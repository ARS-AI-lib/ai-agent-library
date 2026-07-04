// ── Connection Suggestions ("ต่อกับตัวนี้ได้") ───────────────────
// Ported from findConnectionSuggestions() in the original pre-Registration.html
// and adapted to the app's camelCase agent model. Scores a draft idea against
// every existing library entry to find where it could HAND OFF DATA to,
// TRIGGER, or SHARE CONTEXT with an existing Agent/Skill — the deterministic,
// directional signal that grounds the AI's integration suggestions.
//
// Signals & weights (per candidate):
//   dataHandoff 0.50 — draft.output ≈ existing.input (or reverse); directional
//   stage       0.20 — SDLC process-step adjacency (1 step apart scores highest)
//   tool        0.15 — shared Tool tokens
//   teamRole    0.15 — same owner/team

const CONN_THRESHOLD = 40;
const GENERIC_MIN_COUNT = 5;

function asText(v) {
  return Array.isArray(v) ? v.join(', ') : (v || '');
}
function norm(s) {
  return asText(s).toString().toLowerCase()
    .replace(/tbc/g, '').replace(/[.,;:()/\-_]/g, ' ').replace(/\s+/g, ' ').trim();
}
function toks(s) {
  return norm(s).split(' ').filter((w) => w.length > 2);
}
function jaccard(a, b) {
  const ta = new Set(toks(a));
  const tb = new Set(toks(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach((t) => { if (tb.has(t)) inter++; });
  return inter / (ta.size + tb.size - inter);
}
function dataJaccard(a, b, stop) {
  const ta = new Set(toks(a).filter((t) => !stop.has(t)));
  const tb = new Set(toks(b).filter((t) => !stop.has(t)));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach((t) => { if (tb.has(t)) inter++; });
  return inter / (ta.size + tb.size - inter);
}
function lev(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}
function levSim(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  return Math.max(0, (1 - lev(na, nb) / Math.max(na.length, nb.length)) * 100);
}
function textSim(a, b, stop) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  return Math.max(dataJaccard(a, b, stop) * 100, levSim(a, b));
}
function isTBC(v) { return !norm(v); }

function buildToolStopwords(rows) {
  const set = new Set();
  rows.forEach((r) => toks(r.tool).forEach((t) => set.add(t)));
  ['jira', 'gitlab', 'github', 'vercel', 'docker', 'confluence', 'sharepoint', 'slack', 'teams',
   'qdrant', 'figma', 'supabase', 'kubernetes', 'prometheus', 'api', 'ide', 'git', 'sonarqube',
   'robot', 'framework', 'claude', 'gemini', 'gpt', 'opus', 'sonnet', 'flash', 'mcp', 'antigravity',
   'n8n', 'python', 'langchain'].forEach((t) => set.add(t));
  return set;
}
function buildGenericIndex(rows) {
  const freq = {};
  rows.forEach((r) => { ['input', 'output'].forEach((k) => { const n = norm(r[k]); if (n) freq[n] = (freq[n] || 0) + 1; }); });
  const generic = new Set(Object.keys(freq).filter((k) => freq[k] >= GENERIC_MIN_COUNT));
  return { freq, generic };
}
function isGeneric(v, gi) { const n = norm(v); return n && gi.generic.has(n); }

// process id: "2.2 High-Level ..." → "2.2"
function extractProcId(s) {
  const t = asText(s).trim();
  if (!t) return '';
  return /^\d/.test(t) ? t.split(' ')[0] : t;
}
function procIdsOf(v) {
  const arr = Array.isArray(v) ? v : asText(v).split(',');
  return arr.map((s) => extractProcId(s)).filter(Boolean);
}
function numKey(id) {
  const m = String(id).match(/^(\d+)\.(\d+)([A-Za-z]*)/);
  if (!m) return Infinity;
  return parseFloat(m[1]) * 100 + parseFloat(m[2]) + (m[3] ? m[3].charCodeAt(0) / 1000 : 0);
}

// Build an ordered index of every known process id (from the sdlcProcesses
// catalog) so we can measure how many workflow steps apart two agents sit.
export function buildCatalog(processes) {
  const ids = [...new Set((processes || []).map((p) => extractProcId(p.id || p.processId)).filter(Boolean))];
  ids.sort((a, b) => numKey(a) - numKey(b));
  const index = new Map();
  ids.forEach((id, i) => index.set(id, i));
  return { index };
}
function stepDistance(catalog, a, b) {
  const idsA = procIdsOf(a);
  const idsB = procIdsOf(b);
  if (!idsA.length || !idsB.length) return null;
  let best = null;
  idsA.forEach((ia) => {
    const pa = catalog.index.get(ia);
    if (pa === undefined) return;
    idsB.forEach((ib) => {
      const pb = catalog.index.get(ib);
      if (pb === undefined) return;
      const d = Math.abs(pa - pb);
      if (best === null || d < best) best = d;
    });
  });
  return best;
}
function stepAdjacency(catalog, a, b) {
  const d = stepDistance(catalog, a, b);
  if (d === null) return { score: 0, distance: null };
  if (d === 1) return { score: 100, distance: d };
  if (d === 0) return { score: 50, distance: d };
  if (d === 2) return { score: 60, distance: d };
  if (d === 3) return { score: 30, distance: d };
  return { score: 0, distance: d };
}
function trunc(s, n = 44) {
  s = asText(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function scoreDraftConnection(draft, row, gi, stop, catalog) {
  const dOut = asText(draft.output);
  const dIn = asText(draft.input);
  const rOut = asText(row.output);
  const rIn = asText(row.input);

  const outIn = textSim(dOut, rIn, stop);   // draft → row
  const inOut = textSim(rOut, dIn, stop);   // row → draft
  const forward = outIn >= inOut;
  const dirScore = Math.max(outIn, inOut);
  const sOut = forward ? dOut : rOut;
  const sIn = forward ? rIn : dIn;

  const tbc = isTBC(sOut) || isTBC(sIn);
  const generic = isGeneric(sOut, gi) || isGeneric(sIn, gi);
  const adj = stepAdjacency(catalog,
    forward ? draft.sdlcProcessMapping : row.sdlcProcessMapping,
    forward ? row.sdlcProcessMapping : draft.sdlcProcessMapping);
  const toolSc = jaccard(draft.tool, row.tool) * 100;
  const teamSc = draft.owner && draft.owner === row.owner ? 100 : 0;

  let handoff = dirScore;
  if (generic) {
    const val = isGeneric(sOut, gi) ? norm(sOut) : norm(sIn);
    const cluster = gi.freq[val] || GENERIC_MIN_COUNT;
    handoff = dirScore / (1 + Math.log2(cluster));
  }
  const weighted = { dataHandoff: handoff * 0.50, stage: adj.score * 0.20, tool: toolSc * 0.15, teamRole: teamSc * 0.15 };
  let confidence = Object.values(weighted).reduce((s, v) => s + v, 0);
  if (tbc) confidence = Math.min(confidence, 20);

  const dominant = Object.entries(weighted).sort((x, y) => y[1] - x[1])[0][0];
  const type = dominant === 'dataHandoff' ? 'Data Handoff'
    : dominant === 'stage' ? 'Trigger' : 'Shared Context/Tool';

  const parts = [];
  if (dirScore > 30) parts.push(`Output "${trunc(sOut)}" ≈ Input "${trunc(sIn)}" (${dirScore.toFixed(0)}%)`);
  if (adj.distance !== null) parts.push(`${adj.distance} process-step${adj.distance === 1 ? '' : 's'} apart`);
  if (toolSc > 0) parts.push('shared tool');
  if (teamSc > 0) parts.push('same team');

  return {
    target: row.agentName,
    direction: forward ? 'draft→existing' : 'existing→draft',
    type,
    confidence: Math.round(Math.min(100, confidence) * 10) / 10,
    dataIncomplete: tbc,
    reason: parts.join(' · ') || 'weak/no signal',
  };
}

export function findConnectionSuggestions(draft, library, processes, limit = 6) {
  if (!library.length) return [];
  const gi = buildGenericIndex(library);
  const stop = buildToolStopwords(library);
  const catalog = buildCatalog(processes);
  return library
    .filter((r) => norm(r.agentName) !== norm(draft.agentName))
    .map((r) => scoreDraftConnection(draft, r, gi, stop, catalog))
    .filter((r) => r.confidence >= CONN_THRESHOLD)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}
