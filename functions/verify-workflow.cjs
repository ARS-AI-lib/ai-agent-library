// Workflow skills (2026-11-26). Offline. node functions/verify-workflow.cjs
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'src', 'lib');
function loadEsm(file, injected = {}) {
  const code = fs.readFileSync(path.join(SRC, file), 'utf8').replace(/^\s*import\s[^;]*;\s*$/gm, '').replace(/^export\s+/gm, '');
  const names = Object.keys(injected);
  const decls = [...code.matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  return new Function(...names, `${code}\n;return { ${[...new Set(decls)].join(', ')} };`)(...names.map((n) => injected[n]));
}
const tier = loadEsm('tier.js');
const U = loadEsm('agentUtils.js', { getType: tier.getType, getTier: tier.getTier });
let pass = 0; let fail = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n    got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };
const SK = { aiAgent: false, skillMd: true };
const s1 = { id: 's1', agentName: 'Starter', ...SK, createdBy: 'u1', devProgress: 20 };
const s2 = { id: 's2', agentName: 'Second', ...SK, createdBy: 'u1', devProgress: 10 };
const s3 = { id: 's3', agentName: 'Third', ...SK, createdBy: 'u1', matchingAgent: 'Flow', devProgress: 0 };   // same name+submitter, NOT listed
const loose = { id: 'x1', agentName: 'Loose', ...SK, createdBy: 'u9' };
const W = { id: 'w1', agentName: 'Flow', ...SK, isWorkflow: true, createdBy: 'u1', childSkillIds: ['s1', 's2'], devProgress: 30 };
const agent = { id: 'a1', agentName: 'Ag', aiAgent: true, skillMd: false, createdBy: 'u1', childSkillIds: [], devProgress: 50 };
const kid = { id: 'k1', agentName: 'Kid', ...SK, createdBy: 'u1', matchingAgent: 'Ag', devProgress: 0 };
const all = [s1, s2, s3, loose, W, agent, kid];
const names = (a) => a.map((x) => x.agentName);

eq('isWorkflow: workflow true, plain skill/agent false', [U.isWorkflow(W), U.isWorkflow(s1), U.isWorkflow(agent)], [true, false, false]);
eq('isWorkflow needs skill flags (agent with the flag is not a workflow)', U.isWorkflow({ ...agent, isWorkflow: true }), false);
eq('workflowMembers keeps childSkillIds order', names(U.workflowMembers(W, all)), ['Starter', 'Second']);
eq('workflowMembers follows reversed order', names(U.workflowMembers({ ...W, childSkillIds: ['s2', 's1'] }, all)), ['Second', 'Starter']);
eq('workflowMembers skips unknown ids', names(U.workflowMembers({ ...W, childSkillIds: ['s1', 'gone', 's2'] }, all)), ['Starter', 'Second']);
eq('workflowMembers of a non-workflow is empty', U.workflowMembers(agent, all), []);
eq('pairedSubSkills(workflow) = members only (no name heuristic)', names(U.pairedSubSkills(W, all)), ['Starter', 'Second']);
eq('pairedSubSkills(agent) unchanged: heuristic child', names(U.pairedSubSkills(agent, all)), ['Kid']);
eq('isPairedSubSkill: members true, listed-nowhere skill false', [U.isPairedSubSkill(s1, all), U.isPairedSubSkill(s2, all), U.isPairedSubSkill(loose, all)], [true, true, false]);
eq('a workflow is never a sub-skill, even if another workflow lists it', U.isPairedSubSkill(W, [...all, { ...W, id: 'w2', agentName: 'Flow2', childSkillIds: ['w1'] }]), false);
eq('unlisted skill with matchingAgent=workflow name is NOT a member', U.isPairedSubSkill(s3, all), false);
eq('workflowOf', [U.workflowOf(s2, all)?.agentName, U.workflowOf(loose, all)], ['Flow', null]);
eq('agentsOfSkill never lists a workflow as an Agent parent', [U.agentsOfSkill(s1, all), U.agentsOfSkill(s3, all), U.agentsOfSkill(kid, all)], [[], [], ['Ag']]);
eq('typeBadgeName', [U.typeBadgeName(W), U.typeBadgeName(s1), U.typeBadgeName(agent)], ['Workflow skills', 'Skill', 'Agent']);
eq('agentTypeLabel', [U.agentTypeLabel(W, all), U.agentTypeLabel(s1, all), U.agentTypeLabel(agent, all), U.agentTypeLabel({ ...agent, id: 'a2', agentName: 'Solo' }, all)], ['Workflow skills', 'Skill', 'Agent+Skill', 'Agent']);
const f = (type) => U.buildAgentFilter({ type, owner: 'all', role: 'all', tier: 'all', reusable: 'all', hasEndpoint: false, category: null, stage: null, platformTools: false, externalSkills: false, search: '' });
eq('filter skill excludes workflows', [f('skill')(W), f('skill')(s1)], [false, true]);
eq('filter workflow only matches workflows', [f('workflow')(W), f('workflow')(s1), f('workflow')(agent)], [true, false, false]);
eq('filter agent unchanged', [f('agent')(agent), f('agent')(W)], [true, false]);
eq('cascadeTargets skips a member ahead of the workflow', names(U.cascadeTargets({ ...W, devProgress: 15 }, all)), ['Second']);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
