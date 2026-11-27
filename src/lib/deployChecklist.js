// Package checklist shown at "Request deploy" (2026-11-26): what the Agent/Skill package
// contains, per Tier. required = must be ticked before the assessment step.
// ⛔ Single source — do not copy these lists elsewhere.
const LABEL = {
  readme: 'Read me / Instruction',
  template: 'Template / Component file',
  no_secret: 'No secret / Real data',
  rbac: 'Role-Based Access Control',
  prompt_injection: 'Prompt injection',
  guardrail: 'Guardrail',
  pii: 'PII screening',
  audit_log: 'Audit log',
  cab: 'CAB Approved',
};

const SPEC = {
  T1: { readme: true, template: false, no_secret: true },
  T2: { readme: false, template: false, rbac: true, prompt_injection: false, guardrail: false, audit_log: false },
  T3: { readme: true, template: false, no_secret: true, guardrail: false, pii: true },
  T4: { readme: false, template: false, rbac: true, prompt_injection: true, guardrail: true, pii: true, audit_log: true, cab: true },
};

export const CHECKLIST = Object.fromEntries(
  Object.entries(SPEC).map(([tier, items]) => [
    tier,
    Object.entries(items).map(([id, required]) => ({ id, label: LABEL[id], required })),
  ]),
);

export function checklistFor(tier) {
  return CHECKLIST[tier] || [];
}

export function checklistGate(tier, checked) {
  const have = new Set(checked || []);
  const missing = checklistFor(tier).filter((i) => i.required && !have.has(i.id)).map((i) => i.id);
  return { complete: missing.length === 0, missing };
}

export function buildDeployChecklist(tier, checked) {
  const valid = new Set(checklistFor(tier).map((i) => i.id));
  return { tier, checked: (checked || []).filter((id) => valid.has(id)) };
}
