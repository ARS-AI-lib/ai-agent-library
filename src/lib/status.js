// ── Unified Status Badge ─────────────────────────────────────────
// Status is derived purely from `devProgress` via fixed thresholds (locked
// 2026-06-30): 0%=Not Start, 1-10%=To Do, 11-89%=In Progress, 90-99%=Pilot,
// 100%=Ready to Use. `developmentPhase` is no longer read for classification
// — it's a stored display string kept in sync by the progress-update writer
// (see developmentPhaseLabel below), not a source of truth.

export const ST_ORDER = ['ns', 'td', 'ip', 'pilot', 'ru'];

export const ST_DEF = {
  ns: { lb: 'Not Start', color: '#6b7280', bg: '#f9fafb', bd: '#e5e7eb', dot: '#9ca3af' },
  td: { lb: 'To Do', color: '#3d5a8e', bg: '#edf2f9', bd: '#b0c4de', dot: '#4a6fa5' },
  ip: { lb: 'In Progress', color: '#92400e', bg: '#fffbeb', bd: '#fde68a', dot: '#f5a623' },
  pilot: { lb: 'Pilot', color: '#5a6b1c', bg: '#f4f6e5', bd: '#c5d06a', dot: '#8ea82a' },
  ru: { lb: 'Ready to Use', color: '#15803d', bg: '#f0fdf4', bd: '#bbf7d0', dot: '#15803d' },
};

export function phaseForProgress(p) {
  const progress = typeof p === 'number' ? p : 0;
  if (progress >= 100) return 'ru';
  if (progress >= 90) return 'pilot';
  if (progress >= 11) return 'ip';
  if (progress >= 1) return 'td';
  return 'ns';
}

// The literal string written to `developmentPhase` whenever devProgress is
// updated via the progress-update feature — kept as a human-readable mirror
// of the status badge, not used for any classification logic.
export function developmentPhaseLabel(p) {
  return ST_DEF[phaseForProgress(p)].lb;
}

export function agentStatus(agent) {
  const progress = typeof agent?.devProgress === 'number' ? agent.devProgress : 0;
  return phaseForProgress(progress);
}

export function statusCounts(agents) {
  const c = { ns: 0, td: 0, ip: 0, pilot: 0, ru: 0 };
  agents.forEach((a) => {
    const s = agentStatus(a);
    c[s] = (c[s] || 0) + 1;
  });
  return c;
}

// Progress-bar fill color bucket (matches original .pfh/.pfm/.pfl)
export function progressBucket(p) {
  if (p >= 70) return 'pfh';
  if (p >= 30) return 'pfm';
  return 'pfl';
}
