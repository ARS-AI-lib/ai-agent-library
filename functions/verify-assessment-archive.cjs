// Archive year guard (2026-11-26). node functions/verify-assessment-archive.cjs
const { checkArchiveYear, archiveDocId } = require('./assessmentArchiveRules');
let pass = 0; let fail = 0;
const eq = (n, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w); ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${n}${ok ? '' : ` got ${JSON.stringify(g)} want ${JSON.stringify(w)}`}`); };
eq('current year is rejected', typeof checkArchiveYear(2026, 2026), 'string');
eq('future year is rejected', typeof checkArchiveYear(2027, 2026), 'string');
eq('past year is ok', checkArchiveYear(2025, 2026), null);
eq('string year is rejected', typeof checkArchiveYear('2025', 2026), 'string');
eq('non-integer / NaN / undefined rejected', [checkArchiveYear(2025.5, 2026), checkArchiveYear(NaN, 2026), checkArchiveYear(undefined, 2026)].map((x) => typeof x), ['string', 'string', 'string']);
eq('implausibly old year rejected', typeof checkArchiveYear(1999, 2026), 'string');
eq('archiveDocId is the year as a string', archiveDocId(2025), '2025');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
