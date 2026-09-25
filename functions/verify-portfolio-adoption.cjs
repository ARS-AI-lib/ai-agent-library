// Offline checks for portfolioAdoptionRules.js — no Firestore, no network.
//   node functions/verify-portfolio-adoption.cjs
const R = require('./portfolioAdoptionRules');
let fail = 0;
const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fail += 1; };

const agents = [
  { id: 'A1', agentName: 'Security Code Review', approvalStatus: 'approved' },
  { id: 'A2', agentName: 'Dup Name', approvalStatus: 'approved' },
  { id: 'A3', agentName: 'dup  name', approvalStatus: 'approved' },
  { id: 'A4', agentName: 'Pending One', approvalStatus: 'pending' },
  { id: 'A5', agentName: 'New Name', approvalStatus: 'approved' },
];
const idx = R.buildNameIndex(agents, [{ name: 'Old Name', agentId: 'A5' }, { name: 'Security Code Review', agentId: 'A5' }]);

ok(R.foldName(' Security​  Code Review ') === 'security code review', 'fold: case, spaces, zero-width');
const r = R.resolveTaskIds({ agents: ['security code review', 'Dup Name', 'Local Bot', 'Pending One'], skills: ['old name', 'SECURITY CODE REVIEW'] }, idx);
ok([...r.ids].sort().join() === 'A1,A5', 'resolves agents + skills; same agent twice counts once');
ok(r.ambiguous.includes('Dup Name'), 'shared name is ambiguous, not guessed');
ok(r.unmatched.includes('Local Bot') && r.unmatched.includes('Pending One'), 'project-local and non-approved names are skipped');
ok(idx.index.get('security code review') === 'A1', 'an alias never steals a live name');
ok(R.resolveTaskIds(null, idx).ids.size === 0, 'deleted task → no links');

ok(!R.linksChanged({ agents: ['A'], skills: [], progress: 1 }, { agents: ['a '], skills: [], progress: 50 }), 'progress-only write is ignored');
ok(R.linksChanged({ agents: ['A'] }, { agents: ['A', 'B'] }), 'added link detected');
ok(R.linksChanged({ agents: ['A'] }, null), 'task delete detected');
ok(!R.linksChanged({ agents: ['A'], contribute: { agentId: 'X' } }, { agents: ['A'], contribute: { agentId: 'Y' } }), 'contribute changes never count');

const d = R.diffMarkers(['A1', 'A5'], ['A5', 'A9']);
ok(d.add.join() === 'A1' && d.remove.join() === 'A9', 'diff: add new, remove stale, keep existing');
ok(R.markerId('A1', 'P', 'T') === 'A1__task__P__T', 'deterministic marker id');

console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);
