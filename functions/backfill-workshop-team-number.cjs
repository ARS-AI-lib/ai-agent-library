// One-off: assigns the new 2-digit `number` field to any workshopTeams doc
// that doesn't have one yet (today, just the "Testing team" doc from the
// earlier migration), in createdAt order, then seeds
// config/workshopTeamCounter.next so the very next team created through the
// app continues the sequence correctly instead of colliding at "01" again.
// Part of the 2026-09-17 Workshop status/team-membership round.
//
//   node functions/backfill-workshop-team-number.cjs            # dry run
//   node functions/backfill-workshop-team-number.cjs --apply    # write
//
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

(async () => {
  const snap = await db.collection('workshopTeams').orderBy('createdAt', 'asc').get();
  const teams = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  console.log(`workshopTeams: ${teams.length} doc(s) total`);
  let next = 1;
  const toWrite = [];
  for (const t of teams) {
    if (t.number) {
      console.log(`  "${t.name}" already has number ${t.number} — skipping`);
      next = Math.max(next, parseInt(t.number, 10) + 1);
      continue;
    }
    const number = String(next).padStart(2, '0');
    console.log(`  "${t.name}" -> number ${number}`);
    toWrite.push({ id: t.id, number });
    next += 1;
  }

  console.log(`${APPLY ? 'WRITING' : 'DRY RUN — would write'} ${toWrite.length} team number(s), counter.next -> ${next}`);
  if (!APPLY) { console.log('re-run with --apply to write.'); return; }

  for (const { id, number } of toWrite) {
    await db.collection('workshopTeams').doc(id).update({ number });
  }
  await db.doc('config/workshopTeamCounter').set({ next }, { merge: true });
  console.log('✓ done');
})();
