// Offline checks for linkRules.js.   node functions/verify-link-rules.cjs
const { checkLinkDecider } = require('./linkRules');
let fail = 0;
const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fail += 1; };
const skill = { id: 'S', creatorEmails: ['maker@arise.tech'], linkSuggestion: { agentId: 'A', status: 'pending' } };
const target = { id: 'A', creatorEmails: ['owner@infinitaskt.com'], approveArea: ['Security'] };
const t = (u) => checkLinkDecider({ skill, target, ...u }).ok;
ok(t({ isAdmin: true }), 'admin');
ok(t({ role: 'staff' }), 'staff');
ok(t({ role: 'approver', userAreas: ['Security'] }), 'approver of the agent area');
ok(!t({ role: 'approver', userAreas: ['QA'] }), 'approver of another area → denied');
ok(t({ role: 'user', email: 'MAKER@arise.tech' }), 'skill creator (case-insensitive)');
ok(t({ role: 'user', email: 'owner@infinitaskt.com' }), 'target agent creator');
ok(!t({ role: 'committee', email: 'x@arise.tech' }), 'committee not listed → denied');
ok(!t({ role: 'user', email: 'x@arise.tech' }), 'unrelated user → denied');
ok(!checkLinkDecider({ skill: { ...skill, linkSuggestion: { agentId: 'A', status: 'accepted' } }, target, isAdmin: true }).ok, 'already decided → refused');
ok(!checkLinkDecider({ skill: { ...skill, linkSuggestion: { agentId: 'B', status: 'pending' } }, target, isAdmin: true }).ok, 'target mismatch → refused');
console.log(fail ? `\n${fail} failed` : '\nall passed'); process.exit(fail ? 1 : 0);
