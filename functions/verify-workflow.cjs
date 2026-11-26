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
const R = loadEsm('registrationType.js');
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
// What the registration form writes for each Type (this is where isWorkflow is actually set).
eq('typeFlags: Workflow skills writes isWorkflow + skill flags', R.typeFlags('Workflow skills'), { aiAgent: false, skillMd: true, isWorkflow: true });
eq('typeFlags: Skill / Agent / Agent+Skill never set isWorkflow', ['Skill', 'Agent', 'Agent+Skill'].map((t) => 'isWorkflow' in R.typeFlags(t)), [false, false, false]);
eq('typeFlags: Skill = skill flags, Agent+Skill main doc = pure Agent', [R.typeFlags('Skill'), R.typeFlags('Agent+Skill')], [{ aiAgent: false, skillMd: true }, { aiAgent: true, skillMd: false }]);
eq('a doc written from typeFlags(Workflow skills) is a workflow', U.isWorkflow({ ...R.typeFlags('Workflow skills') }), true);
// Starter-in-main-form model (2026-11-26 rev): the main form makes the Starter skill; the workflow doc wraps it.
const main = { agentName: 'Starter', aiAgent: false, skillMd: true, owner: 'Team A', businessValue: 'bv', linkSuggestion: { agentId: 'x' }, matchingAgent: 'Flow', compatibleAgents: ['a'], analysisResult: { overallRisk: 'low' }, approvalStatus: 'pending' };
const wd = R.buildWorkflowDoc(main, 'Flow', 'st1', ['m1', 'm2'], { internalTool: false });
eq('buildWorkflowDoc: name, flags, ordered members (Starter first)', [wd.agentName, wd.isWorkflow, wd.aiAgent, wd.skillMd, wd.childSkillIds], ['Flow', true, false, true, ['st1', 'm1', 'm2']]);
eq('buildWorkflowDoc: inherits shared fields, drops link request, no self-parent', [wd.owner, wd.businessValue, wd.analysisResult.overallRisk, 'linkSuggestion' in wd, wd.matchingAgent, wd.compatibleAgents], ['Team A', 'bv', 'low', false, '', []]);
eq('buildWorkflowDoc does not mutate the starter doc', [main.agentName, 'isWorkflow' in main, main.matchingAgent], ['Starter', false, 'Flow']);
eq('workflowRequiredSkills: starter first, blanks dropped', R.workflowRequiredSkills('Starter', ['A', '', 'B']), 'Starter, A, B');
eq('a built workflow doc is a workflow with its members', (() => { const d = { id: 'w9', ...wd }; const st = { id: 'st1', agentName: 'Starter', ...SK }; const m1 = { id: 'm1', agentName: 'M1', ...SK }; return [U.isWorkflow(d), names(U.workflowMembers(d, [d, st, m1]))]; })(), [true, ['Starter', 'M1']]);
// Registration "Required fields n of N" (the sticky footer counter)
const blank = { agentName: '', description: '', input: '', output: '', businessValue: '', owner: '', reusable: '', tool: '', requiredSkills: '', workflowName: '', coreAbility: new Set(), relatedRole: new Set(), skills: [] };
eq('requiredFieldStatus: empty form → 0 of 11', R.requiredFieldStatus(blank, false), { done: 0, total: 11 });
eq('requiredFieldStatus: Workflow adds Workflow Name → total 12', R.requiredFieldStatus(blank, true).total, 12);
eq('requiredFieldStatus: whitespace-only is not done', R.requiredFieldStatus({ ...blank, agentName: '   ' }, false).done, 0);
const long = 'x'.repeat(100);
const full = { ...blank, agentName: 'a', description: long, input: 'i', output: 'o', businessValue: long, owner: 'T', reusable: 'Reusable', tool: 't', requiredSkills: 'r', coreAbility: new Set(['x']), relatedRole: new Set(['y']) };
eq('requiredFieldStatus: everything filled → done = total', R.requiredFieldStatus(full, false), { done: 11, total: 11 });
eq('requiredFieldStatus: ability/role accept arrays too', R.requiredFieldStatus({ ...full, coreAbility: ['x'], relatedRole: [] }, false).done, 10);
eq('requiredFieldStatus: Workflow derives Required Skills from the member rows', [R.requiredFieldStatus({ ...full, requiredSkills: '', workflowName: 'W', skills: [{}] }, true).done, R.requiredFieldStatus({ ...full, requiredSkills: '', workflowName: 'W', skills: [] }, true).done], [12, 11]);
eq('requiredFieldStatus: Description / Business Value count only at the 100-char minimum (same as validate)', [R.requiredFieldStatus({ ...full, description: 'short' }, false).done, R.requiredFieldStatus({ ...full, businessValue: 'x'.repeat(99) }, false).done], [10, 10]);
eq('requiredFieldStatus: Reusable with Conditions adds Reuse Conditions', [R.requiredFieldStatus({ ...full, reusable: 'Reusable with Conditions', reuseCondition: '' }, false), R.requiredFieldStatus({ ...full, reusable: 'Reusable with Conditions', reuseCondition: 'when X' }, false)], [{ done: 11, total: 12 }, { done: 12, total: 12 }]);
eq('requiredFieldStatus: HML adds Human Job', [R.requiredFieldStatus({ ...full, hml: true, humanJob: '' }, false), R.requiredFieldStatus({ ...full, hml: true, humanJob: 'review' }, false)], [{ done: 11, total: 12 }, { done: 12, total: 12 }]);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
