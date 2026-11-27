import { csvCell } from './csv';
import { bangkokDay } from './assessments';
import { normalizeProgress } from './agentUtils';

// Creator /assess page helpers (2026-11-27). mode: 'backfill' (not_done items) | 'review' (fail items).
export const isAssessable = (item, mode) => item.status === (mode === 'review' ? 'fail' : 'not_done');

// Next assessable item after `currentId` (wraps round the list), or null when none is left.
export function nextItem(items, currentId, mode) {
  const i = items.findIndex((x) => x.id === currentId);
  const ordered = [...items.slice(i + 1), ...items.slice(0, Math.max(i, 0))];
  return ordered.find((x) => x.id !== currentId && isAssessable(x, mode))?.id ?? null;
}

// Escape text for use inside a RegExp (labels may contain regex characters).
export const escapeRe = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// goToField table for declaration errors shaped `ใส่ ${label}` / `ใส่ ${label} (หรือติ๊ก …)`.
export const declErrorFields = (labels) => labels.map((l) => [l, new RegExp(`^ใส่ ${escapeRe(l)}(?: |$)`)]);

// Admin page (/assessment-backfill) helpers.
export const STATUS_LABEL = { pass: 'Pass', fail: 'Not pass', pending_review: 'Not pass (review pending)', not_done: 'Not done' };
const CSV_HEADERS = ['Agent/Skill', 'Tier', 'Phase', 'Owner', 'Creators', 'Status', 'Level', 'Reasons', 'First assessed', 'Last assessed', 'Due date'];
// Formula-injection guard (same rule as agentCsv in assessments.js).
const safeCell = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const day = (ms) => (ms ? bangkokDay(new Date(ms)) : '');

export function backfillCsv(rows, dueDate) {
  const lines = [CSV_HEADERS.map(csvCell).join(',')];
  rows.forEach((r) => lines.push([
    r.name, r.tier, r.phase, r.owner, (r.creators || []).join('; '), STATUS_LABEL[r.status] || r.status,
    r.level, (r.reasons || []).join('; '), day(r.firstAssessedAt), day(r.lastAssessedAt), dueDate,
  ].map((v) => csvCell(safeCell(v == null ? '' : v))).join(',')));
  return lines.join('\r\n');
}

export function summarize(rows) {
  const notDone = rows.filter((r) => r.status === 'not_done').length;
  return { items: rows.length, done: rows.length - notDone, notDone, noEmail: rows.filter((r) => !(r.creators || []).length).length };
}

// Status filter predicate: 'fail' (labelled "Not pass") also covers pending_review rows.
export const matchesStatus = (status, filter) => filter === 'all' || status === filter || (filter === 'fail' && status === 'pending_review');

// Library risk warning (2026-11-27): a Ready-to-Use item whose assessment did not pass.
export const ASSESSMENT_WARNING = 'รายการนี้ยังไม่ผ่าน assessment อาจมีความเสี่ยงจากการใช้งาน';
export function assessmentWarning(agent) {
  const st = agent?.assessment?.status;
  return normalizeProgress(agent?.devProgress) >= 100 && (st === 'fail' || st === 'pending_review') ? ASSESSMENT_WARNING : null;
}

// Bulk send is paced 10 s per creator (user order 2026-11-27); estimate shown before confirming.
export const SEND_GAP_SECONDS = 10;
export const estimateSendMinutes = (creatorCount) => Math.ceil((Math.max(0, creatorCount) * SEND_GAP_SECONDS) / 60);

// Row selection on the admin page (2026-11-27). Only not_done rows are selectable.
const selectable = (r) => r.status === 'not_done';
export const defaultSelection = (rows) => new Set((rows || []).filter(selectable).map((r) => r.id));
export const toggleId = (set, id) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };
export function selectAllFiltered(set, shown, checked) {
  const n = new Set(set);
  (shown || []).filter(selectable).forEach((r) => (checked ? n.add(r.id) : n.delete(r.id)));
  return n;
}
export function selectionState(set, shown) {
  const sel = (shown || []).filter(selectable);
  const c = sel.filter((r) => set.has(r.id)).length;
  return c === 0 ? 'none' : c === sel.length ? 'all' : 'some';
}
export function selectionCounts(rows, set) {
  const chosen = (rows || []).filter((r) => selectable(r) && set.has(r.id));
  return { items: chosen.length, creators: new Set(chosen.flatMap((r) => r.creators || [])).size };
}
export const pruneSelection = (set, rows) => new Set([...set].filter((id) => (rows || []).some((r) => r.id === id && selectable(r))));
