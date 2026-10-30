// Portfolio task links → AI Library adoption (2026-09-25).
//
// A Portfolio task picks Library items in task.agents[] / task.skills[] as
// PLAIN NAMES (no ids). Each (task, agent) pair counts as ONE adoption, merged
// into agentStats.endpointClicks, and is removed again when the link goes
// (unlink or task delete). task.contribute ("Contributes to AI Library") is a
// different relationship and is deliberately never read here.
//
// The marker doc is the source of truth: the counter only moves when a marker
// is created or deleted in the same transaction, so re-running the trigger or
// the backfill can never double count. Pure helpers only — no Firestore here,
// so verify-portfolio-adoption.cjs can check them offline.

/** Case/space/zero-width-insensitive name key. Mirrors the Workshop library
 *  star's client copy (src/lib/agentUtils.js foldName). Parity is enforced by
 *  functions/verify-fold-parity.cjs — run it after touching either copy. */
function foldName(s) {
  return String(s || '')
    .replace(/[​-‍﻿]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * name → agentId index over approved Library agents. A name shared by 2+
 * docs is AMBIGUOUS and resolves to nothing (counting the wrong agent is
 * worse than not counting). `aliases` = [{ name, agentId }] from approved
 * renames, so a task that still holds an agent's old name keeps counting.
 */
function buildNameIndex(agents, aliases = []) {
  const ids = new Map();
  const add = (name, id) => {
    const k = foldName(name);
    if (!k) return;
    if (!ids.has(k)) ids.set(k, new Set());
    ids.get(k).add(id);
  };
  agents.filter((a) => a.approvalStatus === 'approved').forEach((a) => add(a.agentName, a.id));
  aliases.forEach((x) => {
    // An alias never overrides a live name held by a different agent.
    const k = foldName(x.name);
    if (!k || !x.agentId) return;
    if (ids.has(k) && !ids.get(k).has(x.agentId)) return;
    add(x.name, x.agentId);
  });
  const index = new Map();
  const ambiguous = new Set();
  ids.forEach((set, k) => { if (set.size === 1) index.set(k, [...set][0]); else ambiguous.add(k); });
  return { index, ambiguous };
}

/** Library agent ids a task links (agents + skills), plus names that didn't resolve. */
function resolveTaskIds(task, nameIndex) {
  const out = new Set();
  const unmatched = [];
  const ambiguous = [];
  if (!task) return { ids: out, unmatched, ambiguous };
  [...(Array.isArray(task.agents) ? task.agents : []), ...(Array.isArray(task.skills) ? task.skills : [])]
    .forEach((n) => {
      const k = foldName(n);
      if (!k) return;
      const id = nameIndex.index.get(k);
      if (id) out.add(id);
      else if (nameIndex.ambiguous.has(k)) ambiguous.push(n);
      else unmatched.push(n);
    });
  return { ids: out, unmatched, ambiguous };
}

/** True when the write could change the link set (skip progress/comment-only writes). */
function linksChanged(before, after) {
  const key = (t) => (t ? JSON.stringify([
    [...(t.agents || [])].map(foldName).sort(),
    [...(t.skills || [])].map(foldName).sort(),
  ]) : null);
  return key(before) !== key(after);
}

const markerId = (agentId, projectId, taskId) => `${agentId}__task__${projectId}__${taskId}`;

/** { add: [agentId], remove: [agentId] } — desired vs markers that exist now. */
function diffMarkers(desiredIds, existingIds) {
  const want = new Set(desiredIds);
  const have = new Set(existingIds);
  return {
    add: [...want].filter((id) => !have.has(id)),
    remove: [...have].filter((id) => !want.has(id)),
  };
}

module.exports = { foldName, buildNameIndex, resolveTaskIds, linksChanged, markerId, diffMarkers };
