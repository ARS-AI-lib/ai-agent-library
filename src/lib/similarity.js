// ── Duplicate-Check Similarity Scoring ───────────────────────────
// Ported from the original "AI Agent Duplicate Checker" (pre-regis.html).
// Weighted text-similarity across the fields that matter most for
// spotting an agent/skill that already exists in the library.

export const SIMILARITY_WEIGHTS = {
  agentName: 0.25,
  description: 0.25,
  coreAbility: 0.15,
  input: 0.15,
  output: 0.15,
  businessValue: 0.05,
};

export const RISK_THRESHOLDS = { critical: 80, high: 60, medium: 40 };

function norm(s) {
  return (s || '')
    .toString()
    .toLowerCase()
    .replace(/tbc/g, '')
    .replace(/[.,;:()/\-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s) {
  return norm(s).split(' ').filter((w) => w.length > 2);
}

function jaccard(a, b) {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach((t) => {
    if (tb.has(t)) inter++;
  });
  return inter / (ta.size + tb.size - inter);
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function levSim(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  const ml = Math.max(na.length, nb.length);
  return Math.max(0, (1 - levenshtein(na, nb) / ml) * 100);
}

function textSim(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  return Math.max(jaccard(a, b) * 100, levSim(a, b));
}

// Multi-value fields (coreAbility, etc.) may be arrays — flatten to a
// comparable string before scoring.
function asText(v) {
  return Array.isArray(v) ? v.join(', ') : v || '';
}

/**
 * Score a draft agent/skill against ONE existing library entry.
 * @param {object} draft  - { agentName, description, coreAbility, input, output, businessValue }
 * @param {object} existing - same shape, an existing Firestore agent doc
 * @returns {{ confidence:number, fields: Record<string, number> }}
 */
export function scoreDraftAgainst(draft, existing) {
  const fields = {
    agentName: textSim(draft.agentName, existing.agentName),
    description: textSim(draft.description, existing.description),
    coreAbility: textSim(asText(draft.coreAbility), asText(existing.coreAbility)),
    input: textSim(draft.input, existing.input),
    output: textSim(draft.output, existing.output),
    businessValue: textSim(draft.businessValue, existing.businessValue),
  };
  const confidence = Object.entries(SIMILARITY_WEIGHTS).reduce(
    (sum, [key, weight]) => sum + (fields[key] || 0) * weight,
    0
  );
  return { confidence: Math.round(confidence * 10) / 10, fields };
}

export function riskLevel(confidence) {
  if (confidence >= RISK_THRESHOLDS.critical) return 'critical';
  if (confidence >= RISK_THRESHOLDS.high) return 'high';
  if (confidence >= RISK_THRESHOLDS.medium) return 'medium';
  return 'low';
}

export const RISK_DEF = {
  critical: { label: 'Critical', color: '#c5221f', bg: '#fce8e6' },
  high: { label: 'High', color: '#c96a00', bg: '#feefc3' },
  medium: { label: 'Medium', color: '#b06000', bg: '#fef7e0' },
  low: { label: 'Low', color: '#137333', bg: '#e6f4ea' },
};

/**
 * Score a draft against the whole existing library, sorted by confidence desc.
 * Returns top matches only (confidence >= medium threshold) — anything
 * below "medium" isn't worth showing to the submitter as a hard duplicate.
 */
export function findDuplicates(draft, library, limit = 5) {
  return library
    .map((existing) => ({ existing, ...scoreDraftAgainst(draft, existing) }))
    .filter((r) => r.confidence >= RISK_THRESHOLDS.medium)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

/**
 * Top-N nearest neighbours by raw rule score, with NO threshold filter.
 * The rule-based scorer only compares surface tokens, so a genuine semantic
 * overlap written in different words (or mixed Thai/English) can score well
 * below the "medium" cutoff. We still want the AI to see those, so this
 * feeds the LLM the closest N regardless of score — the AI makes the real
 * semantic judgement; the rule score travels along only as a weak hint.
 */
export function rankCandidates(draft, library, limit = 15) {
  return library
    .map((existing) => ({ existing, ...scoreDraftAgainst(draft, existing) }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}
