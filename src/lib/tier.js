// ── Tier Classification ──────────────────────────────────────────
// Computed client-side, NEVER stored in Firestore.
// Locked logic (confirmed in project memory):
//
//   isSkill = (aiAgent === false && skillMd === true)
//
//   Internal/External priority:
//     1) customerFacing === true → External
//     2) internalUse === true    → Internal
//     3) both false/empty: sdlcStage has a value → Internal, else → External
//
//   Tier mapping:
//     Skill + Internal = T1
//     Agent + Internal = T2
//     Skill + External = T3
//     Agent + External = T4

export function isSkill(agent) {
  return agent?.aiAgent === false && agent?.skillMd === true;
}

export function isInternalOrExternal(agent) {
  if (agent?.customerFacing === true) return 'External';
  if (agent?.internalUse === true) return 'Internal';
  const hasStage =
    agent?.sdlcStage &&
    (Array.isArray(agent.sdlcStage) ? agent.sdlcStage.length > 0 : String(agent.sdlcStage).trim() !== '');
  return hasStage ? 'Internal' : 'External';
}

export function getTier(agent) {
  const skill = isSkill(agent);
  const scope = isInternalOrExternal(agent);
  if (skill && scope === 'Internal') return 'T1';
  if (!skill && scope === 'Internal') return 'T2';
  if (skill && scope === 'External') return 'T3';
  return 'T4';
}

export const TIER_DEF = {
  T1: { label: 'T1 · Skill / Internal', color: '#0b7a68', bg: '#0b7a6815', bd: '#0b7a6840' },
  T2: { label: 'T2 · Agent / Internal', color: '#2f6bff', bg: '#2f6bff15', bd: '#2f6bff40' },
  T3: { label: 'T3 · Skill / External', color: '#6d28d9', bg: '#6d28d915', bd: '#6d28d940' },
  T4: { label: 'T4 · Agent / External', color: '#b45309', bg: '#b4530915', bd: '#b4530940' },
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
