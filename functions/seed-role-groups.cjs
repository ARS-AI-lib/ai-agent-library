// One-off (2026-09-24): create /config/roleGroups from DEFAULT_ROLE_GROUPS —
// exactly the 15 groups, labels and roles that were hard-coded until now — so
// Role Group Management has something to edit. Refuses to overwrite an
// existing doc (edits made in the UI must never be clobbered by a re-run).
//
//   node functions/seed-role-groups.cjs           # dry run
//   node functions/seed-role-groups.cjs --apply
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { DEFAULT_ROLE_GROUPS, validateGroups } = require('./roleGroupAdminRules');

const APPLY = process.argv.includes('--apply');
const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' }), 'ai-agent-lib');

(async () => {
  const ref = db.doc('config/roleGroups');
  if ((await ref.get()).exists) { console.log('config/roleGroups already exists — not touching it.'); process.exit(0); }
  const res = validateGroups(DEFAULT_ROLE_GROUPS);
  if (res.error) throw new Error(res.error);
  res.groups.forEach((g, i) => console.log(`${String(i + 1).padStart(2)}. ${g.label.padEnd(18)} key=${JSON.stringify(g.key)} · ${g.roles.length} roles`));
  const assigned = (await db.collection('agents').get()).docs.map((d) => d.data().roleGroup).filter(Boolean);
  const unknown = assigned.filter((k) => !res.groups.some((g) => g.key === k));
  console.log(`\nstored agent.roleGroup values: ${assigned.length} · not in seed: ${unknown.length}`);
  if (unknown.length) throw new Error(`Seed would orphan: ${[...new Set(unknown)].join(', ')}`);
  if (!APPLY) { console.log('\nDry run — pass --apply to write.'); process.exit(0); }
  await ref.set({ groups: res.groups, updatedAt: FieldValue.serverTimestamp(), updatedBy: 'seed-role-groups.cjs', history: [] });
  console.log('\nApplied.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
