// Assessment backfill rules. node functions/verify-assessment-backfill.cjs
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
const T = loadEsm('tier.js');
const R = require('./assessmentBackfillRules');
const CFG = S.DEFAULT_CONFIG;
let pass = 0; let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`}`);
};
const PASS = Object.fromEntries(CFG.questions.map((q) => [q.id, q.options[0].id]));
let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const V = (over, tier) => R.backfillVerdict({ config: CFG, answers: { ...PASS, ...over }, tier });

// verdict
eq('T1 + blocking C7 → fail [C7]', (({ pass: p, reasons }) => [p, reasons])(V({ C7: 'C7b' }, 'T1')), [false, ['C7']]);
eq('T1 + High only → pass', V({ C2: 'C2d' }, 'T1').pass, true);
eq('T2 + High only → fail [High]', (({ pass: p, reasons }) => [p, reasons])(V({ C2: 'C2d' }, 'T2')), [false, ['High']]);
eq('T4 all-pass → pass', V({}, 'T4').pass, true);
eq('incomplete → complete false', R.evaluateAnswers(CFG, { ...PASS, C3: 'nope' }).complete, false);

// drift
let drift = true;
for (let i = 0; i < 200; i++) {
  const a = Object.fromEntries(CFG.questions.map((q) => [q.id, q.options[Math.floor(rnd() * q.options.length)].id]));
  const x = R.evaluateAnswers(CFG, a); const y = S.evaluate(CFG, a);
  if (x.total !== y.total || x.level !== y.level) drift = false;
}
eq('evaluateAnswers matches screening.evaluate (200 random)', drift, true);
const fixtures = [];
[true, false].forEach((aiAgent) => [true, false].forEach((skillMd) => [true, false, undefined].forEach((customerFacing) => [true, undefined].forEach((internalUse) => fixtures.push({ aiAgent, skillMd, customerFacing, internalUse })))));
eq('getTier port equals tier.js on fixtures', fixtures.every((f) => R.getTier(f) === T.getTier(f)), true);

// scope
const base = { id: 'a', approvalStatus: 'approved', devProgress: 95, aiAgent: true, skillMd: false };
eq('progress 89 → false', R.inBackfillScope({ ...base, devProgress: 89 }, []), false);
eq('progress 90 → true', R.inBackfillScope({ ...base, devProgress: 90 }, []), true);
eq('"95%" → true', R.inBackfillScope({ ...base, devProgress: '95%' }, []), true);
eq('archived → false', R.inBackfillScope({ ...base, archived: true }, []), false);
const parent = { id: 'p', agentName: 'P', approvalStatus: 'approved', aiAgent: true, skillMd: false, childSkillIds: ['s'] };
const sub = { ...base, id: 's', aiAgent: false, skillMd: true };
eq('paired sub-skill → false', R.inBackfillScope(sub, [parent, sub]), false);

// status
eq('assessment.status wins', R.backfillStatus({ assessment: { status: 'fail' }, screening: { deployAt: 1, answers: PASS } }, CFG), 'fail');
eq('screening deployAt + C7 → fail', R.backfillStatus({ aiAgent: true, screening: { deployAt: 1, answers: { ...PASS, C7: 'C7b' } } }, CFG), 'fail');
eq('screening deployAt all pass → pass', R.backfillStatus({ aiAgent: true, screening: { deployAt: 1, answers: PASS } }, CFG), 'pass');
eq('nothing → not_done', R.backfillStatus({}, CFG), 'not_done');

// digests
const d = R.creatorDigests([
  { agent: { id: '1', agentName: 'A', creatorEmails: ['Bob@arise.tech'], devProgress: 95 }, status: 'not_done' },
  { agent: { id: '2', agentName: 'B', creatorEmails: ['bob@arise.tech'], devProgress: 100 }, status: 'not_done' },
  { agent: { id: '3', agentName: 'C', creatorEmails: ['bob@arise.tech'] }, status: 'pass' },
  { agent: { id: '4', agentName: 'D', createdBy: 'u1' }, status: 'not_done' },
]);
eq('digest: 1 digest 2 items', [d.digests.length, d.digests[0].items.map((i) => i.id), d.digests[0].email], [1, ['1', '2'], 'bob@arise.tech']);
eq('digest phases', d.digests[0].items.map((i) => i.phase), ['Pilot', 'Ready to Use']);
eq('digest noEmail', d.noEmail, ['4']);

// permissions
const ag = { creatorEmails: ['c@arise.tech'], createdBy: 'uc', approveArea: ['QA'] };
eq('canSubmit creator → null', R.canSubmit(ag, { email: 'C@arise.tech', uid: 'x' }), null);
eq('canSubmit non-creator → error', typeof R.canSubmit(ag, { email: 'z@arise.tech', uid: 'z', role: 'admin' }), 'string');
eq('canDecideReview approver outside area → error', typeof R.canDecideReview(ag, { role: 'approver', approveAreas: ['SIT'] }), 'string');
eq('canDecideReview approver in area → null', R.canDecideReview(ag, { role: 'approver', approveAreas: ['QA'] }), null);
eq('canDecideReview admin → null', R.canDecideReview(ag, { role: 'admin' }), null);

// recipients
const users = [
  { email: 'ad@arise.tech', role: 'admin' }, { email: 'co@arise.tech', role: 'committee' },
  { email: 'ap@arise.tech', role: 'approver', approveAreas: ['QA'] }, { email: 'ap2@arise.tech', role: 'approver', approveAreas: ['SIT'] },
];
const rec = (o) => R.notPassRecipients(ag, users, { assessmentApproverOverride: o }).sort();
eq('override replaces approvers', rec(['x@arise.tech']), ['ad@arise.tech', 'c@arise.tech', 'co@arise.tech', 'x@arise.tech']);
eq('legacy approverOverride ignored → real approvers', R.notPassRecipients(ag, users, { approverOverride: ['x@arise.tech'], assessmentApproverOverride: [] }).sort(), ['ad@arise.tech', 'ap@arise.tech', 'c@arise.tech', 'co@arise.tech']);
eq('empty override → real approvers', rec([]), ['ad@arise.tech', 'ap@arise.tech', 'c@arise.tech', 'co@arise.tech']);

eq('blocking + High reasons', V({ C7: 'C7b', C2: 'C2d' }, 'T2').reasons, ['C7', 'High']);
eq('non-approved → out of scope', R.inBackfillScope({ ...base, approvalStatus: 'pending' }, []), false);
// message
const m = R.renderBackfillMessage({ displayName: 'บ๊อบ', dueDate: '15 Dec 2026', appUrl: 'https://x', items: [{ id: '1', name: 'A', phase: 'Pilot' }, { id: '2', name: 'B', phase: 'Ready to Use' }] });
eq('subject has date', m.subject, 'ขอความร่วมมือทำ Assessment ของ Agent/Skill ภายใน 15 Dec 2026');
eq('links once each', [m.text.split('/assess?agent=1').length - 1, m.text.split('/assess?agent=2').length - 1], [1, 1]);
eq('html greeting/links/date', [m.html.includes('เรียน คุณบ๊อบ'), m.html.split('/assess?agent=1').length - 1 >= 1, m.html.includes('15 Dec 2026'), m.html.includes('{{name}}')], [true, true, true, false]);
eq('dueDate format', R.formatDueDate(new Date('2026-12-15T05:00:00Z')), '15 Dec 2026');

// applySubmit
const NOW = new Date('2026-12-01T05:00:00Z');
const user = { email: 'c@arise.tech', uid: 'uc', role: 'user' };
const ag2 = { id: 'a1', agentName: 'A', owner: 'O', approveArea: ['QA'], creatorEmails: ['c@arise.tech'], aiAgent: false, skillMd: true, description: 'has desc' };
const decl = { description: 'new', tool: 'T', requiredSkills: 'none', permittedDomains: '', prohibitedUses: '', llm: 'L' };
const run = (agent, over = {}) => R.applySubmit(agent, { answers: PASS, decl, mode: 'backfill', config: CFG, user, tier: 'T1', ...over }, NOW);
const thr = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };
eq('input.tier ignored', (() => { const a = { ...ag2, aiAgent: true, skillMd: false }; return R.applySubmit(a, { answers: { ...PASS, C2: 'C2d' }, decl, mode: 'backfill', config: CFG, user, tier: 'T1' }, new Date()).status; })(), 'fail');
const r1 = run(ag2);
eq('backfill pass', r1.status, 'pass');
eq('patch shape', [r1.patch.screening.v, r1.patch.screening.deployAt === NOW, r1.patch.assessment.status, r1.patch.assessment.lastBy], [2, true, 'pass', 'c@arise.tech']);
eq('declaration fills only empty', Object.keys(r1.patch).filter((k) => ['description', 'tool', 'requiredSkills', 'llm', 'permittedDomains', 'prohibitedUses'].includes(k)).sort(), ['llm', 'requiredSkills', 'tool']);
eq('two records pre/deploy', r1.records.map((x) => [x.stage, x.year, x.agentId]), [['pre', 2026, 'a1'], ['deploy', 2026, 'a1']]);
eq('pre record only pre answers', Object.keys(r1.records[0].answers).length, 9);
eq('second submit → already-exists', thr(() => run({ ...ag2, assessment: { status: 'pass' } })), 'already-exists');
eq('incomplete → failed-precondition', thr(() => run(ag2, { answers: { C1: 'C1a' } })), 'failed-precondition');
eq('non-creator → permission-denied', thr(() => run(ag2, { user: { email: 'z@arise.tech', uid: 'z' } })), 'permission-denied');
const failAg = { ...ag2, assessment: { status: 'fail', firstAssessedAt: 'FIRST' }, screening: { v: 2, answers: { ...PASS, C7: 'C7b' }, deployAt: 1 } };
const rv = run(failAg, { mode: 'review' });
eq('review keeps screening untouched', [rv.status, Object.keys(rv.patch), rv.patch.assessment.status, rv.records.length], ['pending_review', ['assessment'], 'pending_review', 0]);
eq('review on non-fail → failed-precondition', thr(() => run(ag2, { mode: 'review' })), 'failed-precondition');
eq('fail verdict status', run(ag2, { answers: { ...PASS, C7: 'C7b' } }).status, 'fail');
// re-run keeps firstAssessedAt (status fail → backfill rejected, so use review path carrying it)
eq('firstAssessedAt kept', rv.patch.assessment.firstAssessedAt, 'FIRST');
// applyDecision (review accept/reject)
const pend = { ...failAg, assessment: { status: 'pending_review', firstAssessedAt: 'FIRST', reasons: ['C7'] } };
const rvw = { answers: PASS, decl, requestedBy: 'c@arise.tech', requestedByUid: 'uc' };
const dec = (d, reason, agent = pend) => R.applyDecision(agent, rvw, { decision: d, reason, config: CFG, now: NOW });
const acc = dec('accept');
eq('accept → pass, screening v2, firstAssessedAt kept', [acc.status, acc.patch.assessment.status, acc.patch.assessment.firstAssessedAt, acc.patch.screening.v, acc.records.length], ['pass', 'pass', 'FIRST', 2, 2]);
eq('reject short reason → invalid-argument', thr(() => dec('reject', 'no')), 'invalid-argument');
const rej = dec('reject', 'ข้อมูลไม่เพียงพอ');
eq('reject → fail, no screening change', [rej.status, Object.keys(rej.patch), rej.patch.assessment.status, rej.records.length], ['fail', ['assessment'], 'fail', 0]);
eq('accept failing verdict → failed-precondition', thr(() => R.applyDecision(pend, { ...rvw, answers: { ...PASS, C7: 'C7b' } }, { decision: 'accept', config: CFG, now: NOW })), 'failed-precondition');
eq('decide when not pending_review → failed-precondition', thr(() => dec('accept', '', failAg)), 'failed-precondition');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
