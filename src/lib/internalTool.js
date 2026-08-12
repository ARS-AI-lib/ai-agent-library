// Single source of truth for "is this library entry an internal implementation
// detail rather than a tool someone can pick up and use?"
//
// Extracted from functions/flag-internal.cjs (2026-08-11) so the rule exists
// exactly once. It is now needed in two places that cannot share a file
// otherwise: the browser (PreRegModal stamps `internalTool` at submit time, so
// a new fragment is flagged the moment it is registered) and the Node script
// (flag-internal.cjs, which backfills entries that predate that). Re-typing the
// regex in the client would be the same drift this project forbids for
// normalizeProgress / agentApproveAreas — flag-internal.cjs loads THIS module
// instead of declaring its own copy.
//
// What the flag does (deliberately narrow): it demotes an entry in chat search
// ranking (INTERNAL_RANK_PENALTY in src/lib/skills.js), routes it to a single
// approver area (layer 2 of agentApproveAreas in src/lib/approveAreas.js), and
// powers the "Platform Tools" sidebar filter. It never hides anything, and it
// never touches scope/tier — see the note at the bottom.

// ALPHA's own tool skills are registered as agent docs in the SAME library it
// searches (query_library, capability_search, …), plus the two "AI Agent
// Library …" meta entries describing ALPHA/its orchestrator itself. They were
// found the same way as the .md files: their descriptions are generic
// filter/search boilerplate that embeds close to nearly any library-related
// question, so they outranked real agents.
//
// `owner === 'Wolfy'` looked like a shortcut but is NOT safe — verified against
// real data it also covers legitimate, pick-up-and-use agents (Epic Writer,
// User Story Writer, ALPHA - Summarizer, …). An exact name allowlist is the
// only rule precise enough; these names are the fixed, deterministic set in
// functions/chatPrompt.js's TOOL_DECLARATIONS plus the two self-referential
// library entries — not something to pattern-match.
export const SELF_REFERENTIAL_NAMES = new Set([
  'get_agent_detail', 'query_library', 'capability_search', 'query_sdlc',
  'duplicate_check', 'search_library', 'agent_library_connection_suggest',
  'AI Agent Library Chat Assistant', 'AI Agent Library Copilot',
]);

/**
 * Narrow, explicit rule: the name ends in ".md" (prompt fragments such as
 * 6.answer-writer.md, 5.query-planner.md, 3.safety.md), OR is one of the fixed
 * self-referential names above. Everything else is left alone — no guessing at
 * intent from descriptions.
 *
 * NOTE: this answers "is it an internal implementation detail", NOT "who
 * consumes it". Scope (customerFacing/internalUse → tier) is a separate axis
 * and is deliberately not derived from here — three .md fragments are
 * currently flagged internalTool AND marked customerFacing, which is
 * contradictory but is a data question, not a rule question.
 */
export function isInternalToolName(agentName) {
  const name = agentName || '';
  return /\.md$/i.test(name) || SELF_REFERENTIAL_NAMES.has(name);
}
