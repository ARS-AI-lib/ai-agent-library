# Category Grouping (Named, Collapsible Groups) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group the Category list in the Agent Library sidebar into 7 named groups (`Business & Product` first) that the user can collapse/expand by clicking the group name.

**Architecture:** One new ordered table in `src/lib/approveAreas.js` (`CATEGORY_GROUPS`) plus a pure bucketing helper `groupCategories(names)` — the same pattern as the existing `CATEGORY_AREA` / `VERTICAL_CATEGORIES` single-source rules. `Sidebar.jsx` maps over the helper's output and holds per-group collapse state in `useState`. The mobile Category filter needs **no** change: `App.jsx` passes the very same `sidebarEl` as `categoryPanel`, so the grouped + collapsible list appears there automatically.

**Tech Stack:** React 19 + Vite 8, plain JSX, no test framework. Verification uses the repo's existing convention: a Node script (`functions/verify-*.cjs`) that loads the shipped `src/lib` ESM file by stripping import/export lines, plus `npm run build` for the JSX, plus the in-app preview for the visual check.

**Spec:** `docs/superpowers/specs/2026-11-06-category-grouping-design.md`

## Global Constraints

- **Do NOT touch these files** (out of scope — user cut points 3–5): `src/components/CardGrid.jsx`, `src/components/DashboardTab.jsx`, `src/components/EditAgentModal.jsx`, `src/lib/agentUtils.js`.
- **English labels only** for headers/buttons; Thai is permitted only inside explanatory copy (here: the existing `ยังไม่มีหมวดที่อนุมัติ` empty state stays as-is — do not translate it).
- **Never append to a file** — overwrite whole files (repo rule §6).
- **Do not redefine** existing classes `.sb`, `.sh`, `.sbar`, `.sname`, `.ttag`; all new CSS lives under a `v7-` prefix in `src/styles/v7.css`.
- `Business & Product` members are **derived from `VERTICAL_CATEGORIES`** — never re-typed by hand.
- Unknown categories must **never disappear** from the UI: anything not in the table lands in the `Unassigned` bucket (last).
- Session-only state: collapse is `useState`, not persisted. All groups start **expanded**.
- No Firestore, no rules, no functions, no new collection, no deploy.

## Review Focus

1. **A category exists in `/config/schema.category` but no group defines it** (the list is grow-only; CategoryApprovalPanel adds names without a deploy). A reasonable person expects to still see it in the sidebar. → Test: Task 1 Step 1 case `unknown category lands in Unassigned`.
2. **`categoryOptions` is empty** (schema still loading / fresh environment). The sidebar must keep its existing empty-state message and not throw. → Test: Task 1 Step 1 case `empty input returns no groups`.
3. **A known `CATEGORY_AREA` category is added but forgotten in the group table** — it would silently fall into `Unassigned` and look like a bug to the next person. → Test: Task 1 Step 1 case `every CATEGORY_AREA key maps to a defined group`.
4. **Collapsing a group that has active filters applied** — the selected items are hidden but must stay selected (count badge, "Show N results", Clear-all must still see them). → Manual check in Task 2 Step 6.
5. **The same component inside the mobile sheet** — collapse must work there and not break the sheet footer. → Manual check in Task 2 Step 6.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/lib/approveAreas.js` | modify | Add `CATEGORY_GROUPS`, `CATEGORY_ORDER` (derived), `CATEGORY_GROUP` (derived map), `CATEGORY_FALLBACK_GROUP`, `categoryGroupName()`, `groupCategories()`. Remove `CATEGORY_GROUP_STARTS`. |
| `functions/verify-category-groups.cjs` | create | Node test for the above (loads the real ESM file). |
| `src/components/Sidebar.jsx` | modify (Category block only) | Render named group headers with caret; `useState` collapse; keep SDLC Stage / Other sections and the empty state untouched. |
| `src/styles/v7.css` | modify | Add `.v7-sb-group` header styles; drop the now-unused `.v7-sb-sep` rule. |

---

### Task 1: Grouping table + pure bucketing helper in `approveAreas.js`

**Files:**
- Modify: `src/lib/approveAreas.js` (near `CATEGORY_AREA`, ~line 310-318)
- Test: `functions/verify-category-groups.cjs` (create)

**Interfaces:**
- Consumes: `VERTICAL_CATEGORIES` and `CATEGORY_AREA` (already exported in the same file).
- Produces (later task imports these from `../lib/approveAreas`):
  - `export const CATEGORY_GROUPS: Array<{ group: string, items: string[] }>` — ordered; group 1 is Business & Product.
  - `export const CATEGORY_ORDER: string[]` — group names in display order (derived from `CATEGORY_GROUPS`).
  - `export const CATEGORY_GROUP: Record<string, string>` — category name → group label (derived).
  - `export const CATEGORY_FALLBACK_GROUP = 'Unassigned'`.
  - `export function categoryGroupName(category: string): string` — group label, falling back to `CATEGORY_FALLBACK_GROUP`.
  - `export function groupCategories(categories: string[]): Array<{ group: string, items: string[] }>` — buckets in `CATEGORY_GROUPS` order, each bucket keeps input order, appends `{ group: 'Unassigned', items: [...] }` **only if non-empty**, never drops a name.

- [ ] **Step 1: Write the failing test** — create `functions/verify-category-groups.cjs`

Use the same `loadEsm` loader as `functions/verify-fold-parity.cjs` (it strips `import`/`export` so the shipped file is what's tested). `approveAreas.js` imports `./agentUtils` and `./tier`, so inject those the way `functions/inspect-sit-name.cjs` does.

```js
// Guard the Category → sidebar-group table (2026-11-06).
//   node functions/verify-category-groups.cjs
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'lib');
function loadEsm(file, injected = {}) {
  const code = fs.readFileSync(path.join(SRC, file), 'utf8')
    .replace(/^\s*import\s[^;]*;\s*$/gm, '')
    .replace(/^export\s+/gm, '');
  const names = Object.keys(injected);
  const decls = [...code.matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  return new Function(...names, `${code}\n;return { ${[...new Set(decls)].join(', ')} };`)(...names.map((n) => injected[n]));
}
const tier = loadEsm('tier.js');
const utils = loadEsm('agentUtils.js', { getType: tier.getType, getTier: tier.getTier });
const A = loadEsm('approveAreas.js', {
  agentProcessIds: utils.agentProcessIds, splitRoles: utils.splitRoles,
  agentCategories: utils.agentCategories, isInternalOrExternal: tier.isInternalOrExternal,
});
const { CATEGORY_GROUPS, CATEGORY_ORDER, CATEGORY_GROUP, CATEGORY_FALLBACK_GROUP,
        categoryGroupName, groupCategories, VERTICAL_CATEGORIES, CATEGORY_AREA } = A;

let fails = 0;
const eq = (a, b, msg) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  console.log(`${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) { console.log('   got     :', JSON.stringify(a)); console.log('   expected:', JSON.stringify(b)); fails++; }
};

// 1. group order is exactly the 7 agreed labels, Business & Product first
eq(CATEGORY_ORDER, ['Business & Product', 'Support Functions', 'Design & Content',
  'Engineering', 'Quality', 'Operations', 'Assistants'], 'CATEGORY_ORDER = the 7 groups in order');

// 2. Business & Product is derived from VERTICAL_CATEGORIES (exact, same order)
eq(CATEGORY_GROUPS[0].items, VERTICAL_CATEGORIES, 'Business & Product items === VERTICAL_CATEGORIES');

// 3. Review Focus #3: every known category maps to a real group, not the fallback
const orphans = Object.keys(CATEGORY_AREA).filter((c) => categoryGroupName(c) === CATEGORY_FALLBACK_GROUP);
eq(orphans, [], 'every CATEGORY_AREA key maps to a defined group (no silent Unassigned)');

// 4. Review Focus #1: unknown category is kept, in the Unassigned bucket
const withUnknown = groupCategories(['Investment', 'Brand New Category']);
eq(withUnknown[withUnknown.length - 1], { group: 'Unassigned', items: ['Brand New Category'] },
  'unknown category lands in Unassigned');

// 5. Review Focus #2: empty input → no groups at all
eq(groupCategories([]), [], 'empty input returns no groups');

// 6. grouping buckets by group order and keeps input order inside each bucket
const g = groupCategories(['Security', 'Investment', 'SIT', 'QA', 'Virtual Assistant']);
eq(g.map((x) => x.group), ['Business & Product', 'Quality', 'Assistants'],
  'groups appear in CATEGORY_ORDER, empty groups omitted');
eq(g.find((x) => x.group === 'Quality').items, ['SIT', 'QA'], 'input order kept inside a bucket');

// 7. no name is ever dropped; every input name appears exactly once
const all = ['Investment', 'Requirements & Product', 'UX Research', 'Architecture', 'SIT',
  'DevOps & Platform', 'Virtual Assistant', 'Totally New'];
const flat = groupCategories(all).flatMap((x) => x.items);
eq([...flat].sort(), [...all].sort(), 'no name dropped or duplicated');

// 8. map agrees with the buckets (one table, not two)
eq(CATEGORY_GROUP['Virtual Assistant'], 'Assistants', "CATEGORY_GROUP['Virtual Assistant'] === 'Assistants'");
eq(CATEGORY_GROUP['Investment'], 'Business & Product', "CATEGORY_GROUP['Investment'] === 'Business & Product'");

if (fails) { console.error(`\n✗ ${fails} case(s) failed`); process.exit(1); }
console.log('\n✓ all category-group cases pass');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node functions/verify-category-groups.cjs`
Expected: FAIL — `CATEGORY_GROUPS` is `undefined`, so case 1 throws `TypeError: Cannot read properties of undefined` (or prints ✗ lines). Non-zero exit.

- [ ] **Step 3: Implement the grouping table in `src/lib/approveAreas.js`**

Replace the existing `CATEGORY_GROUP_STARTS` block (lines ~310-318) with the tables below, and update the two comments that claim the sidebar renders `CATEGORY_AREA` key order (the one just above `'Virtual Assistant'`, lines ~269-273, and any sentence saying "key order IS the sidebar order"). New comment must say: key order still drives `/config/schema.category` order (seed-approve-area-schema.cjs) and the order of items **within** a group, but the **group order** is `CATEGORY_GROUPS` below.

```js
/**
 * Category → sidebar group (2026-11-06). The ONE table that decides how the
 * Agent Library sidebar (and the mobile Category filter, which renders the
 * same component) groups the category list. Order of this array = the order
 * the groups are shown; order of `items` = the order within a group.
 *
 * Business & Product is DERIVED from VERTICAL_CATEGORIES so a new product
 * vertical can never be missed here — same rule as CATEGORY_AREA's spread.
 *
 * Anything a grow-only /config/schema.category adds later and this table has
 * not caught up with is NOT dropped: it falls to CATEGORY_FALLBACK_GROUP.
 * verify-category-groups.cjs fails the build if a KNOWN CATEGORY_AREA key is
 * left out, so the fallback only ever catches genuinely new names.
 */
export const CATEGORY_GROUPS = [
  { group: 'Business & Product', items: [...VERTICAL_CATEGORIES] },
  { group: 'Support Functions', items: [
    'Requirements & Product', 'Project & Delivery', 'Compliance & Governance',
    'Resource Planning', 'People Development', 'Financial', 'Procurement',
  ] },
  { group: 'Design & Content', items: ['UX Research', 'Design & UI', 'Writing & Content'] },
  { group: 'Engineering', items: ['Architecture', 'Software Development', 'Data & Analytics'] },
  { group: 'Quality', items: ['SIT', 'QA', 'Security'] },
  { group: 'Operations', items: ['DevOps & Platform', 'SRE & Reliability', 'Incident Management'] },
  { group: 'Assistants', items: ['Virtual Assistant'] },
];

/** Group labels in display order. */
export const CATEGORY_ORDER = CATEGORY_GROUPS.map((g) => g.group);

/** category name → group label (reverse of CATEGORY_GROUPS; one source). */
export const CATEGORY_GROUP = Object.fromEntries(
  CATEGORY_GROUPS.flatMap(({ group, items }) => items.map((c) => [c, group]))
);

/** Bucket for categories the table has never seen. */
export const CATEGORY_FALLBACK_GROUP = 'Unassigned';

/** Group label for a category, or the fallback bucket. */
export function categoryGroupName(category) {
  return CATEGORY_GROUP[category] || CATEGORY_FALLBACK_GROUP;
}

/**
 * Bucket a raw category-name list into ordered groups:
 *   [{ group, items: [name…] }, …]
 * Groups follow CATEGORY_GROUPS order and empty groups are omitted; input
 * order is preserved inside each bucket; unrecognised names are collected
 * into a trailing 'Unassigned' bucket only when non-empty. Nothing is dropped.
 */
export function groupCategories(categories) {
  const buckets = CATEGORY_GROUPS.map(({ group }) => ({ group, items: [] }));
  const byGroup = new Map(buckets.map((b) => [b.group, b]));
  const stray = [];
  for (const c of categories || []) {
    const b = byGroup.get(CATEGORY_GROUP[c]);
    if (b) b.items.push(c);
    else stray.push(c);
  }
  const out = buckets.filter((b) => b.items.length > 0);
  if (stray.length) out.push({ group: CATEGORY_FALLBACK_GROUP, items: stray });
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node functions/verify-category-groups.cjs`
Expected: every line starts with `✓`, ends with `✓ all category-group cases pass`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/approveAreas.js functions/verify-category-groups.cjs
git commit -m "feat(sidebar): category group table + groupCategories helper

Single ordered CATEGORY_GROUPS table in approveAreas.js; Business & Product
derived from VERTICAL_CATEGORIES; unknown categories fall to Unassigned
rather than vanishing. Verified by functions/verify-category-groups.cjs.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Sidebar renders named, collapsible groups

**Files:**
- Modify: `src/components/Sidebar.jsx` (the Category `<div className="sidebar-group">` block, lines ~60-83, and the React import on line 1)
- Modify: `src/styles/v7.css` (add `.v7-sb-group` near the existing `.v7-sb-sep` rule ~line 323; remove the `.v7-sb-sep` rule)

**Interfaces:**
- Consumes from Task 1: `groupCategories(categories)` → `Array<{group, items}>` and `categoryGroupName` is not needed here.

- [ ] **Step 1: Rewrite the Category block in `Sidebar.jsx`**

Changes, all confined to the Category section:
1. Line 1: `import { Fragment, useState } from 'react';` (add `useState`, drop nothing else). Remove the `import { CATEGORY_GROUP_STARTS } ...` line and instead `import { groupCategories } from '../lib/approveAreas';`.
2. Inside the component, before `return`:
   ```js
   // Collapsed groups (session-only). Empty set = everything expanded, which
   // is the default the user asked for — nothing is hidden until they click.
   const [collapsed, setCollapsed] = useState(() => new Set());
   const toggleGroup = (g) => setCollapsed((prev) => {
     const next = new Set(prev);
     if (next.has(g)) next.delete(g); else next.add(g);
     return next;
   });
   ```
3. Replace the `{categoryOptions.map(...)}` block with:
   ```jsx
   {groupCategories(categoryOptions).map(({ group, items }) => {
     const isCollapsed = collapsed.has(group);
     return (
       <Fragment key={group}>
         <button
           type="button"
           className={`v7-sb-group ${isCollapsed ? 'collapsed' : ''}`}
           aria-expanded={!isCollapsed}
           onClick={() => toggleGroup(group)}
         >
           <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
             <polyline points="6 9 12 15 18 9" />
           </svg>
           <span>{group}</span>
         </button>
         {!isCollapsed && items.map((c) => {
           const n = countFor(agents, (a) => agentCategories(a).includes(c));
           return (
             <button
               key={c}
               type="button"
               aria-pressed={category.has(c)}
               className={`sidebar-item ${category.has(c) ? 'active' : ''}`}
               onClick={() => setCategory(toggle(category, c))}
             >
               <span className="sb-dot" style={{ background: categoryColor(c) }} />
               <span className="sb-label">{c}</span>
               <span className="sidebar-count">{n}</span>
             </button>
           );
         })}
       </Fragment>
     );
   })}
   ```
4. Keep `<div className="sidebar-h">Category</div>` above it and the `categoryOptions.length === 0` empty-state below it exactly as they are. Leave the SDLC Stage and Other `<div className="sidebar-group">` blocks untouched.

Rationale to keep in a short comment above the block: grouping + collapse state live here only; the mobile Category sheet reuses this same component via `App.jsx`'s `categoryPanel`, so there is one implementation.

- [ ] **Step 2: Add CSS in `src/styles/v7.css`, replacing the `.v7-sb-sep` rule**

Delete `line ~323` (`.v7-sb-sep { display: block; height: 1px; ... }`) and in its place add:

```css
/* Category group header (2026-11-06) — replaces the unnamed .v7-sb-sep divider.
   Same 9px uppercase treatment as .sidebar-h, but clickable with a caret. */
.v7-sb-group {
  display: flex; align-items: center; gap: 5px; width: 100%;
  padding: 7px 7px 3px; margin-top: 2px;
  background: none; border: 0; cursor: pointer; font: inherit;
  font-size: 9px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
  color: var(--mu); text-align: left;
}
.v7-sb-group:hover { color: var(--tx2); }
.v7-sb-group svg { flex: 0 0 auto; transition: transform .15s ease; }
.v7-sb-group.collapsed svg { transform: rotate(-90deg); }
.v7-sb-group:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-radius: 4px; }
```

(Do not modify any `.sidebar-*` or `.sb*` rule.)

- [ ] **Step 3: Build to compile the JSX and catch import/syntax errors**

Run: `npm run build`
Expected: `✓ built in …` and `dist/` written; no `Could not resolve` / `Unexpected token` errors. (No test framework exists, so the build is the compile gate for `.jsx`.)

- [ ] **Step 4: Run the Task 1 test again (nothing regressed)**

Run: `node functions/verify-category-groups.cjs`
Expected: `✓ all category-group cases pass`

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.jsx src/styles/v7.css
git commit -m "feat(sidebar): named collapsible category groups

Sidebar now renders group headers from groupCategories(); clicking a group
name hides/shows its categories. Mobile Category filter reuses this same
component, so it picks up the grouping with no ControlBar change.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

- [ ] **Step 6: Visual verification in the preview (both viewports)**

Start the dev server with the app's preview tool (`preview_start` name `vite-dev`), then:
1. `preview_snapshot` — confirm all 7 group headers are present in order: Business & Product, Support Functions, Design & Content, Engineering, Quality, Operations, Assistants. Confirm Business & Product's six products sit directly under it.
2. `preview_click` the `Support Functions` header → `preview_snapshot` shows its 7 categories gone and `aria-expanded="false"`; click again → they return.
3. **Review Focus #4:** click a category (e.g. `QA`) so it becomes active, then collapse the `Quality` group. Confirm the active filter is still applied — the result count / active-filter badge does not change and Clear-all still clears it.
4. **Review Focus #5:** `preview_resize` preset `mobile` (375×812), reload, open the `Category` filter button → the bottom sheet shows the same 7 groups and collapses the same way; the sheet's `Clear all` / `Show N results` footer still works.
5. `preview_screenshot` of the desktop sidebar and the mobile sheet.

Expected: every check matches. Clicking a group name only toggles visibility; it never changes which categories are selected.

---

## Notes for the implementer

- `App.jsx` and `ControlBar.jsx` need **no edits** — desktop category filtering is the sidebar itself, and mobile reuses it via `categoryPanel={isMobile ? sidebarEl : null}` (App.jsx:543). Do not "helpfully" add grouping to ControlBar.
- The `Virtual Assistant` category keeps its position as the **last** group (`Assistants`), not pinned to the top; its old "pinned to top" comment in `CATEGORY_AREA` refers only to `/config/schema.category` order now.
- If Task 1's test case 3 ever fails after a future category is added, that is the guard working — add the new category to the right `CATEGORY_GROUPS` entry, do not delete the case.
