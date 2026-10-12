'use strict';
// ── Delay / at-risk alerts (2026-10-05) ──────────────────────────────
// Once a week (Mon 13:00 Asia/Bangkok) every Creator gets ONE
// digest of their items that are late or about to be, asking them to update
// progress. Pure + offline-testable (verify-delay-alerts.cjs); index.js only
// loads data, enqueues and sends.
//
// ⚠️ PORTS of client logic — functions/ cannot import src/lib at runtime:
//   timelineStatus / autoFitRange  ← src/lib/timeline.js
//   phaseForProgress               ← src/lib/status.js
//   isPairedSubSkill / getType     ← src/lib/agentUtils.js, src/lib/tier.js
// verify-delay-alerts.cjs loads the REAL src/lib files and fails if any
// port disagrees on live data — edit both sides together.

const TZ = 'Asia/Bangkok';
const DAY = 864e5;
const RANK = { delayed: 0, due5: 1, risk10: 2, todo30: 3, ipStale30: 4, ipNoLaunch60: 5, pilotNoLaunch30: 6, pilotLaunch60: 7 };
const CATEGORY_LABEL = {
  delayed: 'เลย Launch Date แล้ว',
  due5: 'ใกล้ถึง Launch Date (ภายใน 5 วันทำการ)',
  risk10: 'เสี่ยงล่าช้า (ภายใน 10 วันทำการ)',
  todo30: 'ยังเป็น To Do เกิน 30 วัน',
  ipStale30: 'Progress ไม่เปลี่ยนแปลงเกิน 30 วัน',
  ipNoLaunch60: 'In Progress เกิน 60 วัน ยังไม่ระบุ Launch Date',
  pilotNoLaunch30: 'Pilot เกิน 30 วัน ยังไม่ระบุ Launch Date',
  pilotLaunch60: 'Pilot เกิน 60 วัน ยังไม่ถึง 100%',
};
// Stuck-item limits (2026-10-05 v2) — CALENDAR days (user decision), unlike the
// business-day launch windows above.
const STUCK_DAYS = { todo: 30, ipNoUpdate: 30, ipNoLaunch: 60, pilotNoLaunch: 30, pilotWithLaunch: 60 };
const PHASE_LABEL = { td: 'To Do', ip: 'In Progress', pilot: 'Pilot', ru: 'Ready to Use' };

// ── value helpers ────────────────────────────────────────────────────
function normalizeProgress(raw) {
  const num = typeof raw === 'number' ? raw : parseInt(String(raw || '').replace('%', ''), 10);
  return isNaN(num) ? 0 : num;
}
// status.js reads the RAW number (string devProgress → 0); callers here pass
// the normalized value, which is what the card/Timeline show.
function phaseForProgress(p) {
  if (p >= 100) return 'ru';
  if (p >= 90) return 'pilot';
  if (p >= 11) return 'ip';
  return 'td';
}
function toDate(v) {
  if (!v) return null;
  try {
    if (v.toDate) return v.toDate();
    if (typeof v._seconds === 'number') return new Date(v._seconds * 1000);
    const d = new Date(v);
    return isNaN(d) ? null : d;
  } catch { return null; }
}

// Calendar day in Bangkok as a UTC-midnight Date (so day arithmetic is exact
// regardless of the server's own timezone).
function bkkDay(d) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).reduce((o, x) => ((o[x.type] = x.value), o), {});
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
}
const calendarDaysBetween = (from, to) => Math.round((to - from) / DAY);
const isWeekday = (d) => { const w = d.getUTCDay(); return w !== 0 && w !== 6; };

// Business days (Mon–Fri) strictly after `from` up to and including `to`.
// Negative when `to` is before `from`.
function businessDaysBetween(from, to) {
  if (to.getTime() === from.getTime()) return 0;
  const sign = to > from ? 1 : -1;
  let n = 0;
  for (let d = new Date(from); ; ) {
    d = new Date(d.getTime() + sign * DAY);
    if (isWeekday(d)) n += sign;
    if (d.getTime() === to.getTime()) break;
  }
  return n;
}

// ── ports ────────────────────────────────────────────────────────────
function getType(a) {
  return (a?.aiAgent === false && a?.skillMd === true) ? 'skill' : 'agent';
}
function matchingAgentNames(s) {
  const m = s?.matchingAgent;
  if (!m) return [];
  if (Array.isArray(m)) return m.map((x) => String(x).trim()).filter(Boolean);
  return String(m).split(',').map((x) => x.trim()).filter(Boolean);
}
function sameSubmitter(a, b) {
  if (a?.createdBy && b?.createdBy && a.createdBy === b.createdBy) return true;
  const ca = (a?.creator || '').trim().toLowerCase();
  const cb = (b?.creator || '').trim().toLowerCase();
  return !!ca && ca === cb;
}
function isPairedSubSkill(skill, all) {
  if (!skill || getType(skill) !== 'skill') return false;
  const parents = matchingAgentNames(skill);
  return all.some((a) => {
    if (getType(a) !== 'agent') return false;
    if (Array.isArray(a.childSkillIds) && a.childSkillIds.includes(skill.id)) return true;
    return parents.length > 0 && sameSubmitter(skill, a) && parents.includes(a.agentName);
  });
}

// timeline.js works in the browser's local (Bangkok) calendar; here every
// date is first mapped to its Bangkok day so the ratios come out the same.
function autoFitStart(agents, milestones) {
  const dates = [];
  agents.forEach((a) => { const d = toDate(a.launchDate); if (d) dates.push(bkkDay(d)); });
  (milestones || []).forEach((m) => {
    const s = toDate(m.start); const e = toDate(m.end);
    if (s) dates.push(bkkDay(s)); if (e) dates.push(bkkDay(e));
  });
  if (!dates.length) return null;
  const min = dates.reduce((x, y) => (y < x ? y : x));
  return new Date(Date.UTC(min.getUTCFullYear(), min.getUTCMonth(), 1));
}
function timelineStatus(progress, launchDay, axisStart, today) {
  if (progress >= 100) return 'done';
  if (progress >= 90) return 'pilot';
  if (!launchDay) return 'ontime';
  if (launchDay > today) {
    const total = (launchDay - axisStart) / DAY;
    const elapsed = (today - axisStart) / DAY;
    const expected = total > 0 ? Math.min(100, (elapsed / total) * 100) : 100;
    return expected - progress <= 20 ? 'ontime' : 'risk';
  }
  return 'delay';
}

// ── classification ───────────────────────────────────────────────────
function isLive(a) {
  return a.approvalStatus === 'approved' && a.archived !== true;
}

/**
 * One category (or null) for one agent. `ctx` = { all, axisStart, today }.
 */
function classify(a, ctx) {
  if (!isLive(a)) return null;
  const progress = normalizeProgress(a.devProgress);
  if (progress >= 100) return null;
  if (isPairedSubSkill(a, ctx.all)) return null;
  const phase = phaseForProgress(progress);
  const launch = toDate(a.launchDate);

  if (launch) {
    const ld = bkkDay(launch);
    if (ld < ctx.today) return { category: 'delayed', launchDay: ld, progress, phase, bdays: businessDaysBetween(ld, ctx.today) };
    const bd = businessDaysBetween(ctx.today, ld);
    if (bd <= 5) return { category: 'due5', launchDay: ld, progress, phase, bdays: bd };
    if (bd <= 10 && ctx.axisStart && timelineStatus(progress, ld, ctx.axisStart, ctx.today) === 'risk') {
      return { category: 'risk10', launchDay: ld, progress, phase, bdays: bd };
    }
  }

  // Stuck items (v2). Clocks fall back to createdAt (user decision for the
  // first rounds: old items have no reliable phase/progress history).
  const created = toDate(a.createdAt);
  const age = (v) => { const d = toDate(v) || created; return d ? calendarDaysBetween(bkkDay(d), ctx.today) : -1; };
  const base = { launchDay: launch ? bkkDay(launch) : null, progress, phase };
  if (phase === 'td') {
    const n = age(a.createdAt);
    if (n > STUCK_DAYS.todo) return { category: 'todo30', ...base, days: n };
  } else if (phase === 'ip') {
    const n = age(a.progressUpdatedAt);
    if (n > STUCK_DAYS.ipNoUpdate) return { category: 'ipStale30', ...base, days: n };
    const m = age(a.phaseSince);
    if (!launch && m > STUCK_DAYS.ipNoLaunch) return { category: 'ipNoLaunch60', ...base, days: m };
  } else if (phase === 'pilot') {
    const m = age(a.phaseSince);
    if (!launch && m > STUCK_DAYS.pilotNoLaunch) return { category: 'pilotNoLaunch30', ...base, days: m };
    if (launch && m > STUCK_DAYS.pilotWithLaunch) return { category: 'pilotLaunch60', ...base, days: m };
  }
  return null;
}

/**
 * All digests for one run: [{ email, items:[{id,name,category,...}] }],
 * sorted by email; items sorted by category priority then name.
 */
function buildDigests(agents, { milestones = [], now = new Date() } = {}) {
  const all = agents;
  const live = agents.filter(isLive);
  const ctx = { all, axisStart: autoFitStart(live, milestones), today: bkkDay(now) };
  const byEmail = new Map();
  for (const a of live) {
    const c = classify(a, ctx);
    if (!c) continue;
    const emails = (Array.isArray(a.creatorEmails) ? a.creatorEmails : [])
      .map((e) => String(e).trim().toLowerCase()).filter(Boolean);
    for (const e of new Set(emails)) {
      if (!byEmail.has(e)) byEmail.set(e, []);
      byEmail.get(e).push({ id: a.id, name: a.agentName || '(no name)', owner: a.owner || '', ...c });
    }
  }
  return [...byEmail.entries()]
    .map(([email, items]) => ({
      email,
      items: items.sort((x, y) => RANK[x.category] - RANK[y.category] || x.name.localeCompare(y.name)),
    }))
    .sort((x, y) => x.email.localeCompare(y.email));
}

// ── rendering ────────────────────────────────────────────────────────
const { APP_URL, esc, frameHtml, htmlToText, NAME_TOKEN } = require('./messageFrame');
const fmtDay = (d) => (d ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d) : '');

// Teams shows at most this many rows; the email always lists everything.
const TEAMS_MAX_ITEMS = 15;

function itemNote(it) {
  if (it.category === 'delayed') return `เลยมา ${it.bdays} วันทำการ (Launch ${fmtDay(it.launchDay)})`;
  if (it.category === 'due5' || it.category === 'risk10') return `อีก ${it.bdays} วันทำการ (Launch ${fmtDay(it.launchDay)})`;
  const launch = it.launchDay ? `Launch ${fmtDay(it.launchDay)}` : 'ยังไม่มี Launch Date';
  if (it.category === 'todo30') return `สร้างมาแล้ว ${it.days} วัน · ${launch}`;
  if (it.category === 'ipStale30') return `ไม่มีการเปลี่ยนแปลง ${it.days} วัน · ${launch}`;
  return `${PHASE_LABEL[it.phase]} มา ${it.days} วัน · ${launch}`;
}

const itemUrl = (it) => `${APP_URL}/?agent=${encodeURIComponent(it.id)}`;

/**
 * { subject, title, text, html, link, to, cardLines, ctaLabel, names } for one digest.
 * Several items: every row links to its own item and there is NO button at the
 * end (a single button could only point at the library home). One item: one
 * button that names that item. `forEmail` labels dry-run copies.
 */
function renderDigest(digest, { forEmail = '', displayName = '' } = {}) {
  const items = digest.items;
  const n = items.length;
  const one = n === 1 ? items[0] : null;
  const subject = one
    ? `[AI Library] Progress Update Required: ${one.name}`
    : `[AI Library] Progress Update Required: ${n} items`;
  const title = one ? `Progress Update Required: ${one.name}` : `Progress Update Required: ${n} items`;

  let body = '';
  if (forEmail) body += `<p style="margin:0 0 12px;color:#b45309">[Dry run] ฉบับนี้จะส่งถึง: ${esc(forEmail)}</p>`;
  const cardLines = [];
  let textBody = '';

  if (one) {
    body += `<p style="margin:0 0 10px"><strong>${esc(one.name)}</strong> (Progress ${one.progress}%)<br/>${esc(CATEGORY_LABEL[one.category])} · ${esc(itemNote(one))}</p>
<p style="margin:0">โปรดตรวจสอบและปรับ Progress หรือ Launch Date ให้ตรงกับสถานะจริง</p>`;
    cardLines.push(`${one.name} (Progress ${one.progress}%)`, `${CATEGORY_LABEL[one.category]} · ${itemNote(one)}`, 'โปรดตรวจสอบและปรับ Progress หรือ Launch Date ให้ตรงกับสถานะจริง');
    textBody = `${one.name} (Progress ${one.progress}%)\n${CATEGORY_LABEL[one.category]} · ${itemNote(one)}\nโปรดตรวจสอบและปรับ Progress หรือ Launch Date ให้ตรงกับสถานะจริง`;
  } else {
    body += `<p style="margin:0 0 6px">รายการ Agent/Skill ของท่านที่ควรตรวจสอบความคืบหน้า <strong>${n} รายการ</strong></p>
<p style="margin:0 0 6px;color:#374151">กด “Update” ท้ายรายการเพื่อเปิดและแก้ไขได้ทันที</p>`;
    cardLines.push('กด “Update” ท้ายรายการเพื่อเปิดและแก้ไขได้ทันที');
    textBody = `รายการ Agent/Skill ของท่านที่ควรตรวจสอบความคืบหน้า ${n} รายการ\nกด link ท้ายรายการเพื่อเปิดและแก้ไขได้ทันที\n`;
    let shown = 0;
    for (const cat of Object.keys(RANK)) {
      const rows = items.filter((i) => i.category === cat);
      if (!rows.length) continue;
      body += `<p style="margin:16px 0 6px;font-weight:700">${esc(CATEGORY_LABEL[cat])} (${rows.length})</p>`;
      textBody += `\n${CATEGORY_LABEL[cat]} (${rows.length})\n`;
      let headed = false;
      for (const it of rows) {
        const url = itemUrl(it);
        body += `<p style="margin:3px 0"><a href="${url}" style="color:#2552b0;font-weight:600">${esc(it.name)}</a> <span style="color:#6b7280">· ${it.progress}% · ${esc(itemNote(it))}</span> &nbsp;<a href="${url}" style="color:#2552b0;white-space:nowrap">Update ›</a></p>`;
        textBody += `- ${it.name} · ${it.progress}% · ${itemNote(it)}\n  Update: ${url}\n`;
        if (shown < TEAMS_MAX_ITEMS) {
          if (!headed) { cardLines.push(`**${CATEGORY_LABEL[cat]} (${rows.length})**`); headed = true; }
          cardLines.push(`• ${it.name} · ${it.progress}% · ${itemNote(it)} — [Update](${url})`);
        }
        shown += 1;
      }
    }
    if (n > TEAMS_MAX_ITEMS) cardLines.push(`และอีก ${n - TEAMS_MAX_ITEMS} รายการ — ดูรายการทั้งหมดในอีเมลฉบับเดียวกัน`);
  }

  const link = one ? itemUrl(one) : `${APP_URL}/`;
  const ctaLabel = one ? 'Update Progress' : '';
  const html = frameHtml(body, {
    cta: one ? { label: ctaLabel, link } : null,
    footerNote: 'ส่งทุกวันจันทร์ เวลา 13:00 · นับวันทำการเฉพาะจันทร์–ศุกร์',
  });
  const text = `เรียน ${NAME_TOKEN}\n\n${htmlToText(forEmail ? `[Dry run] ฉบับนี้จะส่งถึง: ${forEmail}\n` : '')}${forEmail ? '\n' : ''}${textBody}\n${one ? `${ctaLabel}: ${link}\n\n` : ''}ขอแสดงความนับถือ\nAI Agent Library Team`;
  const target = forEmail || digest.email;
  return { subject, title, text, html, link, ctaLabel, cardLines, to: [target], names: displayName ? { [String(digest.email).toLowerCase()]: displayName, [String(target).toLowerCase()]: displayName } : {} };
}

module.exports = {
  TZ, RANK, CATEGORY_LABEL, STUCK_DAYS, calendarDaysBetween,
  normalizeProgress, phaseForProgress, toDate, bkkDay, businessDaysBetween,
  getType, isPairedSubSkill, isLive, autoFitStart, timelineStatus, classify, buildDigests, renderDigest,
};
