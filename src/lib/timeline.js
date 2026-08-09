// ── SDLC Timeline data layer (2026-07) ──────────────────────────────
// Ports the reference "SDLC Timeline" tab's forecast-status logic onto our
// Firestore `agents` data. UX (status semantics, milestone filter,
// out-of-milestone bucketing, click-to-detail) is kept faithful to the
// reference; only the data source (Firestore, not Google Sheets), the
// editable milestones, and the auto-fitting time axis are new.

import { getType } from './tier';
import { normalizeProgress, agentUseCaseNames } from './agentUtils';

// Status palette for the timeline dots — mirrors the reference TL_ST. These
// are timeline-forecast statuses (done/pilot/ontime/risk/delay), DISTINCT from
// the app's progress-bucket ST_DEF, because the timeline judges "are we on
// track to hit the launch date", not just raw % complete.
// 2026-07-06: 'notstart' retired (a 0%-progress item now just gets forecast
// on-track/at-risk/delayed by its launch date like everything else). Pilot
// recolored from olive to the old To-Do blue to stay consistent with the
// library legend's same-day recolor; On track recolored from blue to the old
// olive Pilot green so it no longer clashes with Pilot's new blue.
// bg/bd/tx are CSS var() tokens (theme.css, TL_ST family) — 2026-08-08, same
// dark-mode pattern as ST_DEF/TIER_DEF. These are also read directly by
// <canvas> drawing code in TimelinePage.jsx, which can't resolve var() itself
// — drawTimeline() resolves the SAME token names via getComputedStyle() at
// draw time instead, so the two never drift apart into two palettes.
export const TL_ST = {
  done:     { bg: 'var(--tl-done-bg)', bd: 'var(--tl-done-bd)', tx: 'var(--tl-done-fg)', ic: '✓', lb: 'Done' },
  pilot:    { bg: 'var(--tl-pilot-bg)', bd: 'var(--tl-pilot-bd)', tx: 'var(--tl-pilot-fg)', ic: '◆', lb: 'Pilot' },
  ontime:   { bg: 'var(--tl-ontime-bg)', bd: 'var(--tl-ontime-bd)', tx: 'var(--tl-ontime-fg)', ic: '●', lb: 'On track' },
  risk:     { bg: 'var(--tl-risk-bg)', bd: 'var(--tl-risk-bd)', tx: 'var(--tl-risk-fg)', ic: '!', lb: 'At risk' },
  delay:    { bg: 'var(--tl-delay-bg)', bd: 'var(--tl-delay-bd)', tx: 'var(--tl-delay-fg)', ic: '✕', lb: 'Delayed' },
};

const DAY = 864e5;

// Firestore Timestamp | Date | 'YYYY-MM-DD' | 'M/D/YYYY' → Date (or null).
export function toDate(v) {
  if (!v) return null;
  try {
    if (v.toDate) return v.toDate();
    const d = new Date(v);
    return isNaN(d) ? null : d;
  } catch {
    return null;
  }
}

// Firestore agent → flat timeline item. `team` (the row grouping) is the
// agent's OWNER (dept/team). `creator` is the person. This mirrors the
// reference's a.team (row) vs a.owner (person) — note the field names are
// swapped between the two data models, hence the explicit remap here.
export function toTimelineItem(a) {
  return {
    id: a.id,
    name: a.agentName || '',
    type: getType(a),
    team: a.owner || '',
    creator: a.creator || '',
    launch: toDate(a.launchDate),
    progress: normalizeProgress(a?.devProgress),
    ability: Array.isArray(a.coreAbility) ? a.coreAbility.join(', ') : (a.coreAbility || ''),
    role: Array.isArray(a.relatedRole) ? a.relatedRole.join(', ') : (a.relatedRole || ''),
    useCase: agentUseCaseNames(a).join(', '),
    process: Array.isArray(a.sdlcProcessMapping) ? a.sdlcProcessMapping.join(', ') : (a.sdlcProcessMapping || ''),
    _raw: a,
  };
}

// Forecast status for one item, relative to the axis start `axisStart` (the
// auto-fit earliest date). Faithful port of the reference tlStatus, but keyed
// off our progress-only model: 100% → done, 90-99% (our Pilot bucket) →
// pilot, otherwise the on-track/at-risk/delayed forecast vs the launch date.
export function timelineStatus(item, axisStart, today = startOfToday()) {
  const p = item.progress;
  const d = item.launch;

  if (p >= 100) return 'done';
  if (p >= 90) return 'pilot';           // our Pilot bucket (== reference phase==='pilot')

  // 2026-07-06: 'notstart' retired — a 0%-progress item is no longer a status
  // of its own; it's forecast against its launch date like anything else.
  if (!d) return 'ontime';               // no launch date → nothing to be late against

  if (d > today) {                        // launch in the future → forecast
    const total = (d - axisStart) / DAY;
    const elapsed = (today - axisStart) / DAY;
    const expected = total > 0 ? Math.min(100, (elapsed / total) * 100) : 100;
    const gap = expected - p;             // positive = behind schedule
    return gap <= 20 ? 'ontime' : 'risk';
  }

  // launch has passed and it's not done → overdue
  return 'delay';
}

export function startOfToday() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

// Auto-fit axis range: span from the earliest to the latest of {all milestone
// starts/ends, all item launch dates}, padded to whole months on each end so
// the month header reads cleanly. Falls back to a sane window if there's no
// data at all.
export function autoFitRange(items, milestones) {
  const dates = [];
  items.forEach((it) => { if (it.launch) dates.push(it.launch); });
  milestones.forEach((m) => {
    const s = toDate(m.start); const e = toDate(m.end);
    if (s) dates.push(s); if (e) dates.push(e);
  });
  if (!dates.length) {
    const now = startOfToday();
    const s = new Date(now.getFullYear(), now.getMonth(), 1);
    const e = new Date(now.getFullYear(), now.getMonth() + 5, 0);
    return { start: s, end: e };
  }
  let min = dates[0], max = dates[0];
  dates.forEach((d) => { if (d < min) min = d; if (d > max) max = d; });
  const start = new Date(min.getFullYear(), min.getMonth(), 1);              // 1st of min month
  const end = new Date(max.getFullYear(), max.getMonth() + 1, 0);            // last day of max month
  return { start, end };
}

// Month tick marks between start & end, inclusive, for the axis header.
export function monthTicks(start, end) {
  const out = [];
  let y = start.getFullYear(), m = start.getMonth();
  while (y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth())) {
    const s = new Date(y, m, 1);
    const e = new Date(y, m + 1, 0);
    out.push({ label: s.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(), start: s, end: e });
    m += 1; if (m > 11) { m = 0; y += 1; }
  }
  return out;
}

// Is a launch date inside ANY milestone band?
export function inAnyMilestone(date, milestones) {
  if (!date) return false;
  return milestones.some((m) => {
    const s = toDate(m.start); const e = toDate(m.end);
    return s && e && date >= s && date <= e;
  });
}
