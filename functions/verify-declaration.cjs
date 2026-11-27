// Declaration fields (2026-11-26). node functions/verify-declaration.cjs
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'declaration.js'), 'utf8').replace(/^export\s+/gm, '');
const decls = [...code.matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
const D = new Function(`${code}\n;return { ${[...new Set(decls)].join(', ')} };`)();
let fail = 0;
const eq = (n, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fail++; console.log(`${ok ? '✓' : '✗'} ${n}${ok ? '' : ` got ${JSON.stringify(g)} want ${JSON.stringify(w)}`}`); };
eq('empty doc misses only the REQUIRED fields (tool, requiredSkills)', D.missingDeclaration({}), ['tool', 'requiredSkills']);
eq('Domains / Prohibited / Models are optional', D.DECL_FIELDS.filter((f) => !f.required).map((f) => f.key), ['permittedDomains', 'prohibitedUses', 'llm']);
eq('whitespace counts as missing', D.missingDeclaration({ tool: '  ' }).includes('tool'), true);
eq('filled fields are not missing', D.missingDeclaration({ tool: 'n8n' }), ['requiredSkills']);
// the patch for a child must only fill what the CHILD lacks, never overwrite what it has
eq('declarationPatch fills only missing required keys', D.declarationPatch({ tool: 'own' }, { tool: 'parent', llm: ' G ', permittedDomains: 'd', requiredSkills: ' r ' }),
  { requiredSkills: 'r' });
eq('declarationPatch never writes undefined', Object.values(D.declarationPatch({}, {})).includes(undefined), false);
process.exit(fail ? 1 : 0);
