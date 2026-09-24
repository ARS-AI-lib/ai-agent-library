import { getFunctions, httpsCallable } from 'firebase/functions';

// Client side of Role Group classification (2026-09-24).
//
// Fire-and-forget, like notifyEvent/reindexAgent: approving an agent must
// never fail or stall because Vertex is slow. If the call is lost, the item
// shows on the Dashboard under its alias fallback ("awaiting classification")
// and an admin can fill it later with Classify Missing Role Groups.
//
// The server only ever FILLS a missing roleGroup — calling this twice, or on
// an item that already has one, changes nothing.

export function classifyRoleGroups(agentIds) {
  const ids = [...new Set((agentIds || []).filter(Boolean))].slice(0, 20);
  if (!ids.length) return;
  httpsCallable(getFunctions(), 'classifyRoleGroup')({ agentIds: ids })
    .catch((e) => console.warn('classifyRoleGroup failed:', e?.message || e));
}

/** Admin menu: classify every approved item that still has no roleGroup. Awaited. */
export async function classifyMissingRoleGroups() {
  const res = await httpsCallable(getFunctions(), 'classifyRoleGroup', { timeout: 300000 })({ missingOnly: true });
  return res.data;
}
