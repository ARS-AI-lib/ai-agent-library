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
// color/bg/bd are CSS var() tokens (theme.css) — 2026-08-08, same reasoning
// as ST_DEF in status.js: lets the dark-mode toggle repaint every tier badge
// without editing a call site.
export const TIER_DEF = {
  T1: { label: 'T1 · Alpha Skill', color: 'var(--tier-t1-fg)', bg: 'var(--tier-t1-bg)', bd: 'var(--tier-t1-bd)' },
  T2: { label: 'T2 · Incubate Agent', color: 'var(--tier-t2-fg)', bg: 'var(--tier-t2-bg)', bd: 'var(--tier-t2-bd)' },
  T3: { label: 'T3 · Public Skill', color: 'var(--tier-t3-fg)', bg: 'var(--tier-t3-bg)', bd: 'var(--tier-t3-bd)' },
  T4: { label: 'T4 · Enterprise Agent', color: 'var(--tier-t4-fg)', bg: 'var(--tier-t4-bg)', bd: 'var(--tier-t4-bd)' },
};

export const TIER_ORDER = ['T1', 'T2', 'T3', 'T4'];

// Derives the agent/skill "type" used for badges & filters — same rule as
// the original dashboard: explicit aiAgent flag wins, Skill.md is the
// fallback signal, default is 'agent'.
export function getType(agent) {
  if (agent?.aiAgent === false && agent?.skillMd === true) return 'skill';
  return 'agent';
}

// ── Approval areas ───────────────────────────────────────────────────
// MOVED 2026-08-10 to src/lib/approveAreas.js — `agentApproveAreas()` now
// resolves against 12 discipline-based areas instead of the 7 SDLC stages,
// and needs helpers from agentUtils.js (which imports THIS file), so keeping
// it here would make the two modules circular. tier.js stays import-free.
//
// The old rule was: External → ['Business'], else agent.sdlcStage verbatim.
// That left 79 of 243 agents (Internal, no sdlcStage) with an empty area —
// invisible to every scoped approver. See approveAreas.js for the full
// rationale and the replacement fallback chain.
