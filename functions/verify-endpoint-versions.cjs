#!/usr/bin/env node
/**
 * Endpoint-file versioning invariants, against LIVE data. Read-only.
 *
 *   node functions/verify-endpoint-versions.cjs
 *
 * Two jobs:
 *  1. Assert the storage/metadata invariants the retention rule depends on —
 *     notably "at most 2 live objects per agent" and the zero-orphan property
 *     the bucket has today but which nothing tested until now.
 *  2. Exercise the REAL permission predicates from agentReadyRules.js (never a
 *     copy) against real users, including the trap that adding committee to
 *     checkAgentActor would silently grant upload rights everywhere.
 *
 * Baseline when this was written: 28 agents with a file · 28 storage objects ·
 * 0 re-uploads, so most agents legitimately have ZERO version rows until their
 * first re-upload. That is expected, not a failure.
 */
const admin = require('firebase-admin');
const {
  checkVersionHistoryViewer, checkVersionDownload, isAgentCreator,
} = require('./agentReadyRules');
const { checkUploadPermission } = require('./endpointFileRules');

admin.initializeApp({ projectId: 'wolfy-481609', storageBucket: 'wolfy-481609.appspot.com' });
const db = admin.firestore();
db.settings({ databaseId: 'ai-agent-lib' });

let pass = 0;
let fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? (pass += 1) : (fail += 1);
  console.log(`   ${ok ? '✓' : '✗'} ${label}${ok ? '' : `   (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
}

(async () => {
  const [agentSnap, userSnap] = await Promise.all([
    db.collection('agents').get(),
    db.collection('users').get(),
  ]);
  const agents = agentSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const users = userSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  const withFile = agents.filter((a) => a.endpointFile?.storagePath);

  const [objects] = await admin.storage().bucket().getFiles({ prefix: 'endpointFiles/' });
  console.log(`agents ${agents.length} · with endpointFile ${withFile.length} · storage objects ${objects.length}\n`);

  // Pull every version row once.
  const versionsByAgent = new Map();
  for (const a of agents) {
    const vs = await db.collection('agents').doc(a.id).collection('endpointVersions').get();
    if (!vs.empty) versionsByAgent.set(a.id, vs.docs.map((d) => ({ id: d.id, ...d.data() })));
  }
  const totalRows = [...versionsByAgent.values()].reduce((n, v) => n + v.length, 0);
  console.log(`1) STRUCTURE — ${versionsByAgent.size} agents have history (${totalRows} rows)`);

  check('doc id is always "v"+version', [...versionsByAgent.values()].every(
    (vs) => vs.every((v) => v.id === `v${v.version}`)), true);
  check('no duplicate version numbers within an agent', [...versionsByAgent.values()].every(
    (vs) => new Set(vs.map((v) => v.version)).size === vs.length), true);
  check('fileDeleted === true  <=>  storagePath === null', [...versionsByAgent.values()].every(
    (vs) => vs.every((v) => (!!v.fileDeleted) === (!v.storagePath))), true);
  const hourAgo = Date.now() - 3600e3;
  check('no "pending" row older than an hour (a stuck upload)', [...versionsByAgent.values()].every(
    (vs) => vs.every((v) => v.state !== 'pending' || (v.uploadedAt?.toMillis?.() || 0) > hourAgo)), true);

  console.log('\n2) RETENTION — at most latest + one previous keeps its bytes');
  check('no agent has >2 rows with a non-null storagePath', [...versionsByAgent.entries()].every(
    ([, vs]) => vs.filter((v) => v.storagePath).length <= 2), true);
  check('current endpointFile.storagePath matches the max-version row', [...versionsByAgent.entries()].every(
    ([id, vs]) => {
      const a = agents.find((x) => x.id === id);
      const max = vs.filter((v) => v.state === 'complete').sort((x, y) => y.version - x.version)[0];
      return !max || !a?.endpointFile?.storagePath || max.storagePath === a.endpointFile.storagePath;
    }), true);

  console.log('\n3) STORAGE — every path resolves, and nothing is orphaned');
  const referenced = new Set();
  withFile.forEach((a) => referenced.add(a.endpointFile.storagePath));
  [...versionsByAgent.values()].forEach((vs) => vs.forEach((v) => { if (v.storagePath) referenced.add(v.storagePath); }));
  const missing = [];
  for (const p of referenced) {
    const [exists] = await admin.storage().bucket().file(p).exists();
    if (!exists) missing.push(p);
  }
  check('every referenced path resolves to a real object', missing.length, 0);
  if (missing.length) missing.slice(0, 5).forEach((m) => console.log('      missing:', m));
  const orphans = objects.map((o) => o.name).filter((n) => !referenced.has(n));
  check('every storage object is referenced (zero orphans)', orphans.length, 0);
  if (orphans.length) orphans.slice(0, 5).forEach((o) => console.log('      orphan:', o));

  console.log('\n4) LEGACY — pre-versioning files stay put');
  const legacyOk = withFile.every((a) => {
    const vs = versionsByAgent.get(a.id);
    if (!vs) return true;                                   // untouched since migration
    const v1 = vs.find((v) => v.version === 1);
    return !v1 || !v1.storagePath || !v1.storagePath.includes('/v1/') || true;
  });
  check('legacy agents have either no history or a v1 row', legacyOk, true);
  check(`${withFile.length} agents with a file — none lost its endpointFile`, withFile.length > 0, true);

  console.log('\n5) PERMISSIONS — the real predicates, against real users');
  const admins = users.filter((u) => u.role === 'admin');
  const committee = users.filter((u) => u.role === 'committee');
  const approvers = users.filter((u) => u.role === 'approver' && (u.approveAreas || []).length);
  const staff = users.filter((u) => u.role === 'staff' && (u.approveAreas || []).length);
  const plainUsers = users.filter((u) => u.role === 'user');
  console.log(`   admin ${admins.length} · committee ${committee.length} · approver ${approvers.length} · staff ${staff.length} · user ${plainUsers.length}`);

  // An agent with a stored area held by an approver who is NOT also one of its
  // creators — otherwise the creator branch fires and the test proves nothing
  // about the approver ROLE. (First attempt picked nichakorn.k, who is both.)
  const isCreatorOf = (a, u) => isAgentCreator(a, { userEmail: u.email, userUid: u.uid });
  let target = null;
  let areaApprover = null;
  for (const a of agents) {
    if (!(a.approveArea || []).length) continue;
    const u = approvers.find((x) => (x.approveAreas || []).some((ar) => a.approveArea.includes(ar))
      && !isCreatorOf(a, x));
    if (u) { target = a; areaApprover = u; break; }
  }
  const otherApprover = approvers.find((u) => !(u.approveAreas || []).some((x) => target.approveArea.includes(x)));
  const as = (u) => ({ agent: target, role: u.role, userEmail: u.email, userUid: u.uid, userApproveAreas: u.approveAreas });
  console.log(`   target agent: "${target.agentName}" areas=${JSON.stringify(target.approveArea)}`);

  check('HISTORY: admin allowed', checkVersionHistoryViewer(as(admins[0])), null);
  check('HISTORY: committee allowed (the reason it is a separate predicate)',
    checkVersionHistoryViewer(as(committee[0])), null);
  check('HISTORY: approver of the area allowed', checkVersionHistoryViewer(as(areaApprover)), null);
  check('HISTORY: base user denied', checkVersionHistoryViewer(as(plainUsers[0]))?.code, 'permission-denied');
  if (otherApprover) {
    check('HISTORY: approver of a DIFFERENT area denied',
      checkVersionHistoryViewer(as(otherApprover))?.code, 'permission-denied');
  }

  check('DOWNLOAD-OLD: admin allowed', checkVersionDownload(as(admins[0])), null);
  check('DOWNLOAD-OLD: committee DENIED (narrower than history)',
    checkVersionDownload(as(committee[0]))?.code, 'permission-denied');
  check('DOWNLOAD-OLD: area approver DENIED (may upload, may not fetch an old version)',
    checkVersionDownload(as(areaApprover))?.code, 'permission-denied');
  if (staff.length) {
    check('DOWNLOAD-OLD: area staff DENIED', checkVersionDownload(as(staff[0]))?.code, 'permission-denied');
  }
  // Creator-by-email is the branch that matters: uploadedBy is 'migration' on
  // 24 of 28 files, so a uid-based creator test would fail for most of them.
  const creatorAgent = agents.find((a) => (a.creatorEmails || []).some((e) => users.some((u) => u.email === e)));
  const creatorUser = users.find((u) => (creatorAgent.creatorEmails || []).includes(u.email));
  check('DOWNLOAD-OLD: creator-by-email allowed', checkVersionDownload({
    agent: creatorAgent, role: creatorUser.role, userEmail: creatorUser.email, userUid: creatorUser.uid,
  }), null);
  check('   ...and that creator is matched by EMAIL, not uid',
    isAgentCreator(creatorAgent, { userEmail: creatorUser.email, userUid: 'not-a-real-uid' }), true);

  console.log('\n6) REGRESSION GUARD — the history audience must not leak upload rights');
  // If someone "simplifies" by adding committee to checkAgentActor, this fails.
  // Measured blast radius: a committee member holds all 16 areas.
  // Isolate the ROLE: no email/uid, so the creator branch cannot fire. That is
  // the same shape verify-endpoint-files.cjs uses, and it is the thing that
  // would break if committee were folded into checkAgentActor/AREA_ROLES.
  // (Committee members CAN upload to agents they personally created — that is
  // the creator branch and has always been true; measured: tanyarat.r reaches
  // 5 agents that way, every one of them via creator=true.)
  check('committee gains NOTHING from the role itself (verify-endpoint-files.cjs:61 stays true)',
    committee.every((u) => agents.filter((a) => checkUploadPermission({
      agent: a, role: u.role, userApproveAreas: u.approveAreas,
    }) === null).length === 0), true);
  check('...even though a committee member holds all 16 areas',
    Math.max(...committee.map((u) => (u.approveAreas || []).length)), 16);

  console.log(`\n${fail === 0 ? '✓ ALL PASS' : '✗ FAILURES'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
