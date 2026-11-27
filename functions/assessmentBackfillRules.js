'use strict';
// Assessment backfill rules (pure, offline-testable). Config answers are { questionId: optionId }.
const {
  normalizeProgress, isPairedSubSkill, getTier,
} = require('./delayAlertRules');
const { frameHtml, esc, salutation } = require('./messageFrame');
const { isAgentCreator } = require('./agentReadyRules');

const DECL_KEYS = ['description', 'permittedDomains', 'prohibitedUses', 'tool', 'requiredSkills', 'llm'];
const lc = (e) => String(e || '').trim().toLowerCase();
const filled = (v) => String(v ?? '').trim() !== '';

const optionOf = (q, id) => q.options.find((o) => o.id === id) || null;

/** Port of screening.evaluate + per-option blocksPre||blocksDeploy. Unknown option id = unanswered. */
function evaluateAnswers(config, answers) {
  let total = 0; let complete = true; const blocking = [];
  (config.questions || []).forEach((q) => {
    const o = optionOf(q, answers?.[q.id]);
    if (!o) { complete = false; return; }
    total += o.score || 0;
    if (o.blocksPre || o.blocksDeploy) blocking.push(q.code);
  });
  const t = config.thresholds;
  const level = complete ? (total >= t.hi ? 'High' : total >= t.md ? 'Medium' : 'Low') : null;
  return { complete, total, level, blocking };
}

function backfillVerdict({ config, answers, tier }) {
  const { level, total, blocking } = evaluateAnswers(config, answers);
  const high = tier !== 'T1' && level === 'High';
  const reasons = [...blocking, ...(high ? ['High'] : [])];
  return { pass: blocking.length === 0 && !high, level, total, reasons };
}

function backfillStatus(agent, config) {
  if (agent?.assessment?.status) return agent.assessment.status;
  if (agent?.screening?.deployAt) {
    return backfillVerdict({ config, answers: agent.screening.answers || {}, tier: getTier(agent) }).pass ? 'pass' : 'fail';
  }
  return 'not_done';
}

function inBackfillScope(agent, all) {
  return agent?.approvalStatus === 'approved' && agent.archived !== true
    && normalizeProgress(agent.devProgress) >= 90 && !isPairedSubSkill(agent, all || []);
}

function creatorDigests(rows) {
  const by = new Map(); const noEmail = [];
  (rows || []).forEach(({ agent, status }) => {
    if (status !== 'not_done') return;
    const emails = [...new Set((Array.isArray(agent.creatorEmails) ? agent.creatorEmails : []).map(lc).filter(Boolean))];
    if (!emails.length) { noEmail.push(agent.id); return; }
    const item = { id: agent.id, name: agent.agentName || '', phase: normalizeProgress(agent.devProgress) >= 100 ? 'Ready to Use' : 'Pilot' };
    emails.forEach((e) => { if (!by.has(e)) by.set(e, []); by.get(e).push(item); });
  });
  return { digests: [...by].map(([email, items]) => ({ email, items })), noEmail };
}

const isCreator = (agent, user) => isAgentCreator(agent, { userEmail: user?.email, userUid: user?.uid });
const canSubmit = (agent, user) => (isCreator(agent, user) ? null : 'เฉพาะ Creator ของรายการนี้เท่านั้นที่ทำ Assessment ได้');
function canDecideReview(agent, user) {
  if (user?.role === 'admin') return null;
  const areas = Array.isArray(agent?.approveArea) ? agent.approveArea : [];
  if (user?.role === 'approver' && (user.approveAreas || []).some((a) => areas.includes(a))) return null;
  return 'เฉพาะ Admin หรือ Approver ประจำ Area นี้เท่านั้น';
}

function notPassRecipients(agent, users, cfg) {
  const o = (Array.isArray(cfg?.assessmentApproverOverride) ? cfg.assessmentApproverOverride : []).filter(Boolean);
  const areas = Array.isArray(agent?.approveArea) ? agent.approveArea : [];
  const fixed = users.filter((u) => u.role === 'admin' || u.role === 'committee').map((u) => u.email);
  const appr = o.length ? o : users.filter((u) => u.role === 'approver' && (u.approveAreas || []).some((a) => areas.includes(a))).map((u) => u.email);
  const creators = Array.isArray(agent?.creatorEmails) ? agent.creatorEmails : [];
  return [...new Set([...fixed, ...appr, ...creators].map(lc).filter(Boolean))];
}

const formatDueDate = (d) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' }).format(d);

// "[Due date]" in the intro/closing is replaced with the formatted due date at render time, so the
// date always follows the Due date field even when the admin edited the text.
const DUE_TOKEN = '[Due date]';
const DEFAULT_INTRO = 'AI Agent Library เพิ่มแบบประเมินความเสี่ยง (Assessment) สำหรับ Agent/Skill\nซึ่ง Agent/Skill ของท่านบน Library ยังไม่ผ่านการประเมินดังกล่าว\nโดยรายการที่ท่านจำเป็นจะต้องทำแบบประเมินให้แล้วเสร็จมีดังนี้:';
const DEFAULT_OUTRO = `ขอความกรุณาตอบแบบประเมินให้แล้วเสร็จภายในวันที่ ${DUE_TOKEN}\nหากรายการใดไม่ได้อยู่ภายใต้ความดูแลของท่าน สามารถตอบกลับอีเมลนี้เพื่อแจ้งรายละเอียด\n\nขอบพระคุณยิ่ง\nทีม AI Agent Library`;
const subjectFor = () => 'ขอความร่วมมือตอบ Assessment สำหรับ Agent/Skill ของท่าน';
const withDue = (t, dueDate) => String(t).split(DUE_TOKEN).join(dueDate);

/** Editable parts with their default copy (page pre-fills from this). */
const defaultMessageParts = () => ({ subject: subjectFor(), intro: DEFAULT_INTRO, outro: DEFAULT_OUTRO });

// eslint-disable-next-line no-control-regex
const stripCtl = (t) => String(t).replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim();
/** Validate + clean the admin's message overrides. Empty string = use default. Throws invalid-argument. */
function validateMessage(m) {
  if (m == null) return {};
  if (typeof m !== 'object' || Array.isArray(m)) throw err('invalid-argument', 'message ไม่ถูกต้อง');
  const limits = { subject: 200, intro: 2000, outro: 2000 };
  const out = {};
  Object.entries(limits).forEach(([k, max]) => {
    if (m[k] == null) return;
    if (typeof m[k] !== 'string') throw err('invalid-argument', `message.${k} ไม่ถูกต้อง`);
    if (m[k].length > max) throw err('invalid-argument', `message.${k} ยาวเกิน ${max} ตัวอักษร`);
    out[k] = k === 'subject' ? stripCtl(m[k].replace(/[\r\n\t]+/g, ' ')).replace(/ {2,}/g, ' ') : stripCtl(m[k]);
  });
  return out;
}

/** Optional list of agent ids chosen on the admin page (never trusted for scope/status). */
function validateAgentIds(ids) {
  if (ids == null) return null;
  if (!Array.isArray(ids) || ids.length > 1000 || ids.some((x) => typeof x !== 'string' || !x || x.length > 128)) throw err('invalid-argument', 'agentIds ไม่ถูกต้อง');
  return ids;
}
const selectRows = (rows, ids) => (ids ? rows.filter((r) => ids.includes(r.agent.id)) : rows);

const paras = (t) => String(t).split(/\n{2,}/).map((p) => `<p style="margin:0 0 16px">${esc(p).replace(/\n/g, '<br/>')}</p>`).join('');

// Teams: first item line and first closing line get a larger gap above (object form is used only here).
const cardBlocks = (intro, items, outro) => [
  ...intro,
  ...items.map((t, i) => (i === 0 ? { text: t, spacing: 'Large' } : t)),
  ...outro.map((t, i) => (i === 0 ? { text: t, spacing: 'Large' } : t)),
];

function renderBackfillMessage({ displayName, items, dueDate, appUrl, overrides }) {
  const o = overrides || {};
  const pick = (k, d) => (typeof o[k] === 'string' && stripCtl(o[k]) ? stripCtl(o[k]) : d);
  const subject = pick('subject', subjectFor());
  const intro = withDue(pick('intro', DEFAULT_INTRO), dueDate);
  const outro = withDue(pick('outro', DEFAULT_OUTRO), dueDate);
  const url = (i) => `${appUrl}/assess?agent=${i.id}`;
  const lines = items.map((i, n) => `${n + 1}. ${i.name} · ${i.phase} → ${url(i)}`);
  // Hidden-link forms: Teams card text and the inbox body support [label](url); email html uses <a>.
  const mdLines = items.map((i, n) => `${n + 1}. ${i.name} · ${i.phase} → [Assessment](${url(i)})`);
  const first = String(displayName || '').trim();
  const text = [`เรียน ${salutation(first)}`, intro, lines.join('\n'), outro].join('\n\n');
  const inboxText = [`เรียน ${salutation(first)}`, intro, mdLines.join('\n'), outro].join('\n\n');
  const list = items.map((i, n) => `<li>${esc(i.name)} · ${esc(i.phase)} → <a href="${esc(url(i))}">Assessment</a></li>`).join('');
  const html = frameHtml(`${paras(intro)}<ol style="margin:0 0 16px;padding-left:22px">${list}</ol>${paras(outro)}`).replace('{{name}}', esc(salutation(first)));
  const para = (t) => String(t).split(/\n{2,}/).flatMap((p) => p.split('\n')).map((x) => x.trim()).filter(Boolean);
  // Teams card shows only cardLines, so it carries the same (edited) intro/closing as the email.
  return { subject, text, inboxText, html, cardLines: cardBlocks(para(intro), mdLines, para(outro)), link: `${appUrl}/assess?agent=${items[0]?.id || ''}` };
}

const bkkYear = (d) => new Date(d.getTime() + 7 * 3600 * 1000).getUTCFullYear();
const err = (code, message) => ({ code, message });

function applySubmit(agent, input, now) {
  const { answers, decl, mode, config, user } = input;
  const tier = getTier(agent);
  const denied = canSubmit(agent, user);
  if (denied) throw err('permission-denied', denied);
  // F7a: backfill must be for an in-scope item (input.all = every agent, this one included).
  if (mode === 'backfill' && input.all && !inBackfillScope(agent, input.all)) {
    throw err('failed-precondition', 'รายการนี้ไม่อยู่ในขอบเขตการประเมินย้อนหลัง');
  }
  const status0 = backfillStatus(agent, config);
  const ts = now;
  if (mode === 'review') {
    if (status0 !== 'fail') throw err('failed-precondition', 'ขอทบทวนได้เฉพาะรายการที่ไม่ผ่าน');
    if (!evaluateAnswers(config, answers).complete) throw err('failed-precondition', 'กรุณาตอบให้ครบทุกข้อ');
    return {
      status: 'pending_review', records: [],
      patch: { assessment: { ...(agent.assessment || {}), status: 'pending_review', firstAssessedAt: agent.assessment?.firstAssessedAt || ts, lastAssessedAt: ts, lastBy: user.email } },
    };
  }
  if (status0 !== 'not_done') throw err('already-exists', 'รายการนี้ประเมินแล้ว');
  const ev = evaluateAnswers(config, answers);
  if (!ev.complete) throw err('failed-precondition', 'กรุณาตอบให้ครบทุกข้อ');
  const v = backfillVerdict({ config, answers, tier });
  const status = v.pass ? 'pass' : 'fail';
  const qs = config.questions;
  const screening = {
    v: 2, answers: Object.fromEntries(qs.map((q) => [q.id, answers[q.id]])), level: v.level || '', total: v.total,
    must: qs.filter((q) => optionOf(q, answers[q.id])?.fix === 'must').map((q) => q.id),
    should: qs.filter((q) => optionOf(q, answers[q.id])?.fix === 'should').map((q) => q.id),
    preAt: agent.screening?.preAt || ts, deployAt: ts,
  };
  const patch = {
    screening,
    assessment: { status, firstAssessedAt: agent.assessment?.firstAssessedAt || ts, lastAssessedAt: ts, lastBy: user.email, reasons: v.reasons },
  };
  DECL_KEYS.forEach((k) => { if (!filled(agent[k]) && filled(decl?.[k])) patch[k] = String(decl[k]).trim(); });
  const merged = { ...agent, ...patch };
  const snap = Object.fromEntries(DECL_KEYS.map((k) => [k, String(merged[k] ?? '').trim()]));
  const rec = (stage, a) => ({
    agentId: agent.id || '', agentName: agent.agentName || '', owner: agent.owner || '',
    approveArea: Array.isArray(agent.approveArea) ? [...agent.approveArea] : [],
    stage, answers: a, decl: snap, createdBy: user.uid || '', createdAt: null, year: bkkYear(now),
  });
  const preIds = new Set(qs.filter((q) => q.stage === 'pre').map((q) => q.id));
  const pre = Object.fromEntries(Object.entries(screening.answers).filter(([k]) => preIds.has(k)));
  return { status, patch, records: [rec('pre', pre), rec('deploy', { ...screening.answers })] };
}

/** Review decision (pure). Accept re-derives the verdict from the stored answers; a fail verdict cannot be accepted. */
function applyDecision(agent, review, { decision, reason, config, now, deciderUid }) {
  if (deciderUid && review?.requestedByUid && review.requestedByUid === deciderUid) {
    throw err('permission-denied', 'ผู้ขอไม่สามารถยืนยันคำขอของตัวเองได้ ต้องให้ผู้อื่นยืนยัน');
  }
  if (agent?.assessment?.status !== 'pending_review') throw err('failed-precondition', 'รายการนี้ไม่ได้รอการยืนยัน');
  const by = review?.requestedBy || '';
  if (decision === 'reject') {
    if (String(reason || '').trim().length < 5) throw err('invalid-argument', 'กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร');
    return { status: 'fail', records: [], patch: { assessment: { ...agent.assessment, status: 'fail', lastBy: by } } };
  }
  if (decision !== 'accept') throw err('invalid-argument', 'decision ไม่ถูกต้อง');
  const v = backfillVerdict({ config, answers: review.answers || {}, tier: getTier(agent) });
  if (!v.pass) throw err('failed-precondition', 'ผลประเมินยังไม่ผ่าน ยืนยันไม่ได้');
  const base = { ...agent, assessment: { firstAssessedAt: agent.assessment.firstAssessedAt }, screening: agent.screening ? { ...agent.screening, deployAt: null } : agent.screening };
  return applySubmit(base, { answers: review.answers, decl: review.decl, mode: 'backfill', config, user: { email: by, uid: review.requestedByUid || '' } }, now);
}

/** Count real outcomes of a send loop. Each result is a sendMail result ({status}) or {error:true}. */
function tallyDeliveries(results) {
  const t = { sent: 0, held: 0, skipped: 0, dryRun: 0, disabled: 0, failed: 0 };
  (results || []).forEach((r) => {
    if (!r || r.error) t.failed += 1;
    else if (r.status === 'sent') t.sent += 1;
    else if (r.status === 'held') t.held += 1;
    else if (r.status === 'skipped-domain') t.skipped += 1;
    else if (r.status === 'disabled') t.disabled += 1;
    else if (r.status === 'dry-run') t.dryRun += 1;
    else t.failed += 1;
  });
  return t;
}

/** F10: a real calendar date (yyyy-mm-dd), not before today in Bangkok. Returns an error message or null. */
function validateDueDate(due, now) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(due || ''));
  if (!m) return 'dueDate ไม่ถูกต้อง';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return 'dueDate ไม่ใช่วันที่จริง';
  const today = new Date((now || new Date()).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  return String(due) < today ? 'dueDate ต้องไม่เป็นวันที่ผ่านมาแล้ว' : null;
}

/** F7c: bound client JSON. Returns clean { answers, decl } or throws invalid-argument. */
function sanitizeSubmitInput({ answers, decl }, config) {
  const bad = (m) => err('invalid-argument', m);
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw bad('answers ไม่ถูกต้อง');
  const known = new Set((config.questions || []).map((q) => q.id));
  const cleanAnswers = {};
  Object.entries(answers).forEach(([k, v]) => {
    if (!known.has(k) || typeof v !== 'string' || v.length > 60) throw bad('answers ไม่ถูกต้อง');
    cleanAnswers[k] = v;
  });
  const cleanDecl = {};
  if (decl != null) {
    if (typeof decl !== 'object' || Array.isArray(decl)) throw bad('decl ไม่ถูกต้อง');
    Object.entries(decl).forEach(([k, v]) => {
      if (!DECL_KEYS.includes(k) || typeof v !== 'string') throw bad('decl ไม่ถูกต้อง');
      const t = v.trim();
      if (t.length > 2000) throw bad('decl ยาวเกินไป');
      cleanDecl[k] = t;
    });
  }
  return { answers: cleanAnswers, decl: cleanDecl };
}

/** F2: plain statement of what a send really did (inbox written vs Teams/Email outcome). */
function summarizeSend({ inbox = 0, sent = 0, held = 0, skipped = 0, dryRun = 0, disabled = 0, failed = 0, remaining = 0 }) {
  const parts = [];
  if (inbox) parts.push(`ส่ง Inbox แล้ว ${inbox} ข้อความ`);
  const m = [];
  if (sent) m.push(`ส่งแล้ว ${sent}`);
  if (held) m.push(`ถูกพักไว้ ${held}`);
  if (skipped) m.push(`ข้าม (นอก domain) ${skipped}`);
  if (dryRun) m.push(`ไม่ได้ส่งจริง (dry run ${dryRun})`);
  if (disabled) m.push(`ปิดการส่งอยู่ ${disabled}`);
  if (failed) m.push(`ล้มเหลว ${failed}`);
  if (m.length) parts.push(`Teams/Email: ${m.join(' · ')}`);
  if (remaining) parts.push(`ยังไม่ได้ส่งถึง ${remaining} คน (หมดเวลาต่อครั้ง) กด Send อีกครั้งเพื่อส่งต่อ (ส่งเฉพาะคนที่ยังมีรายการ not done; คนที่ได้รับแล้วจะได้รับเตือนซ้ำ)`);
  return parts.length ? parts.join(' · ').replace(' · ยังไม่ได้ส่งถึง', m.length || inbox ? ' · ยังไม่ได้ส่งถึง' : ' · ยังไม่ได้ส่งถึง') : 'ไม่มีข้อความที่ส่งออก';
}

/** R12: stop STARTING new deliveries once elapsed wall-clock reaches the limit. */
const shouldStopSending = (elapsedMs, limitMs) => elapsedMs >= limitMs;

module.exports = {
  defaultMessageParts, validateMessage, validateAgentIds, selectRows,
  shouldStopSending,
  validateDueDate, sanitizeSubmitInput, summarizeSend,
  evaluateAnswers, backfillVerdict, backfillStatus, inBackfillScope, creatorDigests,
  canSubmit, canDecideReview, notPassRecipients, renderBackfillMessage, formatDueDate, applySubmit, applyDecision, tallyDeliveries,
  normalizeProgress, isPairedSubSkill, getTier,
};
