// One-off (2026-10-21): set Reusable with Conditions on "BiB Frontend React
// Code Generator" + its 16 linked skills, and rename the parent to
// "Frontend React Code Generator".
//
//   node functions/fix-bib-frontend-reusable-rename.cjs            # dry run
//   node functions/fix-bib-frontend-reusable-rename.cjs --apply
//
// Rename mirrors exports.decideRenameRequest in index.js exactly (same two
// writes: agentName + previousName on the parent, matchingAgent on every
// child found by matchingAgent==oldName AND sameSubmitter) so Portfolio
// adoption links and sub-skill pairing survive the rename (CLAUDE.md §25/§27).
// childSkillIds (doc-ID link) needs no update — it doesn't store the name.
//
// reusable is NOT embedded text (functions/embedText.js) so no reindex is
// needed for that part. agentName IS embedded — after --apply, run
// `node functions/bootstrap-vectors.cjs --apply` (hash-skip keeps it cheap,
// only the renamed doc will actually re-embed).
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const OLD_NAME = 'BiB Frontend React Code Generator';
const NEW_NAME = 'Frontend React Code Generator';
const REUSABLE = 'Reusable with Conditions';
const REUSE_CONDITION = 'Specific structured. Compatible with miniapp, Bank in Bank. Another might need more review.';

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

(async () => {
  const parentSnap = await db.collection('agents').where('agentName', '==', OLD_NAME).get();
  if (parentSnap.empty) { console.error(`✗ "${OLD_NAME}" not found`); process.exit(1); }
  if (parentSnap.size > 1) { console.error(`✗ ${parentSnap.size} docs named "${OLD_NAME}" — ambiguous`); process.exit(1); }
  const parentDoc = parentSnap.docs[0];
  const parent = parentDoc.data();

  const childSnap = await db.collection('agents').where('matchingAgent', '==', OLD_NAME).get();
  const children = childSnap.docs.filter((d) => {
    const c = d.data();
    if (parent.createdBy && c.createdBy && c.createdBy === parent.createdBy) return true;
    const ca = String(c.creator || '').trim().toLowerCase();
    const cb = String(parent.creator || '').trim().toLowerCase();
    return !!ca && ca === cb;
  });

  const all = [{ id: parentDoc.id, ref: parentDoc.ref, name: parent.agentName, isParent: true },
    ...children.map((d) => ({ id: d.id, ref: d.ref, name: d.data().agentName, isParent: false }))];

  console.log(`Parent: ${parent.agentName}  (${parentDoc.id})`);
  console.log(`Children by matchingAgent==oldName + sameSubmitter: ${children.length}`);
  all.forEach((a) => console.log(`${a.isParent ? '*' : ' '} ${a.id}  ${a.name}`));
  console.log(`\nReusable -> "${REUSABLE}" on ${all.length} docs`);
  console.log(`Rename parent -> "${NEW_NAME}", cascade matchingAgent on ${children.length} children`);
  console.log(`\n${APPLY ? 'APPLY' : 'dry run'}`);
  if (!APPLY) return;

  const batch = db.batch();
  all.forEach((a) => {
    batch.update(a.ref, { reusable: REUSABLE, reuseCondition: REUSE_CONDITION, updatedAt: FieldValue.serverTimestamp() });
  });
  batch.update(parentDoc.ref, { agentName: NEW_NAME, previousName: OLD_NAME, updatedAt: FieldValue.serverTimestamp() });
  children.forEach((d) => {
    batch.update(d.ref, { matchingAgent: NEW_NAME, updatedAt: FieldValue.serverTimestamp() });
  });
  await batch.commit();
  console.log(`✔ updated ${all.length} docs, renamed parent, cascaded matchingAgent to ${children.length} children`);
})().catch((e) => { console.error(e); process.exit(1); });
