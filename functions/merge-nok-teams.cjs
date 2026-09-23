// Merge the three "นก" teams into นกลงทุน (2026-09-23, one-off).
//
//   node functions/merge-nok-teams.cjs            # dry run
//   node functions/merge-nok-teams.cjs --apply
//
// นกต่อ (3) · นกรู้ (9) · นกคุ้ม (1)  ->  นกลงทุน (already 6 docs -> 19)
// and the three retired names are dropped from /config/schema.team.
//
// ── Both fields, not just owner ──
// Every one of the 13 docs carries the same value in BOTH `owner` and `team`.
// Renaming only `owner` would leave the retired names in the database, which is
// the opposite of what was asked. `team` is the legacy CSV-import twin of
// `owner`; the UI reads `owner` everywhere (cards, By Owner grouping, Dashboard
// owner workload), so leaving them disagreeing would also be a new
// inconsistency of the kind that hid the §23 category bug for a week.
//
// ── Deliberately NOT touched: agentName ──
// 11 of the 13 docs have the team name as a prefix of their own name
// ("นกรู้ - Fund information", "นกต่อ - Flash news", …). Those are product
// names, not ownership, and renaming an agent is a different operation with its
// own approval flow and cascade (§25: `matchingAgent` on children stores the
// PARENT NAME, so a silent rename detaches sub-skills). Verified first that no
// doc's `matchingAgent` references any of these names, so nothing is dangling
// either way — but a rename here would still need decideRenameRequest, not a
// backfill script.
//
// ── No reindex needed ──
// buildEmbedText() in functions/embedText.js does not include owner or team, so
// no stored vector's contentHash changes.
//
// ── /config/schema.team shrinks ──
// firestore.rules keeps /config/schema grow-only for clients (the relatedRole
// free-add rule); Admin SDK bypasses rules, which is the only way to retire a
// value — same situation as retiring a category via
// seed-approve-area-schema.cjs (§27).
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const FROM = ['นกต่อ', 'นกรู้', 'นกคุ้ม'];
const TO = 'นกลงทุน';

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

const norm = (v) => (v == null ? '' : String(v).trim());

(async () => {
  const snap = await db.collection('agents').get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // Safety check for the agentName decision above: if any child pointed at one
  // of these names we would need to think about it before writing anything.
  const refs = all.filter((a) => FROM.includes(norm(a.matchingAgent)));
  if (refs.length) {
    console.error(`✗ ${refs.length} doc(s) reference a retired name in matchingAgent — aborting`);
    process.exit(1);
  }

  const todo = all.filter((a) => FROM.includes(norm(a.owner)) || FROM.includes(norm(a.team)));

  console.log(`${todo.length} docs to rewrite -> "${TO}"\n`);
  todo.forEach((a) => {
    const o = FROM.includes(norm(a.owner)) ? `owner ${norm(a.owner)} -> ${TO}` : `owner ${norm(a.owner)} (kept)`;
    const t = FROM.includes(norm(a.team)) ? `team ${norm(a.team)} -> ${TO}` : `team ${norm(a.team)} (kept)`;
    console.log(`  ${a.id.padEnd(12)} ${o.padEnd(28)} ${t.padEnd(28)} name: ${a.agentName || ''}`);
  });

  const schemaRef = db.doc('config/schema');
  const teams = (await schemaRef.get()).data()?.team || [];
  const nextTeams = teams.filter((t) => !FROM.includes(norm(t)));
  const removed = teams.filter((t) => FROM.includes(norm(t)));
  console.log(`\nschema.team: ${teams.length} -> ${nextTeams.length}`);
  removed.forEach((t) => console.log(`  - ${t}  (RETIRED)`));
  console.log(`  keeps "${TO}": ${nextTeams.includes(TO)}`);
  if (!nextTeams.includes(TO)) {
    console.error('✗ target team is missing from schema.team — aborting rather than orphaning 19 docs');
    process.exit(1);
  }

  if (!APPLY) {
    console.log('\nDRY RUN — re-run with --apply to write.');
    return;
  }

  const batch = db.batch();
  todo.forEach((a) => {
    const patch = { updatedAt: FieldValue.serverTimestamp() };
    if (FROM.includes(norm(a.owner))) patch.owner = TO;
    if (FROM.includes(norm(a.team))) patch.team = TO;
    batch.update(db.collection('agents').doc(a.id), patch);
  });
  batch.update(schemaRef, { team: nextTeams, updatedAt: FieldValue.serverTimestamp() });
  await batch.commit();
  console.log(`\n✓ wrote ${todo.length} docs + schema.team`);
})().catch((e) => { console.error(e); process.exit(1); });
