// Feedback & Rating + usage statistics — the single place that decides HOW a
// rating is displayed (2026-08-18).
//
// ── The rule this file exists to enforce ──
// **Never render a computed average.** docs/SYSTEM-OVERVIEW.md:353 has a
// standing instruction — "อย่าใส่ตัวเลขปลอมหรือประมาณเอาเด็ดขาด" — and with
// the library's current traffic (64 chat turns TOTAL, ever, against 195
// registered users) most agents will sit at 0-2 ratings for a long time.
// `★5.0` derived from one rating is precisely the estimated number that rule
// forbids: it looks authoritative and is not.
//
// A histogram is a fact. `★5×3 ★4×1 ★1×1` cannot be wrong, cannot mislead at
// n=1, and still lets a reader compare two agents at a glance. So every
// surface renders counts, and `ratingAverage()` deliberately does not exist.
//
// Equally: n=0 must render as "ยังไม่มีรีวิว", never as five empty stars.
// 239 cards of empty stars would read as an abandoned library, which is worse
// than showing nothing — and it would be a lie about the agent rather than
// about the data.
//
// Every consumer (AgentCard, AgentDetailModal, DashboardTab, sorting) imports
// from here so no call site re-derives the display rule — the same anti-drift
// discipline as normalizeProgress / agentApproveAreas / isInternalToolName.

/** Stars, low → high. Exported so no caller hardcodes [1,2,3,4,5]. */
export const STAR_LEVELS = [1, 2, 3, 4, 5];

/** Empty stats, so a missing /agentStats doc and a zeroed one behave alike. */
export const EMPTY_STATS = {
  detailOpens: 0, endpointClicks: 0, searchHits: 0,
  r1: 0, r2: 0, r3: 0, r4: 0, r5: 0, ratingCount: 0,
};

/**
 * Normalise one raw /agentStats doc. Firestore omits fields that were never
 * incremented, so every read must go through this rather than assuming keys.
 */
export function readStats(raw) {
  const s = raw || {};
  const n = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0);
  return {
    detailOpens: n(s.detailOpens),
    endpointClicks: n(s.endpointClicks),
    searchHits: n(s.searchHits),
    r1: n(s.r1), r2: n(s.r2), r3: n(s.r3), r4: n(s.r4), r5: n(s.r5),
    // Trust the histogram over the stored counter: they can only disagree if a
    // write half-landed, and the buckets are what the UI actually draws.
    ratingCount: STAR_LEVELS.reduce((t, i) => t + n(s[`r${i}`]), 0),
  };
}

/** `{1: n, ...5: n}` for drawing the distribution. */
export function ratingHistogram(stats) {
  const s = readStats(stats);
  return Object.fromEntries(STAR_LEVELS.map((i) => [i, s[`r${i}`]]));
}

/**
 * Total in-app demand for an agent. Used only for ORDERING ("เรียงตามความนิยม",
 * Dashboard leaderboards) — never rendered as a single score, because summing
 * three different kinds of event into one number would itself be an estimate.
 * Endpoint clicks weigh most: that is someone actually leaving to go use the
 * thing, whereas a search hit is just the catalogue offering it up.
 */
export function demandScore(stats) {
  const s = readStats(stats);
  return s.endpointClicks * 3 + s.detailOpens * 2 + s.searchHits;
}

/** True when nobody has touched this agent at all — the retire signal. */
export function isUntouched(stats) {
  const s = readStats(stats);
  return s.detailOpens === 0 && s.endpointClicks === 0 && s.searchHits === 0;
}

/**
 * What a compact surface (card) should show. Returns a discriminated shape so
 * the caller renders, never decides.
 *   { kind: 'none' }                  → "ยังไม่มีรีวิว", NO star row
 *   { kind: 'histogram', bars, total } → bars are % of total, low→high
 */
export function ratingDisplay(stats) {
  const s = readStats(stats);
  if (s.ratingCount === 0) return { kind: 'none' };
  return {
    kind: 'histogram',
    total: s.ratingCount,
    bars: STAR_LEVELS.map((star) => ({
      star,
      count: s[`r${star}`],
      pct: Math.round((s[`r${star}`] / s.ratingCount) * 100),
    })),
  };
}

/**
 * May this user rate this agent? Mirrors the server check in submitRating —
 * the server is authoritative, this only decides whether to render the
 * control, so a user is never shown a button that will reject them.
 *
 * Uses the same creatorEmails/createdBy identity test as canUpdateProgress in
 * agentUtils.js. Kept as its own function rather than reusing that one because
 * the QUESTION is the opposite: there, being the creator grants rights; here
 * it removes them.
 */
export function canRateAgent(agent, user) {
  if (!agent || !user) return false;
  if (agent.approvalStatus !== 'approved' || agent.archived === true) return false;
  if (agent.createdBy && agent.createdBy === user.uid) return false;
  const email = (user.email || '').toLowerCase();
  const creators = Array.isArray(agent.creatorEmails) ? agent.creatorEmails : [];
  if (email && creators.some((e) => String(e || '').toLowerCase() === email)) return false;
  return true;
}
