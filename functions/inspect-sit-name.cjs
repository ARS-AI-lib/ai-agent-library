// READ-ONLY inspection of every doc named "SIT Automation Test" (2026-11-05).
//
//   node functions/inspect-sit-name.cjs        # nothing is ever written
//
// Written after functions/flip-sit-automation-to-skill.cjs aborted with TWO
// matches: one rejected (owner "07"), one APPROVED (live in the library).
// Before deleting / flipping anything we need the live one's real shape —
// current type flags, links, tier, and whether it carries an endpoint file.
const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const NAME_RE = /^sit\s+automation\s+test$/i;
const norm = (v) => (v == null ? '' : String(v).trim());
const SRC = path.join(__dirname, '..', 'src', 'lib');

function loadEsm(file, injected = {}) {
  const code = fs
    .readFileSync(path.join(SRC, file), 'utf8')
    .replace(/^\s*import\s[^;]*;\s*$/gm, '')
    .replace(/^export\s+/gm, '');
  const names = Object.keys(injected);
  const decls = [...code.matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  const body = `${code}\n;return { ${[...new Set(decls)].join(', ')} };`;
  return new Function(...names, body)(...names.map((n) => injected[n]));
}

const tier = loadEsm('tier.js');
const utils = loadEsm('agentUtils.js', { getType: tier.getType, getTier: tier.getTier });
const areas = loadEsm('approveAreas.js', {
  agentProcessIds: utils.agentProcessIds,
  splitRoles: utils.splitRoles,
  agentCategories: utils.agentCategories,
  isInternalOrExternal: tier.isInternalOrExternal,
});
const { getType, getTier } = tier;
const { agentApproveAreas, agentTypeLabel } = { ...areas, ...utils };

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

(async () => {
  const snap = await db.collection('agents').get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const hits = all.filter((a) => NAME_RE.test(norm(a.agentName)));

  console.log(`/agents total: ${all.length} · docs named "SIT Automation Test": ${hits.length}\n`);

  for (const a of hits) {
    console.log('═'.repeat(70));
    console.log(`${a.agentName}   id=${a.id}`);
    console.log('─'.repeat(70));
    console.log(`  approvalStatus      : ${a.approvalStatus}   archived=${!!a.archived}`);
    console.log(`  deploymentStatus    : ${JSON.stringify(a.deploymentStatus)}`);
    console.log(`  aiAgent             : ${JSON.stringify(a.aiAgent)}`);
    console.log(`  skillMd             : ${JSON.stringify(a.skillMd)}`);
    console.log(`  → getType()         : ${getType(a)}    getTier(): ${getTier(a)}`);
    console.log(`  → agentTypeLabel()  : ${agentTypeLabel ? agentTypeLabel(a, all) : '(n/a)'}`);
    console.log(`  owner / team        : ${JSON.stringify(a.owner)} / ${JSON.stringify(a.team)}`);
    console.log(`  creator / createdBy : ${JSON.stringify(a.creator)} / ${JSON.stringify(a.createdBy)}`);
    console.log(`  reusable            : ${JSON.stringify(a.reusable)}`);
    console.log(`  devProgress         : ${JSON.stringify(a.devProgress)}   launchDate: ${JSON.stringify(a.launchDate)}`);
    console.log(`  approveArea stored  : ${JSON.stringify(a.approveArea)}`);
    console.log(`  approveArea resolved: ${JSON.stringify(agentApproveAreas(a))}`);
    console.log(`  category            : ${JSON.stringify(a.category)}`);
    console.log(`  endpoint            : ${JSON.stringify(a.endpoint)}`);
    console.log(`  endpointFile        : ${JSON.stringify(a.endpointFile)}`);
    console.log(`  endpointFileVersion : ${JSON.stringify(a.endpointFileVersion)}`);

    const ownChildren = Array.isArray(a.childSkillIds) ? a.childSkillIds : [];
    const parents = all.filter((p) => p.id !== a.id && Array.isArray(p.childSkillIds) && p.childSkillIds.includes(a.id));
    const nameRefs = all.filter((p) => p.id !== a.id && norm(p.matchingAgent) === norm(a.agentName));
    console.log(`  childSkillIds       : ${JSON.stringify(ownChildren)}`);
    console.log(`  parents (by id link): ${JSON.stringify(parents.map((p) => `${p.agentName} (${p.id})`))}`);
    console.log(`  docs w/ matchingAgent = this name (${nameRefs.length}): ${JSON.stringify(nameRefs.map((p) => `${p.agentName} (${p.id})`))}`);
    console.log(`  → linked?           : ${ownChildren.length || parents.length || nameRefs.length ? 'YES' : 'no'}`);

    const rel = {};
    for (const [label, ref] of [
      ['agentVectors', db.collection('agentVectors').doc(a.id)],
      ['agentStats', db.collection('agentStats').doc(a.id)],
      ['analysisRuns', db.collection('analysisRuns').doc(a.id)],
    ]) rel[label] = (await ref.get()).exists;
    console.log(`  related docs        : ${JSON.stringify(rel)}`);
    console.log('');
  }

  console.log('═'.repeat(70));
  console.log('nothing was written (read-only).');
})().catch((e) => { console.error(e); process.exit(1); });
