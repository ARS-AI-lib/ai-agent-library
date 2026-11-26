// Per-event assessment records + results filtering (2026-11-26). node functions/verify-assessments.cjs
const fs = require('fs');
const path = require('path');
function loadEsm(file, injected = {}) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', file), 'utf8').replace(/^\s*import\s[^;]*;\s*$/gm, '').replace(/^export\s+/gm, '');
  const names = Object.keys(injected);
  const decls = [...code.matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  return new Function(...names, `${code}\n;return { ${[...new Set(decls)].join(', ')} };`)(...names.map((n) => injected[n]));
}
const scr = loadEsm('screening.js');
const dec = loadEsm('declaration.js');
const A = loadEsm('assessments.js', { DECL_FIELDS: dec.DECL_FIELDS, evaluate: scr.evaluate, optionOf: scr.optionOf, normalizeAnswers: scr.normalizeAnswers });
const CFG = scr.DEFAULT_CONFIG;
let pass = 0; let fail = 0;
const eq = (n, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w); ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${n}${ok ? '' : `\n    got  ${JSON.stringify(g)}\n    want ${JSON.stringify(w)}`}`); };

// ── record
const agent = { id: 'a1', agentName: 'Foo', owner: 'Team A', approveArea: ['QA'], description: 'd', tool: 't', llm: 'g', permittedDomains: 'p', prohibitedUses: 'x', requiredSkills: 'r' };
const rec = A.assessmentRecord(agent, 'pre', { C1: 'C1a' }, 'u1', new Date('2026-11-26T05:00:00Z'));
eq('record keys exactly', Object.keys(rec).sort(), ['agentId', 'agentName', 'answers', 'approveArea', 'createdBy', 'decl', 'owner', 'stage', 'year']);
eq('record values', [rec.agentId, rec.agentName, rec.owner, rec.approveArea, rec.stage, rec.createdBy, rec.year], ['a1', 'Foo', 'Team A', ['QA'], 'pre', 'u1', 2026]);
eq('decl copies the 6 declaration fields', Object.keys(rec.decl).sort(), ['description', 'llm', 'permittedDomains', 'prohibitedUses', 'requiredSkills', 'tool']);
eq('decl missing fields are empty strings', Object.values(A.assessmentRecord({ id: 'a' }, 'deploy', {}, 'u').decl).every((v) => v === ''), true);
eq('bangkokYear: 18:00Z on 31 Dec is already next year in Bangkok', [A.bangkokYear(new Date('2026-12-31T18:00:00Z')), A.bangkokYear(new Date('2026-12-31T16:59:00Z'))], [2027, 2026]);
eq('bangkokDay', A.bangkokDay(new Date('2026-11-26T17:30:00Z')), '2026-11-27');

// ── filtering / grouping / csv
const ts = (iso) => ({ toDate: () => new Date(iso) });
const mk = (id, owner, area, iso, stage = 'pre', answers = {}) => ({ id, agentName: `A-${id}`, owner, approveArea: area, stage, answers, decl: {}, createdAt: ts(iso), year: A.bangkokYear(new Date(iso)) });
const R = [
  mk('1', 'Team A', ['QA'], '2026-11-26T16:30:00Z'),          // 2026-11-26 23:30 Bangkok
  mk('2', 'Team B', ['Security'], '2026-10-01T05:00:00Z'),
  mk('3', 'Team A', ['QA', 'Security'], '2025-06-01T05:00:00Z'),
];
const ids = (l) => l.map((r) => r.id);
eq('no filter → all', ids(A.filterRecords(R, {})), ['1', '2', '3']);
eq('year filter', ids(A.filterRecords(R, { year: 2025 })), ['3']);
eq('period end date is inclusive of that day (23:30 Bangkok)', ids(A.filterRecords(R, { from: '2026-11-01', to: '2026-11-26' })), ['1']);
eq('period start/end exclude outside records', ids(A.filterRecords(R, { from: '2026-10-02', to: '2026-11-25' })), []);
eq('year + period both apply', ids(A.filterRecords(R, { year: 2026, from: '2026-01-01', to: '2026-10-31' })), ['2']);
eq('owner filter', ids(A.filterRecords(R, { owner: 'Team B' })), ['2']);
eq('area filter matches any overlap', ids(A.filterRecords(R, { area: 'Security' })), ['2', '3']);
const g = A.groupByOwner(R);
eq('groupByOwner: groups ordered by newest row; rows newest first', g.map((x) => [x.owner, ids(x.rows)]), [['Team A', ['1', '3']], ['Team B', ['2']]]);
const csv = A.recordCsv(CFG, [mk('1', 'Team A', ['QA'], '2026-11-26T05:00:00Z', 'deploy', { C10: 'C10a', C11: 'C11x' })]);
eq('csv headers: fixed + 6 declaration + one per question', csv.headers.slice(0, 7), ['Date', 'Owner', 'Agent/Skill', 'Stage', 'Level', 'Total', 'Must fix']);
eq('csv has a column per question code', csv.headers.slice(-11), CFG.questions.map((q) => q.code));
const cRow = csv.rows[0];
eq('csv answer text; removed option shows (removed option)', [cRow[csv.headers.indexOf('C10')], cRow[csv.headers.indexOf('C11')]], [CFG.questions.find((q) => q.id === 'C10').options[0].th, '(removed option)']);
eq('csv unanswered question is empty', cRow[csv.headers.indexOf('C1')], '');
// csv formula injection: text cells starting with = + - @ are neutralised
const evil = { ...mk('9', '=SUM(A1)', [], '2026-11-26T05:00:00Z'), agentName: '@cmd', decl: { description: '+1+1', tool: '-2' } };
const ec = A.recordCsv(CFG, [evil]);
eq('csv: formula-looking owner/agent/declaration cells are prefixed with a quote', [ec.rows[0][1], ec.rows[0][2], ec.rows[0][ec.headers.indexOf('Description')], ec.rows[0][ec.headers.indexOf('Permitted Tools')]], ["'=SUM(A1)", "'@cmd", "'+1+1", "'-2"]);
eq('csv: ordinary text is unchanged', A.recordCsv(CFG, [mk('8', 'Team A', [], '2026-11-26T05:00:00Z')]).rows[0][1], 'Team A');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
