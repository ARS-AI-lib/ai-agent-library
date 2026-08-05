---
name: project-chat-retrieval-rearchitecture
description: ALPHA chat + idea-check moving to hybrid embeddings retrieval — decisions locked 2026-08-04 with measured evidence
metadata: 
  node_type: memory
  type: project
  originSessionId: 5b7ada72-a449-4ebc-b37a-4269b922e007
  modified: 2026-08-04T14:42:51.098Z
---

Locked 2026-08-04 after a grilling session with measured evidence. Replaces the
lexical-scoring approach in ALPHA chat and extends to Pre-Registration idea check.

**Root cause found (measured, not guessed):** `capability_search` was never semantic —
`scoreText()` in `skills.js` is character-trigram substring matching. Query `เทสเคส`
returned **0 results** because the library stores "Testcase" in English; query
`เขียนเทสเคส` returned 4 results of which 3 were wrong (matched only on the common
verb "เขียน" giving exactly 3 trigrams = the `MIN_TRIGRAM_HITS` gate) while missing
every correct answer. Every prior fix (QUERY_STOPWORDS, relative cutoff, prompt rules)
chased *precision*; *recall* was silently broken, and recall failures cannot be
recovered downstream by the LLM.

**Decisions:**
- Retrieval = real embeddings, **`text-multilingual-embedding-002` @ 256 dims**.
  NOT `gemini-embedding-001` — truncating its 3072 dims to 256 collapses score
  separation (an investment skill ranked #8 for a test-case query). Verified both
  work in `asia-southeast1` via the existing `@google/genai` client.
- Vectors in a **separate `/agentVectors/{id}` collection**, lazy-loaded on chat open
  (same pattern as the SDLC catalog), cosine computed in `skills.js`. Keeps all
  business logic (tier/readiness/archive) in one place — no server-side duplication,
  which is the `normalizeProgress` drift risk. Client SDK has no `findNearest`.
- Freshness: fire-and-forget reindex call after save + manual admin rebuild, hash-based
  so only changed docs re-embed. **No Eventarc** (see CLAUDE.md §9 scar tissue).
- **Hybrid (lexical ∪ embedding), not replacement.** Measured: a Thai-reworded duplicate
  of TC Writer ranked #7 lexically → #1 by embedding, but an English "Test Case Generator"
  ranked #1 lexically → #2 by embedding. Neither wins alone; the union strictly contains
  the current candidate set, so **recall cannot regress**.
- **No absolute score floor for "not found".** Measured: a nonsense query
  ("ช่วยแปลภาษาญี่ปุ่นเป็นไทย") scored 0.680 — higher than real queries at 0.625–0.639.
  Cosine cannot separate real from fake. The **LLM** decides "ไม่พบ"; the score travels
  along only as a weak signal.
- Rendering: LLM returns JSON (`{type:'list'|'prose'}`) and the **client draws** status
  pills / link icons / grouping from real data. Formatting in a prompt is never stable —
  that is why answers looked different every time and why a "Ready to Use" header ended
  up containing `*`-marked pilot items.
- Readiness filter = explicit `intent: "usable_now" | "all"` tool parameter **enforced in
  code**, not a prompt rule (the prompt rule was already there and was ignored).
  Ambiguous → `all`, grouped, ready/pilot first. Answers cut to 3–5 relevant items.
- **Idea check is in scope.** Verified no shared code (`similarity.js` vs `scoreText`),
  so the chat change alone is zero-impact — but `similarity.js:128` already admits the
  same disease, and a missed duplicate is costlier than a bad chat answer.

Blast radius verified by reading call sites, not grep alone: `PreRegModal` →
`search_library` → `rankCandidates()` in `similarity.js`; chat → `scoreText()` in
`skills.js`. Separate implementations, no cross-imports.

Regression suite must run before every deploy and must cover mode B explicitly
(SDLC gap analysis, Scrum-vs-Kanban, risk/pros-cons) — the real risk to those is the
system-prompt rewrite, not the embeddings. Run `node functions/regression.cjs`
(9 cases, exercises the real prompt via `functions/chatPrompt.js`).

**Follow-up round, shipped 2026-08-04:**
- Template answers (`query_library` list, `get_agent_detail`, `connection_suggest`)
  now emit the same `@@ name | reason` protocol, so every answer path renders through
  the identical card component. Before this only the capability path had cards and
  the other half of the answers still looked like the old plain text.
- `parseBlocks` keeps blocks in SOURCE ORDER. The first version hoisted all prose
  above the cards, which silently moved a trailing "ยังมีอีก N รายการ" note above the
  list it described, and put a detail answer's fields above its own heading.
- Vectors rounded to **4 decimals** (`EMBED_PRECISION`, folded into `contentHash` so a
  change forces a rebuild). Payload measured 1.26 MB → **0.45 MB**; earlier "~250KB"
  estimate was wrong — it assumed binary, but Firestore ships JSON doubles at ~21
  chars each. 3 decimals is too lossy (3/50 ranks moved); 4 is exactly lossless.
- `query_library`'s `keyword` is now union(substring, semantic) too — it was the last
  place the old lexical-only behaviour could still bite.
- `RecommendationList` falls back to plain rows when no name resolves, so a bad name
  never makes the whole answer vanish.
- **Query expansion is a large, cheap win.** The model was sending short keyword
  queries; measured on the real index, "เขียน code" ranked fe-dev **#54**, the full
  question ranked it **#72**, but an expanded query ("อยากได้ตัวช่วยพัฒนาโปรแกรม เขียนโค้ด
  backend frontend") ranked it **#11** and be-dev **#2**. `capability_search`'s `query`
  parameter description now REQUIRES an expanded Thai+English phrase, not a keyword.
- **13 internal prompt files (`*.md`) were approved agents** and outranked every real
  dev agent (`6.answer-writer.md` was #1 at 0.773 for "เขียน code"). Flagged
  `internalTool: true` (see `functions/flag-internal.cjs`) and DEMOTED by
  `INTERNAL_RANK_PENALTY = 0.85` in ranking — user chose demote, not exclude, so they
  stay findable and stay visible in the web UI. The penalty applies to ranking only;
  the reported `similarity` stays the true cosine.
- Client now re-sends `message` on EVERY loop iteration. It used to be nulled after
  the first call, so the turn that COMPOSES the answer never saw the user's question —
  only history + a function response. Genuine bug (also restores the documented
  user→functionCall→functionResponse shape), **but it was NOT the cause** of the
  reported "answers one question behind" screenshot; bad retrieval was. Don't
  re-attribute it.
- **"มี Agent N ตัว" false-positive `type` filter, shipped 2026-08-04.** Real bug found
  via screenshot: process 1.2 has exactly 2 real entries, both Skills — the model saw
  the word "Agent" in "1.2 Deep Research & Benchmark: มี Agent 2 ตัว อะไรบ้าง" and set
  `type: "Agent"` on query_library, filtering both out → false "ไม่พบ". Thai (and casual
  English) use "agent" to mean "AI tool" generically, not the library's formal
  Agent-vs-Skill category. `chatPrompt.js`'s `type` param description now says: only set
  `type` when the user asks about the category directly ("Agent มีกี่ตัว"), never just
  because the word appears in a sentence that also references a process/filter — when
  unsure, leave it unset. Verified with the real model: process-id query now omits
  `type` entirely; "Agent มีกี่ตัว" still sets it correctly. 2 regression cases guard
  both directions.
- **"แสดงทั้งหมด" (show all) after a capped list, shipped 2026-08-04.** Two compounding
  bugs found via screenshot: (1) `query_library`'s answer template caps display at 8
  cards with a CSV note for the rest, but the model has no structured memory of the
  original filter for a follow-up — it improvised a fresh `capability_search` with a
  vague query instead. (2) that vague query surfaced ALPHA's OWN tool skills
  (`get_agent_detail`, `query_library`, …) as top "Ready to Use" hits, because their
  descriptions are generic filter/search boilerplate that embeds close to nearly any
  library question — same failure mode as the `.md` fragments.
  Fix for (2): extended `functions/flag-internal.cjs`'s `internalTool` rule with an
  exact-name allowlist (the 7 names in `TOOL_DECLARATIONS` + the two "AI Agent
  Library ..." self-referential entries). `owner === 'Wolfy'` was checked and rejected
  as the rule — it also covers legitimate agents (Epic Writer, ALPHA - Summarizer).
  Fix for (1) is NOT a smarter prompt — `templateAnswer`'s `csv` field already holds
  the query_library's FULL matching set (only the on-screen display is capped), so
  "show all" is now caught client-side by a keyword heuristic (`SHOW_ALL_RE`, matches
  the same "just a convenience heuristic" bar as the existing `wantsRegister` pattern)
  gated on the immediately-preceding assistant message actually having that `csv`
  data, and answered by re-rendering the SAME stored array wider — zero model calls,
  zero chance of the wrong tool. Capped at `EXPAND_CAP = 30` cards; beyond that it
  states the true count and points at the CSV download instead of a card wall.
- Content-free counters at `/metrics/chat-YYYY-MM-DD` (turns, tool picked, list vs
  prose, not-found rate). No message text, no user identity — the session-only
  no-transcript rule is untouched. Written only by chatLibrary via admin SDK;
  `allow write: if false` for clients. Watch `answer_notFound` and
  `tool_query_library` as early-warning signals.

See [[project-work-queue]] and [[project-chat-assistant-requirements]].
