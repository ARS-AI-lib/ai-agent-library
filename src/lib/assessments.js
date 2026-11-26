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
  const headers = ['Date', 'Owner', 'Agent/Skill', 'Stage', 'Level', 'Total', 'Must fix', 'Should fix', ...DECL_COLUMNS.map((c) => c.label), ...config.questions.map((q) => q.code)];
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
