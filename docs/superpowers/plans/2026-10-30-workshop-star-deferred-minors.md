# Workshop Library Star — Deferred Minors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four minors deferred from the 2026-10-29 library-star review, with zero user-visible behaviour change.

**Architecture:** Three tiny code/comment edits (one CSS flag, one new offline parity test, two assertions added to an existing offline test) plus one deploy handoff. Nothing touches Firestore, rules, or deployed functions. The only shipped byte change is the CSS `!important` removal, and it provably overrides nothing.

**Tech Stack:** React 19 + Vite (CSS via `src/styles/WorkshopPage.css`); plain-Node offline verify scripts in `functions/*.cjs` using the repo's `loadEsm()` loader pattern; `npx oxlint` for lint; `npm run build` for the Vite bundle.

**Spec:** `docs/superpowers/specs/2026-10-30-workshop-star-deferred-minors-design.md`

## Global Constraints

- Never append to a file (`>>`) — overwrite whole files. (CLAUDE.md §6)
- Do not redefine `theme.css` classes; new Workshop CSS keeps the `.ws-` prefix. (CLAUDE.md §6)
- New copy is English-only. This plan adds no user-facing copy.
- End every commit message with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- **No Firestore / rules / functions deploy this round.** The one `functions/` edit is a comment; do not trigger a functions deploy for it.
- **Production deploy is the user's step, hosting-only, and only after their explicit go-ahead** (locked 2026-10-29 rule; applies even under `bypassPermissions`). Never run bare `firebase deploy` or `--only functions` — the GCP project `wolfy-481609` is shared with the Portfolio app. Use the global `firebase` binary, not `npx firebase-tools`.
- Report results to the user in Thai.
- Diff discipline: the only *shipped logic* line this plan changes is the `!important` flag. Everything else is tests, comments, or docs.

## Review Focus

The input classes / failure modes this spec implies but whose tests the spec does not itself spell out. Each is pinned by a step in the task named.

1. **A future edit changes `foldName` on one side only** — the two copies silently drift and the Workshop star agrees with the Portfolio trigger on nothing. Expected: `verify-fold-parity.cjs` goes RED. (Task 2, mutation-proof step.)
2. **`.ws-sticker-star` ends up with no gold** after the flag is dropped, because some other rule or an inline style was setting its background. Expected: star still `#f5b301`. (Task 1, built-CSS + call-site checks.)
3. **`libraryStarNames()` is called with no argument** by a future caller. Expected: empty Set, no throw. (Task 3, assertion 2 + mutation-proof.)
4. **`isLibraryStar(undefined, …)`** — a sticker rendered with no idea object. Expected: `false`, no throw. (Task 3, assertion 1 + mutation-proof.)
5. **Odd `foldName` inputs** — `0`, `null`, `undefined`, whitespace-only, BOM, Thai text. Expected: both copies agree on every one. (Task 2, battery.)

---

### Task 1: Drop the dead `!important` on the star background

**Files:**
- Modify: `src/styles/WorkshopPage.css:69`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing another task imports. (The built CSS is what Task 4 deploys.)

- [ ] **Step 1: Edit line 69**

In `src/styles/WorkshopPage.css`, replace:

```css
  background: #f5b301 !important;
```

with:

```css
  background: #f5b301;
```

Nothing else in the file changes.

- [ ] **Step 2: Confirm the flag is gone from the source and that no other rule or inline style feeds that background**

Run:

```bash
grep -rn 'ws-sticker-star' src/
```

Expected: in `WorkshopPage.css`, the selector block now reads `background: #f5b301;` with no `!important`; in `WorkshopPage.jsx` the starred sticker passes `style={starred ? undefined : { … }}` (line ~123), so no inline background competes.

- [ ] **Step 3: Rebuild and confirm the shipped rule carries no `!important`**

Run:

```bash
npm run build
grep -o '\.ws-sticker-star{[^}]*}' dist/assets/*.css
```

Expected: PASS, and the printed rule contains `background:#f5b301` and does **not** contain `!important`.

- [ ] **Step 4: Lint the touched file**

Run:

```bash
npx oxlint src/styles/WorkshopPage.css
```

Expected: no new errors. (CSS is not linted by oxlint — treat "no output / exit 0" as the expected result; a pre-existing oxlint warning elsewhere in the repo is not this task's.)

- [ ] **Step 5: Commit**

```bash
git add src/styles/WorkshopPage.css
git commit -m "fix(workshop): drop dead !important on star background

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: `foldName` parity guard + two-way comments

**Files:**
- Create: `functions/verify-fold-parity.cjs`
- Modify: `src/lib/agentUtils.js:612-620` (extend the existing `foldName` doc comment)
- Modify: `functions/portfolioAdoptionRules.js:14` (add the mirror comment)

**Interfaces:**
- Consumes: `foldName(name) -> string` from `src/lib/agentUtils.js` (ESM) and `foldName(s) -> string` from `functions/portfolioAdoptionRules.js` (CJS). Both exist today; no signature changes.
- Produces: `functions/verify-fold-parity.cjs`, runnable as `node functions/verify-fold-parity.cjs`, exit 0 when the two copies agree on every case.

- [ ] **Step 1: Write the failing test**

Create `functions/verify-fold-parity.cjs` with exactly this content:

```js
// Parity guard: the two independent copies of foldName must stay equivalent.
//   node functions/verify-fold-parity.cjs
//
// Client side : src/lib/agentUtils.js            (ESM — loaded by stripping
//               its import/export lines, so we test the shipped file)
// Server side : functions/portfolioAdoptionRules.js (plain CJS, "pure helpers
//               only" — safe to require with no Firestore)
//
// Why this exists: the Workshop library star folds names with the client copy,
// while the Portfolio adoption trigger folds them with the server copy. They are
// byte-equivalent today and nothing else enforces that. This test is the thing
// that keeps them that way — see the design doc, "Approaches".
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'lib');
// Same loader as verify-workshop-star.cjs / backfill-approve-area.cjs.
function loadEsm(file, injected = {}) {
  const code = fs
    .readFileSync(path.join(SRC, file), 'utf8')
    .replace(/^\s*import\s[^;]*;\s*$/gm, '')
    .replace(/^export\s+/gm, '');
  const names = Object.keys(injected);
  const decls = [...code.matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  const body = `${code}\n;return { ${[...new Set(decls)].join(', ')} };`;
  return new Function(...names, body)(...names.map((n) => injected[n]));
}

const { foldName: clientFold } = loadEsm('agentUtils.js');
const { foldName: serverFold } = require('./portfolioAdoptionRules.js');

if (typeof clientFold !== 'function' || typeof serverFold !== 'function') {
  console.error('✗ foldName missing from one side');
  process.exit(1);
}

// The zero-width / BOM cases below hold their characters LITERALLY — U+200B,
// U+200D, U+200C, U+FEFF — because that is exactly what foldName must strip,
// and both copies strip the same range /[​-‍﻿]/. They are invisible in most
// editors, so if they look lost after a copy/paste, rebuild them with
// String.fromCharCode(0x200b) etc.; the assertions must still exercise them.
const CASES = [
  ['Deck Builder', 'plain'],
  ['  deck   builder ', 'case + collapsed whitespace'],
  ['Deck\tBuilder', 'tab'],
  ['Deck\nBuilder', 'newline'],
  ['Deck​Builder', 'zero-width space'],
  ['Deck‍Builder', 'zero-width joiner'],
  ['Deck‌Builder', 'zero-width non-joiner'],
  ['﻿Deck Builder', 'BOM'],
  ['', 'empty string'],
  [null, 'null'],
  [undefined, 'undefined'],
  [0, 'number 0'],
  ['   ', 'whitespace only'],
  ['ตัวช่วยทดสอบ', 'Thai text'],
  ['  ตัวช่วย   ทดสอบ ', 'Thai + whitespace'],
];

let fail = 0;
for (const [input, label] of CASES) {
  const c = clientFold(input);
  const s = serverFold(input);
  const same = c === s;
  if (!same) fail += 1;
  console.log(`${same ? '✓' : '✗'} ${label}: client=${JSON.stringify(c)} server=${JSON.stringify(s)}`);
}
console.log(fail ? `\n${fail} divergent` : `\nall ${CASES.length} cases agree`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run it — it passes immediately, which proves nothing yet**

Run: `node functions/verify-fold-parity.cjs`
Expected: `all 15 cases agree`, exit 0. The two copies already agree, so this run cannot show the test works. Step 3 supplies that proof.

- [ ] **Step 3: Prove the guard actually bites (mutation check)**

Temporarily break the server copy, run the test, expect RED, then revert:

```bash
# break it: drop the whitespace-collapse from the server copy
perl -0pi -e "s/\.replace\(\/\\\\s\+\/g, ' '\)//" functions/portfolioAdoptionRules.js
node functions/verify-fold-parity.cjs; echo "exit=$?"
git checkout -- functions/portfolioAdoptionRules.js
node functions/verify-fold-parity.cjs; echo "exit=$?"
```

Expected: first run prints at least one `✗` and `exit=1` (the "case + collapsed whitespace" and "tab"/"newline" cases diverge); after `git checkout`, `all 15 cases agree` and `exit=0`. This is the evidence that the test detects one-sided drift — without it, the guard is unproven.

- [ ] **Step 4: Add the two-way comments**

In `src/lib/agentUtils.js`, extend the existing `foldName` doc comment (lines 612-620) so its last line names the test as well as the server file:

```js
/** Case/space/zero-width-insensitive name key. Mirrors the Portfolio adoption
 *  rule (functions/portfolioAdoptionRules.js foldName) so both features fold
 *  names the same way. Parity is enforced by functions/verify-fold-parity.cjs
 *  — run it after touching either copy. */
```

In `functions/portfolioAdoptionRules.js`, replace the one-line comment above `foldName` (line 14) with:

```js
/** Case/space/zero-width-insensitive name key. Mirrors the Workshop library
 *  star's client copy (src/lib/agentUtils.js foldName). Parity is enforced by
 *  functions/verify-fold-parity.cjs — run it after touching either copy. */
```

- [ ] **Step 5: Re-run the test and lint the touched files**

Run:

```bash
node functions/verify-fold-parity.cjs
node --check functions/verify-fold-parity.cjs
npx oxlint functions/verify-fold-parity.cjs functions/portfolioAdoptionRules.js
```

Expected: `all 15 cases agree`, exit 0; `node --check` prints nothing; oxlint reports no new errors.

- [ ] **Step 6: Commit**

```bash
git add functions/verify-fold-parity.cjs functions/portfolioAdoptionRules.js src/lib/agentUtils.js
git commit -m "test(functions): parity guard for the two foldName copies

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

⚠️ Commit only. Do not deploy functions — the `portfolioAdoptionRules.js` edit is a comment.

---

### Task 3: Close the two coverage gaps in `verify-workshop-star.cjs`

**Files:**
- Modify: `functions/verify-workshop-star.cjs` (add two assertion lines; existing assertions stay untouched)

**Interfaces:**
- Consumes: `libraryStarNames(agents) -> Set<string>` and `isLibraryStar(idea, starNames) -> boolean` from `src/lib/agentUtils.js` (already loaded by this file at line 20-21).
- Produces: nothing another task imports.

- [ ] **Step 1: Add the two failing-by-mutation assertions**

In `functions/verify-workshop-star.cjs`, immediately after the existing `ok(!isLibraryStar(null, star), 'null idea → no star (no throw)');` line (line 55), add:

```js
ok(!isLibraryStar(undefined, star), 'undefined idea → no star (no throw)');
ok(libraryStarNames() instanceof Set && libraryStarNames().size === 0, 'no-arg libraryStarNames → empty Set (no throw)');
```

- [ ] **Step 2: Run it — passes immediately because the guards already exist**

Run: `node functions/verify-workshop-star.cjs`
Expected: all lines `✓`, `all passed`, exit 0. (The `|| []` guard and the `!idea` guard are already shipped in `fd68180`.)

- [ ] **Step 3: Prove each assertion bites (mutation checks)**

Run each mutation, expect RED, revert:

```bash
# (a) remove the !idea guard → the undefined case must throw
perl -0pi -e "s/if \(!idea \|\| idea\.status !== 'done'\) return false;/if (idea.status !== 'done') return false;/" src/lib/agentUtils.js
node functions/verify-workshop-star.cjs; echo "exit=$?"
git checkout -- src/lib/agentUtils.js

# (b) remove the || [] guard → the no-arg call must throw
perl -0pi -e "s/for \(const a of agents \|\| \[\]\)/for (const a of agents)/" src/lib/agentUtils.js
node functions/verify-workshop-star.cjs; echo "exit=$?"
git checkout -- src/lib/agentUtils.js

node functions/verify-workshop-star.cjs; echo "exit=$?"
```

Expected: (a) `exit=1` with a `TypeError` on the undefined-idea line; (b) `exit=1` with a `TypeError` on the no-arg line; final run `all passed`, `exit=0`.

- [ ] **Step 4: Confirm the source is back to shipped state**

Run:

```bash
git diff --stat src/lib/agentUtils.js
```

Expected: no output (working tree clean for that file) — i.e. both `git checkout` reversions took.

- [ ] **Step 5: Commit**

```bash
git add functions/verify-workshop-star.cjs
git commit -m "test(functions): pin no-arg libraryStarNames and undefined-idea cases

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: Verification gate + hosting deploy handoff

**Files:**
- No repository files created. This task produces the deploy handoff (run by the user) and the on-page checklist.

**Interfaces:**
- Consumes: every task above, committed on `main`.
- Produces: the exact commands the user runs, and the on-page checklist.

- [ ] **Step 1: Run the full verification gate**

Run:

```bash
node functions/verify-workshop-star.cjs
node functions/verify-fold-parity.cjs
npm run build
npx oxlint src/styles/WorkshopPage.css functions/verify-fold-parity.cjs functions/verify-workshop-star.cjs
```

Expected: `all passed`; `all 15 cases agree`; build PASS; oxlint no new errors. Any red here stops the handoff.

- [ ] **Step 2: Confirm the shipped diff is only the flag**

Run:

```bash
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- src/
```

Expected: under `src/`, exactly one changed line — `background: #f5b301 !important;` → `background: #f5b301;` in `src/styles/WorkshopPage.css`. Everything else under `functions/` is a test or a comment. (If `origin/main` is stale because the sandbox cannot fetch, say so in the handoff and have the user compare against the last pushed commit instead.)

- [ ] **Step 3: Hand the user the deploy commands (they run these)**

```bash
git push origin main
```

```bash
npm run build && firebase deploy --only hosting --project wolfy-481609
```

Note for the handoff: hosting-only is target-isolated by `.firebaserc`, so it cannot touch the Portfolio site; the functions comment in `portfolioAdoptionRules.js` rides along with the next natural *scoped* functions deploy and is deliberately not deployed now.

- [ ] **Step 4: Hand the user the on-page confirmation checklist**

Give this checklist verbatim (it *is* the rule, restated for a human):

> On `https://wolfy-ai-library.web.app/workshop`, pick any sticker with status **Done**:
> 1. Read its skill name, then search that exact name in the main Library search box.
> 2. **Exactly 1 hit** → the sticker on the board is a **gold star**, and its 2-digit team number is readable inside it (not clipped).
> 3. **0 hits, or 2+ hits** → the sticker stays a **plain blue Done circle**.
> 4. Hover the star: it brightens slightly and does not lose its gold.
> 5. The star is the same size as neighbouring stickers — the row does not reflow.

- [ ] **Step 5: Report in Thai, then stop**

Report the gate results, the diff confirmation, the two commands, and the checklist — in Thai. Do **not** run the push or the deploy; those wait on the user's explicit go-ahead.
