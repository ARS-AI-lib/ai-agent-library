// Firestore side of Portfolio → Library adoption. Shared by the
// syncPortfolioAdoption trigger and backfill-portfolio-adoption.cjs so both
// reconcile exactly the same way. Pure rules live in portfolioAdoptionRules.js.
const { FieldValue } = require('firebase-admin/firestore');
const { buildNameIndex, resolveTaskIds, markerId, diffMarkers } = require('./portfolioAdoptionRules');

/** Name index over approved agents + approved-rename aliases (previousName). */
async function loadNameIndex(db) {
  const [agentSnap, renameSnap] = await Promise.all([
    db.collection('agents').where('approvalStatus', '==', 'approved').get(),
    db.collection('renameRequests').where('status', '==', 'approved').get(),
  ]);
  const agents = agentSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  // Only renames decided after 2026-09-25 carry previousName; older ones are
  // simply not aliased (known limitation, see CLAUDE.md).
  const aliases = renameSnap.docs.map((d) => d.data())
    .filter((r) => r.previousName && r.agentId)
    .map((r) => ({ name: r.previousName, agentId: r.agentId }));
  return buildNameIndex(agents, aliases);
}

/**
 * Make the markers for ONE task match its current links, moving
 * agentStats.endpointClicks by exactly the markers created/deleted.
 * `task` null = task deleted. `apply` false = report only (backfill dry-run).
 */
async function reconcileTask(db, { projectId, taskId, task, projectName, nameIndex, apply = true }) {
  const { ids, unmatched, ambiguous } = resolveTaskIds(task, nameIndex);
  const q = db.collection('agentEvents')
    .where('kind', '==', 'task').where('projectId', '==', projectId).where('taskId', '==', taskId);

  const run = async (tx) => {
    const snap = tx ? await tx.get(q) : await q.get();
    const { add, remove } = diffMarkers(ids, snap.docs.map((d) => d.data().agentId));
    if (tx) {
      const adopter = String(task?.pic || task?.lastEditedBy || '').trim();
      add.forEach((agentId) => {
        tx.set(db.collection('agentEvents').doc(markerId(agentId, projectId, taskId)), {
          agentId, kind: 'task', source: 'portfolio', projectId, taskId,
          projectName: projectName || '', taskName: task?.name || '', adopter,
          createdAt: FieldValue.serverTimestamp(),
        });
        tx.set(db.collection('agentStats').doc(agentId),
          { endpointClicks: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      });
      remove.forEach((agentId) => {
        tx.delete(db.collection('agentEvents').doc(markerId(agentId, projectId, taskId)));
        tx.set(db.collection('agentStats').doc(agentId),
          { endpointClicks: FieldValue.increment(-1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      });
    }
    return { add, remove };
  };

  const { add, remove } = apply ? await db.runTransaction(run) : await run(null);
  return { add, remove, unmatched, ambiguous };
}

module.exports = { loadNameIndex, reconcileTask };
