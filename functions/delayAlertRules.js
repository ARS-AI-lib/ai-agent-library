'use strict';
// ── Delay / at-risk alerts (2026-10-05) ──────────────────────────────
// Twice a week (Mon 09:30, Thu 13:00 Asia/Bangkok) every Creator gets ONE
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
const RANK = { delayed: 0, due5: 1, risk10: 2, stale: 3 };
const CATEGORY_LABEL = {
  delayed: 'เลย Launch Date แล้ว',
  due5: 'ใกล้ถึง Launch Date (ภายใน 5 วันทำการ)',
  risk10: 'เสี่ยงล่าช้า (At risk · ภายใน 10 วันทำการ)',
  stale: 'ไม่มี Launch Date และสถานะค้างนาน',
};
const STALE_LIMIT = { td: 60, ip: 60, pilot: 30 };
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
    return null;
  }

  const since = toDate(a.phaseSince) || toDate(a.updatedAt) || toDate(a.createdAt);
  if (!since) return null;
  const age = businessDaysBetween(bkkDay(since), ctx.today);
  if (age > STALE_LIMIT[phase]) return { category: 'stale', launchDay: null, progress, phase, bdays: age };
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
const APP_URL = 'https://wolfy-ai-library.web.app';
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtDay = (d) => (d ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d) : '');

function itemNote(it) {
  if (it.category === 'delayed') return `Launch ${fmtDay(it.launchDay)} · เลยมา ${it.bdays} วันทำการ`;
  if (it.category === 'stale') return `${PHASE_LABEL[it.phase]} มา ${it.bdays} วันทำการ · ยังไม่มี Launch Date`;
  return `Launch ${fmtDay(it.launchDay)} · อีก ${it.bdays} วันทำการ`;
}

/** { subject, title, text, html, link, to } for one digest. `forEmail` labels dry-run copies. */
function renderDigest(digest, { forEmail = '' } = {}) {
  const n = digest.items.length;
  const subject = `[AI Library] มี ${n} รายการที่ควรอัปเดต Progress`;
  const title = `มี ${n} รายการที่ควรอัปเดต Progress`;
  let body = `<h2 style="font-size:17px;margin:0 0 12px">${esc(title)}</h2>`;
  if (forEmail) body += `<p style="margin:0 0 12px;color:#b45309">[Dry run] ฉบับนี้จะส่งถึง: ${esc(forEmail)}</p>`;
  body += '<p style="margin:0 0 14px">รายการด้านล่างใกล้ถึงหรือเลย Launch Date แล้ว หรือสถานะค้างนาน โปรดอัปเดต Progress หรือ Launch Date ให้เป็นปัจจุบัน</p>';
  let text = `${title}\n`;
  if (forEmail) text += `[Dry run] ฉบับนี้จะส่งถึง: ${forEmail}\n`;
  for (const cat of Object.keys(RANK)) {
    const rows = digest.items.filter((i) => i.category === cat);
    if (!rows.length) continue;
    body += `<p style="margin:16px 0 6px;font-weight:700">${esc(CATEGORY_LABEL[cat])} (${rows.length})</p>`;
    text += `\n${CATEGORY_LABEL[cat]} (${rows.length})\n`;
    for (const it of rows) {
      const url = `${APP_URL}/?agent=${encodeURIComponent(it.id)}`;
      body += `<p style="margin:3px 0"><a href="${url}" style="color:#2552b0;font-weight:600">${esc(it.name)}</a> <span style="color:#6b7280">· ${it.progress}% · ${esc(itemNote(it))}</span></p>`;
      text += `- ${it.name} · ${it.progress}% · ${itemNote(it)}\n  ${url}\n`;
    }
  }
  const link = n === 1 ? `${APP_URL}/?agent=${encodeURIComponent(digest.items[0].id)}` : `${APP_URL}/`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.65;color:#1f2937;max-width:560px">
${body}
<p style="margin:22px 0 0"><a href="${link}" style="display:inline-block;background:#2f6bff;color:#fff;text-decoration:none;padding:9px 16px;border-radius:6px;font-weight:600">Update Progress</a></p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:22px 0 10px" />
<p style="font-size:11.5px;color:#9ca3af;margin:0">แจ้งเตือนอัตโนมัติทุกวันจันทร์ 09:30 และวันพฤหัสบดี 13:00 · นับเฉพาะวันจันทร์–ศุกร์</p>
</div>`;
  return { subject, title, text: `${text}\n${APP_URL}`, html, link, to: [forEmail || digest.email] };
}

module.exports = {
  TZ, RANK, CATEGORY_LABEL, STALE_LIMIT,
  normalizeProgress, phaseForProgress, toDate, bkkDay, businessDaysBetween,
  getType, isPairedSubSkill, isLive, autoFitStart, timelineStatus, classify, buildDigests, renderDigest,
};
