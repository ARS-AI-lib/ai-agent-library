// One-off: for any workshopIdeas doc missing the new `teamId` field, look up
// the matching workshopTeams doc by name and set teamId; also sets
// `status: 'idea'` on any doc that only has the old `kind` field, so
// pre-existing stickers don't render with an undefined/blank status color.
// Part of the 2026-09-17 Workshop status/team-membership round. Old `kind`/
// `useCaseId`/`useCaseName` fields are left in place, untouched.
//
//   node functions/backfill-workshop-idea-teamid.cjs            # dry run
//   node functions/backfill-workshop-idea-teamid.cjs --apply    # write
//
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

(async () => {
  const [ideasSnap, teamsSnap] = await Promise.all([
    db.collection('workshopIdeas').get(),
    db.collection('workshopTeams').get(),
  ]);
  const teamsByName = new Map(teamsSnap.docs.map((d) => [(d.data().name || '').toLowerCase(), d.id]));

  const toWrite = [];
  let alreadyOk = 0;
  let noMatch = 0;

  ideasSnap.docs.forEach((d) => {
    const idea = d.data();
    const patch = {};
    if (!idea.teamId) {
      const teamId = teamsByName.get((idea.team || '').toLowerCase());
      if (teamId) patch.teamId = teamId;
      else { noMatch += 1; console.log(`  no workshopTeams match for idea "${d.id}" team="${idea.team}"`); }
    }
    if (!idea.status) patch.status = 'idea';
    if (Object.keys(patch).length === 0) { alreadyOk += 1; return; }
    toWrite.push({ id: d.id, patch });
  });

  console.log(`workshopIdeas: ${ideasSnap.size} doc(s) total, ${alreadyOk} already up to date, ${noMatch} with no team match`);
  console.log(`${APPLY ? 'WRITING' : 'DRY RUN — would write'} ${toWrite.length} doc(s)`);
  if (!APPLY) { console.log('re-run with --apply to write.'); return; }

  for (const { id, patch } of toWrite) {
    await db.collection('workshopIdeas').doc(id).update(patch);
  }
  console.log('✓ done');
})();
