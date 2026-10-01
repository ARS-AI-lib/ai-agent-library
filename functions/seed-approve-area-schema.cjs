// One-time config seed for the 12 approver areas (2026-08-10).
//
//   node functions/seed-approve-area-schema.cjs           # dry run
//   node functions/seed-approve-area-schema.cjs --apply
//
// Writes two things to /config/schema:
//   approveArea — the 12-area list, replacing SDLC stage as the option set
//                 behind UserManagementModal's "Approve areas" picker.
//   category    — arrayUnion of 'Security' and 'Data & Analytics'.
//
// The two new categories close a real gap found while grouping the library:
// Security and Data & Analytics are the only two AREAS with no CATEGORY
// counterpart, which is why security-role agents were landing in unrelated
// areas (Guardrail Agent → Delivery Management) until ROLE_FIRST_AREA was
// added to compensate. Adding the categories lets the normal category layer
// handle them over time. category is grow-only by design (same rule the
// CategoryApprovalPanel arrayUnion uses) — nothing is removed here.
//
// AREA_ORDER is read from src/lib/approveAreas.js rather than retyped, so the
// stored option list cannot drift from the resolver's own taxonomy.
const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');

const src = fs
  .readFileSync(path.join(__dirname, '..', 'src', 'lib', 'approveAreas.js'), 'utf8')
  .replace(/^\s*import\s[^;]*;\s*$/gm, '')
  .replace(/^export\s+/gm, '');
const { AREA_ORDER, CATEGORY_AREA, VERTICAL_CATEGORIES } = new Function(`${src}\n;return { AREA_ORDER, CATEGORY_AREA, VERTICAL_CATEGORIES };`)();

// The category list is now DERIVED from CATEGORY_AREA's keys rather than a
// hand-kept constant (2026-08-10). That table is the thing that guarantees
// every category maps to exactly one approver area, so making it the single
// source for the option list too means the two cannot drift.
const CATEGORIES = Object.keys(CATEGORY_AREA);

// Which of those categories are PRODUCTS rather than disciplines (2026-08-17).
// Seeded as its own field so functions/index.js can present the model two
// separate lists — a flat 21-item list is exactly why it could never tell a
// product from a discipline, and why all 4 product categories sat at 0 agents.
// Derived from approveAreas.js, never hand-typed here.
const PRODUCT_CATEGORIES = VERTICAL_CATEGORIES;

if (!Array.isArray(AREA_ORDER) || AREA_ORDER.length < 1 || !CATEGORIES.length) {
  console.error('✗ could not read AREA_ORDER / CATEGORY_AREA from src/lib/approveAreas.js');
  process.exit(1);
}
const unmapped = CATEGORIES.filter((c) => ![].concat(CATEGORY_AREA[c]).every((a) => AREA_ORDER.includes(a)));
if (unmapped.length) {
  console.error('✗ these categories map to an area that is not in AREA_ORDER — aborting:');
  unmapped.forEach((c) => console.error(`  "${c}" -> ${CATEGORY_AREA[c]}`));
  process.exit(1);
}

/** Code categories in code order, then UI-approved extras still in the schema. */
function mergeCategories(codeCats, curCats, categoryAreaMap) {
  const map = categoryAreaMap || {};
  const kept = curCats.filter((c) => !codeCats.includes(c) && map[c]);
  return { finalCats: [...codeCats, ...kept], kept };
}
if (process.argv.includes('--self-test')) {
  const r = mergeCategories(['A', 'B'], ['B', 'X', 'Y', 'A'], { X: 'QA' });
  const ok = JSON.stringify(r.finalCats) === '["A","B","X"]' && JSON.stringify(r.kept) === '["X"]';
  console.log(ok ? '✓ mergeCategories keeps UI-approved X, drops unmapped Y, code order first' : '✗ mergeCategories', JSON.stringify(r));
  process.exit(ok ? 0 : 1);
}

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

(async () => {
  const ref = db.doc('config/schema');
  const cur = (await ref.get()).data() || {};
  const curCats = Array.isArray(cur.category) ? cur.category : [];
  // 2026-10-01 fix: categories approved through CategoryApprovalPanel live
  // only in /config/schema (+ a categoryAreaMap entry), never in code. This
  // script used to overwrite the list with the code keys and silently wipe
  // them — that is how "Orchestration & Automation" disappeared. They are now
  // kept, after the code order. To retire one, delete its categoryAreaMap
  // entry first (and move its agents off it).
  const { finalCats, kept } = mergeCategories(CATEGORIES, curCats, cur.categoryAreaMap);
  const adding = finalCats.filter((c) => !curCats.includes(c));
  const removing = curCats.filter((c) => !finalCats.includes(c));

  console.log(`=== approveArea (${AREA_ORDER.length}) ===`);
  AREA_ORDER.forEach((a, i) => console.log(`  ${String(i + 1).padStart(2)}. ${a}`));
  console.log(`\n  existing: ${cur.approveArea ? JSON.stringify(cur.approveArea) : '(none)'}`);

  console.log(`\n=== category: ${curCats.length} -> ${finalCats.length} ===`);
  kept.forEach((c) => console.log(`  =  ${c}   (kept: approved via UI -> ${cur.categoryAreaMap[c]})`));
  adding.forEach((c) => console.log(`  +  ${c}   -> ${CATEGORY_AREA[c]}`));
  // Removal is normally impossible (the list is grow-only for users, enforced
  // by firestore.rules and CategoryApprovalPanel's arrayUnion). This script
  // runs on the admin SDK, which bypasses rules, and is the ONLY sanctioned
  // way to retire a category — an admin taxonomy decision, not user input.
  // Anything listed here must already have been migrated off every agent by
  // functions/realign-categories.cjs, or those agents keep a dangling label.
  removing.forEach((c) => console.log(`  -  ${c}   (RETIRED)`));
  if (!adding.length && !removing.length) console.log(JSON.stringify(curCats) === JSON.stringify(finalCats) ? '  (no change)' : '  (order changed)');

  console.log('\n  note: sdlcStage is left untouched — it is still a real agent');
  console.log('  field and drives the SDLC board; it just no longer defines approver scope.');

  console.log(`\n  productCategory (${PRODUCT_CATEGORIES.length}): ${PRODUCT_CATEGORIES.join(' · ')}`);

  if (!APPLY) { console.log('\nDRY RUN — re-run with --apply to write.'); return; }

  await ref.set({ approveArea: AREA_ORDER, category: finalCats, productCategory: PRODUCT_CATEGORIES }, { merge: true });
  console.log('\n✓ written');
})();
