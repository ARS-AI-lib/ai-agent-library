# Workshop Library Star — Deferred Minors (short design)

**Intent:** Close the four deferred minors from the 2026-10-29 library-star whole-branch
review, with **zero user-visible behavior change**. Every change is low-risk by
construction and ships hosting-only (or not at all — see the deploy note).

## Goals

1. Remove the dead `background: #f5b301 !important` on `.ws-sticker-star`.
2. Lock `foldName` parity between `src/lib/agentUtils.js` and
   `functions/portfolioAdoptionRules.js` with a **test**, not a comment, plus
   cross-reference comments on both sides.
3. Close the two test-coverage gaps in `functions/verify-workshop-star.cjs`.
4. Get one real on-page confirmation of the gold star (user-side; no code).

## Non-goals / Anti-goals

- **No behavior change** — the star matching logic, the CSS shape, and every shipped
  rule stay exactly as reviewed and deployed (`fd68180`).
- **No Firestore, rules, or functions deploy.** The only `functions/` edit is a
  comment (anti-goal: do not trigger a functions deploy for a comment).
- The parity test asserts **`foldName` equivalence only** — it deliberately does NOT
  compare `libraryStarNames` (library star: duplicate name ⇒ no star) against
  `buildNameIndex` (Portfolio: duplicates tolerated when aliases resolve to one agent).
  Their semantics differ by design; an overly broad test would hard-code the wrong
  thing and trip the same "frozen-invariant" trap recorded in `functions/CLAUDE.md` §32.

## What each minor becomes

### 1. `!important` removal (WorkshopPage.css:69)

Delete the `!important` flag; keep `background: #f5b301`.

Why it is provably zero-impact: the starred branch passes `style={undefined}`
(WorkshopPage.jsx:123), hover uses `filter`, and no other rule in the bundle targets
`.ws-sticker-star`'s background. The flag overrides nothing today; removing it changes
nothing tomorrow unless someone re-adds an inline background — which is exactly the
silent masking the reviewer wanted gone.

### 2. `foldName` parity guard + two-way comments

- **New offline test** `functions/verify-fold-parity.cjs` (pattern: the repo's
  `loadEsm()` loads the REAL `src/lib/agentUtils.js`; `require()` loads the REAL
  `functions/portfolioAdoptionRules.js`, which is plain CJS with no Firestore imports —
  "pure helpers only" per its header). It asserts equal output over a battery of hard
  cases: case fold, leading/trailing and collapsed whitespace, tab/newline, zero-width
  space/joiner/non-joiner, BOM `﻿`, empty/`null`/`undefined`/`0`, and Thai text
  (lowercase is a no-op but pins the round-trip).
- **Comments both ways:** the client side already names the Portfolio file
  (agentUtils.js:619-621) — extend it to point at the new test; add the mirror comment
  on `functions/portfolioAdoptionRules.js:15`.
- **Deploy note:** the comment-only edit to `portfolioAdoptionRules.js` is
  **deliberately not deployed** this round (zero behavior change; the locked §11 rules
  forbid unscoped functions deploys and the GCP project is shared with Portfolio). It
  rides along with the next natural scoped functions deploy. Cheap and notation-safe.

### 3. Two extra assertions in `verify-workshop-star.cjs`

- `isLibraryStar(undefined, starNames)` → `false` (mirrors the existing `null` check).
- `libraryStarNames()` with no argument → empty Set, no throw (pins the `|| []` guard).

### 4. On-page confirmation (user-side, post-deploy)

A short checklist handed to the user so they can confirm the star on production without
signing in from this sandbox: pick any Done sticker → search the same name in the
Library search → exactly 1 hit ⇒ gold star with a readable team number; 0 hits or 2+
hits ⇒ plain Done circle. The rule itself is the checklist.

## Constraints (project-wide, from CLAUDE.md §6/§11)

- Never append to a file (`>>`) — overwrite whole files.
- Do not redefine `theme.css` classes; new Workshop CSS keeps the `.ws-` prefix.
- New copy is English-only (this change adds none).
- Commit trailer: `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- Production deploy: hosting only, and only after the user's explicit go-ahead
  (locked rule applies even in `bypassPermissions`).

## Approaches (settled with the user)

| # | Approach | Verdict |
|---|---|---|
| A | Parity **test** loading both real files + comments both ways | **Chosen** |
| B | Comments only, no test | Rejected — nothing enforces parity; the exact failure mode the review flagged |
| C | Single shared `foldName` module across `src/` and `functions/` | Rejected — ESM/CJS boundary; functions would have to import `src` at runtime or add a build step, out of proportion for one function |

## Verification gate (the "system still works" contract)

Each of these must be green before the deploy handoff:

1. `node functions/verify-workshop-star.cjs` — all pass, including the 2 new assertions.
2. `node functions/verify-fold-parity.cjs` — all pass (runs the REAL client + Portfolio
   `foldName` implementations).
3. `npm run build` — PASS.
4. `npx oxlint` on every touched file — no new errors.
5. Diff review: no shipped logic line changes except the `!important` flag; everything
   else is tests, comments, or new doc files.