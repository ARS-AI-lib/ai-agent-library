// Deploy package checklist per Tier (2026-11-26). node functions/verify-deploy-checklist.cjs
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'src', 'lib');
function loadEsm(file) {
  const code = fs.readFileSync(path.join(SRC, file), 'utf8').replace(/^\s*import\s[^;]*;\s*$/gm, '').replace(/^export\s+/gm, '');
  const decls = [...code.matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  return new Function(`${code}\n;return { ${[...new Set(decls)].join(', ')} };`)();
}
const C = loadEsm('deployChecklist.js');
let pass = 0; let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`}`);
};
const ids = (t) => C.checklistFor(t).map((i) => i.id);
const req = (t) => C.checklistFor(t).filter((i) => i.required).map((i) => i.id);

eq('T1 items', ids('T1'), ['readme', 'template', 'no_secret']);
eq('T2 items', ids('T2'), ['readme', 'template', 'rbac', 'prompt_injection', 'guardrail', 'audit_log']);
eq('T3 items', ids('T3'), ['readme', 'template', 'no_secret', 'guardrail', 'pii']);
eq('T4 items', ids('T4'), ['readme', 'template', 'rbac', 'prompt_injection', 'guardrail', 'pii', 'audit_log', 'cab']);
eq('T1 required', req('T1'), ['readme', 'no_secret']);
eq('T2 required', req('T2'), ['rbac']);
eq('T3 required', req('T3'), ['readme', 'no_secret', 'pii']);
eq('T4 required', req('T4'), ['rbac', 'prompt_injection', 'guardrail', 'pii', 'audit_log', 'cab']);
eq('labels', C.checklistFor('T4').map((i) => i.label), ['Read me / Instruction', 'Template / Component file', 'Role-Based Access Control', 'Prompt injection', 'Guardrail', 'PII screening', 'Audit log', 'CAB Approved']);
eq('T1 missing no_secret', C.checklistGate('T1', ['readme']), { complete: false, missing: ['no_secret'] });
eq('T1 complete', C.checklistGate('T1', ['readme', 'no_secret']).complete, true);
eq('T2 optional items only → still needs rbac', C.checklistGate('T2', ['readme', 'guardrail']).missing, ['rbac']);
eq('foreign ids ignored (T1 given pii)', C.checklistGate('T1', ['pii', 'cab']).missing, ['readme', 'no_secret']);
eq('unknown tier → no list, complete', [C.checklistFor('T9'), C.checklistGate('T9', []).complete], [[], true]);
eq('buildDeployChecklist keeps only valid ids', C.buildDeployChecklist('T1', ['readme', 'pii', 'no_secret']), { tier: 'T1', checked: ['readme', 'no_secret'] });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
