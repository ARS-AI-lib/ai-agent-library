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

// color/bg/bd are CSS var() references (tokens defined in theme.css, light +
// dark) — 2026-08-08, so a dark-mode toggle can repaint every consumer of
// this object without touching a single call site. `dot` stays a literal hex
// on purpose: a legend swatch/KPI bar should read the same saturated hue in
// both themes, it's the pale bg+text PAIR that has to adapt (see theme.css).
export const ST_DEF = {
  td: { lb: 'To Do', color: 'var(--st-td-fg)', bg: 'var(--st-td-bg)', bd: 'var(--st-td-bd)', dot: '#9ca3af' },
  ip: { lb: 'In Progress', color: 'var(--st-ip-fg)', bg: 'var(--st-ip-bg)', bd: 'var(--st-ip-bd)', dot: '#f5a623' },
  pilot: { lb: 'Pilot', color: 'var(--st-pilot-fg)', bg: 'var(--st-pilot-bg)', bd: 'var(--st-pilot-bd)', dot: '#4a6fa5' },
  ru: { lb: 'Ready to Use', color: 'var(--st-ru-fg)', bg: 'var(--st-ru-bg)', bd: 'var(--st-ru-bd)', dot: '#15803d' },
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

// ── Human / AI level (2026-09-24) — AI-SDLC Blueprint only ──────────
// How much of the work AI carries for one agent/skill, derived from the
// same status bucket plus the stored `hml` (Human-in-the-Loop) flag:
//   To Do                              → 'human'  (people still do the work;
//                                         a process with NO agent is also 'human' — DashboardRoleView)
//   In Progress / Pilot                → 'mixed'  (Gen AI + Human)
//   Ready to Use with hml = true       → 'mixed'
//   Ready to Use with hml = false      → 'ai'     (Gen AI, no human in the loop)
// Takes the already-normalized progress number (callers use
// normalizeProgress first — agentUtils imports this file, not the reverse).
export const HITL_ORDER = ['human', 'mixed', 'ai'];
export const HITL_DEF = {
  human: { lb: 'Human', color: '#004E85' },
  mixed: { lb: 'Gen AI + Human', color: '#FF761E' },
  ai: { lb: 'Gen AI', color: '#0EB678' },
};
export function hitlLevel(progress, hml) {
  const b = phaseForProgress(progress);
  if (b === 'td') return 'human';
  if (b !== 'ru') return 'mixed';
  const inLoop = hml === true || String(hml).toLowerCase() === 'true';
  return inLoop ? 'mixed' : 'ai';
}
