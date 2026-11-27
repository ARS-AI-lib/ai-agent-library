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
eq('default subject (no date)', m.subject, 'ขอความร่วมมือตอบ Assessment สำหรับ Agent/Skill ของท่าน');
eq('[Due date] token replaced in text/html/inbox/cards, none left', [m.text.includes('ภายในวันที่ 15 Dec 2026'), m.html.includes('ภายในวันที่ 15 Dec 2026'), m.inboxText.includes('ภายในวันที่ 15 Dec 2026'), m.cardLines.some((l) => String(l.text || l).includes('ภายในวันที่ 15 Dec 2026')), [m.text, m.html, m.inboxText, m.cardLines.join('\n')].some((x) => x.includes('[Due date]'))], [true, true, true, true, false]);
eq('override outro keeps the [Due date] token working', R.renderBackfillMessage({ displayName: 'บ๊อบ', dueDate: '15 Dec 2026', appUrl: 'https://x', items: [{ id: '1', name: 'A', phase: 'Pilot' }], overrides: { outro: 'ตอบภายใน [Due date] ครับ' } }).text.includes('ตอบภายใน 15 Dec 2026 ครับ'), true);
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
// tallyDeliveries — inputs are the real sendMail statuses (mailer.js): sent, held, dry-run, skipped-domain, disabled, error
const Z = { sent: 0, held: 0, skipped: 0, dryRun: 0, disabled: 0, failed: 0 };
[['sent', 'sent'], ['held', 'held'], ['skipped-domain', 'skipped'], ['dry-run', 'dryRun'], ['disabled', 'disabled'], ['error', 'failed'], ['weird', 'failed']]
  .forEach(([st, k]) => eq(`tally ${st} → ${k}`, R.tallyDeliveries([{ status: st }]), { ...Z, [k]: 1 }));
eq('tally thrown', R.tallyDeliveries([{ error: true }]), { ...Z, failed: 1 });
eq('tally mix keeps sent accurate', R.tallyDeliveries([{ status: 'sent' }, { status: 'sent' }, { status: 'held' }]), { ...Z, sent: 2, held: 1 });
eq('tally empty', R.tallyDeliveries([]), Z);

// creator page helpers
const CSVL = loadEsm('csv.js');
const DL = loadEsm('declaration.js');
const AS = loadEsm('assessments.js', { DECL_FIELDS: DL.DECL_FIELDS, evaluate: S.evaluate, optionOf: S.optionOf, normalizeAnswers: S.normalizeAnswers });
const UT = loadEsm('agentUtils.js', { getType: T.getType, getTier: T.getTier });
const B = loadEsm('assessmentBackfill.js', { csvCell: CSVL.csvCell, bangkokDay: AS.bangkokDay, normalizeProgress: UT.normalizeProgress });
const it = (id, status) => ({ id, status });
const L = [it('a', 'not_done'), it('b', 'pass'), it('c', 'not_done'), it('d', 'not_done')];
eq('nextItem after a → c', B.nextItem(L, 'a', 'backfill'), 'c');
eq('nextItem wraps to earlier', B.nextItem(L, 'd', 'backfill'), 'a');
eq('nextItem none left', B.nextItem([it('a', 'pass')], 'a', 'backfill'), null);
eq('nextItem review picks fail only', B.nextItem([it('a', 'fail'), it('b', 'not_done'), it('c', 'fail')], 'a', 'review'), 'c');
eq('nextItem current excluded', B.nextItem([it('a', 'not_done')], 'a', 'backfill'), null);
eq('assessable backfill', B.isAssessable(it('x', 'not_done'), 'backfill'), true);
eq('assessable backfill done', B.isAssessable(it('x', 'pass'), 'backfill'), false);
eq('assessable review fail', B.isAssessable(it('x', 'fail'), 'review'), true);
eq('assessable review not_done', B.isAssessable(it('x', 'not_done'), 'review'), false);
eq('nextItem empty', B.nextItem([], 'a', 'backfill'), null);
eq('nextItem unknown current', B.nextItem(L, 'zzz', 'backfill'), 'a');
eq('escapeRe', new RegExp(B.escapeRe('A (b)+?')).test('A (b)+?'), true);
{
  const labels = ['Permitted Tools', 'Description', 'Required Skills', 'A (b)+'];
  const fields = B.declErrorFields(labels);
  const msgs = { 'Permitted Tools': 'ใส่ Permitted Tools (หรือติ๊ก "ไม่ใช้ tool")', Description: 'ใส่ Description', 'Required Skills': 'ใส่ Required Skills', 'A (b)+': 'ใส่ A (b)+' };
  labels.forEach((l) => {
    const hits = fields.filter(([, re]) => re.test(msgs[l])).map(([x]) => x);
    eq(`declErrorFields matches only ${l}`, hits, [l]);
  });
}
{
  const HEAD = 'Agent/Skill,Tier,Phase,Owner,Creators,Status,Level,Reasons,First assessed,Last assessed,Due date';
  const row = (o) => ({ id: 'a', name: 'N', tier: 'T1', phase: 'Pilot', owner: 'O', creators: [], status: 'not_done', level: '', reasons: [], firstAssessedAt: null, lastAssessedAt: null, ...o });
  const lines = (rows, due) => B.backfillCsv(rows, due).split('\r\n');
  eq('csv header', lines([], '2026-12-01')[0], HEAD);
  eq('csv status labels', ['pass', 'fail', 'pending_review', 'not_done'].map((s) => lines([row({ status: s })], 'd')[1].split(',')[5]), ['Pass', 'Not pass', 'Not pass (review pending)', 'Not done']);
  eq('csv creators joined', lines([row({ creators: ['a@x.com', 'b@x.com'] })], 'd')[1].split(',')[4], 'a@x.com; b@x.com');
  eq('csv escaping', lines([row({ name: 'A, "B"' })], 'd')[1].startsWith('"A, ""B""",'), true);
  eq('csv newline', B.backfillCsv([row({ name: 'A\nB' })], 'd').includes('"A\nB"'), true);
  eq('csv formula guard', lines([row({ name: '=cmd' })], 'd')[1].startsWith("'=cmd,"), true);
  eq('csv bangkok dates', lines([row({ firstAssessedAt: Date.UTC(2026, 10, 26, 18, 0), lastAssessedAt: Date.UTC(2026, 10, 27, 1, 0) })], '2026-12-01')[1].split(',').slice(8), ['2026-11-27', '2026-11-27', '2026-12-01']);
  eq('csv empty dates', lines([row({})], '')[1].split(',').slice(8), ['', '', '']);
  eq('csv reasons', lines([row({ status: 'fail', reasons: ['C7', 'High'] })], 'd')[1].split(',')[7], 'C7; High');
  eq('csv blank due date (empty)', lines([row({})], '')[1].split(',')[10], '');
  eq('csv blank due date (undefined)', lines([row({})], undefined)[1].split(',')[10], '');
  eq('csv due date given', lines([row({})], '2026-12-01')[1].split(',')[10], '2026-12-01');
  eq('filter fail includes pending_review', ['pass', 'fail', 'pending_review', 'not_done'].map((s) => B.matchesStatus(s, 'fail')), [false, true, true, false]);
  eq('filter pass excludes pending_review', B.matchesStatus('pending_review', 'pass'), false);
  eq('filter all', B.matchesStatus('not_done', 'all'), true);
  eq('summarize', B.summarize([row({ status: 'pass', creators: ['a'] }), row({ status: 'fail', creators: ['a'] }), row({ status: 'pending_review' }), row({ creators: ['a'] }), row({})]), { items: 5, done: 3, notDone: 2, noEmail: 2 });
}
{
  const WARN = 'รายการนี้ยังไม่ผ่าน assessment อาจมีความเสี่ยงจากการใช้งาน';
  const ag = (devProgress, status) => ({ devProgress, assessment: status ? { status } : undefined });
  eq('warning 100% fail', B.assessmentWarning(ag(100, 'fail')), WARN);
  eq('warning "100%" string pending_review', B.assessmentWarning(ag('100%', 'pending_review')), WARN);
  eq('warning 99% fail null', B.assessmentWarning(ag(99, 'fail')), null);
  eq('warning 100% pass null', B.assessmentWarning(ag(100, 'pass')), null);
  eq('warning 100% none null', B.assessmentWarning(ag(100)), null);
}
// --- fix wave (F2/F5/F7/F10)
{
  const NOW = new Date('2026-11-27T10:00:00Z');
  eq('due ok', R.validateDueDate('2026-12-15', NOW), null);
  eq('due today ok', R.validateDueDate('2026-11-27', NOW), null);
  eq('due fake date', typeof R.validateDueDate('2026-13-45', NOW), 'string');
  eq('due Feb 30', typeof R.validateDueDate('2026-02-30', NOW), 'string');
  eq('due past', typeof R.validateDueDate('2026-11-26', NOW), 'string');
  eq('due not string', typeof R.validateDueDate(null, NOW), 'string');
  const thrown = (f) => { try { f(); return null; } catch (e) { return e.code; } };
  eq('sanitize ok', R.sanitizeSubmitInput({ answers: { C1: 'C1a' }, decl: { tool: ' x ' } }, CFG).decl, { tool: 'x' });
  eq('sanitize unknown qid', thrown(() => R.sanitizeSubmitInput({ answers: { ZZ: 'a' }, decl: {} }, CFG)), 'invalid-argument');
  eq('sanitize non-string option', thrown(() => R.sanitizeSubmitInput({ answers: { C1: 5 }, decl: {} }, CFG)), 'invalid-argument');
  eq('sanitize unknown decl key', thrown(() => R.sanitizeSubmitInput({ answers: {}, decl: { evil: 'x' } }, CFG)), 'invalid-argument');
  eq('sanitize decl non-string', thrown(() => R.sanitizeSubmitInput({ answers: {}, decl: { tool: { a: 1 } } }, CFG)), 'invalid-argument');
  eq('sanitize decl too long', thrown(() => R.sanitizeSubmitInput({ answers: {}, decl: { tool: 'x'.repeat(2001) } }, CFG)), 'invalid-argument');
  eq('sanitize decl null -> empty', R.sanitizeSubmitInput({ answers: {}, decl: null }, CFG).decl, {});
  const user = { email: 'c@arise.tech', uid: 'u1' };
  const ag = { id: 'a1', agentName: 'A', approvalStatus: 'approved', devProgress: 100, creatorEmails: ['c@arise.tech'], assessment: { status: 'fail' } };
  eq('review incomplete rejected', thrown(() => R.applySubmit(ag, { answers: { C1: 'C1a' }, decl: {}, mode: 'review', config: CFG, user }, NOW)), 'failed-precondition');
  eq('review complete ok', R.applySubmit(ag, { answers: PASS, decl: {}, mode: 'review', config: CFG, user }, NOW).status, 'pending_review');
  const nd = { ...ag, aiAgent: false, skillMd: true, assessment: undefined };
  eq('backfill out of scope', thrown(() => R.applySubmit({ ...nd, devProgress: 50 }, { answers: PASS, decl: {}, mode: 'backfill', config: CFG, user, all: [{ ...nd, devProgress: 50 }] }, NOW)), 'failed-precondition');
  eq('backfill in scope ok', R.applySubmit(nd, { answers: PASS, decl: {}, mode: 'backfill', config: CFG, user, all: [nd] }, NOW).status, 'pass');
  const parent = { id: 'p', agentName: 'P', aiAgent: true, skillMd: false, childSkillIds: ['a1'] };
  eq('backfill paired child blocked', thrown(() => R.applySubmit(nd, { answers: PASS, decl: {}, mode: 'backfill', config: CFG, user, all: [nd, parent] }, NOW)), 'failed-precondition');
  // self-approval
  const pr = { ...ag, approveArea: ['X'], assessment: { status: 'pending_review' } };
  const rv = { answers: PASS, decl: {}, requestedBy: 'c@arise.tech', requestedByUid: 'u1' };
  eq('self accept refused', thrown(() => R.applyDecision(pr, rv, { decision: 'accept', config: CFG, now: NOW, deciderUid: 'u1' })), 'permission-denied');
  eq('self reject refused', thrown(() => R.applyDecision(pr, rv, { decision: 'reject', reason: 'because', config: CFG, now: NOW, deciderUid: 'u1' })), 'permission-denied');
  eq('admin may accept their OWN request', R.applyDecision(pr, rv, { decision: 'accept', config: CFG, now: NOW, deciderUid: 'u1', deciderIsAdmin: true }).status, 'pass');
  eq('admin flag does not help another requester check (approver self still refused)', thrown(() => R.applyDecision(pr, rv, { decision: 'accept', config: CFG, now: NOW, deciderUid: 'u1', deciderIsAdmin: false })), 'permission-denied');
  eq('other accept ok', R.applyDecision(pr, rv, { decision: 'accept', config: CFG, now: NOW, deciderUid: 'u2' }).status, 'pass');
  eq('stop below limit', R.shouldStopSending(3299999, 3300000), false);
  eq('stop at limit', R.shouldStopSending(3300000, 3300000), true);
  eq('summary truncated', R.summarizeSend({ inbox: 0, sent: 10, remaining: 5 }), 'Teams/Email: ส่งแล้ว 10 · ยังไม่ได้ส่งถึง 5 คน (หมดเวลาต่อครั้ง) กด Send อีกครั้งเพื่อส่งต่อ (ส่งเฉพาะคนที่ยังมีรายการ not done; คนที่ได้รับแล้วจะได้รับเตือนซ้ำ)');
  eq('estimate 145 creators', B.estimateSendMinutes(145), 25);
  eq('estimate 6', B.estimateSendMinutes(6), 1);
  eq('estimate 0', B.estimateSendMinutes(0), 0);
  eq('estimate 1', B.estimateSendMinutes(1), 1);
  // editable message / selection
  const base = { displayName: 'บ๊อบ', dueDate: '15 Dec 2026', appUrl: 'https://x', items: [{ id: '1', name: 'A', phase: 'Pilot' }] };
  const dm = R.defaultMessageParts('15 Dec 2026');
  eq('default parts', Object.keys(dm), ['subject', 'intro', 'outro']);
  eq('default subject', dm.subject, 'ขอความร่วมมือตอบ Assessment สำหรับ Agent/Skill ของท่าน');
  eq('no override == default subject', R.renderBackfillMessage(base).subject, dm.subject);
  const ov = R.renderBackfillMessage({ ...base, overrides: { subject: 'S1', intro: 'Hi <b>x</b>', outro: 'Bye' } });
  eq('override subject', ov.subject, 'S1');
  eq('override intro escaped in html', ov.html.includes('Hi &lt;b&gt;x&lt;/b&gt;') && !ov.html.includes('<b>x</b>'), true);
  eq('items + link kept', ov.text.includes('https://x/assess?agent=1') && ov.html.includes('https://x/assess?agent=1'), true);
  eq('due sentence removed (date only in subject)', [ov.text.includes('ใช้เวลาประมาณ 5 นาที'), ov.text.includes('15 Dec 2026'), ov.html.includes('15 Dec 2026'), ov.inboxText.includes('15 Dec 2026'), ov.cardLines.some((l) => String(l.text ?? l).includes('15 Dec 2026'))], [false, false, false, false, false]);
  eq('empty override -> default', R.renderBackfillMessage({ ...base, overrides: { subject: '  ', intro: '', outro: '' } }).subject, dm.subject);
  eq('control chars stripped', R.validateMessage({ subject: 'a\u0000b\u0007c' }).subject, 'abc');
  eq('validateMessage undefined', R.validateMessage(undefined), {});
  eq('validateMessage non-string', thrown(() => R.validateMessage({ subject: 5 })), 'invalid-argument');
  eq('validateMessage subject too long', thrown(() => R.validateMessage({ subject: 'x'.repeat(201) })), 'invalid-argument');
  eq('validateMessage intro too long', thrown(() => R.validateMessage({ intro: 'x'.repeat(2001) })), 'invalid-argument');
  eq('validateMessage not object', thrown(() => R.validateMessage('x')), 'invalid-argument');
  eq('agentIds absent', R.validateAgentIds(undefined), null);
  eq('agentIds ok', R.validateAgentIds(['a', 'b']), ['a', 'b']);
  eq('agentIds non-string', thrown(() => R.validateAgentIds(['a', 3])), 'invalid-argument');
  eq('agentIds too many', thrown(() => R.validateAgentIds(Array.from({ length: 1001 }, (_, i) => `i${i}`))), 'invalid-argument');
  eq('agentIds not array', thrown(() => R.validateAgentIds('a')), 'invalid-argument');
  const rws = [{ agent: { id: 'a', creatorEmails: ['x@a.t'] }, status: 'not_done' }, { agent: { id: 'b', creatorEmails: ['x@a.t'] }, status: 'not_done' }, { agent: { id: 'c', creatorEmails: ['y@a.t'] }, status: 'pass' }];
  eq('selectRows by ids', R.selectRows(rws, ['a', 'c']).map((r) => r.agent.id), ['a', 'c']);
  eq('selectRows null keeps all', R.selectRows(rws, null).length, 3);
  eq('selected digest only selected items', R.creatorDigests(R.selectRows(rws, ['a'])).digests[0].items.map((i) => i.id), ['a']);
  // client selection helpers
  const cr = (id, status, creators) => ({ id, status, creators });
  const RR = [cr('a', 'not_done', ['x']), cr('b', 'not_done', ['x', 'y']), cr('c', 'pass', ['z']), cr('d', 'not_done', [])];
  eq('defaultSelection', [...B.defaultSelection(RR)].sort(), ['a', 'b', 'd']);
  eq('toggleId off', [...B.toggleId(new Set(['a']), 'a')], []);
  eq('toggleId on', [...B.toggleId(new Set(), 'a')], ['a']);
  eq('selectionCounts', B.selectionCounts(RR, new Set(['a', 'b', 'c'])), { items: 2, creators: 2 });
  eq('selectionCounts ignores non-not_done', B.selectionCounts(RR, new Set(['c'])), { items: 0, creators: 0 });
  eq('selectAllFiltered on', [...B.selectAllFiltered(new Set(['a']), RR.slice(1), true)].sort(), ['a', 'b', 'd']);
  eq('selectAllFiltered off only shown', [...B.selectAllFiltered(new Set(['a', 'b']), [RR[1]], false)], ['a']);
  eq('selectionState all', B.selectionState(new Set(['a', 'b', 'd']), RR), 'all');
  eq('selectionState some', B.selectionState(new Set(['a']), RR), 'some');
  eq('selectionState none', B.selectionState(new Set(), RR), 'none');
  eq('selectionState no selectable', B.selectionState(new Set(), [RR[2]]), 'none');
  eq('pruneSelection', [...B.pruneSelection(new Set(['a', 'zz', 'c']), RR)], ['a']);
  eq('phase all', B.matchesPhase('Pilot', 'all'), true);
  eq('phase pilot', B.matchesPhase('Pilot', 'Pilot'), true);
  eq('phase mismatch', B.matchesPhase('Ready to Use', 'Pilot'), false);
  const FR = [{ id: 'a', name: 'Alpha', creators: ['x@a'], status: 'not_done', phase: 'Pilot' }, { id: 'b', name: 'Beta', creators: ['x@a'], status: 'not_done', phase: 'Ready to Use' }, { id: 'c', name: 'Alpha2', creators: [], status: 'pass', phase: 'Pilot' }];
  eq('filterRows all three', B.filterRows(FR, { q: 'alpha', status: 'not_done', phase: 'Pilot' }).map((r) => r.id), ['a']);
  eq('filterRows phase only', B.filterRows(FR, { q: '', status: 'all', phase: 'Ready to Use' }).map((r) => r.id), ['b']);
  eq('filterRows search creator + status', B.filterRows(FR, { q: 'x@a', status: 'not_done', phase: 'all' }).map((r) => r.id), ['a', 'b']);
  const FO = [{ id: 'o1', name: 'A', phase: 'Pilot', status: 'not_done', creators: [], owner: 'Team B' }, { id: 'o2', name: 'B', phase: 'Pilot', status: 'not_done', creators: [], owner: ' Team A ' }, { id: 'o3', name: 'C', phase: 'Ready to Use', status: 'pass', creators: [], owner: '' }, { id: 'o4', name: 'D', phase: 'Pilot', status: 'fail', creators: [] }];
  eq('ownerOptions sorted, trimmed, hasNone', B.ownerOptions(FO), { owners: ['Team A', 'Team B'], hasNone: true });
  eq('owner filter exact (trimmed)', B.filterRows(FO, { owner: 'Team A' }).map((r) => r.id), ['o2']);
  eq('owner filter none matches empty and missing', B.filterRows(FO, { owner: B.NO_OWNER }).map((r) => r.id), ['o3', 'o4']);
  eq('owner combined with phase + status', B.filterRows(FO, { owner: 'Team B', phase: 'Pilot', status: 'not_done' }).map((r) => r.id), ['o1']);
  eq('owner all keeps everything', B.filterRows(FO, { owner: 'all' }).length, 4);
  eq('filter-out selection retained', [...B.selectAllFiltered(new Set(['b']), B.filterRows(FR, { q: '', status: 'all', phase: 'Pilot' }), true)].sort(), ['a', 'b']);
  // review round 1
  const TXT = (l) => (typeof l === 'string' ? l : l.text);
  const cl = R.renderBackfillMessage({ ...base, overrides: { intro: 'P1\n\nP2', outro: 'C1\n\nC2' } }).cardLines.map(TXT);
  eq('cardLines intro first, items middle, closing last', [cl[0], cl[1], cl[2].startsWith('1. A'), cl[3], cl[4]], ['P1', 'P2', true, 'C1', 'C2']);
  const cd = R.renderBackfillMessage(base).cardLines.map(TXT);
  eq('default cardLines start with the intro lines and end with the closing', [cd[0] === dm.intro.split('\n')[0], cd[cd.length - 1]], [true, 'ทีม AI Agent Library']);
  eq('cardLines default has reply + thanks', cd.includes('ขอบพระคุณยิ่ง'), true);
  eq('cardLines strip control chars', R.renderBackfillMessage({ ...base, overrides: { intro: 'a\u0007b' } }).cardLines.map(TXT)[0], 'ab');
  eq('subject newlines collapsed', R.validateMessage({ subject: 'a\n b\t\tc' }).subject, 'a b c');
  eq('intro keeps paragraphs', R.validateMessage({ intro: 'a\n\nb' }).intro, 'a\n\nb');
  const SR = [{ id: 'a', status: 'not_done', creators: [] }, { id: 'b', status: 'not_done', creators: ['x'] }];
  eq('selectionCounts excludes no-creator items', B.selectionCounts(SR, new Set(['a', 'b'])), { items: 1, creators: 1 });
  // hidden links
  const hl = R.renderBackfillMessage(base);
  eq('html link label, bare URL not visible', [hl.html.includes('>Assessment</a>'), hl.html.includes('href="https://x/assess?agent=1"'), hl.html.includes('>https://x/assess?agent=1<')], [true, true, false]);
  eq('text keeps raw URL', hl.text.includes('1. A · Pilot → https://x/assess?agent=1'), true);
  eq('card line markdown link', hl.cardLines.map(TXT).some((l) => l === '1. A · Pilot → [Assessment](https://x/assess?agent=1)'), true);
  eq('inbox body markdown link', hl.inboxText.includes('1. A · Pilot → [Assessment](https://x/assess?agent=1)') && !hl.inboxText.includes('→ https://'), true);
  // block spacing
  const sp = R.renderBackfillMessage({ ...base, overrides: { intro: 'INTRO', outro: 'OUTRO' } });
  eq('text blank line between blocks', sp.text.split('\n\n').length, 4);
  eq('text block order', sp.text.split('\n\n').slice(1).map((b) => b.split('\n')[0].replace(/^1\. .*/, 'LIST')), ['INTRO', 'LIST', 'OUTRO']);
  eq('inbox blank line between blocks', sp.inboxText.split('\n\n').length, 4);
  eq('html separate blocks with margins', [sp.html.includes('<p style="margin:0 0 16px">INTRO</p>'), sp.html.includes('<ol style="margin:0 0 16px'), sp.html.includes('<p style="margin:0 0 16px">OUTRO</p>')], [true, true, true]);
  const spc = sp.cardLines;
  eq('card gap before first item and first closing', [spc[0], spc[1].spacing, spc[2].spacing], ['INTRO', 'Large', 'Large']);
  // F2 wording
  const T = { sent: 0, held: 0, skipped: 0, dryRun: 0, disabled: 0, failed: 0 };
  eq('summary inbox + dry run', R.summarizeSend({ inbox: 12, ...T, dryRun: 12 }), 'ส่ง Inbox แล้ว 12 ข้อความ · Teams/Email: ไม่ได้ส่งจริง (dry run 12)');
  eq('summary nothing', R.summarizeSend({ inbox: 0, ...T }), 'ไม่มีข้อความที่ส่งออก');
  eq('summary sent+failed', R.summarizeSend({ inbox: 0, ...T, sent: 3, failed: 1 }), 'Teams/Email: ส่งแล้ว 3 · ล้มเหลว 1');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
