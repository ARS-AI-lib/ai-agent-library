// Offline checks for the teams-flow provider (mailer.js). No network, no Firestore.
//   node functions/verify-teams.cjs
const M = require('./mailer');
let fail = 0;
const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fail += 1; };

const N = require('./notifyRules');
const users = [{ id: 'u1', email: 'a@arise.tech', role: 'admin', displayName: 'A' }];
const base = { id: 'AG1', agentName: 'X', creatorEmails: ['c@arise.tech'], approveArea: [], approvedBy: 'u1' };
const note = N.buildNotification({ type: 'agent.approved', doc: { ...base, approvalStatus: 'approved' }, agent: base, users });
const card = M.buildTeamsCard(note);
ok(card.type === 'AdaptiveCard' && card.version === '1.4', 'Adaptive Card 1.4');
ok(card.body[1].text === 'Approved: X', 'title has no [AI Library] prefix');
ok(card.body.filter((b) => b.text === card.body[1].text).length === 1, 'title appears once (no repeated heading)');
ok(!JSON.stringify(card.body).includes('web.app'), 'app URL line replaced by the button');
ok(card.actions[0].url === 'https://wolfy-ai-library.web.app/?agent=AG1', 'decision event deep-links to the agent');
const pend = M.buildTeamsCard(N.buildNotification({ type: 'agent.pending', doc: { ...base, approvalStatus: 'pending' }, agent: base, users }));
ok(pend.actions[0].url.endsWith('/?view=pending'), 'approver events open the pending queue');
const ready = M.buildTeamsCard(N.buildNotification({ type: 'agent.ready', doc: { ...base, devProgress: 100, endpoint: 'https://x.example/bot' }, agent: base, users }));
ok(ready.actions[1]?.title === 'Open endpoint' && ready.actions[1].url === 'https://x.example/bot', 'Ready to Use gets an Open Endpoint button');
const readyNoUrl = M.buildTeamsCard(N.buildNotification({ type: 'agent.ready', doc: { ...base, devProgress: 100, endpoint: 'ติดต่อทีม' }, agent: base, users }));
ok(readyNoUrl.actions.length === 1, 'non-URL endpoint gets no button');

const s = M.splitTeamsRecipients(['a@arise.tech', 'B@Arise.Tech', 'c@krungthai.com', 'bad'], ['arise.tech']);
ok(s.send.length === 2 && s.skipped.join() === 'c@krungthai.com,bad', 'domain filter (case-insensitive), others skipped');
ok(M.PROVIDERS.includes('teams-flow'), 'teams-flow is a valid provider');
ok(M.DEFAULT_CONFIG.teamsDomains.join() === 'arise.tech', 'default reach = arise.tech only');

// approverOverride: approver events go only to the override; creators untouched.
const users2 = [{ id: 'u1', email: 'boss@arise.tech', role: 'admin' }, { id: 'u2', email: 'appr@arise.tech', role: 'approver', approveAreas: ['Security'] }];
const ag = { id: 'AG2', agentName: 'Y', creatorEmails: ['maker@infinitaskt.com'], approveArea: ['Security'], devProgress: 100 };
const ov = ['tinnapat.p@arise.tech'];
ok(N.buildNotification({ type: 'agent.pending', doc: { ...ag, approvalStatus: 'pending' }, agent: ag, users: users2, approverOverride: ov }).to.join() === 'tinnapat.p@arise.tech', 'approver event → override only');
ok(N.buildNotification({ type: 'agent.approved', doc: { ...ag, approvalStatus: 'approved' }, agent: ag, users: users2, approverOverride: ov }).to.join() === 'maker@infinitaskt.com', 'creator event → real creator');
ok(N.buildNotification({ type: 'agent.ready', doc: ag, agent: ag, users: users2, approverOverride: ov }).to.sort().join() === 'maker@infinitaskt.com,tinnapat.p@arise.tech', 'mixed event → creator + override (no real approvers)');
ok(N.buildNotification({ type: 'agent.pending', doc: { ...ag, approvalStatus: 'pending' }, agent: ag, users: users2 }).to.length === 2, 'no override → normal area routing');

// Email via the Flow (planFlowDeliveries).
const to3 = ['a@arise.tech', 'k@krungthai.com'];
const off = M.planFlowDeliveries(to3, ['arise.tech'], false);
ok(off.deliveries.length === 1 && off.deliveries[0].teams && !off.deliveries[0].email && off.skipped.join() === 'k@krungthai.com', 'emailEnabled off → same as before (Teams only, others skipped)');
const on = M.planFlowDeliveries(to3, ['arise.tech'], true);
ok(on.deliveries.find((d) => d.recipient === 'a@arise.tech')?.teams === true && on.deliveries.find((d) => d.recipient === 'a@arise.tech')?.email === true, 'Teams domain → Teams + email');
ok(on.deliveries.find((d) => d.recipient === 'k@krungthai.com')?.teams === false && on.deliveries.find((d) => d.recipient === 'k@krungthai.com')?.email === true && !on.skipped.length, 'other domain → email only');
ok(N.buildNotification({ type: 'agent.approved', doc: { ...base, approvalStatus: 'approved' }, agent: base, users }).html.includes('/?agent=AG1'), 'email button uses the same deep link');

// ── Message frame (2026-10-09): greeting, closing, per-item links ─────
const MF = require('./messageFrame');
const D = require('./delayAlertRules');
const apNote = N.buildNotification({ type: 'agent.approved', doc: { ...base, approvalStatus: 'approved' }, agent: base, users });
ok(apNote.html.includes('เรียน {{name}}') && apNote.html.includes('ขอแสดงความนับถือ'), 'every email has greeting + closing');
ok(card.body.some((b) => /^เรียน /.test(b.text)), 'Teams card has the greeting line');
ok(card.actions.length === 1 && card.actions[0].title === apNote.ctaLabel, 'single-item event: one button named after the action');
ok(MF.personalize('เรียน {{name}}', 'ทินภัทร พงษ์') === 'เรียน คุณทินภัทร' && MF.personalize('เรียน {{name}}', '') === 'เรียน ผู้ใช้งาน AI Agent Library' && MF.personalize('{{name}}', 'Tinnapat P') === 'คุณ Tinnapat', 'greeting: Thai first name / Latin name / no name');
const mk = (n) => ({ email: 'a@arise.tech', items: Array.from({ length: n }, (_, i) => ({ id: `AG${i}`, name: `Agent ${i}`, category: 'delayed', progress: 40, phase: 'ip', bdays: 3, launchDay: new Date('2026-10-01') })) });
const multi = D.renderDigest(mk(3));
const mcard = M.buildTeamsCard(multi);
ok(!mcard.actions && !multi.html.includes('display:inline-block'), 'multi-item digest: no button at the end (card or email)');
ok([0, 1, 2].every((i) => multi.html.includes(`?agent=AG${i}`) && mcard.body.some((b) => b.text.includes(`[Update](https://wolfy-ai-library.web.app/?agent=AG${i})`))), 'multi-item digest: every row links to its own item (email + Teams)');
const one = D.renderDigest(mk(1));
ok(M.buildTeamsCard(one).actions.length === 1 && one.html.includes('?agent=AG0') && one.html.includes('display:inline-block'), 'one-item digest: one button that targets that item');
const big = D.renderDigest(mk(20));
ok(M.buildTeamsCard(big).body.filter((b) => b.text.startsWith('• ')).length === 15 && big.cardLines.slice(-1)[0].includes('อีก 5 รายการ') && (big.html.match(/Update ›/g) || []).length === 20, 'Teams shows 15 rows + remainder note; email lists all 20');
ok(!multi.html.includes('09:30') && !multi.html.includes('พฤหัส') && multi.html.includes('13:00'), 'digest footer states the weekly Monday 13:00 schedule');

console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);
