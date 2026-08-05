// ── Shared embedding contract ────────────────────────────────────────
// Single source of truth for HOW an agent becomes a vector. The Cloud
// Function, the bootstrap script, and any calibration/regression script all
// require this file rather than re-deriving the logic.
//
// This matters more than usual: if the text shape or the model/dimension used
// at index time ever diverges from the one used at query time, the stored
// vectors and the fresh ones live in different spaces, cosine similarity
// silently returns garbage, and nothing throws. Same class of drift that made
// normalizeProgress a standing rule in CLAUDE.md — except here it would be
// invisible instead of merely wrong.

const crypto = require('crypto');

// Measured choice, not a default: text-multilingual-embedding-002 at 256 dims.
// gemini-embedding-001 is newer but natively 3072-dim, and truncating it to
// 256 collapses score separation badly (an investment-news skill ranked #8 for
// a test-case query under it, vs #14 under this model).
const EMBED_MODEL = 'text-multilingual-embedding-002';
const EMBED_DIM = 256;
// Vectors are stored as JSON and downloaded whole by the browser, where a raw
// double serialises to ~21 characters ("0.014704730361700058"). At 244 entries
// that was a measured 1.26 MB on first chat open — a real cost on VPN, and far
// more precision than cosine ranking can use.
//
// Measured before adopting: 4 decimals cuts the payload to 0.45 MB (−64%) with
// ZERO ranking changes across 5 real queries × top-10. 3 decimals saves barely
// more (0.39 MB) but starts reordering results (3/50 moved), so 4 is the floor.
const EMBED_PRECISION = 4;
const round = (x) => Number(x.toFixed(EMBED_PRECISION));
// Vertex caps instances per embed request; 50 stays inside both that cap and
// the per-request token budget for ~250 short documents.
const EMBED_BATCH = 50;

const flat = (v) => (Array.isArray(v) ? v.join(', ') : (v || ''));

// The exact text that gets embedded for a library entry. The content hash is
// taken over this string, so changing the shape here automatically invalidates
// every stored vector and forces a clean rebuild — which is the behaviour we
// want, rather than a half-migrated index.
function buildEmbedText(a) {
  return [
    a.agentName || '',
    flat(a.description),
    `input: ${flat(a.input)}`,
    `output: ${flat(a.output)}`,
    flat(a.coreAbility),
    flat(a.relatedRole),
    flat(a.useCase),
    flat(a.businessValue),
  ].join('. ').replace(/\s+/g, ' ').trim();
}

// Precision is folded into the hash deliberately: changing it changes what a
// stored vector IS, so every entry must be re-embedded. Hashing only the source
// text would leave the index silently half-migrated after a precision change.
function contentHash(text) {
  return crypto.createHash('sha1')
    .update(`${EMBED_MODEL}:${EMBED_DIM}:p${EMBED_PRECISION}:${text}`)
    .digest('hex');
}

// taskType is asymmetric on purpose: stored library vectors are
// RETRIEVAL_DOCUMENT, and every lookup — a chat question, or a draft being
// duplicate-checked — embeds as RETRIEVAL_QUERY. Validated before committing:
// treating a draft as a query ranked its true duplicate #1 in 3 of 4 cases,
// including a Thai-reworded duplicate that the lexical scorer buried at #7.
async function embedTexts(ai, texts, taskType) {
  const out = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const resp = await ai.models.embedContent({
      model: EMBED_MODEL,
      contents: texts.slice(i, i + EMBED_BATCH),
      config: { outputDimensionality: EMBED_DIM, taskType },
    });
    (resp.embeddings || []).forEach((e) => out.push((e.values || []).map(round)));
  }
  return out;
}

module.exports = { EMBED_MODEL, EMBED_DIM, EMBED_BATCH, EMBED_PRECISION, buildEmbedText, contentHash, embedTexts };
