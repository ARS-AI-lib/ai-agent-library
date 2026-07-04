// Backfill `createdBy` (uid) for legacy Sheet-sourced agents that don't have
// one yet. Uses a single placeholder UID for all of them — `creator` (the
// real name string from the Sheet) is left untouched so a future script can
// re-map each doc to its actual person once a name→uid table exists.
// See memory: project-progress-update-feature-design.
//
// Usage:
//   node tmp/backfill-createdby.cjs                 # dry run
//   node tmp/backfill-createdby.cjs --apply          # actually writes

const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const PLACEHOLDER_UID = 'kDyouEZaHicZrxZ4tZ7mJZ11kTt2'; // tinnapat.p@arise.tech
const APPLY = process.argv.includes('--apply');

const app = initializeApp({ projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

(async () => {
  const snap = await db.collection('agents').get();
  const targets = [];
  snap.forEach((d) => {
    const data = d.data();
    const isLegacy = data.sourceSheetRow !== undefined && data.sourceSheetRow !== null;
    const hasCreatedBy = !!(data.createdBy && String(data.createdBy).trim());
    if (isLegacy && !hasCreatedBy) {
      targets.push({ id: d.id, agentName: data.agentName, creator: data.creator || '' });
    }
  });

  console.log(`Legacy agents missing createdBy: ${targets.length}`);
  targets.forEach((t) => console.log(`  ${t.agentName}  (creator: ${t.creator || '—'})`));

  if (!APPLY) {
    console.log('\n— DRY RUN — re-run with --apply to write these changes.');
    return;
  }

  const batchSize = 400;
  for (let i = 0; i < targets.length; i += batchSize) {
    const batch = db.batch();
    targets.slice(i, i + batchSize).forEach(({ id }) => {
      batch.update(db.collection('agents').doc(id), {
        createdBy: PLACEHOLDER_UID,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
  }
  console.log(`✅ Backfilled createdBy on ${targets.length} agents (placeholder UID — creator name preserved for later re-mapping).`);
})();
