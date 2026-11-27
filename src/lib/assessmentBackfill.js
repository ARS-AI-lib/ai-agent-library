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
