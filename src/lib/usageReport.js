/**
 * Usage report — pure helpers (2026-11-10).
 *
 * The /usage page renders rows built server-side by the `usageReport`
 * callable (one row per person's FIRST use of an item). This module holds
 * the two things that page must not duplicate or drift on:
 *   1. the CSV column/header list (Source was removed 2026-11-10; the
 *      server still sends `source`, we just don't render or export it), and
 *   2. row grouping (shared shape for "Group by Agent/Skill" and
 *      "Group by Owner" so both behave identically).
 *
 * Kept as a plain module (no React import) so `functions/verify-usage-page.cjs`
 * can load the shipped file through the same loadEsm pattern as
 * verify-category-groups.cjs — one source of truth, no second copy in a test.
 */

export const CSV_COLUMNS = [
  'agentName', 'owner', 'area', 'category',
  'adopterName', 'adopterEmail', 'project', 'adoptedDate',
];

export const CSV_HEADERS = [
  'Agent/Skill Name', 'Owner', 'Area', 'Category',
  'Adopter', 'Adopter Email', 'Project / Task', 'Adopted Date',
];

const FALLBACK_LABEL = { agentName: '(no name)', owner: '(no owner)' };

/**
 * Bucket rows under one of their own fields.
 *
 * @param {Array<object>} rows  report rows (already filtered by the caller)
 * @param {'agentName'|'owner'} by
 * @returns {Array<{ key: string, rows: Array<object> }>} biggest group first;
 *   within a group the input order is kept (stable sort never reorders it).
 */
export function groupUsageRows(rows, by) {
  const fallback = FALLBACK_LABEL[by] || '(none)';
  const map = new Map();
  (rows || []).forEach((r) => {
    const key = String(r?.[by] ?? '') || fallback;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  });
  return [...map.entries()]
    .map(([key, groupRows]) => ({ key, rows: groupRows }))
    .sort((a, b) => b.rows.length - a.rows.length);
}
