// ── Unified Status Badge ─────────────────────────────────────────
// Status is derived purely from `devProgress` via fixed thresholds. 2026-07-06:
// the "Not Start" bucket was retired — everything below 90% that isn't yet in
// progress now starts at "To Do". Thresholds: 0-10%=To Do, 11-89%=In Progress,
// 90-99%=Pilot, 100%=Ready to Use. Legend recolored the same day: To Do took
// the old Not-Start grey, Pilot took the old To-Do blue (the old olive Pilot
// colour is retired). `developmentPhase` is no longer read for classification
// — it's a stored display string kept in sync by the progress-update writer
// (see developmentPhaseLabel below), not a source of truth.

export const ST_ORDER = ['td', 'ip', 'pilot', 'ru'];

export const ST_DEF = {
  td: { lb: 'To Do', color: '#6b7280', bg: '#f9fafb', bd: '#e5e7eb', dot: '#9ca3af' },
  ip: { lb: 'In Progress', color: '#92400e', bg: '#fffbeb', bd: '#fde68a', dot: '#f5a623' },
  pilot: { lb: 'Pilot', color: '#3d5a8e', bg: '#edf2f9', bd: '#b0c4de', dot: '#4a6fa5' },
  ru: { lb: 'Ready to Use', color: '#15803d', bg: '#f0fdf4', bd: '#bbf7d0', dot: '#15803d' },
};

export function phaseForProgress(p) {
  const progress = typeof p === 'number' ? p : 0;
  if (progress >= 100) return 'ru';
  if (progress >= 90) return 'pilot';
  if (progress >= 11) return 'ip';
  return 'td';   // 0-10% — "Not Start" bucket retired 2026-07-06, folds into To Do
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
  const c = { td: 0, ip: 0, pilot: 0, ru: 0 };
  agents.forEach((a) => {
    const s = agentStatus(a);
    c[s] = (c[s] || 0) + 1;
  });
  return c;
}

// Progress-bar fill color bucket — 2026-07-06 (improve pass): reuse the same
// td/ip/pilot/ru bucket as the status badge instead of a separate 70/30%
// threshold (old pfh/pfm/pfl, whose green/purple/grey carried no relation to
// status at all). One card previously showed two unrelated colour codings for
// the same progress number; now the bar and the badge always agree.
export function progressBucket(p) {
  return phaseForProgress(p);
}
