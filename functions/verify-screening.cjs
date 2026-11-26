// Screening questionnaire (2026-11-26). node functions/verify-screening.cjs
// Loads the SHIPPED src/lib/screening.js and replays xlsx sheet 3 + the HTML example.
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'src', 'lib');
function loadEsm(file, injected = {}) {
  const code = fs.readFileSync(path.join(SRC, file), 'utf8')
    .replace(/^\s*import\s[^;]*;\s*$/gm, '').replace(/^export\s+/gm, '');
  const names = Object.keys(injected);
  const decls = [...code.matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  return new Function(...names, `${code}\n;return { ${[...new Set(decls)].join(', ')} };`)(...names.map((n) => injected[n]));
}
const S = loadEsm('screening.js');
let pass = 0; let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`}`);
};
const PASS = { C1: 0, C2: 0, C3: 0, C4: 0, C5: 0, C6: 0, C7: 0, C8: 0, C9: 0, C10: 0, C11: 0 };
const ev = (over) => S.evaluate({ ...PASS, ...over });
const codes = (r, k) => r[k].map((x) => x.item);

eq('question count (C1–C11 only; D1–D6 live in the form)', [S.QUESTIONS.length, S.QUESTIONS.filter((q) => q.opts).length], [11, 11]);
eq('all-pass → Low, nothing to fix', (({ level, must, should }) => [level, must.length, should.length])(ev({})), ['Low', 0, 0]);
eq('HTML example → Medium total 11', (({ level, total }) => [level, total])(S.evaluate({ ...PASS, C1: 2, C2: 1, C3: 0, C4: 3 })), ['Medium', 11]);
eq('High at 14', S.evaluate({ ...PASS, C2: 3 }).level, 'High');
eq('Medium at 8', S.evaluate({ ...PASS, C4: 3 }).level, 'Medium');
eq('Low at 6', S.evaluate({ ...PASS, C11: 1 }).level, 'Low');

// sheet 3 — C6..C10 (should only)
eq('C6 b → should C6', codes(ev({ C6: 1 }), 'should'), ['C6']);
eq('C7 b → should C7 + hit', [codes(ev({ C7: 1 }), 'should'), ev({ C7: 1 }).hits.length], [['C7'], 1]);
eq('C7 c → should C7', codes(ev({ C7: 2 }), 'should'), ['C7']);
eq('C8 b/c → should C8', [codes(ev({ C8: 1 }), 'should'), codes(ev({ C8: 2 }), 'should')], [['C8'], ['C8']]);
eq('C9 b → should C9', codes(ev({ C9: 1 }), 'should'), ['C9']);
eq('C10 b/c/d → should C10', [1, 2, 3].map((i) => codes(ev({ C10: i }), 'should')), [['C10'], ['C10'], ['C10']]);
// sheet 3 — C11 by C4 (a none, b KB, c docs, d web, e unknown)
for (const [name, c11] of [['tested-failed', 1], ['not-tested', 2]]) {
  const rows = [0, 1, 2, 3, 4].map((c4) => { const r = ev({ C4: c4, C11: c11 }); return [codes(r, 'must'), codes(r, 'should')]; });
  eq(`C11 ${name}: C4 none → should; C4 KB/docs/web/unknown → must`, rows, [[[], ['C11']], [['C11'], []], [['C11'], []], [['C11'], []], [['C11'], []]]);
}
eq('C11 passed never flags', [0, 1, 2, 3, 4].map((c4) => ev({ C4: c4, C11: 0 }).must.length), [0, 0, 0, 0, 0]);
eq('hits: C1 e + C2 d', ev({ C1: 4, C2: 3 }).hits.length, 2);
eq('hits: C1 c (score 2) is not a main factor', ev({ C1: 2 }).hits.length, 0);

// gates
eq('preGate complete when C1-C9 answered', S.preGate({ ...PASS }), { complete: true, blocked: false, reasons: [] });
eq('preGate: unanswered C5 → incomplete', S.preGate({ ...PASS, C5: undefined }).complete, false);
eq('preGate: C7 "มี" blocks', S.preGate({ ...PASS, C7: 1 }).blocked, true);
eq('preGate: C7 "ยังไม่ได้ตรวจ" blocks', S.preGate({ ...PASS, C7: 2 }).blocked, true);
eq('preGate: C6 not passed does NOT block', S.preGate({ ...PASS, C6: 1 }).blocked, false);
eq('pendingRecheck', S.pendingRecheck({ ...PASS, C6: 1, C9: 1 }), ['C6', 'C9']);
eq('pendingRecheck none', S.pendingRecheck({ ...PASS }), []);
eq('deployGate on empty answers: incomplete, no throw', (({ complete }) => complete)(S.deployGate({})), false);
eq('deployGate all pass', S.deployGate({ ...PASS }), { complete: true, blocked: false, reasons: [] });
eq('deployGate: C10 partial → blocked', S.deployGate({ ...PASS, C10: 1 }).blocked, true);
eq('deployGate: C4 web + C11 untested → blocked', S.deployGate({ ...PASS, C4: 3, C11: 2 }).blocked, true);
eq('deployGate: C4 none + C11 untested → NOT blocked (should only)', S.deployGate({ ...PASS, C4: 0, C11: 2 }).blocked, false);
eq('deployGate: C7 "มี" blocks (legacy items answer C7 at deploy)', S.deployGate({ ...PASS, C7: 1 }).blocked, true);
eq('deployGate: C7 not checked blocks', S.deployGate({ ...PASS, C7: 2 }).blocked, true);
eq('RECO text has no stale D-numbers', Object.values(S.RECO).some((t) => /\bD[1-6]\b/.test(t)), false);
eq('deployGate: unrelated C6 fail does not block', S.deployGate({ ...PASS, C6: 1 }).blocked, false);

const b = S.buildScreening({ ...PASS, C4: 3, C11: 2 });
eq('buildScreening shape', [b.v, b.level, b.must, 'decl' in b, Object.keys(b.answers).length, Object.values(b).includes(undefined)], [1, 'High', ['C11'], false, 11, false]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
