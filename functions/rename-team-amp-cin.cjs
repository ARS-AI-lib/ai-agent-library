// One-off rename: team "AMP&CIN" -> "Project Committee" (2026-08-20).
//
//   node functions/rename-team-amp-cin.cjs           # dry run
//   node functions/rename-team-amp-cin.cjs --apply
//
// Two writes, both needing the admin SDK (bypasses rules):
//   1. Every agent doc whose `owner` is literally "AMP&CIN" -> "Project Committee".
//      Measured 2026-08-20: exactly 1 doc (demand-request-generator), across
//      ALL approvalStatus/archived states, not just the live library.
//   2. /config/schema.team: replace the "AMP&CIN" entry with "Project
//      Committee". Client writes to this list are grow-only
//      (firestore.rules ~:441 requires request.resource.data.team.hasAll(
//      resource.data.team)) — same posture as the category retire-and-add in
//      seed-approve-area-schema.cjs, and for the same reason: only an
//      admin-SDK script may shrink or rename an entry in a grow-only list.
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const OLD_NAME = 'AMP&CIN';
const NEW_NAME = 'Project Committee';

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

(async () => {
  const snap = await db.collection('agents').where('owner', '==', OLD_NAME).get();
  console.log(`=== agents.owner === "${OLD_NAME}" ===`);
  console.log(`  found: ${snap.size}`);
  snap.docs.forEach((d) => {
    const a = d.data();
    console.log(`  - ${a.agentName}  (approvalStatus: ${a.approvalStatus}, archived: ${!!a.archived})`);
  });

  const schemaRef = db.doc('config/schema');
  const schema = (await schemaRef.get()).data() || {};
  const team = Array.isArray(schema.team) ? schema.team : [];
  const hasOld = team.includes(OLD_NAME);
  const hasNew = team.includes(NEW_NAME);
  console.log(`\n=== /config/schema.team ===`);
  console.log(`  "${OLD_NAME}" present: ${hasOld} · "${NEW_NAME}" present: ${hasNew}`);

  if (!APPLY) {
    console.log('\nDRY RUN — re-run with --apply to write.');
    return;
  }

  const batch = db.batch();
  snap.docs.forEach((d) => batch.update(d.ref, { owner: NEW_NAME }));
  if (hasOld || !hasNew) {
    const nextTeam = [...new Set(team.filter((t) => t !== OLD_NAME).concat(NEW_NAME))].sort();
    batch.set(schemaRef, { team: nextTeam }, { merge: true });
  }
  await batch.commit();
  console.log(`\n✓ ${snap.size} agent doc(s) updated, /config/schema.team rewritten`);
})();
