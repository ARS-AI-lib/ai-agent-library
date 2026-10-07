import { getFunctions, httpsCallable } from 'firebase/functions';

// Client side of email notifications (2026-08-20).
//
// Fire-and-forget, exactly like recordAgentEvent: approving an agent or filing
// a deploy request must never fail, stall, or roll back because mail is having
// a bad day. A lost notification costs one email; a blocked approval costs the
// user their work.
//
// The payload carries NO recipients — only { type, agentId }. The server
// resolves who should be told and re-verifies the claim against the real
// document before sending, so a forged call describes a state that is not true
// and dies server-side.
//
// ── Call this ONCE per logical action ──
// Paired sub-skills cascade: a deploy request on a 7-child parent writes 8
// documents. Fire this for the PARENT ONLY, outside the cascade loop, or one
// human decision becomes eight emails.

const TYPES = new Set([
  'agent.pending',
  'agent.approved',
  'agent.rejected',
  'deploy.requested',
  'deploy.approved',
  'deploy.rejected',
  'agent.archived',
  'agent.ready',
  'file.updated',
  'rename.requested',
  'rename.decided',
  // 2026-10-07: these two were missing, so PreRegModal / PendingApprovalModal
  // calls were silently dropped here (0 link.* rows in /mailLog). Keep this
  // list in sync with EVENT_TYPES in functions/notifyRules.js.
  'link.requested',
  'link.decided',
  'user.roleChanged',
]);

/**
 * Tell the server something happened. Never throws, never awaited by callers.
 * @param {string} type  one of TYPES
 * @param {{agentId?:string, requestId?:string, targetUid?:string}} target
 */
export function notifyEvent(type, target = {}) {
  if (!TYPES.has(type)) return;
  try {
    httpsCallable(getFunctions(undefined, 'asia-southeast1'), 'notifyEvent')({ type, ...target })
      .catch((e) => console.warn('notifyEvent failed', type, e?.message || e));
  } catch (e) {
    console.warn('notifyEvent could not be invoked:', e?.message || e);
  }
}
