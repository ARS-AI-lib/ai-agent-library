// Mark skills taken from outside the company as `externalSource: true`
// (2026-10-15, one-off). Drives the derived "External Skills" sidebar filter.
//
//   node functions/backfill-external-source.cjs            # dry run
//   node functions/backfill-external-source.cjs --apply
//
// Scope: approved, not archived, Skill type (aiAgent false + skillMd true),
// name starts with "Figma" or is the TDG skill. Never touches `category`:
// category feeds Approve Area routing, this flag must not.
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const isTarget = (name) => /^figma/i.test(name) || /^TDG\b/i.test(name);

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

(async () => {
  const snap = await db.collection('agents').get();
  const hits = snap.docs
    .map((d) => ({ id: d.id, ref: d.ref, ...d.data() }))
    .filter((a) => a.approvalStatus === 'approved' && a.archived !== true)
    .filter((a) => a.aiAgent === false && a.skillMd === true)
    .filter((a) => isTarget(String(a.agentName || '').trim()));

  const todo = hits.filter((a) => a.externalSource !== true);
  hits.forEach((a) => console.log(`${a.externalSource === true ? '=' : '+'} ${a.id}  ${a.agentName}`));
  console.log(`\n${hits.length} matched · ${todo.length} to update · ${APPLY ? 'APPLY' : 'dry run'}`);
  if (!APPLY || todo.length === 0) return;

  const batch = db.batch();
  todo.forEach((a) => batch.update(a.ref, { externalSource: true, updatedAt: FieldValue.serverTimestamp() }));
  await batch.commit();
  console.log(`✔ updated ${todo.length}`);
})().catch((e) => { console.error(e); process.exit(1); });
