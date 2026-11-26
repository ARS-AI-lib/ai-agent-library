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
