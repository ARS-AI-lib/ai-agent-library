// One-off (2026-10-26): rename "DailySync.md" skill to "Daily-Scrum".
// Checked first: no childSkillIds, no sub-skill references it via
// matchingAgent (verified by script, not re-checked here) — a clean
// standalone rename, same shape as exports.decideRenameRequest minus the
// cascade step (nothing to cascade to).
//
//   node functions/fix-dailysync-rename.cjs            # dry run
//   node functions/fix-dailysync-rename.cjs --apply
//
// agentName is embedded text — after --apply, run
// `node functions/bootstrap-vectors.cjs --apply` to refresh search.
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const ID = '2Glw7r6JdcSXTO7jxcY0';
const OLD_NAME = 'DailySync.md';
const NEW_NAME = 'Daily-Scrum';

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

(async () => {
  const ref = db.collection('agents').doc(ID);
  const snap = await ref.get();
  if (!snap.exists) { console.error('✗ doc not found'); process.exit(1); }
  const a = snap.data();
  if (a.agentName !== OLD_NAME) { console.error(`✗ expected "${OLD_NAME}", found "${a.agentName}" — aborting`); process.exit(1); }

  console.log(`${ID}: "${OLD_NAME}" -> "${NEW_NAME}"`);
  console.log(APPLY ? 'APPLY' : 'dry run');
  if (!APPLY) return;

  await ref.update({ agentName: NEW_NAME, previousName: OLD_NAME, updatedAt: FieldValue.serverTimestamp() });
  console.log('✔ renamed');
})().catch((e) => { console.error(e); process.exit(1); });
