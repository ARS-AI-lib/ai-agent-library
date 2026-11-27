// Declaration fields (2026-11-26). node functions/verify-declaration.cjs
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'declaration.js'), 'utf8').replace(/^export\s+/gm, '');
const decls = [...code.matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
const D = new Function(`${code}\n;return { ${[...new Set(decls)].join(', ')} };`)();
let fail = 0;
const eq = (n, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fail++; console.log(`${ok ? '✓' : '✗'} ${n}${ok ? '' : ` got ${JSON.stringify(g)} want ${JSON.stringify(w)}`}`); };
const ALL = ['permittedDomains', 'prohibitedUses', 'tool', 'requiredSkills', 'llm'];
const NONE = { permittedDomains: 'ไม่จำกัด domain', prohibitedUses: 'ไม่มีข้อห้าม', tool: 'ไม่ใช้ tool', requiredSkills: 'ไม่ต้อง', llm: 'ยังไม่ได้ทดสอบ' };
eq('all five fields required', D.DECL_FIELDS.every((f) => f.required) && D.DECL_FIELDS.map((f) => f.key), ALL);
eq('none phrases exact', Object.fromEntries(D.DECL_FIELDS.map((f) => [f.key, f.none])), NONE);
for (const k of ALL) {
  eq(`isNoneValue ${k} exact`, D.isNoneValue(k, NONE[k]), true);
  eq(`isNoneValue ${k} trims`, D.isNoneValue(k, `  ${NONE[k]} `), true);
  eq(`isNoneValue ${k} other text`, D.isNoneValue(k, 'abc'), false);
  eq(`isNoneValue ${k} other field phrase`, D.isNoneValue(k, NONE[ALL.find((x) => x !== k)]), false);
}
eq('isNoneValue unknown key', D.isNoneValue('zzz', 'x'), false);
eq('empty doc misses all five', D.missingDeclaration({}), ALL);
eq('whitespace counts as missing', D.missingDeclaration({ tool: '  ' }).includes('tool'), true);
eq('text or none phrase fills', D.missingDeclaration({ permittedDomains: 'DGL', prohibitedUses: NONE.prohibitedUses, tool: 'n8n', requiredSkills: 'ไม่ต้อง', llm: 'G' }), []);
eq('declarationPatch fills only missing, all five', D.declarationPatch({ tool: 'own' }, { tool: 'parent', llm: ' G ', permittedDomains: 'd', prohibitedUses: 'p', requiredSkills: ' r ' }),
  { permittedDomains: 'd', prohibitedUses: 'p', requiredSkills: 'r', llm: 'G' });
eq('declarationPatch never writes undefined', Object.values(D.declarationPatch({}, {})).includes(undefined), false);
process.exit(fail ? 1 : 0);
