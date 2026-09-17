// One-off: migrates config/workshopSchema.team (grow-only array) into the new
// workshopTeams collection (one doc per team), per the 2026-09-16 Workshop
// revamp. Leaves the old config/workshopSchema doc in place, unused, rather
// than deleting it — out of scope to touch /config/* further than this.
//
//   node functions/migrate-workshop-teams.cjs            # dry run
//   node functions/migrate-workshop-teams.cjs --apply    # write
//
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

(async () => {
  const schemaSnap = await db.doc('config/workshopSchema').get();
  const teams = Array.isArray(schemaSnap.data()?.team) ? schemaSnap.data().team : [];

  const existing = await db.collection('workshopTeams').get();
  const existingNames = new Set(existing.docs.map((d) => d.data().name));

  const toCreate = teams.filter((name) => !existingNames.has(name));

  console.log(`config/workshopSchema.team: ${teams.length} team(s): ${JSON.stringify(teams)}`);
  console.log(`workshopTeams existing: ${existing.size}`);
  console.log(`${APPLY ? 'WRITING' : 'DRY RUN — would write'} ${toCreate.length} new workshopTeams doc(s)`);
  if (!APPLY) { console.log('re-run with --apply to write.'); return; }

  for (const name of toCreate) {
    await db.collection('workshopTeams').add({
      name,
      createdBy: 'migration',
      createdByName: 'Migration Script',
      createdAt: FieldValue.serverTimestamp(),
    });
    console.log(`  created workshopTeams doc for "${name}"`);
  }
  console.log('✓ done');
})();
