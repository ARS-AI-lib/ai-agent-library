import { getFunctions, httpsCallable } from 'firebase/functions';

// Keeps the semantic search index in step with agent edits.
//
// Fire-and-forget on purpose: a save must never fail, block, or slow down
// because the search index is having a bad day. If a reindex is lost the entry
// simply keeps its previous vector until the next edit or an admin rebuild —
// stale ranking, never a broken save.
//
// Deliberately NOT a Firestore trigger. Eventarc wildcard triggers on this
// project have a documented history of reporting ACTIVE while silently never
// firing (CLAUDE.md §9), and a search index that quietly stops updating is
// exactly the kind of failure nobody notices for months.
export function reindexAgent(agentId) {
  if (!agentId) return;
  try {
    httpsCallable(getFunctions(undefined, 'asia-southeast1'), 'reindexAgentVectors')({ agentId })
      .catch((e) => console.warn('reindexAgentVectors failed for', agentId, e?.message || e));
  } catch (e) {
    console.warn('reindexAgentVectors could not be invoked:', e?.message || e);
  }
}

// Full sweep — admin-triggered. Returns the function's own report so the caller
// can show what actually happened rather than a hopeful "done".
export async function rebuildAllVectors() {
  const fn = httpsCallable(getFunctions(undefined, 'asia-southeast1'), 'reindexAgentVectors');
  const { data } = await fn({ full: true });
  return data; // { scanned, embedded, skipped, pruned }
}
