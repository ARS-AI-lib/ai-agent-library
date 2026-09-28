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
// Plain, table-free HTML with inline styles only. Email clients strip <style>
// blocks and external CSS, and Outlook in particular ignores most modern
// layout — so this stays deliberately boring.

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function shell(bodyHtml, agentIdForLink) {
  const link = agentIdForLink ? `${APP_URL}/` : `${APP_URL}/`;
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.65;color:#1f2937;max-width:560px">
${bodyHtml}
<p style="margin:22px 0 0"><a href="${link}" style="display:inline-block;background:#2f6bff;color:#fff;text-decoration:none;padding:9px 16px;border-radius:6px;font-weight:600">เปิด AI Agent Library</a></p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:22px 0 10px" />
<p style="font-size:11.5px;color:#9ca3af;margin:0">อีเมลนี้ส่งอัตโนมัติจากระบบ AI Agent Library · หากไม่ต้องการรับการแจ้งเตือน แจ้ง Admin เพื่อปิดได้</p>
</div>`;
}

// Returns '' for an empty value: a label with nothing after it ("เมื่อ") reads
// as a rendering bug, and several of these fields are legitimately absent on
// older documents (archivedAt, deployDecidedAt, launchDate).
const row = (k, v) => (String(v == null ? '' : v).trim()
  ? `<p style="margin:3px 0"><span style="color:#6b7280">${esc(k)}</span>&nbsp;&nbsp;<strong>${esc(v)}</strong></p>`
  : '');
const quote = (s) => `<blockquote style="margin:10px 0;padding:10px 14px;background:#f9fafb;border-left:3px solid #d1d5db;color:#374151">${esc(s)}</blockquote>`;

/**
 * Build the full notification, or null when nothing should be sent.
 * Returns { subject, text, html, to[] }.
 */
function buildNotification({ type, doc, agent, users = [], subSkillCount = 0, approverOverride = [] }) {
  const def = EVENTS[type];
  if (!def) return null;
  if (!doc) return null;
  if (!def.verify(doc)) return null;             // forged or stale -> nothing

  // One email per logical action: a cascaded sub-skill is never its own event.
  if (def.scope === 'agent' && doc.matchingAgent) return null;

  const ctx = { agent, approverOverride };
  const to = [...new Set((def.to(doc, users, ctx) || [])
    .map((e) => String(e || '').trim().toLowerCase())
    .filter(Boolean))];
  if (!to.length) return null;

  const a = def.scope === 'agent' ? doc : (agent || {});
  const name = a.agentName || doc.currentName || '(ไม่ทราบชื่อ)';
  let subject = '';
  let body = '';

  switch (type) {
    case 'agent.pending':
      subject = `มีรายการใหม่รออนุมัติ: ${name}`;
      body = `<h2 style="font-size:17px;margin:0 0 12px">มีรายการใหม่รออนุมัติ</h2>
${row('รายการ', name)}${row('ผู้ส่ง', a.creator || '—')}${row('ทีม', a.owner || '—')}
${row('Approve Area', (a.approveArea || []).join(', ') || 'ไม่ระบุ')}
${subSkillCount > 0 ? `<p style="margin:8px 0 0;color:#b06000">มี sub-skill ${subSkillCount} รายการมาพร้อมกัน — อนุมัติครั้งเดียวมีผลทั้งชุด</p>` : ''}`;
      break;

    case 'agent.approved':
      subject = `อนุมัติแล้ว: ${name}`;
      body = `<h2 style="font-size:17px;margin:0 0 12px">อนุมัติแล้ว</h2>
${row('รายการ', name)}${row('อนุมัติโดย', nameOf(a.approvedBy, users))}
<p style="margin:14px 0 0"><strong>ขั้นตอนถัดไป</strong><br/>อัปเดต Progress ได้ตามความคืบหน้า · เมื่อถึง 95% และพร้อมใช้จริง ให้กด <strong>Deployment Request</strong></p>`;
      break;

    case 'agent.rejected':
      subject = `ไม่ผ่านการอนุมัติ: ${name}`;
      body = `<h2 style="font-size:17px;margin:0 0 12px">ไม่ผ่านการอนุมัติ</h2>
${row('รายการ', name)}
${a.rejectionReason ? `<p style="margin:14px 0 4px"><strong>เหตุผลจากผู้ตรวจ</strong></p>${quote(a.rejectionReason)}` : ''}
${a.rejectedBy ? row('ปฏิเสธโดย', nameOf(a.rejectedBy, users)) : ''}${a.rejectedAt ? row('เมื่อ', fmtDate(a.rejectedAt)) : ''}
<p style="margin:14px 0 0;color:#6b7280">รายการยังอยู่ในระบบ ไม่ได้ถูกลบ — แก้ไขแล้วส่งใหม่ได้</p>`;
      break;

    case 'deploy.requested':
      subject = `ขออนุมัติ Deployment: ${name}`;
      body = `<h2 style="font-size:17px;margin:0 0 12px">ขออนุมัติ Deployment</h2>
${row('รายการ', name)}${row('ผู้ขอ', nameOf(a.deployRequestedBy, users))}${row('Progress', `${progressOf(a.devProgress)}%`)}
${subSkillCount > 0 ? `<p style="margin:10px 0 0;color:#b06000">⚠ มี sub-skill <strong>${subSkillCount} รายการ</strong>ผูกอยู่ — อนุมัติครั้งเดียวมีผลกับทั้งชุด</p>` : ''}`;
      break;

    case 'deploy.approved':
      subject = `อนุมัติ Deployment แล้ว: ${name}`;
      body = `<h2 style="font-size:17px;margin:0 0 12px">อนุมัติ Deployment แล้ว</h2>
${row('รายการ', name)}${row('อนุมัติโดย', nameOf(a.deployDecidedBy, users))}${row('เมื่อ', fmtDate(a.deployDecidedAt))}
<p style="margin:14px 0 0"><strong>ตอนนี้ปรับ Progress เป็น 100% ได้แล้ว</strong><br/>แต่ต้องระบุ <strong>Endpoint URL หรือแนบไฟล์</strong>ก่อน ระบบถึงจะให้ผ่าน</p>`;
      break;

    case 'deploy.rejected':
      subject = `Deployment ไม่ผ่าน: ${name}`;
      body = `<h2 style="font-size:17px;margin:0 0 12px">Deployment ไม่ผ่าน</h2>
${row('รายการ', name)}${row('ปฏิเสธโดย', nameOf(a.deployDecidedBy, users))}${row('เมื่อ', fmtDate(a.deployDecidedAt))}
<p style="margin:14px 0 0;color:#6b7280">ปรับแก้แล้วกด Deployment Request ใหม่ได้</p>`;
      break;

    case 'agent.archived':
      subject = `ถูก Archive ออกจาก Library: ${name}`;
      body = `<h2 style="font-size:17px;margin:0 0 12px">ถูก Archive ออกจาก Library</h2>
${row('รายการ', name)}${row('ดำเนินการโดย', nameOf(a.archivedBy, users))}${row('เมื่อ', fmtDate(a.archivedAt))}
${a.archiveReason ? `<p style="margin:14px 0 4px"><strong>เหตุผล</strong></p>${quote(a.archiveReason)}` : ''}
<p style="margin:14px 0 0"><strong>ไม่ได้ถูกลบ</strong> — ข้อมูลยังอยู่ครบ ใช้ตรวจย้อนหลังและเตือนความซ้ำซ้อนได้ แค่ไม่แสดงในไลบรารีและการค้นหา</p>
<p style="margin:8px 0 0;color:#6b7280">หากไม่เห็นด้วย ติดต่อ Approver ประจำ Area หรือ Admin เพื่อนำกลับเข้าระบบ</p>`;
      break;

    case 'agent.ready':
      subject = `พร้อมใช้งานแล้ว: ${name}`;
      body = `<h2 style="font-size:17px;margin:0 0 12px">พร้อมใช้งานแล้ว (Ready to Use)</h2>
${row('รายการ', name)}
${row('ช่องทางใช้งาน', a.endpointFile?.name ? `ไฟล์แนบในระบบ · ${a.endpointFile.name} (ต้อง login ก่อนดาวน์โหลด)` : (a.endpoint || '—'))}
${a.launchDate ? row('Launch date', fmtDate(a.launchDate)) : ''}${row('ดำเนินการโดย', nameOf(a.readyMarkedBy, users))}`;
      break;

    case 'rename.requested':
      subject = `ขอเปลี่ยนชื่อ: ${doc.currentName} → ${doc.requestedName}`;
      body = `<h2 style="font-size:17px;margin:0 0 12px">ขอเปลี่ยนชื่อ Agent/Skill</h2>
${row('ชื่อเดิม', doc.currentName)}${row('ชื่อใหม่ที่ขอ', doc.requestedName)}${row('ผู้ขอ', doc.createdByEmail || '—')}
${row('Approve Area', ((agent || {}).approveArea || []).join(', ') || 'ไม่ระบุ')}
${subSkillCount > 0 ? `<p style="margin:10px 0 0;color:#b06000">⚠ มี sub-skill <strong>${subSkillCount} รายการ</strong>ผูกกับชื่อเดิม — ระบบจะอัปเดตให้อัตโนมัติเมื่ออนุมัติ</p>` : ''}`;
      break;

    case 'rename.decided':
      if (doc.status === 'approved') {
        subject = `อนุมัติเปลี่ยนชื่อแล้ว: ${doc.requestedName}`;
        body = `<h2 style="font-size:17px;margin:0 0 12px">อนุมัติเปลี่ยนชื่อแล้ว</h2>
${row('ชื่อเดิม', doc.currentName)}${row('ชื่อใหม่', doc.appliedName || doc.requestedName)}
${doc.childrenUpdated ? `<p style="margin:10px 0 0">อัปเดตการผูกของ sub-skill ให้แล้ว <strong>${doc.childrenUpdated} รายการ</strong></p>` : ''}`;
      } else {
        subject = `คำขอเปลี่ยนชื่อไม่ผ่าน: ${doc.currentName}`;
        body = `<h2 style="font-size:17px;margin:0 0 12px">คำขอเปลี่ยนชื่อไม่ผ่าน</h2>
${row('ชื่อเดิม (ยังใช้อยู่)', doc.currentName)}${row('ชื่อที่ขอ', doc.requestedName)}
<p style="margin:14px 0 0;color:#6b7280">ชื่อเดิมยังคงเดิมทุกอย่าง</p>`;
      }
      break;

    case 'user.roleChanged':
      subject = 'สิทธิ์ของคุณใน AI Agent Library ถูกปรับ';
      body = `<h2 style="font-size:17px;margin:0 0 12px">สิทธิ์ของคุณถูกปรับ</h2>
${row('บทบาท', doc.role || 'user')}${row('Approve Area', (doc.approveAreas || []).join(', ') || '(ไม่มี)')}
<p style="margin:14px 0 0">รายการที่รออนุมัติใน Area ข้างต้นจะเข้ามาที่คิวของคุณ</p>`;
      break;

    default:
      return null;
  }

  const html = shell(body);
  // Plain-text alternative: strip tags and collapse blank lines. Some clients
  // (and most mail-security scanners) prefer a real text/plain part.
  const text = `${subject}\n\n${body
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/h2>|<\/blockquote>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n\n${APP_URL}`;

  // Teams card extras (2026-09-28). `title` is the plain subject; `link` deep-
  // links to where the recipient acts (App.jsx reads ?agent / ?view); an
  // http(s) endpoint on Ready to Use becomes its own button.
  const QUEUE = new Set(['agent.pending', 'deploy.requested', 'rename.requested']);
  const agentId = def.scope === 'agent' ? doc.id : (agent || {}).id;
  let link = `${APP_URL}/`;
  if (QUEUE.has(type)) link = `${APP_URL}/?view=pending`;
  else if (agentId && type !== 'user.roleChanged') link = `${APP_URL}/?agent=${encodeURIComponent(agentId)}`;
  else if (type === 'user.roleChanged' && ['approver', 'committee', 'admin', 'staff'].includes(doc.role)) link = `${APP_URL}/?view=pending`;
  const endpoint = type === 'agent.ready' && /^https?:\/\//i.test(String(a.endpoint || '').trim()) ? String(a.endpoint).trim() : '';

  return { subject: `[AI Library] ${subject}`, text, html, to, title: subject, link, endpoint };
}

module.exports = {
  APP_URL, EVENTS, EVENT_TYPES,
  areaApprovers, creatorAddresses, nameOf, progressOf, fmtDate,
  buildNotification,
};
