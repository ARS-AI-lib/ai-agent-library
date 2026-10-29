# Workshop Library Star Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mark a Workshop board sticker as a gold star when its Done skill is already registered in the real Library.

**Architecture:** All decision logic lives in one pure, node-testable helper in `src/lib/agentUtils.js` (`foldName`, `libraryStarNames`, `isLibraryStar`). `WorkshopPage.jsx` builds the name index once from the already-streamed `useApprovedAgents()` list and passes it to `WorkshopStickers`, which adds a CSS `clip-path` star class. No Firestore write, no rules, no functions — hosting-only deploy.

**Tech Stack:** React 19 + Vite, plain CSS, node `.cjs` verify script using the repo's `loadEsm()` pattern.

**Spec:** [`docs/superpowers/specs/2026-10-29-workshop-library-star-design.md`](../specs/2026-10-29-workshop-library-star-design.md)

## Global Constraints

- **Never append to a file with `>>` — always overwrite the whole file** (CLAUDE.md §6).
- Do NOT redefine classes that already exist in `theme.css` (`.sb`, `.sh`, `.sbar`, `.sname`, `.ttag`). New Workshop classes keep the existing `.ws-` prefix.
- Do NOT edit files outside the task's scope; this plan touches **only** `src/lib/agentUtils.js`, `src/styles/WorkshopPage.css`, `src/components/WorkshopPage.jsx`, and the new `functions/verify-workshop-star.cjs`.
- Library items are matched from `agents` of `useApprovedAgents()` = **approved AND not archived**. An archived item must fall back to a plain Done circle.
- A star must appear **only** when exactly one Library item matches the folded name. A name shared by 2+ Library docs resolves to **no star**.
- Label/header copy stays **English**; this change adds no new user-facing text except a suffix on the existing `title` tooltip.
- Production deploy always follows the locked rule (CLAUDE.md §11): build → **stop and ask the user** → the user runs the deploy from their Terminal. Use the global `firebase` binary, never `npx firebase-tools`. Deploy **hosting only**.
- Commit messages end with the trailer:
  `Co-Authored-By: Claude Code <noreply@anthropic.com>`

## Review Focus

The spec fixes the happy path; these five inputs are the ones most likely to bite, and each is pinned by a check in the task that owns the code:

1. **A sticker whose skill name is empty/missing/whitespace-only** → no star, no crash (must not throw on `null`/`undefined`/`''`). — Task 1.
2. **Two Library items sharing a folded name** → ambiguous → **no star** (a wrong star is worse than none). — Task 1.
3. **Names differing only by case, internal whitespace, or zero-width characters** → still counted as a match. — Task 1.
4. **A name that matches an archived Library item only** → **no star** (the index is built from `agents`, which excludes archived). — Task 2 Step 5 check.
5. **A sticker whose status is not `done`** even though the name matches → **no star**. — Task 1.

---

### Task 1: Pure star-match helpers in `agentUtils.js`

**Files:**
- Modify: `src/lib/agentUtils.js` (add the helpers at the end of the file)
- Create: `functions/verify-workshop-star.cjs` (offline node checks, no ADC)

**Interfaces:**
- Consumes: nothing from earlier tasks (first task).
- Produces (all exported from `src/lib/agentUtils.js` — Task 2 imports them):
  - `foldName(name: string | null | undefined) -> string` — case/space/zero-width-insensitive key.
  - `libraryStarNames(agents: Array<{ agentName?: string }>) -> Set<string>` — folded names that appear **exactly once** in the given list.
  - `isLibraryStar(idea: { status?: string, skillName?: string }, starNames: Set<string>) -> boolean` — `true` only for a `done` idea whose folded `skillName` is in `starNames`.

- [ ] **Step 1: Write the failing test**

Create `functions/verify-workshop-star.cjs`:

```js
// Offline checks for the Workshop library-star helpers in src/lib/agentUtils.js
//   node functions/verify-workshop-star.cjs
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'lib');
// Same loader as backfill-approve-area.cjs — reads the real client module,
// dropping its ESM imports/exports, so we test the shipped file, not a copy.
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

const utils = loadEsm('agentUtils.js');
const { foldName, libraryStarNames, isLibraryStar } = utils;
let fail = 0;
const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fail += 1; };

if (typeof foldName !== 'function' || typeof libraryStarNames !== 'function' || typeof isLibraryStar !== 'function') {
  console.error('✗ helpers missing from src/lib/agentUtils.js');
  process.exit(1);
}

// foldName — case / whitespace / zero-width folding
ok(foldName('Deck Builder') === foldName('  deck   builder '), 'fold: case + whitespace');
ok(foldName('Deck\u200bBuilder') === foldName('DeckBuilder'), 'fold: zero-width stripped');
ok(foldName('') === '' && foldName(null) === '' && foldName(undefined) === '', 'fold: empty inputs → ""');

// libraryStarNames — a name shared by 2+ docs is ambiguous and resolves to nothing
const names = libraryStarNames([
  { agentName: 'Deck Builder' },
  { agentName: 'deck  builder' },  // duplicate of the above (folded)
  { agentName: 'RCA Fix Assistant' },        // unique
  { agentName: '' },                         // ignored
  {},                                        // ignored (no name)
]);
ok(!names.has(foldName('Deck Builder')), 'index: duplicated name is ambiguous → absent');
ok(names.has(foldName('RCA Fix Assistant')), 'index: unique name kept');

// isLibraryStar — only done + unique match
const star = names;
ok(isLibraryStar({ status: 'done', skillName: 'RCA Fix Assistant' }, star), 'done + match → star');
ok(isLibraryStar({ status: 'done', skillName: 'rca  fix assistant' }, star), 'done + folded match → star');
ok(!isLibraryStar({ status: 'done', skillName: 'Deck Builder' }, star), 'done + ambiguous name → no star');
ok(!isLibraryStar({ status: 'done', skillName: 'Not In Library' }, star), 'done + no match → no star');
ok(!isLibraryStar({ status: 'qa', skillName: 'RCA Fix Assistant' }, star), 'non-done → no star');
ok(!isLibraryStar({ status: 'done' }, star), 'done + missing skillName → no star (no throw)');
ok(!isLibraryStar({ status: 'done', skillName: '   ' }, star), 'done + blank skillName → no star');
ok(!isLibraryStar(null, star), 'null idea → no star (no throw)');

console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node functions/verify-workshop-star.cjs`
Expected: FAIL — prints `✗ helpers missing from src/lib/agentUtils.js` and exits 1.

- [ ] **Step 3: Implement the three helpers in `src/lib/agentUtils.js`**

Append at the end of the file. Write the zero-width range with `\u` escapes so the source stays reviewable:

```js
/** Case/space/zero-width-insensitive name key. Mirrors the Portfolio adoption
 *  rule (functions/portfolioAdoptionRules.js foldName) so both features fold
 *  names the same way. */
export function foldName(name) {
  return String(name || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Folded names of approved Library items that appear EXACTLY ONCE in the
 *  given list. A name shared by 2+ docs is ambiguous and is left out, so no
 *  sticker is ever starred for the wrong item. */
export function libraryStarNames(agents) {
  const count = new Map();
  for (const a of agents || []) {
    const key = foldName(a && a.agentName);
    if (!key) continue;
    count.set(key, (count.get(key) || 0) + 1);
  }
  const out = new Set();
  for (const [key, n] of count) if (n === 1) out.add(key);
  return out;
}

/** A Workshop sticker is starred only when it is Done AND its skill name
 *  matches exactly one Library item. */
export function isLibraryStar(idea, starNames) {
  if (!idea || idea.status !== 'done') return false;
  const key = foldName(idea.skillName);
  return !!key && !!starNames && starNames.has(key);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node functions/verify-workshop-star.cjs`
Expected: PASS — every line `✓` and `all passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agentUtils.js functions/verify-workshop-star.cjs
git commit -m "feat(workshop): pure helpers for library-star name matching

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Render the star sticker (CSS + both boards)

**Files:**
- Modify: `src/styles/WorkshopPage.css` (add `.ws-sticker-star` right after the existing `.ws-sticker:hover` rule at line 55; never append with `>>`)
- Modify: `src/components/WorkshopPage.jsx`
  - extend the `../lib/agentUtils` import (line 12)
  - `WorkshopStickers` (lines 112–135): accept `starNames` and apply the star class
  - line ~619: build the index with `useMemo`
  - line ~935 (main board) and line ~973 (Use Cases board): pass `starNames={starNames}`

**Interfaces:**
- Consumes from Task 1: `foldName(name) -> string`, `libraryStarNames(agents) -> Set<string>`, `isLibraryStar(idea, starNames) -> boolean`.
- Produces: `WorkshopStickers` prop `starNames: Set<string>` (both call sites must pass it; omitting it renders plain Done stickers — no crash).

- [ ] **Step 1: Add the star CSS**

In `src/styles/WorkshopPage.css`, immediately after the `.ws-sticker:hover` line, insert:

```css
/* Star variant: Done sticker whose skill is already on the Library.
   Gold + clip-path star (NOT the ★ glyph — ★ reads as a rating in this app).
   24px (vs 22px) so the 10px team number still fits inside the star body. */
.ws-sticker-star {
  width: 24px;
  height: 24px;
  min-width: 24px;
  background: #f5b301 !important;
  border-radius: 0;
  clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
}
```

- [ ] **Step 2: Wire the helpers into `WorkshopStickers`**

Change the component (lines 112–135) so the sticker branch reads:

```jsx
function WorkshopStickers({ ideas, teams, starNames, canAdd, onAdd, onOpen }) {
  return (
    <div className="ws-stickers-row" onClick={(e) => e.stopPropagation()}>
      {ideas.map((idea) => {
        const team = teams.find((t) => t.id === idea.teamId);
        const starred = isLibraryStar(idea, starNames);
        return (
          <button
            key={idea.id}
            type="button"
            className={`ws-sticker${starred ? ' ws-sticker-star' : ''}`}
            style={starred ? undefined : { background: STATUS_COLOR[idea.status] || STATUS_COLOR.idea }}
            title={starred
              ? `${idea.team} — ${idea.skillName || idea.ideaName} (on Library)`
              : `${idea.team} — ${idea.skillName || idea.ideaName}`}
            onClick={() => onOpen(idea)}
          >
            {team?.number || '??'}
          </button>
        );
      })}
      {canAdd && (
        <button type="button" className="ws-sticker-add" title="Add sticker" onClick={onAdd}>+</button>
      )}
    </div>
  );
}
```

(The star path sets `style={undefined}` so the CSS gold wins; the plain path keeps its existing inline status colour.)

- [ ] **Step 3: Build the index once and pass it to both boards**

Line 12 — extend the existing import:

```js
import { agentProcessIds, agentUseCaseNames, buildAgentFilter, relationshipLabel, isLibraryStar, libraryStarNames } from '../lib/agentUtils';
```

After `const { agents } = useApprovedAgents(canView);` (line 619), add:

```js
  // Folded names of approved, non-archived Library items that appear exactly
  // once → the Done stickers that render as a star (2026-10-29 design).
  const starNames = useMemo(() => libraryStarNames(agents), [agents]);
```

Then pass the prop at **both** call sites:

```jsx
          <WorkshopStickers
            ideas={ideasForProcess(proc.id)}
            teams={teams}
            starNames={starNames}
            canAdd={canParticipate}
            onAdd={() => setAddModalProc(proc)}
            onOpen={(idea) => setDetailIdea(idea)}
          />
```

```jsx
        {ucIdeas.length > 0 && (
          <WorkshopStickers ideas={ucIdeas} teams={teams} starNames={starNames} canAdd={false} onAdd={() => {}} onOpen={(idea) => setDetailIdea(idea)} />
        )}
```

- [ ] **Step 4: Verify it builds**

Run: `npm run build`
Expected: PASS, no errors. (A JSX syntax error or a missing export fails here.)

Run: `npx oxlint src/components/WorkshopPage.jsx src/lib/agentUtils.js`
Expected: no new errors.

- [ ] **Step 5: Visual smoke test on the dev server**

Start the configured preview server (`vite-dev`, port 5173) with the browser-preview tooling, then open `/workshop`.

Check, in this order:
1. Every `done` sticker whose skill is on the Library (e.g. `RCA Fix Assistant`) shows a **gold star** with its team number still readable inside.
2. Every other sticker is unchanged — plain circle, same status colour and size as before.
3. Clicking a star opens the same detail popup as before (popup untouched).
4. The Use Cases board shows the same star behaviour.
5. **Archived check:** a name that exists only among archived Library items renders a **plain Done circle**, not a star. (The index is built from `agents`, which excludes archived — if no such name exists in the current board data, say so in the handoff and rely on that exclusion.)

Capture a screenshot of the board for the handoff.

- [ ] **Step 6: Commit**

```bash
git add src/styles/WorkshopPage.css src/components/WorkshopPage.jsx
git commit -m "feat(workshop): render Done-on-Library stickers as a gold star

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Deploy handoff (hosting only)

**Files:**
- None modified. This task is the release step for Tasks 1–2.

**Interfaces:**
- Consumes: the built `dist/` from Task 2 Step 4.
- Produces: a live hosting release on both targets (`main` = `wolfy-481609`, `pretty` = `wolfy-ai-library`).

- [ ] **Step 1: Confirm the branch is clean and in sync**

Run: `git status --short` → only the expected files; `git rev-list --left-right --count origin/main...HEAD` → `0 0` after the user pushes.

- [ ] **Step 2: Stop and ask the user to deploy**

Show the user the exact command and wait for their go-ahead (locked production rule, CLAUDE.md §11 — applies even in `bypassPermissions`). Hand them:

```bash
npm run build && firebase deploy --only hosting --project wolfy-481609
```

(the user runs this in their own Terminal; the sandbox blocks network egress in-chat).

- [ ] **Step 3: Verify live**

After the user reports the deploy finished, load `https://wolfy-ai-library.web.app/workshop` and confirm the star stickers render as in Task 2 Step 5. No rules publish and no functions deploy are needed for this change.
