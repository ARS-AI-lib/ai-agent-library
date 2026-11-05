// Delete the REJECTED "SIT Automation Test" item, then retire the stray Owner
// name "07" from /config/schema.team (2026-11-05, one-off).
//
//   node functions/delete-rejected-sit-automation-test.cjs            # dry run — read this first
//   node functions/delete-rejected-sit-automation-test.cjs --apply
//
// ── Why this replaces the two earlier scripts ──
// The first dry run of retire-team-07.cjs proved the two requests are about the
// SAME doc: `owner="07"` exists only because "SIT Automation Test" carries it.
// The user decided to delete the item outright, so:
//   · the "flip Type Agent→Skill" one-off is moot (the doc is going away), and
//   · retiring "07" is only possible AFTER the doc is gone — this script does
//     both, in that order, and refuses to do the second half if the first fails.
//   (the old flip-sit-automation-to-skill.cjs / retire-team-07.cjs were deleted)
//
// ── Why Admin SDK ──
// Two separate rules reasons: (a) /config/schema.team is grow-only for clients
// (`request.resource.data.team.hasAll(resource.data.team)`, firestore.rules ~:488),
// so no client can shrink the list; (b) deletes of /agents have their own rules
// branch. Admin SDK bypasses rules.
//
// ⚠️ 2026-11-05: the name is NOT unique. Two docs share it —
//   Uw0kz7JNJTeKlkhdSXaH  rejected  owner "07"   ← this script's target
//   b8z9etNRmyzknzfVK9Ns  approved  (live)       ← left alone, never touched
// so the target is selected by "name matches AND approvalStatus === rejected".
//
// ── Fail-safe (aborts rather than writes anything unexpected) ──
//  1. Expects EXACTLY ONE doc matching /^sit\s+automation\s+test$/i.
//  2. Refuses to delete unless `approvalStatus === 'rejected'` (that is what the
//     user asked for; if a second, non-rejected item of this name appears, stop).
//  3. Refuses if the doc is LINKED — has its own childSkillIds, is listed in
//     some parent's childSkillIds, or another doc names it in `matchingAgent`
//     (the name-based parent link). Deleting a linked doc would silently break
//     a cascade.
//  4. Refuses if the doc has an `endpointFile` (a Storage object would be
//     orphaned; decide that deliberately).
//  5. Refuses to retire "07" if any OTHER doc still uses it as owner/team.
// Everything it would delete is printed first, including the raw doc.
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const NAME_RE = /^sit\s+automation\s+test$/i;
const TARGET_TEAM = '07';
const norm = (v) => (v == null ? '' : String(v).trim());

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

const abort = (msg) => { console.error(`\n✗ ${msg} — aborting, nothing written.`); process.exit(1); };

(async () => {
  // ── 1. find the doc ──────────────────────────────────────────────────────
  const snap = await db.collection('agents').get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const hits = all.filter((a) => NAME_RE.test(norm(a.agentName)));
  const rejected = hits.filter((a) => a.approvalStatus === 'rejected');
  const kept = hits.filter((a) => a.approvalStatus !== 'rejected');

  console.log(`=== /agents: ${all.length} docs ===`);
  console.log(`matches on ${NAME_RE}: ${hits.length}  (rejected: ${rejected.length} · other: ${kept.length})`);
  hits.forEach((a) =>
    console.log(`  - ${JSON.stringify(a.agentName)}  id=${a.id}  status=${a.approvalStatus}  archived=${!!a.archived}  owner=${JSON.stringify(a.owner)}`)
  );
  // The name is NOT unique (found 2026-11-05): one rejected, one approved/live.
  // Only the rejected one is the user's target; the approved one is left alone.
  if (rejected.length !== 1) abort(`expected exactly 1 REJECTED match, got ${rejected.length} — tell Claude what you see`);
  if (kept.length) console.log(`  ↪ leaving ${kept.length} non-rejected doc(s) of this name untouched: ${kept.map((k) => k.id).join(', ')}`);

  const a = rejected[0];

  // ── 2. link checks ───────────────────────────────────────────────────────
  const parents = all.filter((p) => p.id !== a.id && Array.isArray(p.childSkillIds) && p.childSkillIds.includes(a.id));
  const ownChildren = Array.isArray(a.childSkillIds) ? a.childSkillIds : [];
  const nameRefs = all.filter((p) => p.id !== a.id && norm(p.matchingAgent) === norm(a.agentName));
  console.log('\n=== links ===');
  console.log(`  own childSkillIds          : ${JSON.stringify(ownChildren)}`);
  console.log(`  parents linking to it      : ${JSON.stringify(parents.map((p) => p.agentName))}`);
  console.log(`  docs naming it as parent   : ${JSON.stringify(nameRefs.map((p) => p.agentName))}`);
  if (ownChildren.length || parents.length || nameRefs.length) {
    abort('this doc IS linked (see above) — deleting it would break a cascade');
  }

  if (a.endpointFile) abort('doc carries `endpointFile` — a Storage object would be orphaned; decide that first');

  // ── 3. related docs keyed by agentId, printed before anything happens ────
  const vecRef = db.collection('agentVectors').doc(a.id);
  const statsRef = db.collection('agentStats').doc(a.id);
  const runRef = db.collection('analysisRuns').doc(a.id); // pre-reg analysis is 1:1 on the agent id
  const vec = await vecRef.get();
  const stats = await statsRef.get();
  const run = await runRef.get();
  const reviews = stats.exists ? await statsRef.collection('reviews').get() : { size: 0 };

  const eventSnap = await db.collection('agentEvents').get();
  const events = eventSnap.docs.filter((d) => d.id.startsWith(`${a.id}__`));
  const rrSnap = await db.collection('renameRequests').get();
  const renameReqs = rrSnap.docs.filter((d) => d.data()?.agentId === a.id);
  const cpSnap = await db.collection('categoryProposals').get();
  const proposals = cpSnap.docs.filter((d) => d.data()?.agentId === a.id);

  console.log('\n=== related docs (all removed with the item) ===');
  console.log(`  /agentVectors/${a.id}          : ${vec.exists ? 'EXISTS' : 'none'}`);
  console.log(`  /agentStats/${a.id}            : ${stats.exists ? 'EXISTS' : 'none'}  (+ reviews: ${reviews.size})`);
  console.log(`  /analysisRuns/${a.id}          : ${run.exists ? 'EXISTS' : 'none'}`);
  console.log(`  /agentEvents  markers          : ${events.length}`);
  console.log(`  /renameRequests rows           : ${renameReqs.length}`);
  console.log(`  /categoryProposals rows        : ${proposals.length}`);
  console.log('  subcollection /agents/{id}/endpointVersions is deleted with the doc (recursiveDelete)');

  console.log('\n=== the doc to delete (verbatim) ===');
  console.log(JSON.stringify(a, null, 2));

  // ── 4. can "07" be retired afterwards? ───────────────────────────────────
  const schemaRef = db.doc('config/schema');
  const schema = (await schemaRef.get()).data() || {};
  const curTeams = Array.isArray(schema.team) ? schema.team : [];
  const others = all.filter((x) => x.id !== a.id && (norm(x.owner) === TARGET_TEAM || norm(x.team) === TARGET_TEAM));
  const nextTeams = curTeams.filter((t) => norm(t) !== TARGET_TEAM);
  const removingTeam = curTeams.length - nextTeams.length;

  console.log(`\n=== /config/schema.team (${curTeams.length} entries) ===`);
  console.log(`  contains "${TARGET_TEAM}": ${curTeams.some((t) => norm(t) === TARGET_TEAM)}  → will remove ${removingTeam}`);
  console.log(`  other docs still using "${TARGET_TEAM}": ${others.length}${others.length ? ' — ' + others.map((x) => x.agentName).join(' | ') : ''}`);
  if (others.length) abort(`"${TARGET_TEAM}" is still used by ${others.length} other doc(s) — not retiring the name`);

  if (!APPLY) {
    console.log('\nDRY RUN — review the three blocks above, then re-run with --apply to write.');
    return;
  }

  // ── 5. apply: delete the item first, retire the name after ──────────────
  await db.recursiveDelete(db.collection('agents').doc(a.id));
  if (vec.exists) await vecRef.delete();
  if (stats.exists) await db.recursiveDelete(statsRef);
  if (run.exists) await runRef.delete();
  if (events.length) {
    const b = db.batch();
    events.forEach((d) => b.delete(d.ref));
    await b.commit();
  }
  if (renameReqs.length) {
    const b = db.batch();
    renameReqs.forEach((d) => b.delete(d.ref));
    await b.commit();
  }
  if (proposals.length) {
    const b = db.batch();
    proposals.forEach((d) => b.delete(d.ref));
    await b.commit();
  }
  console.log(`\n✓ deleted "${a.agentName}" (${a.id}) + ${vec.exists ? 1 : 0} vector + ${stats.exists ? 1 : 0} stats + ${run.exists ? 1 : 0} analysisRuns + ${events.length} event marker(s) + ${renameReqs.length} rename row(s) + ${proposals.length} proposal row(s)`);

  if (removingTeam) {
    await schemaRef.set({ team: nextTeams }, { merge: true });
    console.log(`✓ /config/schema.team: ${curTeams.length} -> ${nextTeams.length} (removed "${TARGET_TEAM}")`);
  } else {
    console.log(`- /config/schema.team unchanged ("${TARGET_TEAM}" not present)`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
