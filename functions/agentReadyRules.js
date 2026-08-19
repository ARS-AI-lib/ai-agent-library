/**
 * Who may act on an agent, and what "ready for 100%" requires (2026-08-19).
 *
 * Split out of index.js for the same reason endpointFileRules.js / embedText.js
 * / chatPrompt.js were: so verify-agent-ready.cjs exercises THE REAL RULES
 * rather than a copy that drifts. These decide who can flip an agent to
 * Ready-to-Use and who can rename one, so a test against a stale duplicate
 * would be worse than no test at all.
 *
 * Everything here is pure — no Firestore, no network — which is what makes it
 * testable against live agent/user data offline.
 *
 * ── Why area scoping cannot be a Firestore rule ──
 * `agentApproveAreas()` is a 7-layer resolver in src/lib/approveAreas.js;
 * security rules cannot evaluate it, and copying its tables here is forbidden
 * (CLAUDE.md §20). So these checks read the agent's STORED `approveArea` —
 * layer 1 of that resolver, which beats every other layer anyway — exactly as
 * checkUploadPermission() already does. All 29 deploy-approved agents carry
 * one. An agent with no stored area degrades to admin-only: the safe
 * direction to fail in.
 */

// Roles that get area-scoped rights. `committee` is deliberately absent — it
// is a read/oversight tier, and no request has ever asked for it here.
const AREA_ROLES = new Set(['approver', 'staff']);
// Renames are narrower than the ready-transition: staff are not approvers.
const RENAME_DECIDER_ROLES = new Set(['approver']);

/**
 * Is this user the creator of this agent?
 *
 * Email match is the PRIMARY signal, not a fallback. Measured on live data:
 * 157 of 239 agents carry a `createdBy` that maps to no user, and the values
 * expose why — `…Z11kTt2`, `…Z11kTt3`, `…Z11kTt162`, i.e. one real uid with an
 * incrementing suffix minted by the CSV import. `createdBy === uid` can never
 * match on those, so creator identity runs on `creatorEmails` (the same thing
 * isMyAgent() does client-side). The uid check is kept for the minority of
 * rows created through the real submit flow.
 */
function isAgentCreator(agent, { userEmail, userUid }) {
  const email = String(userEmail || '').toLowerCase();
  if (email) {
    const creators = Array.isArray(agent?.creatorEmails) ? agent.creatorEmails : [];
    if (creators.some((e) => String(e || '').toLowerCase() === email)) return true;
  }
  return !!(userUid && agent?.createdBy && agent.createdBy === userUid);
}

/** Do this user's Approve Areas intersect the agent's stored ones? */
function sharesApproveArea(agent, userApproveAreas) {
  const mine = Array.isArray(userApproveAreas) ? userApproveAreas : [];
  const theirs = Array.isArray(agent?.approveArea) ? agent.approveArea : [];
  return mine.length > 0 && theirs.some((a) => mine.includes(a));
}

/**
 * The shared "may this person act on this agent" test, used by BOTH the
 * Ready-to-Use transition and the endpoint-file upload — the user's
 * requirement was explicitly that editing the endpoint or the uploaded file
 * uses the same permission set as reaching 100%, so it is defined once.
 *
 * Allowed: admin · the creator · an approver/staff whose area matches.
 * Returns null when allowed, or { code, message }.
 */
function checkAgentActor({ agent, role, userEmail, userUid, userApproveAreas }) {
  if (!agent) return { code: 'not-found', message: 'Agent not found.' };
  if (role === 'admin') return null;
  if (isAgentCreator(agent, { userEmail, userUid })) return null;
  if (AREA_ROLES.has(role) && sharesApproveArea(agent, userApproveAreas)) return null;
  return {
    code: 'permission-denied',
    message: 'Only the creator, an approver/staff of this agent\'s Approve Area, or an admin can do this.',
  };
}

/** Agent must be live (approved, not archived) before anything below applies. */
function checkAgentLive(agent) {
  if (!agent) return { code: 'not-found', message: 'Agent not found.' };
  if (agent.approvalStatus !== 'approved' || agent.archived === true) {
    return { code: 'failed-precondition', message: 'Agent must be approved and not archived.' };
  }
  return null;
}

/**
 * Server-side URL sanitiser.
 *
 * Mirrors safeEndpointUrl() in src/lib/agentUtils.js by necessity, not by
 * accident: that module is not part of the deployed function bundle, and a
 * scheme check that exists only on the client is not a security control at
 * all. Same relationship as checkUploadFile (authoritative) vs
 * validateUploadFile (UX pre-check) in the upload path. Anything that is not
 * http/https — notably `javascript:` and `data:` — is rejected outright
 * rather than "cleaned".
 */
function safeEndpointUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.href;
  } catch {
    return '';
  }
}

/**
 * May this agent be flipped to 100% right now, and with what endpoint?
 *
 * The gate the whole feature exists for: an agent cannot be declared
 * Ready-to-Use with no way to actually reach it. It is satisfied by any of —
 * an endpoint already on the doc, a previously uploaded file, or a URL
 * supplied in this very call.
 *
 * NOT retroactive by construction: this only ever runs on the transition, so
 * the 15 deploy-approved agents already sitting at 100% without an endpoint
 * are untouched (they surface in the Dashboard's Data Quality Watchlist
 * instead).
 *
 * Returns { endpoint } when allowed, or { code, message } on refusal.
 */
function checkMarkReady({ agent, endpointUrl }) {
  const live = checkAgentLive(agent);
  if (live) return live;

  // The >95 cap already requires deploy approval (firestore.rules), but this
  // callable bypasses rules via the admin SDK, so it must state the
  // precondition itself rather than inherit it.
  if (agent.deploymentStatus !== 'approved') {
    return {
      code: 'failed-precondition',
      message: 'Deployment request must be approved before progress can reach 100%.',
    };
  }

  const supplied = safeEndpointUrl(endpointUrl);
  if (endpointUrl && !supplied) {
    return { code: 'invalid-argument', message: 'Endpoint must be an http/https URL.' };
  }

  const existing = String(agent.endpoint || '').trim();
  const hasFile = !!agent.endpointFile?.storagePath;
  const endpoint = supplied || existing;
  if (!endpoint && !hasFile) {
    return {
      code: 'failed-precondition',
      message: 'An endpoint URL or an uploaded file is required before progress can reach 100%.',
    };
  }
  return { endpoint };
}

/**
 * May this user decide a rename request?
 *
 * Narrower than checkAgentActor on purpose: the creator REQUESTS a rename,
 * so letting the creator also approve it would make the approval step
 * meaningless. Staff are excluded too — approving a rename is an approver
 * act, matching who decides deployment requests.
 */
function checkRenameDecider({ agent, role, userApproveAreas }) {
  if (!agent) return { code: 'not-found', message: 'Agent not found.' };
  if (role === 'admin') return null;
  if (RENAME_DECIDER_ROLES.has(role) && sharesApproveArea(agent, userApproveAreas)) return null;
  return {
    code: 'permission-denied',
    message: 'Only an approver of this agent\'s Approve Area, or an admin, can decide a rename.',
  };
}

/** Is the requested new name usable? Returns null or { code, message }. */
function checkRenameValue({ agent, requestedName }) {
  const next = String(requestedName || '').trim();
  if (!next) return { code: 'invalid-argument', message: 'A new name is required.' };
  if (next.length > 150) return { code: 'invalid-argument', message: 'Name is too long (max 150).' };
  if (next === String(agent?.agentName || '').trim()) {
    return { code: 'invalid-argument', message: 'The new name is the same as the current one.' };
  }
  return null;
}

module.exports = {
  AREA_ROLES, RENAME_DECIDER_ROLES,
  isAgentCreator, sharesApproveArea,
  checkAgentActor, checkAgentLive, safeEndpointUrl,
  checkMarkReady, checkRenameDecider, checkRenameValue,
};
