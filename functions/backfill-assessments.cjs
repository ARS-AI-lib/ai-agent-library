// Create the /assessments records that never got written (2026-11-27): the client wrote them
// best-effort and they were denied until the rules were published. Rebuilds one record per stored
// stage from agent.screening: a 'pre' record (preAt / createdAt) and, if a deploy was requested
// (deployAt), a 'deploy' record. Skips any (agentId, stage) that already has a record.
// Dry-run unless --apply. Admin SDK (bypasses rules). Needs ADC.
//   node functions/backfill-assessments.cjs [--apply]
const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
function loadEsm(file, injected = {}) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', file), 'utf8').replace(/^\s*import\s[^;]*;\s*$/gm, '').replace(/^export\s+/gm, '');
  const names = Object.keys(injected);
  const decls = [...code.matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  return new Function(...names, `${code}\n;return { ${[...new Set(decls)].join(', ')} };`)(...names.map((n) => injected[n]));
}
const scr = loadEsm('screening.js');
const dec = loadEsm('declaration.js');
const A = loadEsm('assessments.js', { DECL_FIELDS: dec.DECL_FIELDS, evaluate: scr.evaluate, optionOf: scr.optionOf, normalizeAnswers: scr.normalizeAnswers });
const APPLY = process.argv.includes('--apply');

(async () => {
  const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId: process.env.GCLOUD_PROJECT || 'wolfy-481609' }), 'ai-agent-lib');
  const cfgSnap = await db.doc('config/screening').get();
  const config = cfgSnap.exists ? cfgSnap.data() : scr.DEFAULT_CONFIG;
  const [agents, existing] = await Promise.all([db.collection('agents').get(), db.collection('assessments').get()]);
  const have = new Set(existing.docs.map((d) => `${d.data().agentId}__${d.data().stage}`));
  let plan = 0;
  for (const d of agents.docs) {
    const a = { id: d.id, ...d.data() };
    const sc = a.screening;
    if (!sc?.answers) continue;
    const answers = scr.normalizeAnswers(config, sc.answers);
    const stages = [['pre', sc.preAt || a.createdAt]];
    if (sc.deployAt) stages.push(['deploy', sc.deployAt]);
    for (const [stage, at] of stages) {
      if (have.has(`${a.id}__${stage}`)) continue;
      const when = at?.toDate ? at.toDate() : new Date();
      const rec = { ...A.assessmentRecord(a, stage, answers, a.createdBy || '', when), createdAt: Timestamp.fromDate(when) };
      plan += 1;
      console.log(`${APPLY ? 'write' : 'would write'} ${stage.padEnd(6)} ${a.agentName} · ${when.toISOString().slice(0, 10)} · ${Object.keys(answers).length} answers`);
      if (APPLY) await db.collection('assessments').add(rec);
    }
  }
  console.log(`${plan} record(s) ${APPLY ? 'written' : 'to write (dry-run — pass --apply)'}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
