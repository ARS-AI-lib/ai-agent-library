// Single source of truth for "does this duplicate-check result stop Submit?"
// Shared by PreRegModal and functions/eval-duplicate.cjs (via loadEsm).
//
// Decision 2026-11-26 (option B):
//   HARD block   — overall_risk is high, or a clear_duplicate is >= 70.
//   SOFT (reason) — a likely_overlap is >= 80: Submit is allowed only with a written
//                   reason, which the approver sees in the Pending queue.
// Archived candidates never stop Submit: the prompt treats them as "tried and
// retired", a warning, not "use this instead".
export const BLOCK_CLEAR_DUPLICATE = 70;
export const JUSTIFY_OVERLAP = 80;
export const MIN_JUSTIFICATION = 20;

export function duplicateBlock(aiResult, isArchived = () => false) {
  const all = aiResult?.candidates || [];
  const live = all.filter((c) => !isArchived(c.agentName));
  const byConf = [...live].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  const out = { blocked: false, reason: null, candidate: null, needsJustification: false };

  const dup = byConf.find((c) => c.verdict === 'clear_duplicate' && (c.confidence || 0) >= BLOCK_CLEAR_DUPLICATE);
  if (dup) return { ...out, blocked: true, reason: 'similar', candidate: dup };

  if (aiResult?.overall_risk === 'high') {
    const dups = all.filter((c) => c.verdict === 'clear_duplicate');
    const archivedOnly = dups.length > 0 && dups.every((c) => isArchived(c.agentName));
    if (!archivedOnly) return { ...out, blocked: true, reason: 'high_risk', candidate: byConf[0] || null };
  }

  const overlap = byConf.find((c) => c.verdict === 'likely_overlap' && (c.confidence || 0) >= JUSTIFY_OVERLAP);
  if (overlap) return { ...out, needsJustification: true, reason: 'overlap', candidate: overlap };
  return out;
}
