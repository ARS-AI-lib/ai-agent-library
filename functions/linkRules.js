// Skill → Agent link requests (2026-09-30).
//
// Why: PreRegModal used to write the AI's `suggested_matching_agent` straight
// into matchingAgent at submit — nobody confirmed it. That is how
// "AI Governance Proposal Deck Builder" ended up showing "JO Deck Generator"
// (another team's agent) as its parent. Now the suggestion is stored as
// `skill.linkSuggestion = { agentId, agentName, status: 'pending' }` and a
// person decides it in the Pending queue (section "Link Requests").
//
// Who may decide (user decision 2026-09-30): admin · staff · approver of the
// TARGET agent's area · a creator of EITHER side. Committee is not listed.
// Stored approveArea only — the 7-layer resolver is not deployed with
// functions (same rule as agentReadyRules.js). Pure, so verify-link-rules.cjs
// runs it offline. The client mirror is canDecideLink() in pendingQueue.js.

const lower = (e) => String(e || '').trim().toLowerCase();
const isCreator = (doc, email) => !!email && (Array.isArray(doc?.creatorEmails) ? doc.creatorEmails : []).some((e) => lower(e) === email);

function checkLinkDecider({ role, isAdmin, email, userAreas = [], skill, target }) {
  if (!skill || !target) return { ok: false, code: 'not-found', message: 'Skill or target agent not found.' };
  if (skill.linkSuggestion?.status !== 'pending') return { ok: false, code: 'failed-precondition', message: 'This link request has already been decided.' };
  if (skill.linkSuggestion.agentId !== target.id) return { ok: false, code: 'failed-precondition', message: 'Target mismatch.' };
  const me = lower(email);
  if (isAdmin || role === 'admin' || role === 'staff') return { ok: true };
  if (isCreator(skill, me) || isCreator(target, me)) return { ok: true };
  const areas = Array.isArray(target.approveArea) ? target.approveArea : [];
  if (role === 'approver' && areas.some((a) => userAreas.includes(a))) return { ok: true };
  return { ok: false, code: 'permission-denied', message: 'Only a creator of either side, an approver of the agent\'s area, staff or admin can decide this link.' };
}

module.exports = { checkLinkDecider };
