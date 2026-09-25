// Single source of truth for the generative Gemini model (2026-09-25).
//
// Why 3.5-flash: Vertex retires gemini-2.5-flash (hard stop in
// asia-southeast1 on 31 Mar 2027). A probe on 2026-09-25 showed
// gemini-3.5-flash is the ONLY Gemini 3 model served in asia-southeast1
// (3.6-flash / 3.1-flash-lite exist only on `global`), and we keep the region.
//
// Gemini 3 uses thinkingLevel, not thinkingBudget — never send both (400).
// Rollback / upgrade = change GEN_MODEL here and redeploy the scoped functions.
// Embeddings are separate (embedText.js) and not affected.
const GEN_MODEL = 'gemini-3.5-flash';

// JSON classifiers (duplicate check, role group): speed over reasoning.
const THINK_OFF = { thinkingLevel: 'MINIMAL' };
// ALPHA chat — chosen by regression measurement, see CLAUDE.md §15.
const CHAT_THINK = { thinkingLevel: 'LOW' };

// Documented placeholder for a functionCall part whose real signature was not
// kept (an older cached web client). Gemini 3 rejects an unsigned functionCall
// in history with 400; this skips the check for that part only.
const DUMMY_THOUGHT_SIGNATURE = 'skip_thought_signature_validator';

module.exports = { GEN_MODEL, THINK_OFF, CHAT_THINK, DUMMY_THOUGHT_SIGNATURE };
