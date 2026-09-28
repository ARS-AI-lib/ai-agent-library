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

console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);
