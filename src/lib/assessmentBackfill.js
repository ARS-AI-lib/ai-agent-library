import { csvCell } from './csv';
import { bangkokDay } from './assessments';

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
