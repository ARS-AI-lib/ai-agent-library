// Pure helpers for the Assessment Settings editor (2026-11-26).

// How many things differ between the saved config and the draft (questions edited / added /
// removed, thresholds, or just the order) — drives the "N unsaved changes" bar.
export function countChanges(base, draft) {
  const baseMap = new Map(base.questions.map((q) => [q.id, JSON.stringify(q)]));
  const seen = new Set();
  let n = 0;
  draft.questions.forEach((q) => { seen.add(q.id); if (baseMap.get(q.id) !== JSON.stringify(q)) n += 1; });
  baseMap.forEach((_, id) => { if (!seen.has(id)) n += 1; });
  if (JSON.stringify(base.thresholds) !== JSON.stringify(draft.thresholds)) n += 1;
  if (n === 0 && base.questions.map((q) => q.id).join() !== draft.questions.map((q) => q.id).join()) n = 1;
  return n;
}

// Which question to select after deleting `deletedId` from `ids`: the next one, else the previous, else null.
export function nextSelected(ids, deletedId) {
  const i = ids.indexOf(deletedId);
  if (i < 0) return ids[0] ?? null;
  return ids[i + 1] ?? ids[i - 1] ?? null;
}
