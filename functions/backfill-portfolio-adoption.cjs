// Backfill: count EXISTING Portfolio task links as Library adoption.
// Same reconcile as the syncPortfolioAdoption trigger (portfolioAdoption.js),
// marker ids are deterministic → safe to re-run.
//   node functions/backfill-portfolio-adoption.cjs          # dry-run
//   node functions/backfill-portfolio-adoption.cjs --apply
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { loadNameIndex, reconcileTask } = require('./portfolioAdoption');

const APPLY = process.argv.includes('--apply');
const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');
const pdb = getFirestore(app, 'portfolio');

(async () => {
  const nameIndex = await loadNameIndex(db);
  const names = new Map();
  (await db.collection('agents').get()).docs.forEach((d) => names.set(d.id, d.data().agentName));
  const perAgent = new Map();
  const unmatched = new Map();
  const ambiguous = new Set();
  let tasks = 0, linked = 0, adds = 0, removes = 0;

  for (const p of (await pdb.collection('projects').get()).docs) {
    for (const t of (await p.ref.collection('tasks').get()).docs) {
      tasks += 1;
      const task = t.data();
      if ((task.agents || []).length + (task.skills || []).length) linked += 1;
      const r = await reconcileTask(db, { projectId: p.id, taskId: t.id, task, projectName: p.data().name || '', nameIndex, apply: APPLY });
      adds += r.add.length; removes += r.remove.length;
      r.add.forEach((id) => perAgent.set(id, (perAgent.get(id) || 0) + 1));
      r.remove.forEach((id) => perAgent.set(id, (perAgent.get(id) || 0) - 1));
      r.unmatched.forEach((n) => unmatched.set(n, (unmatched.get(n) || 0) + 1));
      r.ambiguous.forEach((n) => ambiguous.add(n));
    }
  }
  console.log(`tasks ${tasks} · with links ${linked} · markers +${adds} / -${removes}`);
  console.log('\nadoption change per agent:');
  [...perAgent].sort((a, b) => b[1] - a[1]).forEach(([id, n]) => console.log(`  ${n > 0 ? '+' : ''}${n}  ${names.get(id) || id}`));
  console.log(`\nnot in Library (skipped): ${unmatched.size}`);
  [...unmatched].sort((a, b) => b[1] - a[1]).forEach(([n, c]) => console.log(`  ${c}×  ${n}`));
  if (ambiguous.size) console.log(`\nambiguous names (skipped): ${[...ambiguous].join(', ')}`);
  console.log(APPLY ? '\nAPPLIED' : '\nDRY RUN — nothing written');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
