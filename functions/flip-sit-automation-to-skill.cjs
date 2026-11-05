// Flip the APPROVED "SIT Automation Test" from Agent -> Skill (2026-11-05, one-off).
//
//   node functions/flip-sit-automation-to-skill.cjs            # dry run
//   node functions/flip-sit-automation-to-skill.cjs --apply
//
// ── Which doc ──
// Two docs share this name (found 2026-11-05). This script targets ONLY the
// live, deploy-approved one by its id, and refuses if that id/name/status has
// drifted:
//   Uw0kz7JNJTeKlkhdSXaH  rejected            → handled by delete-rejected-sit-automation-test.cjs
//   b8z9etNRmyzknzfVK9Ns  approved (live)     → THIS script
//
// ── What "Type" is ──
// Type is DERIVED, never stored (src/lib/tier.js): getType() returns 'skill'
// only when `aiAgent === false && skillMd === true`; anything else is 'agent'.
// So the whole change is those two booleans. getTier() then recomputes
// (Skill+Internal=T1, Agent+Internal=T2) — but nothing stores tier, so no
// data migration and no vector rebuild are needed:
//   · buildEmbedText() (functions/embedText.js) does NOT read aiAgent/skillMd
//     → the stored vector stays valid, contentHash unchanged.
//
// ── Why Admin SDK ──
// firestore.rules locks the type: aiAgent/skillMd appear in NO
// affectedKeys().hasOnly([...]) branch on /agents, so no client — not even
// admin — can change them. Admin SDK bypasses rules.
//
// ── Fail-safe ──
//  1. The target id must exist, still be named "SIT Automation Test", be
//     approved + not archived, and currently read as an Agent.
//  2. Refuses if the doc is linked (own childSkillIds / a parent linking by id /
//     another doc naming it as parent via matchingAgent) — flipping the type of
//     a linked node without deciding the link is out of scope.
//  3. Asserts agentApproveAreas() does NOT move (it should not: type flags are
//     not an input to the resolver, and a stored approveArea beats every layer).
//     Aborts if it would.
const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const TARGET_ID = 'b8z9etNRmyzknzfVK9Ns';
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
const { agentApproveAreas } = areas;

const abort = (msg) => { console.error(`\n✗ ${msg} — aborting, nothing written.`); process.exit(1); };

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

(async () => {
  const snap = await db.collection('agents').get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const a = all.find((x) => x.id === TARGET_ID);

  if (!a) abort(`no agent with id ${TARGET_ID}`);
  if (!NAME_RE.test(norm(a.agentName))) abort(`id ${TARGET_ID} is named ${JSON.stringify(a.agentName)}, not "SIT Automation Test" — id drifted?`);
  if (a.approvalStatus !== 'approved') abort(`id ${TARGET_ID} is not approved (status=${a.approvalStatus})`);
  if (a.archived) abort(`id ${TARGET_ID} is archived`);

  const parents = all.filter((p) => p.id !== a.id && Array.isArray(p.childSkillIds) && p.childSkillIds.includes(a.id));
  const ownChildren = Array.isArray(a.childSkillIds) ? a.childSkillIds : [];
  const nameRefs = all.filter((p) => p.id !== a.id && norm(p.matchingAgent) === norm(a.agentName));

  console.log(`target: ${a.agentName}  id=${a.id}`);
  console.log(`  status=${a.approvalStatus} deploymentStatus=${a.deploymentStatus} archived=${!!a.archived}`);
  console.log(`  links: children=${JSON.stringify(ownChildren)} parents=${JSON.stringify(parents.map((p) => p.agentName))} nameRefs=${JSON.stringify(nameRefs.map((p) => p.agentName))}`);

  if (ownChildren.length || parents.length || nameRefs.length) abort('this doc IS linked — decide the link handling first');
  if (getType(a) === 'skill') { console.log('\nAlready a Skill — nothing to do.'); return; }

  const before = agentApproveAreas(a).join(' | ');
  const after = { ...a, aiAgent: false, skillMd: true };
  const afterArea = agentApproveAreas(after).join(' | ');

  console.log('\n── before ──');
  console.log(`  aiAgent=${JSON.stringify(a.aiAgent)}  skillMd=${JSON.stringify(a.skillMd)}  → getType=${getType(a)}  getTier=${getTier(a)}`);
  console.log(`  approveArea(resolver)=${before}`);
  console.log('── after (what --apply writes) ──');
  console.log(`  aiAgent=false  skillMd=true  → getType=${getType(after)}  getTier=${getTier(after)}`);
  console.log(`  approveArea(resolver)=${afterArea}`);
  console.log(`  (endpoint / endpointFile / deploymentStatus / devProgress / launchDate untouched)`);

  if (before !== afterArea) abort(`approveArea would move (${before} -> ${afterArea}) — not expected; refusing to write`);

  if (!APPLY) { console.log('\nDRY RUN — re-run with --apply to write.'); return; }

  await db.collection('agents').doc(a.id).update({
    aiAgent: false,
    skillMd: true,
    updatedAt: FieldValue.serverTimestamp(),
  });
  console.log('\n✓ wrote 1 doc — type is now Skill (T1). No vector rebuild needed.');
})().catch((e) => { console.error(e); process.exit(1); });
