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

/**
 * Bucket rows for the two group toggles.
 *
 * - `'agent'` groups by **agentId**, NOT by name: agent names are not unique
 *   in this library (Portfolio adoption skips names shared by 2+ agents for
 *   exactly that reason), so grouping by name would merge two unrelated
 *   agents under one header. Display label = the row's `agentName`.
 * - `'owner'` groups by the owner string (owners are labels, not ids).
 *
 * @param {Array<object>} rows  report rows (already filtered by the caller)
 * @param {'agent'|'owner'} by
 * @returns {Array<{ key: string, label: string, rows: Array<object> }>}
 *   biggest group first; within a group the input order is kept (a stable
 *   sort never reorders it).
 */
export function groupUsageRows(rows, by) {
  const map = new Map();
  (rows || []).forEach((r) => {
    let key;
    let label;
    if (by === 'agent') {
      key = String(r?.agentId ?? '') || String(r?.agentName ?? '');
      label = String(r?.agentName ?? '') || '(no name)';
    } else {
      key = String(r?.owner ?? '');
      label = key || '(no owner)';
    }
    if (!map.has(key)) map.set(key, { key, label, rows: [] });
    map.get(key).rows.push(r);
  });
  return [...map.values()].sort((a, b) => b.rows.length - a.rows.length);
}
