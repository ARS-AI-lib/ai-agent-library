// Backfills /config/schema.relatedRole and /config/schema.team with distinct
// values already in live use on approved agents, but never captured in
// schema — both fields are grow-only (relatedRole since 2026-07-06's
// TagMultiSelect self-service, team since 2026-08-10's Owner roster) and
// only ever grew from a user typing a genuinely NEW value through the form.
// Historical values imported before either field existed were never written
// back, so schema.relatedRole sat at 3 entries and schema.team at 43 while
// the UI's option lists looked complete only because every consumer unions
// schema with live agent data at render time (never breaks, but leaves the
// schema doc itself looking incomplete on direct inspection, and would leave
// a future consumer that reads schema alone missing 54/19 real values).
// coreAbility has no such gap (0 missing when checked) — this brings the
// other two fields to the same standard.
//
// Purely additive (arrayUnion) — never touches agent docs.
//
//   node functions/backfill-schema-options.cjs           # dry run
//   node functions/backfill-schema-options.cjs --apply
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');

function splitRoles(r) {
  if (!r) return [];
  if (Array.isArray(r)) return r.map((x) => String(x).trim()).filter(Boolean);
  return String(r).split(/[,/]/).map((x) => x.trim()).filter(Boolean);
}

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

(async () => {
  const [snap, schemaSnap] = await Promise.all([
    db.collection('agents').get(),
    db.doc('config/schema').get(),
  ]);
  const cfg = schemaSnap.data() || {};

  const liveRoles = new Set();
  const liveOwners = new Set();
  snap.forEach((d) => {
    const a = d.data();
    if (a.approvalStatus !== 'approved' || a.archived === true) return;
    splitRoles(a.relatedRole).forEach((r) => liveRoles.add(r));
    if (a.owner) liveOwners.add(a.owner);
  });

  const curRoles = new Set(cfg.relatedRole || []);
  const curTeams = new Set(cfg.team || []);
  const addRoles = [...liveRoles].filter((r) => !curRoles.has(r)).sort();
  const addTeams = [...liveOwners].filter((o) => !curTeams.has(o)).sort();

  console.log(`=== schema.relatedRole: ${curRoles.size} -> ${curRoles.size + addRoles.length} ===`);
  addRoles.forEach((r) => console.log(`  +  ${r}`));
  console.log(`\n=== schema.team: ${curTeams.size} -> ${curTeams.size + addTeams.length} ===`);
  addTeams.forEach((t) => console.log(`  +  ${t}`));

  console.log(`\n${APPLY ? 'WRITING' : 'DRY RUN — would write'}: +${addRoles.length} relatedRole, +${addTeams.length} team`);
  if (!APPLY) { console.log('re-run with --apply to write.'); return; }

  const ref = db.doc('config/schema');
  const patch = {};
  if (addRoles.length) patch.relatedRole = FieldValue.arrayUnion(...addRoles);
  if (addTeams.length) patch.team = FieldValue.arrayUnion(...addTeams);
  if (!Object.keys(patch).length) { console.log('nothing to do.'); return; }
  await ref.set(patch, { merge: true });
  console.log('✓ written');
})();
