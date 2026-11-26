// Validation of the editable questionnaire (2026-11-26). node functions/verify-screening-config.cjs
const fs = require('fs');
const path = require('path');
function loadEsm(file) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', file), 'utf8').replace(/^\s*import\s[^;]*;\s*$/gm, '').replace(/^export\s+/gm, '');
  const decls = [...code.matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  return new Function(`${code}\n;return { ${[...new Set(decls)].join(', ')} };`)();
}
const { DEFAULT_CONFIG } = loadEsm('screening.js');
const { validateScreeningConfig } = require('./screeningConfigRules');
let pass = 0; let fail = 0;
const eq = (n, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w); ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${n}${ok ? '' : ` got ${JSON.stringify(g)} want ${JSON.stringify(w)}`}`); };
const clone = () => JSON.parse(JSON.stringify(DEFAULT_CONFIG));
const bad = (mut) => { const c = clone(); mut(c); return typeof validateScreeningConfig(c) === 'string'; };

eq('DEFAULT_CONFIG is valid', validateScreeningConfig(DEFAULT_CONFIG), null);
eq('no questions → error', bad((c) => { c.questions = []; }), true);
eq('duplicate question id → error', bad((c) => { c.questions[1].id = c.questions[0].id; }), true);
eq('duplicate option id (same question) → error', bad((c) => { c.questions[0].options[1].id = c.questions[0].options[0].id; }), true);
eq('duplicate option id across questions → error', bad((c) => { c.questions[1].options[0].id = c.questions[0].options[0].id; }), true);
eq('question without options → error', bad((c) => { c.questions[0].options = []; }), true);
eq('score -1 / 101 / 2.5 → error', [bad((c) => { c.questions[0].options[0].score = -1; }), bad((c) => { c.questions[0].options[0].score = 101; }), bad((c) => { c.questions[0].options[0].score = 2.5; })], [true, true, true]);
eq('bad stage → error', bad((c) => { c.questions[0].stage = 'later'; }), true);
eq('bad fix value → error', bad((c) => { c.questions[0].options[0].fix = 'maybe'; }), true);
eq('non-boolean block flag → error', bad((c) => { c.questions[0].options[0].blocksPre = 'yes'; }), true);
eq('thresholds md >= hi → error', bad((c) => { c.thresholds = { md: 10, hi: 10 }; }), true);
eq('empty Thai text → error', bad((c) => { c.questions[0].th = '  '; }), true);
eq('no pre-stage question → error (registration needs one)', bad((c) => { c.questions.forEach((q) => { q.stage = 'deploy'; }); }), true);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
