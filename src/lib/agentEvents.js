import { getFunctions, httpsCallable } from 'firebase/functions';

// Client side of the usage counters (2026-08-18).
//
// Fire-and-forget, exactly like reindexAgent: opening a modal or following a
// link must never be delayed, blocked, or broken because telemetry is having a
// bad day. A lost event just means one uncounted view — the same posture
// bumpChatMetrics takes server-side.
//
// The server de-duplicates per user / per agent / per kind (2026-08-19: the
// bucket size now differs by kind — 'detail'/'endpoint' are per Bangkok-local
// WEEK, Sun 00:00–Sat 23:59; 'search' stays per Bangkok-local day), so the
// counters mean "unique people", not "clicks". That is what makes them both
// un-inflatable and honest enough to put in front of an executive. It also
// means calling this more than once is harmless, which is why none of the call
// sites bother to guard against re-renders.

const KINDS = new Set(['detail', 'endpoint', 'search']);

// Within one page session, don't re-send an event the server would only
// discard. Purely a network-traffic saving — correctness lives on the server.
const sentThisSession = new Set();

export function recordAgentEvent(agentId, kind) {
  if (!agentId || !KINDS.has(kind)) return;
  const key = `${agentId}__${kind}`;
  if (sentThisSession.has(key)) return;
  sentThisSession.add(key);
  try {
    httpsCallable(getFunctions(undefined, 'asia-southeast1'), 'recordAgentEvent')({ agentId, kind })
      .catch((e) => console.warn('recordAgentEvent failed', kind, agentId, e?.message || e));
  } catch (e) {
    console.warn('recordAgentEvent could not be invoked:', e?.message || e);
  }
}

/**
 * Record that a set of agents was surfaced by a search. Capped hard: a search
 * that returns 60 rows should not fire 60 calls, and the long tail of a result
 * list is not really "demand" for those entries anyway — only the top of the
 * list was plausibly considered.
 */
export function recordSearchHits(agentIds, limit = 10) {
  if (!Array.isArray(agentIds)) return;
  agentIds.filter(Boolean).slice(0, limit).forEach((id) => recordAgentEvent(id, 'search'));
}

/** Submit/replace the caller's rating. NOT fire-and-forget — the user is
 *  waiting on this one and must see whether it landed (or why it didn't:
 *  rating your own agent is rejected server-side). */
export async function submitRating({ agentId, rating, comment }) {
  const fn = httpsCallable(getFunctions(undefined, 'asia-southeast1'), 'submitRating');
  const { data } = await fn({ agentId, rating, comment: comment || '' });
  return data; // { ok, updated }
}
