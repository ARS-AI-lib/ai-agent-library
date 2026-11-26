// Registration "Type" → the flags written on the new agent doc (single source).
// Workflow skills is a Skill-class item (tier T1/T3) marked isWorkflow:true; its members are
// paired skills (see isWorkflow / workflowMembers in agentUtils.js).
export const WORKFLOW = 'Workflow skills';

export function typeFlags(type) {
  if (type === WORKFLOW) return { aiAgent: false, skillMd: true, isWorkflow: true };
  if (type === 'Skill') return { aiAgent: false, skillMd: true };
  // Agent+Skill: the MAIN doc is a pure Agent — each paired skill becomes its own Skill doc.
  return { aiAgent: true, skillMd: false };
}

// Workflow skills (rev 2026-11-26): the MAIN form creates the Starter skill (a plain Skill whose
// matchingAgent = workflow name); this builds the wrapping workflow doc from the same payload.
// Members are listed in step order, Starter first. No link request, no self-parent.
export function buildWorkflowDoc(mainDoc, workflowName, starterId, memberIds, extra = {}) {
  const { linkSuggestion, ...rest } = mainDoc;
  return {
    ...rest,
    ...typeFlags(WORKFLOW),
    agentName: workflowName,
    matchingAgent: '',
    compatibleAgents: [],
    childSkillIds: [starterId, ...memberIds],
    ...extra,
  };
}

// Required Skills (D5) of a workflow = Starter + the other member names, in order.
export function workflowRequiredSkills(starterName, memberNames) {
  return [starterName, ...memberNames].map((n) => String(n || '').trim()).filter(Boolean).join(', ');
}

// "Required fields: n of N" in the registration footer. Counts only the always-required keys;
// Workflow skills derives Required Skills from its member rows and adds Workflow Name.
const REQUIRED_TEXT = ['agentName', 'description', 'input', 'output', 'businessValue', 'owner', 'reusable', 'tool'];
const filled = (v) => String(v ?? '').trim() !== '';
const nonEmpty = (v) => (v instanceof Set ? v.size > 0 : Array.isArray(v) ? v.length > 0 : false);

export function requiredFieldStatus(form, isWorkflow) {
  const checks = [
    ...REQUIRED_TEXT.map((k) => filled(form[k])),
    nonEmpty(form.coreAbility),
    nonEmpty(form.relatedRole),
    isWorkflow ? (form.skills || []).length >= 1 : filled(form.requiredSkills),
  ];
  if (isWorkflow) checks.push(filled(form.workflowName));
  return { done: checks.filter(Boolean).length, total: checks.length };
}
