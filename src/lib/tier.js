// ── Tier Classification ──────────────────────────────────────────
// Computed client-side, NEVER stored in Firestore.
//
//   isSkill = (aiAgent === false && skillMd === true)
//
//   Internal/External priority (revised 2026-08-07 — see below):
//     1) customerFacing === true → External
//     2) internalUse === true    → Internal
//     3) neither set             → Internal (default)
//
//   Tier mapping:
//     Skill + Internal = T1
//     Agent + Internal = T2
//     Skill + External = T3
//     Agent + External = T4
//
// 2026-08-07 fix: step 3 used to guess External when an agent had no
// sdlcStage, on the theory "no dev-process tracking → not an internal
// workflow tool". Checked against the real 242-item library: 24 agents hit
// that branch, and every one of them was an incomplete/placeholder entry
// (owner Tech Innovation/นกลงทุน/นกรู้, description "TBC", several literal
// internal orchestrator prompt fragments like 3.safety.md, 5.query-planner.md)
// — none were actually customer-facing. Guessing External for missing data is
// also backwards from a governance standpoint (T3/T4 imply the STRONGER
// governance requirements per the tier design — Red Team/CAB/PVT for T4 — so
// under-classifying as External is the wrong direction to default toward).
// New default: Internal. Every NEW submission already sets customerFacing/
// internalUse explicitly via the required Scope radio in PreRegModal, so this
// branch only ever fires for legacy/incomplete data — see
// functions/backfill-scope.cjs, which uses the agent's actual description/
// output (when there's real content to read) to properly set these two flags
// instead of leaving them to this default indefinitely.
export function isSkill(agent) {
  return agent?.aiAgent === false && agent?.skillMd === true;
}

export function isInternalOrExternal(agent) {
  if (agent?.customerFacing === true) return 'External';
  if (agent?.internalUse === true) return 'Internal';
  return 'Internal';
}

export function getTier(agent) {
  const skill = isSkill(agent);
  const scope = isInternalOrExternal(agent);
  if (skill && scope === 'Internal') return 'T1';
  if (!skill && scope === 'Internal') return 'T2';
  if (skill && scope === 'External') return 'T3';
  return 'T4';
}

// Tier display names (2026-07-07) — shown as the full tooltip/label wherever
// space allows; the compact "T1"–"T4" badge alone remains fine in tight UI
// (cards, timeline dots) per user's explicit sign-off.
export const TIER_DEF = {
  T1: { label: 'T1 · Alpha Skill', color: '#0b7a68', bg: '#0b7a6815', bd: '#0b7a6840' },
  T2: { label: 'T2 · Incubate Agent', color: '#2f6bff', bg: '#2f6bff15', bd: '#2f6bff40' },
  T3: { label: 'T3 · Public Skill', color: '#6d28d9', bg: '#6d28d915', bd: '#6d28d940' },
  T4: { label: 'T4 · Enterprise Agent', color: '#b45309', bg: '#b4530915', bd: '#b4530940' },
};

export const TIER_ORDER = ['T1', 'T2', 'T3', 'T4'];

// Derives the agent/skill "type" used for badges & filters — same rule as
// the original dashboard: explicit aiAgent flag wins, Skill.md is the
// fallback signal, default is 'agent'.
export function getType(agent) {
  if (agent?.aiAgent === false && agent?.skillMd === true) return 'skill';
  return 'agent';
}

// ── Approval areas (for the pending-approval queue + progress-update gate) ──
// An agent's approve area is computed at runtime from its own data — there is
// no separate "group" field anywhere. External agents (Tier T3/T4) always
// fall under the single "Business" area; everything else is gated by the
// agent's own SDLC stage(s) (an agent can span more than one).
export function agentApproveAreas(agent) {
  if (isInternalOrExternal(agent) === 'External') return ['Business'];
  const stage = agent?.sdlcStage;
  if (!stage) return [];
  return Array.isArray(stage) ? stage.filter(Boolean) : [stage].filter(Boolean);
}
