// Screening engine over a config object (2026-11-26). node functions/verify-screening.cjs
// Loads the SHIPPED src/lib/screening.js; replays the bank's xlsx sheet 3 on DEFAULT_CONFIG,
// plus config-edit cases (score change, removed option, per-option blocking, legacy index answers).
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
const CFG = S.DEFAULT_CONFIG;
let pass = 0; let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`}`);
};
// answers by option id; PASS = first (best) option of every question
const PASS = Object.fromEntries(CFG.questions.map((q) => [q.id, q.options[0].id]));
const ev = (over, cfg = CFG) => S.evaluate(cfg, { ...PASS, ...over });
const items = (r, k) => r[k].map((x) => x.item);
const clone = () => JSON.parse(JSON.stringify(CFG));

eq('11 questions, 6 pre-stage-free: C1–C9 pre, C10–C11 deploy', [CFG.questions.length, S.questionsFor(CFG, 'pre').length, S.questionsFor(CFG, 'deploy').length], [11, 9, 2]);
eq('all-pass → Low, nothing to fix', (({ level, must, should }) => [level, must.length, should.length])(ev({})), ['Low', 0, 0]);
eq('HTML example (C1:c C2:b C3:a C4:d) → Medium total 11', (({ level, total }) => [level, total])(ev({ C1: 'C1c', C2: 'C2b', C3: 'C3a', C4: 'C4d' })), ['Medium', 11]);
eq('High at 14 (C2 d)', ev({ C2: 'C2d' }).level, 'High');
eq('Medium at 8 (C4 d)', ev({ C4: 'C4d' }).level, 'Medium');
eq('Low at 6 (C11 b)', ev({ C11: 'C11b' }).level, 'Low');
eq('level is null until every pre question is answered', S.evaluate(CFG, { ...PASS, C5: undefined }).level, null);

// sheet 3 — should / must per question (config: C11 b/c are "must")
eq('C6 b → should C6', items(ev({ C6: 'C6b' }), 'should'), ['C6']);
eq('C7 b → should C7 + hit', [items(ev({ C7: 'C7b' }), 'should'), ev({ C7: 'C7b' }).hits.length], [['C7'], 1]);
eq('C8 b/c, C9 b → should', [items(ev({ C8: 'C8b' }), 'should'), items(ev({ C8: 'C8c' }), 'should'), items(ev({ C9: 'C9b' }), 'should')], [['C8'], ['C8'], ['C9']]);
eq('C10 b/c/d → should C10', ['C10b', 'C10c', 'C10d'].map((o) => items(ev({ C10: o }), 'should')), [['C10'], ['C10'], ['C10']]);
eq('C11 b/c (failed / untested) → must C11', [items(ev({ C11: 'C11b' }), 'must'), items(ev({ C11: 'C11c' }), 'must')], [['C11'], ['C11']]);
eq('C11 passed never flags', ev({ C11: 'C11a' }).must.length, 0);
eq('hits: C1 e + C2 d', ev({ C1: 'C1e', C2: 'C2d' }).hits.length, 2);
eq('hits: C1 c (score 2) is not a main factor', ev({ C1: 'C1c' }).hits.length, 0);

// gates (per option flags)
eq('preGate complete when all pre questions answered', S.preGate(CFG, { ...PASS }), { complete: true, blocked: false, reasons: [] });
eq('preGate: unanswered C5 → incomplete', S.preGate(CFG, { ...PASS, C5: undefined }).complete, false);
eq('preGate: C7 "มี" / "ยังไม่ได้ตรวจ" block', [S.preGate(CFG, { ...PASS, C7: 'C7b' }).blocked, S.preGate(CFG, { ...PASS, C7: 'C7c' }).blocked], [true, true]);
eq('preGate: C6 not passed does NOT block', S.preGate(CFG, { ...PASS, C6: 'C6b' }).blocked, false);
eq('pendingRecheck', S.pendingRecheck(CFG, { ...PASS, C6: 'C6b', C9: 'C9b' }), ['C6', 'C9']);
eq('deployGate on empty answers: incomplete, no throw', S.deployGate(CFG, {}).complete, false);
eq('deployGate all pass', S.deployGate(CFG, { ...PASS }), { complete: true, blocked: false, reasons: [] });
eq('deployGate: C10 partial → blocked', S.deployGate(CFG, { ...PASS, C10: 'C10b' }).blocked, true);
eq('deployGate: C11 untested → blocked', S.deployGate(CFG, { ...PASS, C11: 'C11c' }).blocked, true);
eq('deployGate: C7 not checked → blocked (legacy items answer C7 at deploy)', S.deployGate(CFG, { ...PASS, C7: 'C7c' }).blocked, true);
eq('deployGate: unrelated C6 fail does not block', S.deployGate(CFG, { ...PASS, C6: 'C6b' }).blocked, false);
eq('RECO/advice text has no stale D-numbers', CFG.questions.some((q) => /\bD[1-6]\b/.test(q.advice || '')), false);

// config edits
const c2 = clone(); c2.questions.find((q) => q.id === 'C4').options.find((o) => o.id === 'C4d').score = 2;
eq('score edit 8→2 lowers total by 6', ev({ C4: 'C4d' }, c2).total, ev({ C4: 'C4d' }).total - 6);
const c3 = clone(); c3.questions.find((q) => q.id === 'C6').options.find((o) => o.id === 'C6b').blocksPre = true;
eq('blocksPre flag on C6b makes preGate block', [S.preGate(c3, { ...PASS, C6: 'C6b' }).blocked, S.preGate(CFG, { ...PASS, C6: 'C6b' }).blocked], [true, false]);
const c4 = clone(); c4.questions.find((q) => q.id === 'C11').options = c4.questions.find((q) => q.id === 'C11').options.filter((o) => o.id !== 'C11b');
eq('deleted option: optionOf null, scores 0, counts as unanswered', [S.optionOf(c4, 'C11', 'C11b'), S.evaluate(c4, { ...PASS, C11: 'C11b' }).total, S.deployGate(c4, { ...PASS, C11: 'C11b' }).complete], [null, 0, false]);
const c5 = clone(); c5.thresholds = { md: 3, hi: 8 };
eq('thresholds are configurable', ev({ C4: 'C4d' }, c5).level, 'High');

// legacy v1 answers stored as option INDEXES
eq('normalizeAnswers maps legacy indexes to ids', S.normalizeAnswers(CFG, { C4: 3, C11: 2, C1: 'C1a' }), { C4: 'C4d', C11: 'C11c', C1: 'C1a' });
eq('legacy index answers evaluate like the ids', S.evaluate(CFG, S.normalizeAnswers(CFG, { ...Object.fromEntries(Object.keys(PASS).map((k) => [k, 0])), C4: 3 })).total, ev({ C4: 'C4d' }).total);

// stored record + stage results
const b = S.buildScreening(CFG, { ...PASS, C4: 'C4d', C11: 'C11c' });
eq('buildScreening shape (v2, ids, no undefined)', [b.v, b.level, b.must, Object.keys(b.answers).length, Object.values(b).includes(undefined)], [2, 'High', ['C11'], 11, false]);
const sc0 = S.buildScreening(CFG, { ...PASS, C4: 'C4d' });
const r0 = S.stageResults(CFG, { ...sc0, deployAt: null });
eq('stageResults: before deploy → pre only', [r0.pre.level, r0.pre.total, r0.deploy], ['Medium', 8, null]);
const sc1 = S.buildScreening(CFG, { ...PASS, C10: 'C10b', C6: 'C6b' });
const r1 = S.stageResults(CFG, { ...sc1, deployAt: { seconds: 1 } });
eq('stageResults: deploy rows C10/C11 with pass flag', r1.deploy.rows.map((r) => [r.code, r.ok]), [['C10', false], ['C11', true]]);
eq('stageResults: pre part ignores deploy questions (C6 is a pre should-fix)', [r1.pre.level, r1.pre.should], ['Low', ['C6']]);
eq('stageResults on empty/legacy input is null', [S.stageResults(CFG, null), S.stageResults(CFG, {})], [null, null]);
eq('stageResults reads legacy v1 index answers', S.stageResults(CFG, { answers: { C1: 0, C2: 0, C3: 0, C4: 3, C5: 0, C6: 0, C7: 0, C8: 0, C9: 0 }, deployAt: null }).pre.level, 'Medium');

// questionsToAsk: what the deploy dialog must show (new pre questions must not lock old agents)
const ids = (a) => a.map((q) => (typeof q === 'string' ? q : q.id));
eq('questionsToAsk: no stored screening → every pre + deploy question', S.questionsToAsk(CFG, {}, false).length, 11);
eq('questionsToAsk: stored all-pass → only deploy questions', S.questionsToAsk(CFG, { ...PASS }, true), ['C10', 'C11']);
eq('questionsToAsk: recheck + deploy', S.questionsToAsk(CFG, { ...PASS, C6: 'C6b' }, true), ['C6', 'C10', 'C11']);
const cNew = clone(); cNew.questions.splice(3, 0, { id: 'qNEW', code: 'N1', group: 'g', th: 'ใหม่', en: 'new', advice: '', stage: 'pre', options: [{ id: 'oNEW', th: 'ok', en: 'ok', score: 0, fix: 'none', blocksPre: false, blocksDeploy: false }] });
eq('questionsToAsk: a pre question added AFTER registration is asked at deploy', S.questionsToAsk(cNew, { ...PASS }, true), ['qNEW', 'C10', 'C11']);
eq('questionsToAsk: a removed-option answer is asked again', S.questionsToAsk(c4, { ...PASS, C11: 'C11b' }, true).includes('C11'), true);
// partial level for STORED data (a question added later must not blank every level)
eq('evaluate partial: level computed over the answered pre questions', S.evaluate(cNew, { ...PASS, C4: 'C4d' }, 'pre', { partial: true }).level, 'Medium');
eq('evaluate (strict) is still null while a pre question is unanswered', S.evaluate(cNew, { ...PASS, C4: 'C4d' }, 'pre').level, null);
eq('stageResults uses the partial level', S.stageResults(cNew, { answers: { ...PASS, C4: 'C4d' }, deployAt: null }).pre.level, 'Medium');
eq('stageResults: deploy result carries the overall score', [r1.deploy.total, r1.pre.total], [S.evaluate(CFG, { ...PASS, C10: 'C10b', C6: 'C6b' }).total, S.evaluate(CFG, { ...PASS, C6: 'C6b' }, 'pre').total]);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
