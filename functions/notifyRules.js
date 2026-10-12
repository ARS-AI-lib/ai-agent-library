/**
 * Email notification catalog, verification, routing and rendering (2026-08-20).
 *
 * Split out of index.js for the same reason endpointFileRules.js /
 * agentReadyRules.js / embedText.js were: so verify-notify.cjs exercises THE
 * REAL RULES against live data rather than a copy that drifts. These decide
 * who receives mail about what, so testing a stale duplicate would be worse
 * than not testing.
 *
 * Everything here is pure — no Firestore, no network, no clock beyond what is
 * passed in — which is what makes the whole system verifiable offline, before
 * a single real email is sent.
 *
 * ── Three properties that make this safe ──
 * 1. The CLIENT NEVER NAMES RECIPIENTS. It sends `{ type, agentId }`; routing
 *    happens here, server-side.
 * 2. EVERY EVENT IS VERIFIED against the real document before anything is
 *    sent (`verify` below). A forged event describes a state that isn't true,
 *    so it resolves to nothing and dies silently.
 * 3. ONE EMAIL PER LOGICAL ACTION. Paired sub-skills are skipped outright —
 *    a deploy request on a 7-child parent writes 8 docs, and a naive
 *    per-write notifier would send 8 emails for one human decision.
 *
 * ── Why routing reads STORED approveArea ──
 * agentApproveAreas() is a 7-layer resolver in src/lib/approveAreas.js and is
 * not part of the deployed function bundle; copying its tables here is
 * forbidden (CLAUDE.md §20). Layer 1 — the stored field — wins over every
 * other layer anyway. When an agent has no stored area, routing falls back to
 * admin/committee, which is exactly what visiblePending() does today.
 */

const APP_URL = 'https://wolfy-ai-library.web.app';

// Roles that receive area-routed mail. Mirrors the approver queue: admin and
// committee are the fullAccess safety net and see everything.
const FULL_ACCESS_ROLES = new Set(['admin', 'committee']);
const AREA_ROLES = new Set(['approver']);

const fmtDate = (ts) => {
  const d = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : null);
  if (!d) return '';
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok',
  }).format(d);
};

// Firestore Timestamp / Date / millis -> millis (0 when absent).
const toMillis = (ts) => {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'number') return ts;
  return 0;
};
const FILE_UPDATE_WINDOW_MS = 10 * 60 * 1000;

const progressOf = (raw) => {
  if (typeof raw === 'number') return raw;
  const m = String(raw || '').match(/\d+/);
  return m ? Number(m[0]) : 0;
};

/** uid -> display name, falling back to email then a neutral placeholder. */
function nameOf(uid, users) {
  if (!uid) return 'ระบบ';
  const u = users.find((x) => x.id === uid);
  return u?.displayName || u?.email || 'ผู้ใช้ในระบบ';
}

/** Everyone who should act on this agent, by stored area. */
function areaApprovers(agent, users) {
  const areas = Array.isArray(agent?.approveArea) ? agent.approveArea : [];
  const full = users.filter((u) => FULL_ACCESS_ROLES.has(u.role));
  if (!areas.length) return full; // no area -> only the safety net is reachable
  const scoped = users.filter((u) => AREA_ROLES.has(u.role)
    && (u.approveAreas || []).some((a) => areas.includes(a)));
  return [...full, ...scoped];
}

/** The agent's creators — creatorEmails is the field the rules already trust. */
function creatorAddresses(agent) {
  return Array.isArray(agent?.creatorEmails) ? agent.creatorEmails.filter(Boolean) : [];
}

function emailsOf(users) {
  return users.map((u) => u.email).filter(Boolean);
}

/**
 * Approver-side recipients. `ctx.approverOverride` (from /config/mail, set
 * 2026-09-28) REPLACES the area routing with a fixed list — the user asked
 * that approver notifications go only to them until they say otherwise.
 * Creator-side recipients are never affected.
 */
function approverEmails(agent, users, ctx) {
  const o = Array.isArray(ctx?.approverOverride) ? ctx.approverOverride.filter(Boolean) : [];
  return o.length ? o : emailsOf(areaApprovers(agent, users));
}

/**
 * The event catalog. `verify` is the guard that makes forged events inert —
 * it re-reads the real doc and asks "does it actually say this happened?"
 */
const EVENTS = {
  'agent.pending': {
    scope: 'agent',
    verify: (a) => a.approvalStatus === 'pending',
    to: (a, users, ctx) => approverEmails(a, users, ctx),
  },
  'agent.approved': {
    scope: 'agent',
    verify: (a) => a.approvalStatus === 'approved',
    to: (a) => creatorAddresses(a),
  },
  'agent.rejected': {
    scope: 'agent',
    verify: (a) => a.approvalStatus === 'rejected',
    to: (a) => creatorAddresses(a),
  },
  'deploy.requested': {
    scope: 'agent',
    verify: (a) => a.deploymentStatus === 'requested',
    to: (a, users, ctx) => approverEmails(a, users, ctx),
  },
  'deploy.approved': {
    scope: 'agent',
    verify: (a) => a.deploymentStatus === 'approved',
    to: (a, users) => [...creatorAddresses(a), ...emailsOf(users.filter((u) => u.id === a.deployRequestedBy))],
  },
  'deploy.rejected': {
    scope: 'agent',
    verify: (a) => a.deploymentStatus === 'rejected',
    to: (a, users) => [...creatorAddresses(a), ...emailsOf(users.filter((u) => u.id === a.deployRequestedBy))],
  },
  'agent.archived': {
    scope: 'agent',
    verify: (a) => a.archived === true,
    to: (a) => creatorAddresses(a),
  },
  'agent.ready': {
    scope: 'agent',
    verify: (a) => progressOf(a.devProgress) === 100,
    to: (a, users, ctx) => [...creatorAddresses(a), ...approverEmails(a, users, ctx)],
  },
  // Endpoint file replaced via the Attach Endpoint File menu (2026-10-07).
  // The first attach during the 100% flow is NOT this event — that path
  // already sends agent.ready, and one action = one notification.
  'file.updated': {
    scope: 'agent',
    // Fresh upload only: a replayed/forged call minutes later describes
    // nothing that just happened. `now` is passed in (this file reads no clock).
    verify: (a, ctx) => !!a.endpointFile?.storagePath
      && ctx.now - toMillis(a.endpointFile.uploadedAt) <= FILE_UPDATE_WINDOW_MS,
    to: (a, users, ctx) => [...creatorAddresses(a), ...approverEmails(a, users, ctx)],
    // A sub-skill upload is its own action, not a cascade — so the
    // one-email-per-action skip below does not apply.
    allowSubSkill: true,
    // The uploader already knows; never mail them about their own upload.
    excludeActor: true,
  },
  'rename.requested': {
    scope: 'renameRequest',
    verify: (r) => r.status === 'pending',
    to: (r, users, ctx) => approverEmails(ctx.agent || {}, users, ctx),
  },
  'rename.decided': {
    scope: 'renameRequest',
    verify: (r) => r.status === 'approved' || r.status === 'rejected',
    to: (r) => [r.createdByEmail].filter(Boolean),
  },
  // Skill → Agent link requests (2026-09-30). doc = the skill, ctx.agent = target.
  'link.requested': {
    scope: 'link',
    verify: (s) => s?.linkSuggestion?.status === 'pending',
    // Creators of the TARGET agent + its area approvers (approverOverride applies).
    to: (s, users, ctx) => [...creatorAddresses(ctx.agent || {}), ...approverEmails(ctx.agent || {}, users, ctx)],
  },
  'link.decided': {
    scope: 'link',
    verify: (s) => ['accepted', 'rejected'].includes(s?.linkSuggestion?.status),
    to: (s) => creatorAddresses(s),
  },
  'user.roleChanged': {
    scope: 'user',
    // Nothing to verify against a previous state — the app stores no role
    // history, and the user deliberately chose not to add an audit field.
    // Existence of the user doc is the only check available.
    verify: (u) => !!u,
    to: (u) => [u.email].filter(Boolean),
  },
};

const EVENT_TYPES = Object.keys(EVENTS);

// ── Rendering ────────────────────────────────────────────────────────
// Frame (greeting / closing / one optional button) lives in messageFrame.js so
// events and the delay digest read the same. Each case below writes one lead
// sentence + a few rows; the button names the action it leads to.
const { esc, frameHtml, htmlToText, NAME_TOKEN } = require('./messageFrame');

// Returns '' for an empty value: a label with nothing after it ("เมื่อ") reads
// as a rendering bug, and several of these fields are legitimately absent on
// older documents (archivedAt, deployDecidedAt, launchDate).
const row = (k, v) => (String(v == null ? '' : v).trim()
  ? `<p style="margin:3px 0"><span style="color:#6b7280">${esc(k)}</span>&nbsp;&nbsp;<strong>${esc(v)}</strong></p>`
  : '');
const quote = (s) => `<blockquote style="margin:10px 0;padding:10px 14px;background:#f9fafb;border-left:3px solid #d1d5db;color:#374151">${esc(s)}</blockquote>`;
const lead = (html) => `<p style="margin:0 0 10px">${html}</p>`;
const note = (html, color = '#6b7280') => `<p style="margin:12px 0 0;color:${color}">${html}</p>`;

/**
 * Build the full notification, or null when nothing should be sent.
 * Returns { subject, text, html, to[], title, link, ctaLabel, endpoint, cardLines, names }.
 * `html` / `cardLines` carry the {{name}} placeholder; mailer fills it per recipient.
 */
function buildNotification({
  type, doc, agent, users = [], subSkillCount = 0, approverOverride = [],
  actorEmail = '', now = Date.now(),
}) {
  const def = EVENTS[type];
  if (!def) return null;
  if (!doc) return null;
  const ctx = { agent, approverOverride, now };
  if (!def.verify(doc, ctx)) return null;        // forged or stale -> nothing

  // One email per logical action: a cascaded sub-skill is never its own event.
  if (def.scope === 'agent' && doc.matchingAgent && !def.allowSubSkill) return null;

  const actor = String(actorEmail || '').trim().toLowerCase();
  const to = [...new Set((def.to(doc, users, ctx) || [])
    .map((e) => String(e || '').trim().toLowerCase())
    .filter(Boolean))]
    .filter((e) => !(def.excludeActor && actor && e === actor));
  if (!to.length) return null;

  const a = def.scope === 'agent' ? doc : (agent || {});
  const name = a.agentName || doc.currentName || '(ไม่ทราบชื่อ)';
  let subject = '';
  let body = '';
  let ctaLabel = 'View item';

  switch (type) {
    case 'agent.pending':
      subject = `Approval Required: ${name}`;
      ctaLabel = 'Review & approve';
      body = `${lead(`มีรายการใหม่รอการอนุมัติ: <strong>${esc(name)}</strong>`)}
${row('ผู้ส่ง', a.creator || '—')}${row('Team', a.owner || '—')}${row('Approve Area', (a.approveArea || []).join(', ') || 'ไม่ระบุ')}
${subSkillCount > 0 ? note(`มี Skill ประกอบ ${subSkillCount} รายการ อนุมัติครั้งเดียวมีผลทั้งชุด`, '#b06000') : ''}`;
      break;

    case 'agent.approved':
      subject = `Approved: ${name}`;
      ctaLabel = 'Open item';
      body = `${lead(`<strong>${esc(name)}</strong> ได้รับการอนุมัติแล้ว${a.approvedBy ? ` โดย ${esc(nameOf(a.approvedBy, users))}` : ''}`)}
<p style="margin:12px 0 0"><strong>ขั้นตอนถัดไป</strong><br/>Update Progress ตามความคืบหน้า และกดขอ Deployment เมื่อถึง 95% และพร้อมใช้งานจริง</p>`;
      break;

    case 'agent.rejected':
      subject = `Not Approved: ${name}`;
      ctaLabel = 'Edit & resubmit';
      body = `${lead(`<strong>${esc(name)}</strong> ไม่ผ่านการอนุมัติ`)}
${a.rejectionReason ? `<p style="margin:12px 0 4px"><strong>เหตุผลจากผู้ตรวจ</strong></p>${quote(a.rejectionReason)}` : ''}
${a.rejectedBy ? row('ตรวจโดย', nameOf(a.rejectedBy, users)) : ''}${a.rejectedAt ? row('เมื่อ', fmtDate(a.rejectedAt)) : ''}
${note('รายการยังอยู่ในระบบ ไม่ได้ถูกลบ สามารถแก้ไขแล้วส่งใหม่ได้')}`;
      break;

    case 'deploy.requested':
      subject = `Deployment Approval Required: ${name}`;
      ctaLabel = 'Review & approve';
      body = `${lead(`<strong>${esc(name)}</strong> ขออนุมัติ Deployment`)}
${row('ผู้ขอ', nameOf(a.deployRequestedBy, users))}${row('Progress', `${progressOf(a.devProgress)}%`)}
${subSkillCount > 0 ? note(`มี Skill ผูกอยู่ <strong>${subSkillCount} รายการ</strong> อนุมัติครั้งเดียวมีผลกับทั้งชุด`, '#b06000') : ''}`;
      break;

    case 'deploy.approved':
      subject = `Deployment Approved: ${name}`;
      ctaLabel = 'Update progress';
      body = `${lead(`Deployment ของ <strong>${esc(name)}</strong> ได้รับอนุมัติแล้ว${a.deployDecidedBy ? ` โดย ${esc(nameOf(a.deployDecidedBy, users))}` : ''}`)}
${row('เมื่อ', fmtDate(a.deployDecidedAt))}
<p style="margin:12px 0 0"><strong>ขั้นตอนถัดไป</strong><br/>ปรับ Progress เป็น 100% ได้เมื่อระบุ <strong>Endpoint URL หรือแนบ file</strong>แล้ว</p>`;
      break;

    case 'deploy.rejected':
      subject = `Deployment Not Approved: ${name}`;
      body = `${lead(`Deployment ของ <strong>${esc(name)}</strong> ไม่ผ่านการอนุมัติ`)}
${row('ตรวจโดย', nameOf(a.deployDecidedBy, users))}${row('เมื่อ', fmtDate(a.deployDecidedAt))}
${note('ปรับแก้แล้วสามารถกดขอ Deployment ใหม่ได้')}`;
      break;

    case 'agent.archived':
      subject = `Archived: ${name}`;
      body = `${lead(`<strong>${esc(name)}</strong> ถูก Archive ออกจาก Library`)}
${row('ดำเนินการโดย', nameOf(a.archivedBy, users))}${row('เมื่อ', fmtDate(a.archivedAt))}
${a.archiveReason ? `<p style="margin:12px 0 4px"><strong>เหตุผล</strong></p>${quote(a.archiveReason)}` : ''}
<p style="margin:12px 0 0">ข้อมูลไม่ได้ถูกลบ ยังใช้ตรวจย้อนหลังได้ เพียงไม่แสดงในไลบรารีและการค้นหา</p>
${note('หากไม่เห็นด้วย โปรดติดต่อ Approver ประจำ Area หรือ Admin เพื่อนำกลับเข้าระบบ')}`;
      break;

    case 'agent.ready':
      subject = `Ready to Use: ${name}`;
      body = `${lead(`<strong>${esc(name)}</strong> พร้อมใช้งานแล้ว (Ready to Use)`)}
${row('ช่องทางใช้งาน', a.endpointFile?.name ? `File แนบในระบบ · ${a.endpointFile.name} (ต้อง login ก่อน download)` : (a.endpoint || '—'))}
${a.launchDate ? row('Launch date', fmtDate(a.launchDate)) : ''}${row('ดำเนินการโดย', nameOf(a.readyMarkedBy, users))}`;
      break;

    case 'file.updated': {
      const v = a.endpointFileVersion ? `v${a.endpointFileVersion}` : '';
      subject = `File updated${v ? ` ${v}` : ''}: ${name}`;
      body = `${lead(`File ของ <strong>${esc(name)}</strong> ถูก update${v ? ` เป็น ${esc(v)}` : ''}`)}
${row('File', a.endpointFile?.name || '—')}${row('Uploaded by', nameOf(a.endpointFile?.uploadedBy, users))}${row('เมื่อ', fmtDate(a.endpointFile?.uploadedAt))}
${note('ดู version ก่อนหน้าได้ใน File History ของรายการนี้ (ต้อง login ก่อน download)')}`;
      break;
    }

    case 'rename.requested':
      subject = `Rename Request: ${doc.currentName} → ${doc.requestedName}`;
      ctaLabel = 'Review & approve';
      body = `${lead('มีคำขอเปลี่ยนชื่อ Agent/Skill')}
${row('ชื่อเดิม', doc.currentName)}${row('ชื่อใหม่ที่ขอ', doc.requestedName)}${row('ผู้ขอ', doc.createdByEmail || '—')}
${row('Approve Area', ((agent || {}).approveArea || []).join(', ') || 'ไม่ระบุ')}
${subSkillCount > 0 ? note(`มี Skill ผูกกับชื่อเดิม <strong>${subSkillCount} รายการ</strong> ระบบจะ update ให้อัตโนมัติเมื่ออนุมัติ`, '#b06000') : ''}`;
      break;

    case 'rename.decided':
      if (doc.status === 'approved') {
        subject = `Rename Approved: ${doc.currentName} → ${doc.requestedName}`;
        body = `${lead('คำขอเปลี่ยนชื่อได้รับการอนุมัติแล้ว')}
${row('ชื่อเดิม', doc.currentName)}${row('ชื่อใหม่', doc.appliedName || doc.requestedName)}
${doc.childrenUpdated ? note(`update การผูกของ Skill ให้แล้ว <strong>${doc.childrenUpdated} รายการ</strong>`, '#1f2937') : ''}`;
      } else {
        subject = `Rename Not Approved: ${doc.currentName}`;
        body = `${lead('คำขอเปลี่ยนชื่อไม่ผ่านการอนุมัติ')}
${row('ชื่อที่ใช้อยู่', doc.currentName)}${row('ชื่อที่ขอ', doc.requestedName)}
${note('ชื่อเดิมยังคงใช้ต่อไปตามปกติ')}`;
      }
      break;

    case 'link.requested': {
      const t = agent || {};
      subject = `Skill Link Request: ${doc.agentName} → ${t.agentName || doc.linkSuggestion?.agentName || ''}`;
      ctaLabel = 'Review request';
      body = `${lead('มีคำขอผูก Skill เข้ากับ Agent')}
${row('Skill', doc.agentName)}${row('Skill Team', doc.owner || '—')}${row('Agent', t.agentName || '—')}${row('Agent Team', t.owner || '—')}
${note('AI แนะนำการผูกนี้ตอนลงทะเบียน สามารถยืนยันหรือปฏิเสธได้ที่หน้ารออนุมัติ (Link Requests)', '#1f2937')}`;
      break;
    }

    case 'link.decided': {
      const ok = doc.linkSuggestion?.status === 'accepted';
      const tn = (agent || {}).agentName || doc.linkSuggestion?.agentName || '';
      subject = ok ? `Skill Linked: ${doc.agentName} → ${tn}` : `Skill Link Declined: ${doc.agentName}`;
      body = `${lead(ok ? 'Skill ถูกผูกกับ Agent แล้ว' : 'คำขอผูก Skill กับ Agent ไม่ผ่าน')}
${row('Skill', doc.agentName)}${row('Agent', tn || '—')}${row('ตัดสินโดย', nameOf(doc.linkSuggestion?.decidedBy, users))}
${ok ? note('Progress และ Deployment ของ Skill นี้จะเปลี่ยนตาม Agent หลักต่อจากนี้', '#1f2937') : note('Skill ยังเป็นรายการอิสระเหมือนเดิม')}`;
      break;
    }

    case 'user.roleChanged':
      subject = 'Your Access Has Changed';
      ctaLabel = 'Open AI Agent Library';
      body = `${lead('สิทธิ์การใช้งานของท่านถูกปรับ')}
${row('บทบาท', doc.role || 'user')}${row('Approve Area', (doc.approveAreas || []).join(', ') || '(ไม่มี)')}
${note('รายการที่รออนุมัติใน Area ข้างต้นจะเข้ามาที่ queue ของท่าน', '#1f2937')}`;
      break;

    default:
      return null;
  }

  // Teams card extras (2026-09-28). `title` is the plain subject; `link` deep-
  // links to where the recipient acts (App.jsx reads ?agent / ?view); an
  // http(s) endpoint on Ready to Use becomes its own button.
  const QUEUE = new Set(['agent.pending', 'deploy.requested', 'rename.requested', 'link.requested']);
  const agentId = (def.scope === 'agent' || def.scope === 'link') ? doc.id : (agent || {}).id;
  let link = `${APP_URL}/`;
  if (QUEUE.has(type)) link = `${APP_URL}/?view=pending`;
  else if (agentId && type !== 'user.roleChanged') link = `${APP_URL}/?agent=${encodeURIComponent(agentId)}`;
  else if (type === 'user.roleChanged' && ['approver', 'committee', 'admin', 'staff'].includes(doc.role)) link = `${APP_URL}/?view=pending`;
  const endpoint = type === 'agent.ready' && /^https?:\/\//i.test(String(a.endpoint || '').trim()) ? String(a.endpoint).trim() : '';

  const html = frameHtml(body, { cta: { label: ctaLabel, link } });
  const bodyText = htmlToText(body);
  const text = `เรียน ${NAME_TOKEN}\n\n${bodyText}\n\n${ctaLabel}: ${link}\n\nขอแสดงความนับถือ\nAI Agent Library Team`;
  const cardLines = bodyText.split('\n').filter((l) => l.trim());
  const names = {};
  users.forEach((u) => { if (u.email && u.displayName) names[String(u.email).toLowerCase()] = u.displayName; });

  return { subject: `[AI Library] ${subject}`, text, html, to, title: subject, link, ctaLabel, endpoint, cardLines, names };
}

module.exports = {
  APP_URL, EVENTS, EVENT_TYPES,
  areaApprovers, creatorAddresses, nameOf, progressOf, fmtDate, toMillis,
  FILE_UPDATE_WINDOW_MS,
  buildNotification,
};
