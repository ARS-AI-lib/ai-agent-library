// Backfills sdlcProcesses.{id}.description from the attached
// SDLC_Complete_Process_Library.xlsx (58 rows extracted 2026-09-16). Purely
// additive — sdlcProcesses currently has no `description` field, so this
// cannot break any existing reader.
//
//   node functions/backfill-process-descriptions.cjs            # dry run
//   node functions/backfill-process-descriptions.cjs --apply    # write
//
const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');

const descriptions = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'process-descriptions.json'), 'utf8'),
);

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

(async () => {
  const snap = await db.collection('sdlcProcesses').get();
  const existingIds = new Set();
  snap.forEach((d) => existingIds.add(d.id));

  const matched = [];
  const missing = [];
  Object.entries(descriptions).forEach(([id, description]) => {
    if (existingIds.has(id)) matched.push({ id, description });
    else missing.push(id);
  });

  const alreadyHas = [];
  snap.forEach((d) => {
    if (d.data().description) alreadyHas.push(d.id);
  });

  console.log(`sdlcProcesses docs: ${existingIds.size}`);
  console.log(`descriptions extracted from XLSX: ${Object.keys(descriptions).length}`);
  console.log(`matched (will write): ${matched.length}`);
  if (missing.length) {
    console.log(`\n✗ XLSX ids with NO matching sdlcProcesses doc (${missing.length}):`);
    missing.forEach((id) => console.log('  ' + id));
  }
  if (alreadyHas.length) {
    console.log(`\nnote: ${alreadyHas.length} docs already have a description — will be overwritten.`);
  }

  console.log(`\n${APPLY ? 'WRITING' : 'DRY RUN — would write'} description on ${matched.length} docs`);
  if (!APPLY) { console.log('re-run with --apply to write.'); return; }

  for (let i = 0; i < matched.length; i += 400) {
    const batch = db.batch();
    matched.slice(i, i + 400).forEach((m) => {
      batch.update(db.collection('sdlcProcesses').doc(m.id), { description: m.description });
    });
    await batch.commit();
    console.log(`  committed ${Math.min(i + 400, matched.length)}/${matched.length}`);
  }
  console.log('✓ done');
})();
