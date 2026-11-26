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
