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

function renderBackfillMessage({ displayName, items, dueDate, appUrl }) {
  const subject = `ขอความร่วมมือทำ Assessment ของ Agent/Skill ภายใน ${dueDate}`;
  const lines = items.map((i, n) => `${n + 1}. ${i.name} · ${i.phase} → ${appUrl}/assess?agent=${i.id}`);
  const intro = 'AI Agent Library เพิ่มแบบประเมินความเสี่ยง (Assessment) สำหรับ Agent/Skill ทุกตัว งานที่ใช้งานอยู่แล้วก่อนมีแบบประเมินนี้จึงต้องประเมินย้อนหลังหนึ่งครั้ง คุณเป็น Creator ของรายการต่อไปนี้:';
  const dur = `ใช้เวลาประมาณ 5 นาทีต่อรายการ (11 ข้อ แบบเลือกตอบ) กรุณาทำให้เสร็จภายใน ${dueDate}`;
  const reply = 'หากรายการใดไม่ได้อยู่ในความดูแลของคุณแล้ว ตอบกลับอีเมลนี้เพื่อแจ้งได้เลย';
  const first = String(displayName || '').trim();
  const text = [`เรียน ${salutation(first)}`, intro, ...lines, dur, reply, 'ขอบคุณครับ', 'ทีม AI Agent Library'].join('\n');
  const list = items.map((i, n) => `<li>${esc(i.name)} · ${esc(i.phase)} → <a href="${esc(`${appUrl}/assess?agent=${i.id}`)}">${esc(`${appUrl}/assess?agent=${i.id}`)}</a></li>`).join('');
  const html = frameHtml(`<p style="margin:0 0 14px">${esc(intro)}</p><ol>${list}</ol><p>${esc(dur)}</p><p>${esc(reply)}</p><p>ขอบคุณครับ<br/>ทีม AI Agent Library</p>`).replace('{{name}}', esc(salutation(first)));
  return { subject, text, html, cardLines: lines, link: `${appUrl}/assess?agent=${items[0]?.id || ''}` };
}

const bkkYear = (d) => new Date(d.getTime() + 7 * 3600 * 1000).getUTCFullYear();
const err = (code, message) => ({ code, message });

function applySubmit(agent, input, now) {
  const { answers, decl, mode, config, user } = input;
  const tier = getTier(agent);
  const denied = canSubmit(agent, user);
  if (denied) throw err('permission-denied', denied);
  const status0 = backfillStatus(agent, config);
  const ts = now;
  if (mode === 'review') {
    if (status0 !== 'fail') throw err('failed-precondition', 'ขอทบทวนได้เฉพาะรายการที่ไม่ผ่าน');
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

module.exports = {
  evaluateAnswers, backfillVerdict, backfillStatus, inBackfillScope, creatorDigests,
  canSubmit, canDecideReview, notPassRecipients, renderBackfillMessage, formatDueDate, applySubmit,
  normalizeProgress, isPairedSubSkill, getTier,
};
