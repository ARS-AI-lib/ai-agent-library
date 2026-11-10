# Usage Page Adjustments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Source column (UI + CSV), rename the first header to "Agent/Skill Name", split Project/Task into its own column, and add a "Group by Agent/Skill" toggle that is mutually exclusive with "Group by Owner".

**Architecture:** All testable logic (CSV column lists, row grouping) lives in a new pure module `src/lib/usageReport.js` — the same single-source pattern as `approveAreas.js` — and is proven by a new `functions/verify-usage-page.cjs` loaded through `loadEsm`. `UsageReportPage.jsx` becomes a thin consumer; because this repo has no React test runner, the component's gate is `node --check` + `npm run build` + a small set of code-shape invariant commands (repo convention, CLAUDE.md §6).

**Tech Stack:** React 19 + Vite, plain JS modules, Node assert-style verify script.

**Spec:** `docs/superpowers/specs/2026-11-10-usage-page-adjustments-design.md`

## Global Constraints

- Labels/headers English (CLAUDE.md §6): exact strings `'Agent/Skill Name'`, `'Project / Task'`, `'Group by Agent/Skill'`, `'Group by Owner'`.
- No new CSS — reuse `.usage-toggle` / `.usage-group` / `.usage-badge` / `.usage-dim` as they are today. Do not touch `UsageReport.css` or `theme.css`.
- Never append to files; edit in place (CLAUDE.md §6).
- No functions, no rules changes — deploy stays hosting-only. Never deploy without explicit user confirmation (user runs the deploy themselves from their Terminal).
- Commit messages end with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- Commits land on `main` directly (established flow for this repo; the user pushes/deploys afterwards).
- `source` stays in the server row payload (`functions/index.js` untouched) — it is only not rendered/exported.

## Review Focus

1. **Portfolio row with no project text** (row exists but `project` came back `''`) must render `—`, never an empty cell — Task 2 (`r.project || '—'` in the cell).
2. **One group toggle must always turn the other off** — no stacking of two group headers. Pinned by Task 2's invariant command: exactly one grouping state variable, `groupBy`, and zero occurrences of `groupByOwner`.
3. **Row whose `agentName` is empty** must not merge invisibly with genuine rows — it groups under its own `(no name)` bucket — Task 1 test.
4. **CSV must never export grouped rows** — export always runs over `filtered` flat rows whatever `groupBy` is — Task 2 invariant command: `exportCsv` still maps `filtered` and contains no reference to grouping.
5. **The group header row must span all 7 columns** — pinned by Task 2 invariant command: `colSpan={7}` present in `UsageReportPage.jsx`.

---

### Task 1: Pure helpers + verify script

**Files:**
- Create: `src/lib/usageReport.js`
- Create: `functions/verify-usage-page.cjs`

**Interfaces:**
- Produces:
  - `CSV_COLUMNS: string[]` — row keys in export order:
    `['agentName','owner','area','category','adopterName','adopterEmail','project','adoptedDate']` (no `source`)
  - `CSV_HEADERS: string[]` — matching header row:
    `['Agent/Skill Name','Owner','Area','Category','Adopter','Adopter Email','Project / Task','Adopted Date']`
  - `groupUsageRows(rows, by) -> [{ key, rows }]` where `by` is `'agentName' | 'owner'`.
    Groups row objects by their own `[by]` property (rows already carry `agentName`/`owner`).
    Fallback bucket label: `by === 'agentName'` → `'(no name)'`, `by === 'owner'` → `'(no owner)'`.
    Output sorted by group size descending (ties keep first-appearance order — JS stable sort, do not re-sort inside a group). Empty/`[]` input → `[]`.

- [ ] **Step 1: Write the failing verify script** — `functions/verify-usage-page.cjs`

Use the `loadEsm` loader copied verbatim from `functions/verify-category-groups.cjs` (strip import/export, `new Function`), pointed at `src/lib/usageReport.js` with **no injected modules** (the module imports nothing). Then these assertions (same `eq` helper style as that file):

```js
const U = loadEsm('usageReport.js');
const { CSV_COLUMNS, CSV_HEADERS, groupUsageRows } = U;

eq(CSV_COLUMNS, ['agentName','owner','area','category','adopterName','adopterEmail','project','adoptedDate'],
  'CSV_COLUMNS = 8 keys, no source');
eq(CSV_COLUMNS.includes('source'), false, 'source column removed from CSV');
eq(CSV_HEADERS, ['Agent/Skill Name','Owner','Area','Category','Adopter','Adopter Email','Project / Task','Adopted Date'],
  'CSV_HEADERS renamed + Project / Task kept');

const rows = [
  { agentName: 'TC Writer', owner: 'Team A', adopterEmail: 'x@arise.tech' },
  { agentName: 'TC Writer', owner: 'Team A', adopterEmail: 'y@arise.tech' },
  { agentName: 'Guardrail', owner: 'Team B', adopterEmail: 'z@arise.tech' },
  { agentName: '', owner: 'Team A', adopterEmail: 'w@arise.tech' },
];
const g = groupUsageRows(rows, 'agentName');
eq(g.map((x) => x.key), ['TC Writer', 'Guardrail', '(no name)'],
  'groups sorted by size desc, empty name in its own bucket');
eq(g[0].rows.map((r) => r.adopterEmail), ['x@arise.tech', 'y@arise.tech'],
  'input order kept inside a group');
eq(g[0].rows.length, 2, 'group row count = badge number');
eq(groupUsageRows(rows, 'owner').map((x) => x.key), ['Team A', 'Team B'], 'owner grouping works');
eq(groupUsageRows([{ owner: '' }], 'owner')[0].key, '(no owner)', 'owner fallback bucket');
eq(groupUsageRows([], 'agentName'), [], 'empty input → []');
```

Output: each passing line starts `✓`; on failure the script `process.exit(1)` with `✗ N case(s) failed`.

- [ ] **Step 2: Run it and watch it fail**

Run: `node functions/verify-usage-page.cjs`
Expected: FAIL — loader `ENOENT`/TypeError because `src/lib/usageReport.js` does not exist yet (first category-group line never prints or prints `✗`).

- [ ] **Step 3: Create `src/lib/usageReport.js`**

Export exactly the three names above. `groupUsageRows` builds a `Map` in one pass (bucket key = `String(rows[i][by] ?? '') || fallbackLabel`), returns `[...map.entries()].map(([key, rows]) => ({ key, rows })).sort((a, b) => b.rows.length - a.rows.length)`. A short header comment citing the spec is fine; no other exports.

- [ ] **Step 4: Run the script and watch it pass**

Run: `node functions/verify-usage-page.cjs`
Expected: every line `✓`, final line `✓ all usage-page cases pass`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/usageReport.js functions/verify-usage-page.cjs
git commit -m "feat(usage): usage-report CSV columns + row grouping helpers

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Component — drop Source, split Project/Task, Group by Agent/Skill

**Files:**
- Modify: `src/components/UsageReportPage.jsx` (whole-file region edits; no other file)

**Interfaces:**
- Consumes (Task 1): `CSV_COLUMNS`, `CSV_HEADERS`, `groupUsageRows` from `../lib/usageReport`.

- [ ] **Step 1: Import helpers and replace grouping state**

In `UsageReportPage.jsx`:
- Add import: `import { CSV_COLUMNS, CSV_HEADERS, groupUsageRows } from '../lib/usageReport';`
- Replace `const [groupByOwner, setGroupByOwner] = useState(false);` with `const [groupBy, setGroupBy] = useState(null);` (`null | 'owner' | 'agent'`)
- Replace the `grouped` memo with:

```js
const grouped = useMemo(() => {
  if (!groupBy) return null;
  return groupUsageRows(filtered, groupBy === 'agent' ? 'agentName' : 'owner');
}, [filtered, groupBy]);
```

- Replace the two toggle buttons in `.usage-filters` with:

```jsx
<button type="button" className={`usage-toggle${groupBy === 'agent' ? ' on' : ''}`}
  onClick={() => setGroupBy((v) => (v === 'agent' ? null : 'agent'))}>
  Group by Agent/Skill
</button>
<button type="button" className={`usage-toggle${groupBy === 'owner' ? ' on' : ''}`}
  onClick={() => setGroupBy((v) => (v === 'owner' ? null : 'owner'))}>
  Group by Owner
</button>
```

(each also releases grouping when clicked a second time, same as before)

- [ ] **Step 2: Replace the header row and the Row cells**

- Header `<tr>` becomes exactly:
  `<th>Agent/Skill Name</th><th>Owner</th><th>Area</th><th>Category</th><th>Adopter</th><th>Project / Task</th><th>Adopted Date</th>`
- In `Row`, replace the Source cell block
  `<td><div>{r.source || 'Library'}</div>{r.project && <div className="usage-dim">{r.project}</div>}</td>`
  with `<td>{r.project || '—'}</td>`.
- In the grouped render, change the condition + destructuring on this one line only:
  `{groupByOwner ? grouped.map(([g, list]) => (` → `{groupBy ? grouped.map(({ key: g, rows: list }) => (`
  — the `tbody` body including `list.map((r) => <Row …)` stays exactly as it is (it re-renders the same `Row`).

- [ ] **Step 3: Point exportCsv at the shared columns**

Replace the `downloadCsv(...)` call's two literal argument arrays with `CSV_COLUMNS` and `CSV_HEADERS`; keep `filtered.map(...)` (with the `adoptedDate` field) and the filename exactly as they are.

- [ ] **Step 4: Syntax gate**

Run: `node --check src/components/UsageReportPage.jsx` — Expected: exit 0, no output.
(If `node --check` chokes on JSX in this session's node build, fall back to `npm run build` as the sole gate and note it — the build is the stronger gate anyway. `node --check` works on JSX-free files; for `.jsx` treat build as authoritative.)

- [ ] **Step 5: Build gate + rerun unit script**

Run: `npm run build` — Expected: succeeds, `dist/assets/index-*.js` written.
Run: `node functions/verify-usage-page.cjs` — Expected: all `✓`, exit 0 (no drift from Task 1).

- [ ] **Step 6: Shape invariants (Review Focus 1–5)**

Run:
```bash
grep -c "groupByOwner" src/components/UsageReportPage.jsx    # Expected: 0
grep -n "colSpan={7}" src/components/UsageReportPage.jsx     # Expected: one hit
grep -n "r.project || '—'" src/components/UsageReportPage.jsx # Expected: one hit
grep -n "filtered.map" src/components/UsageReportPage.jsx    # Expected: one hit, inside exportCsv
grep -n "groupUsageRows" src/components/UsageReportPage.jsx  # Expected: one hit, inside the grouped memo
```

- [ ] **Step 7: Browser smoke (as far as auth allows)**

Run: `npm run dev` (in the user's Terminal if port binding is sandbox-blocked), open the preview at `/usage`. Expected: page loads with **zero console errors** (Google SSO gate may sit at sign-in — that is fine; the table exercise needs the user's own login). Check the filter bar renders both toggle buttons at 375px width (flex-wrap already handles it). Then stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add src/components/UsageReportPage.jsx docs/superpowers/specs/2026-11-10-usage-page-adjustments-design.md docs/superpowers/plans/2026-11-10-usage-page-adjustments.md
git commit -m "feat(usage): drop Source column, rename header to Agent/Skill Name, add Group by Agent/Skill

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```