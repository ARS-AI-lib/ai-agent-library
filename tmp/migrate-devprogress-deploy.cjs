// Deploy Approval feature (2026-07-02): two changes to every /agents doc.
//
// 1. devProgress: normalize from the legacy string format ("90%") to a plain
//    number (90). Existing security rules and the new deploy-cap rule both
//    compare devProgress numerically ("<= 95"), which cannot work against a
//    string — this migration is a hard prerequisite for that rule, not
//    cosmetic. Docs already storing a number are left untouched.
// 2. deploymentStatus: new field, 'none' | 'requested' | 'approved' | 'rejected'.
//    Grandfathered per explicit decision: any agent already past the new 95%
//    gate (devProgress > 95, including 100) is stamped 'approved' — we do not
//    retroactively lock work that was already done before this feature
//    existed. Everything else starts at 'none'.
//
// Usage:
//   node tmp/migrate-devprogress-deploy.cjs           # dry run
//   node tmp/migrate-devprogress-deploy.cjs --apply    # actually writes

const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');

const app = initializeApp({ projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

function normalizeProgress(raw) {
  if (typeof raw === 'number') return raw;
  const num = parseInt(String(raw || '').replace('%', ''), 10);
  return isNaN(num) ? 0 : num;
}

(async () => {
  const snap = await db.collection('agents').get();
  const targets = [];
  snap.forEach((d) => {
    const data = d.data();
    const wasString = typeof data.devProgress === 'string';
    const num = normalizeProgress(data.devProgress);
    const hasDeploymentStatus = data.deploymentStatus !== undefined;
    if (!wasString && hasDeploymentStatus) return; // already migrated, nothing to do
    targets.push({
      id: d.id,
      agentName: data.agentName,
      before: data.devProgress,
      after: num,
      deploymentStatus: num > 95 ? 'approved' : 'none',
    });
  });

  console.log(`Agents to migrate: ${targets.length}`);
  targets.forEach((t) =>
    console.log(`  ${t.agentName}  devProgress: ${JSON.stringify(t.before)} → ${t.after}  deploymentStatus → ${t.deploymentStatus}`)
  );

  if (!APPLY) {
    console.log('\n— DRY RUN — re-run with --apply to write these changes.');
    return;
  }

  const batchSize = 400;
  for (let i = 0; i < targets.length; i += batchSize) {
    const batch = db.batch();
    targets.slice(i, i + batchSize).forEach(({ id, after, deploymentStatus }) => {
      batch.update(db.collection('agents').doc(id), {
        devProgress: after,
        deploymentStatus,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
  }
  console.log(`✅ Migrated devProgress → number + deploymentStatus on ${targets.length} agents.`);
})();
