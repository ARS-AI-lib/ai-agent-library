// Library context for the Pre-Reg AI (2026-09-29).
//
// Why: analyzeDuplicate used to judge every draft in isolation — it never saw
// which team the draft belongs to or how that team's existing items are filed.
// Four new AIPhbt items came back with four different Approve Areas while all
// 13 siblings sat in Business & Product. Same lesson as role groups (§33):
// showing already-filed examples makes new answers consistent.
//
// Pure — no Firestore — so verify-library-context.cjs checks it offline and
// eval-library-context.cjs runs the exact same summary against real data.

const DOMINANT_SHARE = 0.6;   // "the team's usual area" only when it really is usual
const MAX_EXAMPLES = 8;

const countBy = (arr) => arr.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {});
const top = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1]);

/**
 * Summarize how one team's approved, live items are filed.
 * @param agents      library docs ({id, agentName, owner, approveArea, category, approvalStatus, archived})
 * @param owner       the draft's team
 * @param opts.excludeId  leave-one-out (eval) — never count the item being judged
 * @param opts.products   product category names (excluded: product tags are evidence-only)
 * @returns null when the team is empty/unknown
 */
function summarizeTeam(agents, owner, { excludeId = null, products = [] } = {}) {
  const team = String(owner || '').trim();
  if (!team) return null;
  const prod = new Set(products);
  const items = (agents || []).filter((a) => a
    && a.id !== excludeId
    && String(a.owner || '').trim() === team
    && a.approvalStatus === 'approved'
    && a.archived !== true);
  if (!items.length) return null;

  const areas = items.flatMap((a) => (Array.isArray(a.approveArea) ? a.approveArea : []));
  const cats = items.flatMap((a) => (Array.isArray(a.category) ? a.category : [])).filter((c) => !prod.has(c));
  const areaCounts = countBy(areas);
  const categoryCounts = countBy(cats);
  const dom = (counts) => {
    const [k, n] = top(counts)[0] || [];
    return k && n / items.length >= DOMINANT_SHARE ? k : null;
  };

  return {
    team,
    n: items.length,
    dominantArea: dom(areaCounts),
    dominantCategory: dom(categoryCounts),
    areaCounts: Object.fromEntries(top(areaCounts)),
    categoryCounts: Object.fromEntries(top(categoryCounts)),
    examples: items.slice(0, MAX_EXAMPLES).map((a) => ({
      name: a.agentName,
      area: Array.isArray(a.approveArea) ? a.approveArea : [],
      category: (Array.isArray(a.category) ? a.category : []).filter((c) => !prod.has(c)),
    })),
  };
}

module.exports = { summarizeTeam, DOMINANT_SHARE, MAX_EXAMPLES };
