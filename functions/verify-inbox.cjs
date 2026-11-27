// Guard the pure Inbox logic (2026-11-17).
//   node functions/verify-inbox.cjs
// Loads the SHIPPED src/lib modules (strip import/export, inject deps) — same
// loader as backfill-approve-area.cjs.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'lib');
function loadEsm(file, injected = {}) {
  const code = fs
    .readFileSync(path.join(SRC, file), 'utf8')
    .replace(/^\s*import\s[^;]*;\s*$/gm, '')
    .replace(/^export\s+/gm, '');
  const names = Object.keys(injected);
  const decls = [...code.matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  const body = `${code}\n;return { ${[...new Set(decls)].join(', ')} };`;
  return new Function(...names, body)(...names.map((n) => injected[n]));
}

const tier = loadEsm('tier.js');
const utils = loadEsm('agentUtils.js', { getType: tier.getType, getTier: tier.getTier });
const areas = loadEsm('approveAreas.js', {
  agentProcessIds: utils.agentProcessIds,
  splitRoles: utils.splitRoles,
  agentCategories: utils.agentCategories,
  isInternalOrExternal: tier.isInternalOrExternal,
});
const mine = loadEsm('mySubmissions.js', {
  normalizeProgress: utils.normalizeProgress, toJsDate: utils.toJsDate, fmtDate: utils.fmtDate,
});
const pq = loadEsm('pendingQueue.js', {
  agentApproveAreas: areas.agentApproveAreas,
  isPairedSubSkill: utils.isPairedSubSkill,
  canDecideRename: utils.canDecideRename,
});
const I = loadEsm('inbox.js', {
  toJsDate: utils.toJsDate, isMyAgent: utils.isMyAgent, isPairedSubSkill: utils.isPairedSubSkill,
  nextStep: mine.nextStep,
  visiblePending: pq.visiblePending, visibleDeployRequests: pq.visibleDeployRequests,
  visibleRenameRequests: pq.visibleRenameRequests, visibleLinkRequests: pq.visibleLinkRequests, visibleAssessmentReviews: pq.visibleAssessmentReviews,
  queueAreaEmptyForApprover: pq.queueAreaEmptyForApprover,
});

let fails = 0;
const eq = (a, b, msg) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  console.log(`${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) {
    console.log('   got     :', JSON.stringify(a));
    console.log('   expected:', JSON.stringify(b));
    fails++;
  }
};

const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);

// constants
eq(I.AUDIENCES, ['all', 'approvers', 'leads'], 'AUDIENCES');
eq(I.AUDIENCE_LABEL, { all: 'Everyone', approvers: 'Approvers and above', leads: 'Admin & Committee' }, 'AUDIENCE_LABEL');
eq([I.REJECTED_WINDOW_DAYS, I.READ_IDS_CAP], [14, 300], 'window/cap constants');

// allowedAudiences
eq(I.allowedAudiences('user'), ['all'], 'allowedAudiences user');
eq(I.allowedAudiences('workshop'), ['all'], 'allowedAudiences workshop');
eq(I.allowedAudiences('staff'), ['all', 'approvers'], 'allowedAudiences staff');
eq(I.allowedAudiences('approver'), ['all', 'approvers'], 'allowedAudiences approver');
eq(I.allowedAudiences('committee'), ['all', 'approvers', 'leads'], 'allowedAudiences committee');
eq(I.allowedAudiences('admin'), ['all', 'approvers', 'leads'], 'allowedAudiences admin');
for (const r of [undefined, null, '', 'bogus']) eq(I.allowedAudiences(r), [], `allowedAudiences ${JSON.stringify(r)} -> []`);

// canPostAnnouncements
eq(['user', 'workshop', 'staff', 'approver', 'committee', 'admin', null].map(I.canPostAnnouncements),
  [false, false, false, false, true, true, false], 'canPostAnnouncements only committee/admin');

// activeAnnouncements
const ts = (ms) => ({ toDate: () => new Date(ms) });
const list = [
  { id: 'expired', createdAt: new Date(NOW - 5 * DAY), expiresAt: new Date(NOW - 1) },
  { id: 'exactly', createdAt: new Date(NOW - 5 * DAY), expiresAt: new Date(NOW) },
  { id: 'nullExp', createdAt: new Date(NOW - 3 * DAY), expiresAt: null },
  { id: 'missingExp', createdAt: new Date(NOW - 1 * DAY) },
  { id: 'tsFuture', createdAt: ts(NOW - 2 * DAY), expiresAt: ts(NOW + DAY) },
  { id: 'dateFuture', createdAt: new Date(NOW - 4 * DAY), expiresAt: new Date(NOW + DAY) },
  { id: 'pinOld', pinned: true, createdAt: new Date(NOW - 9 * DAY) },
  { id: 'pinNew', pinned: true, createdAt: ts(NOW - 8 * DAY) },
];
eq(I.activeAnnouncements(list, NOW).map((x) => x.id),
  ['pinNew', 'pinOld', 'missingExp', 'tsFuture', 'nullExp', 'dateFuture'],
  'activeAnnouncements: drops expired + exactly-now, pinned first then newest');

// unreadAnnouncements
const act = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
eq(I.unreadAnnouncements(act, new Set(['a'])).map((x) => x.id), ['b', 'c'], 'unread respects Set');
eq(I.unreadAnnouncements(act, ['b', 'c']).map((x) => x.id), ['a'], 'unread respects array');
eq(I.unreadAnnouncements(act, []).map((x) => x.id), ['a', 'b', 'c'], 'late joiner: all unread');

// pruneReadIds
eq(I.pruneReadIds(['a', 'x', 'b'], ['a', 'b', 'c']), ['a', 'b'], 'pruneReadIds drops unknown ids');
const known = Array.from({ length: 305 }, (_, i) => `id${i}`);
const pr = I.pruneReadIds(known, known);
eq([pr.length, pr[0], pr[299]], [300, 'id5', 'id304'], 'pruneReadIds keeps the LAST 300');

// validateAnnouncement
const ok = { title: 'Hello', body: 'World', audience: 'all' };
eq(I.validateAnnouncement(ok), null, 'validate: valid -> null');
eq(typeof I.validateAnnouncement({ ...ok, title: '' }), 'string', 'validate: empty title');
eq(typeof I.validateAnnouncement({ ...ok, title: '   ' }), 'string', 'validate: whitespace title');
eq(typeof I.validateAnnouncement({ ...ok, title: 'x'.repeat(121) }), 'string', 'validate: 121-char title');
eq(I.validateAnnouncement({ ...ok, title: 'x'.repeat(120) }), null, 'validate: 120-char title ok');
eq(typeof I.validateAnnouncement({ ...ok, body: 'x'.repeat(5001) }), 'string', 'validate: 5001-char body');
eq(I.validateAnnouncement({ ...ok, body: 'x'.repeat(5000) }), null, 'validate: 5000-char body ok');
eq(typeof I.validateAnnouncement({ ...ok, audience: 'nobody' }), 'string', 'validate: bad audience');

// splitLinks
eq(I.splitLinks('see https://a.com/x, ok'),
  [{ text: 'see ' }, { text: 'https://a.com/x', href: 'https://a.com/x' }, { text: ', ok' }], 'splitLinks basic + trailing comma');
eq(I.splitLinks('1. A → [Assessment](https://x/assess?agent=1) done'),
  [{ text: '1. A → ' }, { text: 'Assessment', href: 'https://x/assess?agent=1' }, { text: ' done' }], 'splitLinks markdown link');
eq(I.splitLinks('[x](javascript:alert(1))').some((s) => 'href' in s), false, 'splitLinks rejects javascript: markdown');
eq(I.splitLinks('[x](data:text/html,y)').some((s) => 'href' in s), false, 'splitLinks rejects data: markdown');
const evil = I.splitLinks('<script>alert(1)</script> javascript:alert(1) data:text/html,x');
eq(evil.some((s) => 'href' in s), false, 'splitLinks: no href for script/javascript:/data:');
eq(evil.map((s) => s.text).join(''), '<script>alert(1)</script> javascript:alert(1) data:text/html,x', 'splitLinks: text preserved');
eq(I.splitLinks('http://a.b'), [{ text: 'http://a.b', href: 'http://a.b' }], 'splitLinks http linked');
eq(I.splitLinks('(go to https://a.com/p).'),
  [{ text: '(go to ' }, { text: 'https://a.com/p', href: 'https://a.com/p' }, { text: ').' }], 'splitLinks: trailing ) and . not swallowed');

// myRequestItems
const me = { email: 'Me@Arise.Tech' };
const mk = (id, extra = {}) => ({ id, agentName: id, creatorEmails: ['me@arise.tech'], aiAgent: true, skillMd: false, approvalStatus: 'approved', devProgress: 50, ...extra });
const pend = mk('P1', { approvalStatus: 'pending' });
const req = mk('R1', { deploymentStatus: 'requested' });
const act1 = mk('A1', { launchDate: new Date(NOW - 10 * DAY), createdAt: new Date(NOW - 2 * DAY), updatedAt: new Date(NOW - DAY) });
const ok1 = mk('K1', { devProgress: 100 });
const mute1 = mk('M1', { createdAt: new Date(NOW - DAY), updatedAt: new Date(NOW - DAY) });
const other = mk('O1', { approvalStatus: 'pending', creatorEmails: ['x@arise.tech'] });
const kids = Array.from({ length: 7 }, (_, i) => mk(`C${i}`, { approvalStatus: 'pending', aiAgent: false, skillMd: true }));
const parent = mk('PAR', { approvalStatus: 'pending', childSkillIds: kids.map((k) => k.id) });
const rejNew = mk('RJ1', { approvalStatus: 'rejected', rejectedAt: new Date(NOW - 3 * DAY) });
const rejFallback = mk('RJ2', { approvalStatus: 'rejected', updatedAt: ts(NOW - 13 * DAY) });
const rejOld = mk('RJ3', { approvalStatus: 'rejected', rejectedAt: new Date(NOW - 15 * DAY) });
const rejNone = mk('RJ4', { approvalStatus: 'rejected' });
const items = I.myRequestItems({
  pending: [pend, other, parent, ...kids, { ...pend }],
  allAgents: [req, act1, ok1, mute1, { ...req }],
  rejected: [rejNew, rejFallback, rejOld, rejNone, { ...rejNew }],
  user: me, now: NOW,
});
const byId = Object.fromEntries(items.map((r) => [r.agent.id, r]));
eq(items.map((r) => r.agent.id).sort(), ['P1', 'PAR', 'R1', 'RJ1', 'RJ2'], 'myRequestItems: right set (acts/ok/mute/others/old rejects excluded, dupes collapsed)');
eq(byId.P1.step.tone, 'wait', 'pending item tone wait');
eq(byId.R1.step.tone, 'wait', 'deploy-requested tone wait');
eq(byId.RJ1.step.tone, 'bad', 'rejected within window tone bad');
eq(items.filter((r) => r.agent.id.startsWith('C')).length, 0, 'paired children hidden -> 1 row for parent');

// inboxQueueCount / showToApprove / badge
const v0 = pq.queueViewer({ isAdmin: false, isCommittee: false, role: 'user', approveAreas: [], uid: 'u1', email: 'u@x' });
eq(I.inboxQueueCount([{ id: 'p', createdBy: 'u1', approvalStatus: 'pending' }], [], [], [], v0), 0, 'base user own pending -> 0');
const vFull = pq.queueViewer({ isAdmin: true, isCommittee: false, role: 'admin', approveAreas: [], uid: 'a', email: 'a@x' });
const p2 = [{ id: 'p1', approvalStatus: 'pending' }, { id: 'p2', approvalStatus: 'pending' }];
const dr = [{ id: 'd1', approvalStatus: 'approved', deploymentStatus: 'requested', aiAgent: true, skillMd: false }];
eq(I.inboxQueueCount(p2, dr, [], [], vFull), 3, 'fullAccess 2 pending + 1 deploy -> 3');
const A = Object.keys(areas.CATEGORY_AREA).length ? areas.AREA_ORDER[0] : null;
const B = areas.AREA_ORDER[1];
const inA = (id) => ({ id, approvalStatus: 'pending', approveArea: [A] });
const inB = (id) => ({ id, approvalStatus: 'pending', approveArea: [B] });
const vAp = pq.queueViewer({ isAdmin: false, isCommittee: false, role: 'approver', approveAreas: [A], uid: 'ap', email: 'ap@x' });
eq(I.inboxQueueCount([inA('x'), inB('y'), inB('z')], [], [], [], vAp), 1, 'approver: 1 of 3 matches -> 1');
eq(I.inboxQueueCount([{ ...inB('y'), createdBy: 'ap' }, inB('z')], [], [], [], vAp), 0, 'approver nothing matching -> 0 (fallback ignored)');
{
  const rv = (id, area) => ({ id: 'r' + id, agentId: id, status: 'pending', approveArea: [area] });
  const ags = [{ id: 'g1', approveArea: [A], approvalStatus: 'approved' }, { id: 'g2', approveArea: [B], approvalStatus: 'approved' }];
  const rvs = [rv('g1', A), rv('g2', B), { id: 'rx', agentId: 'gone', status: 'pending' }];
  const vCom = pq.queueViewer({ isAdmin: false, isCommittee: true, role: 'committee', approveAreas: [A], uid: 'c', email: 'c@x' });
  const vSt = pq.queueViewer({ isAdmin: false, isCommittee: false, role: 'staff', approveAreas: [A], uid: 's', email: 's@x' });
  eq(pq.visibleAssessmentReviews(rvs, ags, vFull).length, 2, 'reviews: admin sees all (resolvable)');
  eq(pq.visibleAssessmentReviews(rvs, ags, vAp).map((x) => x.r.id), ['rg1'], 'reviews: approver by area overlap');
  eq(pq.visibleAssessmentReviews(rvs, ags, vCom).length, 0, 'reviews: committee none');
  const own = [{ ...rv('g1', A), requestedByUid: 'ap' }, { ...rv('g2', B), requestedByUid: 'zz' }];
  eq(pq.visibleAssessmentReviews(own, ags, vAp).length, 0, 'reviews: own request hidden from approver (A only)');
  eq(pq.visibleAssessmentReviews(own, ags, vFull).length, 2, 'reviews: admin w/ other uid sees both');
  const vAdminSelf = pq.queueViewer({ isAdmin: true, isCommittee: false, role: 'admin', approveAreas: [], uid: 'zz', email: 'a@x' });
  eq(pq.visibleAssessmentReviews(own, ags, vAdminSelf).map((x) => x.r.id), ['rg1'], 'reviews: admin does not see own request');
  eq(pq.pendingBadgeCount([], [], [], ags, vAdminSelf, own), 1, 'badge excludes own request');
  eq(pq.visibleAssessmentReviews(rvs, ags, vSt).length, 0, 'reviews: staff none');
  eq(pq.pendingBadgeCount([], [], [], ags, vAp, rvs), 1, 'badge includes reviews');
  eq(pq.pendingBadgeCount([], [], [], ags, vAp), 0, 'badge old callers unchanged');
  eq(I.inboxQueueCount([], [], [], ags, vAp, rvs), 1, 'inboxQueueCount includes reviews');
  eq(I.inboxQueueCount([], [], [], ags, vAp), 0, 'inboxQueueCount old callers unchanged');
}
eq([I.showToApprove(vFull, 0), I.showToApprove(v0, 0), I.showToApprove(v0, 2)], [true, false, true], 'showToApprove');
eq([I.inboxBadgeCount({ unreadCount: 2, queueCount: 3 }), I.inboxBadgeCount({ unreadCount: 0, queueCount: 0 })], [5, 0], 'inboxBadgeCount');

// per-person messages (read ids are `msg:{id}`)
const msgs = [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }];
eq(I.unreadMessages(msgs, new Set(['msg:m1', 'm2'])).map((m) => m.id), ['m2', 'm3'], 'unreadMessages honours msg: prefix, ignores bare/announcement ids');
eq(I.unreadMessages(msgs, ['msg:m1', 'msg:m2', 'msg:m3']).length, 0, 'unreadMessages accepts array, all read -> 0');
eq(I.unreadMessages(null, null), [], 'unreadMessages null-safe');
eq(I.inboxBadgeCount({ unreadCount: 2, queueCount: 3, unreadMessages: 4 }), 9, 'badge = announcements + messages + queue');
eq(I.inboxBadgeCount({ unreadCount: 1, queueCount: 1 }), 2, 'badge old two-arg callers unchanged');
eq(I.pruneReadIds(['a1', 'msg:m1', 'msg:gone'], ['a1', 'msg:m1']), ['a1', 'msg:m1'], 'pruneReadIds keeps known msg ids, drops unknown');

eq(['javascript:alert(1)','data:text/html,x','vbscript:x','/rel/path','','  ',undefined,null,'JaVaScRiPt:1'].map(I.safeHttpUrl), Array(9).fill(null), 'safeHttpUrl rejects non-http(s)');
eq([I.safeHttpUrl('HTTPS://Example.com/a?b=1'), I.safeHttpUrl('http://x.io')], ['https://example.com/a?b=1', 'http://x.io/'], 'safeHttpUrl allows http(s), normalizes');
eq(I.knownReadIds(['a1'], [], false, ['a1', 'msg:m1']), ['a1', 'msg:m1'], 'knownReadIds keeps stored msg ids before load');
eq(I.knownReadIds(['a1'], [{ id: 'm2' }], true, ['msg:m1']), ['a1', 'msg:m2'], 'knownReadIds uses loaded messages after load');
eq(I.pruneReadIds(['msg:m1'], I.knownReadIds([], [], false, ['msg:m1'])), ['msg:m1'], 'msg read survives prune before load');
if (fails) { console.error(`\n✗ ${fails} case(s) failed`); process.exit(1); }
console.log('\n✓ all inbox cases pass');
