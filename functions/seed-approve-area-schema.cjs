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
const { AREA_ORDER } = new Function(`${src}\n;return { AREA_ORDER };`)();

const NEW_CATEGORIES = ['Security', 'Data & Analytics'];

if (!Array.isArray(AREA_ORDER) || AREA_ORDER.length !== 12) {
  console.error('✗ could not read AREA_ORDER from src/lib/approveAreas.js');
  process.exit(1);
}

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

(async () => {
  const ref = db.doc('config/schema');
  const cur = (await ref.get()).data() || {};
  const curCats = Array.isArray(cur.category) ? cur.category : [];
  const adding = NEW_CATEGORIES.filter((c) => !curCats.includes(c));

  console.log('=== approveArea (new field) ===');
  AREA_ORDER.forEach((a, i) => console.log(`  ${String(i + 1).padStart(2)}. ${a}`));
  console.log(`\n  existing value: ${cur.approveArea ? JSON.stringify(cur.approveArea) : '(none)'}`);

  console.log(`\n=== category (grow-only) — currently ${curCats.length} ===`);
  console.log(adding.length ? `  adding: ${adding.join(', ')}` : '  nothing to add (already present)');

  console.log('\n  note: sdlcStage is left untouched — it is still a real agent');
  console.log('  field and drives the SDLC board; it just no longer defines approver scope.');

  if (!APPLY) { console.log('\nDRY RUN — re-run with --apply to write.'); return; }

  await ref.set(
    {
      approveArea: AREA_ORDER,
      ...(adding.length ? { category: FieldValue.arrayUnion(...adding) } : {}),
    },
    { merge: true }
  );
  console.log('\n✓ written');
})();
