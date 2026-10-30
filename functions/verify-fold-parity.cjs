// Parity guard: the two independent copies of foldName must stay equivalent.
//   node functions/verify-fold-parity.cjs
//
// Client side : src/lib/agentUtils.js            (ESM — loaded by stripping
//               its import/export lines, so we test the shipped file)
// Server side : functions/portfolioAdoptionRules.js (plain CJS, "pure helpers
//               only" — safe to require with no Firestore)
//
// Why this exists: the Workshop library star folds names with the client copy,
// while the Portfolio adoption trigger folds them with the server copy. They are
// byte-equivalent today and nothing else enforces that. This test is the thing
// that keeps them that way — see the design doc, "Approaches".
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'lib');
// Same loader as verify-workshop-star.cjs / backfill-approve-area.cjs.
function loadEsm(file, injected = {}) {
  const code = fs
    .readFileSync(path.join(SRC, file), 'utf8')
    .replace(/^\s*import\s[^;]*;\s*$/gm, '')
    .replace(/^export\s+/gm, '');
  const names = Object.keys(injected);
  const decls = [...code.matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  const body = `${code}\n;return { ${[...new Set(decls)].join(', ')} };`;
  return new Function(...names, body)(...names.map((n) => injected[n]));
}

const { foldName: clientFold } = loadEsm('agentUtils.js');
const { foldName: serverFold } = require('./portfolioAdoptionRules.js');

if (typeof clientFold !== 'function' || typeof serverFold !== 'function') {
  console.error('✗ foldName missing from one side');
  process.exit(1);
}

// The zero-width / BOM characters are BUILT from codepoints instead of being
// pasted in raw: a literal U+200B is invisible in every editor and silently
// disappears on copy, after which the cases still print ✓ while testing nothing.
const ZW = {
  space: String.fromCharCode(0x200b),
  joiner: String.fromCharCode(0x200d),
  nonJoiner: String.fromCharCode(0x200c),
  bom: String.fromCharCode(0xfeff),
};
const CASES = [
  ['Deck Builder', 'plain'],
  ['  deck   builder ', 'case + collapsed whitespace'],
  ['Deck\tBuilder', 'tab'],
  ['Deck\nBuilder', 'newline'],
  [`Deck${ZW.space}Builder`, 'zero-width space'],
  [`Deck${ZW.joiner}Builder`, 'zero-width joiner'],
  [`Deck${ZW.nonJoiner}Builder`, 'zero-width non-joiner'],
  [`${ZW.bom}Deck Builder`, 'BOM'],
  ['', 'empty string'],
  [null, 'null'],
  [undefined, 'undefined'],
  [0, 'number 0'],
  ['   ', 'whitespace only'],
  ['ตัวช่วยทดสอบ', 'Thai text'],
  ['  ตัวช่วย   ทดสอบ ', 'Thai + whitespace'],
];

let fail = 0;
for (const [input, label] of CASES) {
  const c = clientFold(input);
  const s = serverFold(input);
  const same = c === s;
  if (!same) fail += 1;
  console.log(`${same ? '✓' : '✗'} ${label}: client=${JSON.stringify(c)} server=${JSON.stringify(s)}`);
}
console.log(fail ? `\n${fail} divergent` : `\nall ${CASES.length} cases agree`);
process.exit(fail ? 1 : 0);
