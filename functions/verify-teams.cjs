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
ok(card.body[1].text === 'อนุมัติแล้ว: X', 'title has no [AI Library] prefix');
ok(card.body.filter((b) => /อนุมัติแล้ว/.test(b.text)).length === 1, 'title appears once (no repeated heading)');
ok(!JSON.stringify(card.body).includes('web.app'), 'app URL line replaced by the button');
ok(card.actions[0].url === 'https://wolfy-ai-library.web.app/?agent=AG1', 'decision event deep-links to the agent');
const pend = M.buildTeamsCard(N.buildNotification({ type: 'agent.pending', doc: { ...base, approvalStatus: 'pending' }, agent: base, users }));
ok(pend.actions[0].url.endsWith('/?view=pending'), 'approver events open the pending queue');
const ready = M.buildTeamsCard(N.buildNotification({ type: 'agent.ready', doc: { ...base, devProgress: 100, endpoint: 'https://x.example/bot' }, agent: base, users }));
ok(ready.actions[1]?.title === 'Open Endpoint' && ready.actions[1].url === 'https://x.example/bot', 'Ready to Use gets an Open Endpoint button');
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

console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);
