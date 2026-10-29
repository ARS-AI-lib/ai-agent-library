// Offline checks for the Workshop library-star helpers in src/lib/agentUtils.js
//   node functions/verify-workshop-star.cjs
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'lib');
// Same loader as backfill-approve-area.cjs — reads the real client module,
// dropping its ESM imports/exports, so we test the shipped file, not a copy.
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

const utils = loadEsm('agentUtils.js');
const { foldName, libraryStarNames, isLibraryStar } = utils;
let fail = 0;
const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fail += 1; };

if (typeof foldName !== 'function' || typeof libraryStarNames !== 'function' || typeof isLibraryStar !== 'function') {
  console.error('✗ helpers missing from src/lib/agentUtils.js');
  process.exit(1);
}

// foldName — case / whitespace / zero-width folding
ok(foldName('Deck Builder') === foldName('  deck   builder '), 'fold: case + whitespace');
ok(foldName('Deck' + '\u200b' + 'Builder') === foldName('DeckBuilder'), 'fold: zero-width stripped');
ok(foldName('') === '' && foldName(null) === '' && foldName(undefined) === '', 'fold: empty inputs → ""');

// libraryStarNames — a name shared by 2+ docs is ambiguous and resolves to nothing
const names = libraryStarNames([
  { agentName: 'Deck Builder' },
  { agentName: 'deck  builder' },  // duplicate of the above (folded)
  { agentName: 'RCA Fix Assistant' },        // unique
  { agentName: '' },                         // ignored
  {},                                        // ignored (no name)
]);
ok(!names.has(foldName('Deck Builder')), 'index: duplicated name is ambiguous → absent');
ok(names.has(foldName('RCA Fix Assistant')), 'index: unique name kept');

// isLibraryStar — only done + unique match
const star = names;
ok(isLibraryStar({ status: 'done', skillName: 'RCA Fix Assistant' }, star), 'done + match → star');
ok(isLibraryStar({ status: 'done', skillName: 'rca  fix assistant' }, star), 'done + folded match → star');
ok(!isLibraryStar({ status: 'done', skillName: 'Deck Builder' }, star), 'done + ambiguous name → no star');
ok(!isLibraryStar({ status: 'done', skillName: 'Not In Library' }, star), 'done + no match → no star');
ok(!isLibraryStar({ status: 'qa', skillName: 'RCA Fix Assistant' }, star), 'non-done → no star');
ok(!isLibraryStar({ status: 'done' }, star), 'done + missing skillName → no star (no throw)');
ok(!isLibraryStar({ status: 'done', skillName: '   ' }, star), 'done + blank skillName → no star');
ok(!isLibraryStar(null, star), 'null idea → no star (no throw)');

console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);
