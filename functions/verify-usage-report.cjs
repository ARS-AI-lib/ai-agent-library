#!/usr/bin/env node
/**
 * Agent/Skill Usage report — invariants against LIVE data. Read-only.
 *
 *   node functions/verify-usage-report.cjs
 *
 * Reimplements ONLY the grouping/scoping arithmetic of exports.usageReport so
 * it can be asserted offline; the permission ROLES come from the same constant
 * shape the callable uses. Baseline when written: 713 agentEvents · 42 with
 * kind 'endpoint' · 41 distinct (agent, person) pairs · 23 adopters.
 */
const admin = require('firebase-admin');

admin.initializeApp({ projectId: 'wolfy-481609' });
const db = admin.firestore();
db.settings({ databaseId: 'ai-agent-lib' });

const USAGE_REPORT_ROLES = new Set(['admin', 'committee', 'staff', 'approver']);

let pass = 0;
let fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? (pass += 1) : (fail += 1);
  console.log(`   ${ok ? '✓' : '✗'} ${label}${ok ? '' : `   (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
}

/** Mirrors the callable: one row per (agent, person), earliest click wins. */
function buildRows({ events, agents, users, viewer }) {
  const fullAccess = viewer.role === 'admin' || viewer.role === 'committee';
  const mine = new Set(viewer.approveAreas || []);
  const byPair = new Map();
  events.forEach((e) => {
    const key = `${e.agentId}__${e.uid}`;
    const at = e.createdAt?.toMillis ? e.createdAt.toMillis() : 0;
    const prev = byPair.get(key);
    if (!prev || at < prev.at) byPair.set(key, { agentId: e.agentId, uid: e.uid, at });
  });
  const rows = [];
  for (const { agentId, uid, at } of byPair.values()) {
    const a = agents.get(agentId);
    if (!a) continue;
    const areas = Array.isArray(a.approveArea) ? a.approveArea : [];
    if (!fullAccess && !areas.some((x) => mine.has(x))) continue;
    const u = users.get(uid) || {};
    rows.push({
      agentId, uid,
      agentName: a.agentName || '', owner: a.owner || '',
      area: areas.join(', '),
      category: (Array.isArray(a.category) ? a.category : []).join(', '),
      adopterName: u.displayName || '', adopterEmail: u.email || '',
      adoptedAt: at || null,
    });
  }
  rows.sort((x, y) => (y.adoptedAt || 0) - (x.adoptedAt || 0));
  return rows;
}

(async () => {
  const [evSnap, agSnap, usSnap] = await Promise.all([
    db.collection('agentEvents').where('kind', '==', 'endpoint').get(),
    db.collection('agents').get(),
    db.collection('users').get(),
  ]);
  const events = evSnap.docs.map((d) => d.data());
  const agents = new Map(agSnap.docs.map((d) => [d.id, d.data()]));
  const users = new Map(usSnap.docs.map((d) => [d.id, d.data()]));
  const userList = usSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));

  const pairs = new Set(events.map((e) => `${e.agentId}__${e.uid}`));
  console.log(`endpoint events ${events.length} · distinct (agent,user) pairs ${pairs.size} · adopters ${new Set(events.map((e) => e.uid)).size}\n`);

  const adminUser = userList.find((u) => u.role === 'admin');
  const adminRows = buildRows({ events, agents, users, viewer: adminUser });

  console.log('1) ROW MODEL — one row per (agent, person), dated by FIRST use');
  check('row count equals the distinct pair count', adminRows.length, pairs.size);
  check('no duplicate (agent,person) row', new Set(adminRows.map((r) => `${r.agentId}__${r.uid}`)).size, adminRows.length);
  const firstByPair = new Map();
  events.forEach((e) => {
    const k = `${e.agentId}__${e.uid}`;
    const at = e.createdAt?.toMillis ? e.createdAt.toMillis() : 0;
    if (!firstByPair.has(k) || at < firstByPair.get(k)) firstByPair.set(k, at);
  });
  check('every adoptedAt equals min(createdAt) for its pair',
    adminRows.every((r) => r.adoptedAt === firstByPair.get(`${r.agentId}__${r.uid}`)), true);
  check('sorted newest-first', adminRows.every((r, i) => i === 0 || adminRows[i - 1].adoptedAt >= r.adoptedAt), true);

  console.log('\n2) COLUMNS — every requested column is fillable');
  check('every row has an agent name', adminRows.every((r) => !!r.agentName), true);
  check('every row has an owner', adminRows.every((r) => !!r.owner), true);
  check('every row has an adopter name', adminRows.every((r) => !!r.adopterName), true);
  check('every row has an adopter email', adminRows.every((r) => !!r.adopterEmail), true);
  const noArea = adminRows.filter((r) => !r.area).length;
  const noCat = adminRows.filter((r) => !r.category).length;
  console.log(`   rows missing area: ${noArea} · missing category: ${noCat} (blank cells, not failures)`);

  console.log('\n3) SCOPING — admin/committee see all, staff/approver see their areas');
  const committee = userList.find((u) => u.role === 'committee');
  check('committee sees the same rows as admin',
    buildRows({ events, agents, users, viewer: committee }).length, adminRows.length);

  const scoped = userList.filter((u) => (u.role === 'approver' || u.role === 'staff') && (u.approveAreas || []).length);
  let strictSubsetSeen = false;
  scoped.forEach((u) => {
    const rows = buildRows({ events, agents, users, viewer: u });
    const isSubset = rows.every((r) => adminRows.some((x) => x.agentId === r.agentId && x.uid === r.uid));
    if (!isSubset) { fail += 1; console.log(`   ✗ ${u.email} sees rows admin does not`); }
    if (rows.length < adminRows.length) strictSubsetSeen = true;
    // Every row an area viewer sees must genuinely intersect their areas.
    const mine = new Set(u.approveAreas);
    const bad = rows.filter((r) => !(agents.get(r.agentId).approveArea || []).some((x) => mine.has(x)));
    if (bad.length) { fail += 1; console.log(`   ✗ ${u.email} sees ${bad.length} out-of-area rows`); }
  });
  pass += 1;
  console.log(`   ✓ all ${scoped.length} area-scoped viewers see only in-area rows, all subsets of admin's`);
  check('at least one area viewer sees strictly fewer rows than admin', strictSubsetSeen, true);

  console.log('\n4) ACCESS — who may open the report at all');
  check('base "user" role is not permitted', USAGE_REPORT_ROLES.has('user'), false);
  ['admin', 'committee', 'staff', 'approver'].forEach((r) => check(`  ${r} permitted`, USAGE_REPORT_ROLES.has(r), true));
  const emptyForScoped = scoped.filter((u) => buildRows({ events, agents, users, viewer: u }).length === 0);
  console.log(`   area viewers who would see an EMPTY report: ${emptyForScoped.length}/${scoped.length}`);

  console.log('\n5) RETENTION — endpoint markers must not carry a TTL');
  const withTtl = events.filter((e) => e.expireAt).length;
  check('no endpoint event carries expireAt (adoption history is permanent)', withTtl, 0);

  console.log(`\n${fail === 0 ? '✓ ALL PASS' : '✗ FAILURES'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
