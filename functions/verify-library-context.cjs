// Offline checks for libraryContextRules.js.   node functions/verify-library-context.cjs
const { summarizeTeam, MAX_EXAMPLES } = require('./libraryContextRules');
let fail = 0;
const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fail += 1; };
const A = (id, owner, area, cat, extra = {}) => ({ id, agentName: id, owner, approveArea: area, category: cat, approvalStatus: 'approved', ...extra });
const lib = [
  A('a1', 'Ai-Phabet', ['Business & Product'], ['Lending & Credit', 'Data & Analytics']),
  A('a2', 'Ai-Phabet', ['Business & Product'], ['Data & Analytics']),
  A('a3', 'Ai-Phabet', ['Business & Product'], ['Data & Analytics']),
  A('a4', 'Ai-Phabet', ['Architecture'], ['Software Development']),
  A('a5', 'Ai-Phabet', ['Business & Product'], ['Data & Analytics'], { archived: true }),
  A('a6', 'Ai-Phabet', ['Business & Product'], ['Data & Analytics'], { approvalStatus: 'pending' }),
  A('b1', 'Other', ['QA'], ['Testing']),
];
const s = summarizeTeam(lib, ' Ai-Phabet ', { products: ['Lending & Credit'] });
ok(s.n === 4, 'only approved + live items of that team count');
ok(s.dominantArea === 'Business & Product', 'dominant area at 3/4 = 75% ≥ 60%');
ok(!('Lending & Credit' in s.categoryCounts) && s.dominantCategory === 'Data & Analytics', 'product tags excluded; discipline dominant');
ok(summarizeTeam(lib, 'Ai-Phabet', { excludeId: 'a1' }).n === 3, 'leave-one-out excludes the judged item');
const split = [A('x1', 'T', ['QA'], []), A('x2', 'T', ['Security'], [])];
ok(summarizeTeam(split, 'T').dominantArea === null, 'no dominant area when the team is split 50/50');
ok(summarizeTeam(lib, '') === null && summarizeTeam(lib, 'Nobody') === null, 'empty or unknown team → null');
const big = Array.from({ length: 20 }, (_, i) => A(`z${i}`, 'Big', ['QA'], []));
ok(summarizeTeam(big, 'Big').examples.length === MAX_EXAMPLES, `examples capped at ${MAX_EXAMPLES}`);
console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);
