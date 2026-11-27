// Per-event assessment records (2026-11-26): one /assessments doc per registration ('pre') and per
// deploy request ('deploy'), answers stored by option id + a snapshot of the declaration (D) fields.
// Results are always RE-EVALUATED from the live config; archived years use their frozen config.
import { DECL_FIELDS } from './declaration';
import { evaluate, optionOf, normalizeAnswers } from './screening';

const BKK_MS = 7 * 3600 * 1000;
const asDate = (v) => (v?.toDate ? v.toDate() : v instanceof Date ? v : new Date(v));
export const bangkokYear = (d) => new Date(asDate(d).getTime() + BKK_MS).getUTCFullYear();
export const bangkokDay = (d) => new Date(asDate(d).getTime() + BKK_MS).toISOString().slice(0, 10);
const bangkokDateTime = (d) => new Date(asDate(d).getTime() + BKK_MS).toISOString().slice(0, 16).replace('T', ' ');

const DECL_COLUMNS = [{ key: 'description', label: 'Description' }, ...DECL_FIELDS.map((f) => ({ key: f.key, label: f.label }))];

// Caller adds `createdAt: serverTimestamp()`.
export function assessmentRecord(agent, stage, answers, uid, now = new Date()) {
  const decl = {};
  DECL_COLUMNS.forEach((c) => { decl[c.key] = String(agent?.[c.key] ?? '').trim(); });
  return {
    agentId: agent?.id || '',
    agentName: agent?.agentName || '',
    owner: agent?.owner || '',
    approveArea: Array.isArray(agent?.approveArea) ? [...agent.approveArea] : [],
    stage,
    answers: { ...(answers || {}) },
    decl,
    createdBy: uid || '',
    year: bangkokYear(now),
  };
}

export function filterRecords(records, { year, from, to, owner, area } = {}) {
  return records.filter((r) => {
    const day = bangkokDay(r.createdAt);
    if (year && Number(r.year) !== Number(year)) return false;
    if (from && day < from) return false;
    if (to && day > to) return false;
    if (owner && r.owner !== owner) return false;
    if (area && !(r.approveArea || []).includes(area)) return false;
    return true;
  });
}

// Newest first inside each owner; owners ordered by their newest record.
export function groupByOwner(records) {
  const sorted = [...records].sort((a, b) => asDate(b.createdAt) - asDate(a.createdAt));
  const map = new Map();
  sorted.forEach((r) => {
    const k = r.owner || '(no owner)';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  });
  return [...map.entries()].map(([owner, rows]) => ({ owner, rows }));
}

export function recordResult(config, r) {
  return evaluate(config, normalizeAnswers(config, r.answers), r.stage === 'pre' ? 'pre' : undefined, { partial: true });
}

export function answerText(config, r, q) {
  const v = r.answers?.[q.id];
  if (v === undefined || v === null || v === '') return '';
  return optionOf(config, q.id, typeof v === 'number' ? normalizeAnswers(config, { [q.id]: v })[q.id] : v)?.th ?? '(removed option)';
}

// Spreadsheet formula injection: text a creator typed must not start with = + - @ in Excel.
const safeCell = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

export function recordCsv(config, records) {
  const headers = ['Date', 'Owner', 'Agent/Skill', 'Stage', 'Level', 'Score', 'Required fixes', 'Recommended fixes', ...DECL_COLUMNS.map((c) => c.label), ...config.questions.map((q) => q.code)];
  const rows = records.map((r) => {
    const e = recordResult(config, r);
    return [
      bangkokDateTime(r.createdAt), safeCell(r.owner || ''), safeCell(r.agentName || ''), r.stage, e.level || '', e.total,
      e.must.map((m) => m.item).join(' '), e.should.map((m) => m.item).join(' '),
      ...DECL_COLUMNS.map((c) => safeCell(r.decl?.[c.key] || '')),
      ...config.questions.map((q) => answerText(config, r, q)),
    ];
  });
  return { headers, rows };
}

// ── Results page: one row per Agent/Skill (2026-11-27) ──────────────────────────
// Combines the latest 'pre' and the latest 'deploy' record of an agent. The deploy record re-answers
// pre questions, so its answers win. Scores: pre stage, deploy stage (null if never requested), total.
export function combineByAgent(config, records) {
  const byAgent = new Map();
  records.forEach((r) => {
    const k = r.agentId || r.id;
    const cur = byAgent.get(k) || { pre: null, deploy: null };
    const slot = r.stage === 'deploy' ? 'deploy' : 'pre';
    if (!cur[slot] || asDate(r.createdAt) > asDate(cur[slot].createdAt)) cur[slot] = r;
    byAgent.set(k, cur);
  });
  return [...byAgent.entries()].map(([agentId, { pre, deploy }]) => {
    const latest = [pre, deploy].filter(Boolean).sort((a, b) => asDate(b.createdAt) - asDate(a.createdAt))[0];
    const answers = { ...normalizeAnswers(config, pre?.answers), ...normalizeAnswers(config, deploy?.answers) };
    const all = evaluate(config, answers, undefined, { partial: true });
    return {
      id: agentId,
      agentId,
      agentName: latest.agentName,
      owner: latest.owner,
      approveArea: latest.approveArea || [],
      createdAt: latest.createdAt,
      year: latest.year,
      decl: latest.decl || {},
      answers,
      hasPre: !!pre,
      preAnswered: config.questions.some((qq) => qq.stage === 'pre' && answers[qq.id] !== undefined && answers[qq.id] !== null && answers[qq.id] !== ''),
      hasDeploy: !!deploy,
      preScore: evaluate(config, answers, 'pre', { partial: true }).total,
      deployScore: deploy ? evaluate(config, answers, 'deploy', { partial: true }).total : null,
      total: all.total,
      level: all.level,
      must: all.must.map((m) => m.item),
      should: all.should.map((m) => m.item),
    };
  });
}

// Long text for the on-screen Declaration block (CSV keeps the full text).
export function clipText(text, max = 250) {
  const t = String(text ?? '').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

// One answer for display: text, points and whether it still needs attention.
export function answerDetail(config, answers, q) {
  const v = answers?.[q.id];
  if (v === undefined || v === null || v === '') return { text: '', points: 0, status: 'unanswered' };
  const o = optionOf(config, q.id, v);
  if (!o) return { text: '(removed option)', points: 0, status: 'removed' };
  return { text: o.th, points: o.score, status: o.fix === 'none' && !o.blocksPre && !o.blocksDeploy ? 'ok' : 'fix' };
}

export function answerLabel(d) {
  if (d.status === 'unanswered') return '(ยังไม่ตอบ)';
  if (d.status === 'removed') return '(removed option)';
  return `${d.text} (${d.points}${d.status === 'fix' ? ' · ยังไม่ผ่าน' : ''})`;
}

export function agentCsv(config, rows) {
  const headers = ['Date', 'Owner', 'Agent/Skill', 'Level', 'Pre-assessment score', 'Deploy request score', 'Total score', 'Required fixes', 'Recommended fixes', ...DECL_COLUMNS.map((c) => c.label), ...config.questions.map((q) => q.code)];
  const out = rows.map((r) => [
    bangkokDateTime(r.createdAt), safeCell(r.owner || ''), safeCell(r.agentName || ''), r.level || '',
    r.preScore, r.deployScore ?? '', r.total, r.must.join(' '), r.should.join(' '),
    ...DECL_COLUMNS.map((c) => safeCell(r.decl?.[c.key] || '')),
    ...config.questions.map((q) => safeCell(answerLabel(answerDetail(config, r.answers, q)))),
  ]);
  return { headers, rows: out };
}

export { DECL_COLUMNS };
