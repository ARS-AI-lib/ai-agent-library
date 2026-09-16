#!/usr/bin/env node
/**
 * Exercise the Ready-to-Use / rename rules against LIVE data (2026-08-19).
 *
 * Requires functions/agentReadyRules.js — the same module index.js calls, not
 * a copy — so a rule change that breaks the matrix shows up here rather than
 * in production. Same reasoning as verify-endpoint-files.cjs.
 *
 * Read-only: queries agents and users, never writes.
 *
 * Usage:  node functions/verify-agent-ready.cjs
 */

const admin = require('firebase-admin');
const {
  checkAgentActor, checkMarkReady, checkRenameDecider, checkRenameValue,
  safeEndpointUrl, isAgentCreator,
} = require('./agentReadyRules');
const { checkUploadPermission } = require('./endpointFileRules');

admin.initializeApp({ projectId: 'wolfy-481609' });
const db = admin.firestore();
db.settings({ databaseId: 'ai-agent-lib' });

let pass = 0;
let fail = 0;
function check(label, got, want) {
  const ok = got === want;
  ok ? (pass += 1) : (fail += 1);
  console.log(`   ${ok ? '✓' : '✗'} ${label}${ok ? '' : `   (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
}

(async () => {
  const [agentSnap, userSnap] = await Promise.all([
    db.collection('agents').get(),
    db.collection('users').get(),
  ]);
  const live = agentSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((a) => a.approvalStatus === 'approved' && a.archived !== true);
  const users = userSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const deployApproved = live.filter((a) => a.deploymentStatus === 'approved');
  const notDeployApproved = live.filter((a) => a.deploymentStatus !== 'approved');

  const ctx = (u) => ({
    role: u.role, userEmail: u.email, userUid: u.id, userApproveAreas: u.approveAreas,
  });
  const allowed = (agent, u) => checkAgentActor({ agent, ...ctx(u) }) === null;

  console.log(`live ${live.length} · deploy-approved ${deployApproved.length} · users ${users.length}\n`);

  // ── 1. actor permission ─────────────────────────────────────────────
  console.log('1) checkAgentActor — who may flip to 100% / edit endpoint');
  const admins = users.filter((u) => u.role === 'admin');
  const plain = users.filter((u) => u.role === 'user');
  const committee = users.filter((u) => u.role === 'committee');
  const approvers = users.filter((u) => u.role === 'approver');

  check('admin allowed on every deploy-approved agent',
    admins.every((u) => deployApproved.every((a) => allowed(a, u))), true);
  check('committee NOT allowed by role alone (not in AREA_ROLES)',
    committee.some((u) => deployApproved.some((a) => allowed(a, u) && !isAgentCreator(a, ctx(u)))), false);

  const platform = approvers.find((u) => (u.approveAreas || []).includes('Platform, DevOps & Operations'));
  if (platform) {
    const want = deployApproved.filter((a) => (a.approveArea || []).includes('Platform, DevOps & Operations')).length;
    const got = deployApproved.filter((a) => allowed(a, platform)).length;
    check(`${platform.email} reaches its ${want} Platform/DevOps agents`, got, want);
    const security = deployApproved.find((a) => (a.approveArea || []).includes('Security'));
    if (security) check(`   ...and is blocked on "${security.agentName}" (Security area)`, allowed(security, platform), false);
  }

  // Creator identity: the whole point of the email-first rule.
  const emailToUser = new Map(users.map((u) => [String(u.email || '').toLowerCase(), u]));
  let creatorPairs = 0;
  let creatorAllowed = 0;
  live.forEach((a) => {
    (a.creatorEmails || []).forEach((e) => {
      const u = emailToUser.get(String(e || '').toLowerCase());
      if (!u) return;
      creatorPairs += 1;
      if (allowed(a, u)) creatorAllowed += 1;
    });
  });
  check(`every known creator is allowed on their own agent (${creatorAllowed}/${creatorPairs})`,
    creatorPairs > 0 && creatorAllowed === creatorPairs, true);

  // A base 'user' must NOT reach agents they did not create.
  const plainWithAgents = plain.filter((u) => live.some((a) => isAgentCreator(a, ctx(u))));
  if (plainWithAgents.length) {
    const u = plainWithAgents[0];
    const notMine = live.filter((a) => !isAgentCreator(a, ctx(u)));
    check(`base user "${u.email}" blocked on all ${notMine.length} agents they didn't create`,
      notMine.every((a) => !allowed(a, u)), true);
  }
  // The finding this rule was built on: `createdBy` is import-mangled on most
  // rows, so email must be the load-bearing path. Measure the split across
  // REAL users rather than asserting on a synthetic uid that could never
  // authenticate.
  const uidSet = new Set(users.map((u) => u.id));
  let viaEmail = 0;
  let viaUid = 0;
  users.forEach((u) => live.forEach((a) => {
    const email = String(u.email || '').toLowerCase();
    const byEmail = !!email && (a.creatorEmails || []).some((e) => String(e || '').toLowerCase() === email);
    const byUid = !!(a.createdBy && a.createdBy === u.id);
    if (byEmail) viaEmail += 1;
    if (byUid && !byEmail) viaUid += 1;
  }));
  console.log(`   creator grants by path — email: ${viaEmail}, uid-only: ${viaUid}`);
  check('email is the load-bearing creator path (uid alone would lose most grants)',
    viaEmail > viaUid, true);
  check(`${live.filter((a) => a.createdBy && !uidSet.has(a.createdBy)).length} agents carry a createdBy matching no real user — those grant creator to nobody`,
    live.filter((a) => a.createdBy && !uidSet.has(a.createdBy)).every((a) => !users.some((u) => u.id === a.createdBy)),
    true);

  // ── 2. the 100% gate ────────────────────────────────────────────────
  console.log('\n2) checkMarkReady — endpoint required, deploy-approval required');
  const withEp = deployApproved.find((a) => String(a.endpoint || '').trim());
  const noEp = deployApproved.find((a) => !String(a.endpoint || '').trim() && !a.endpointFile?.storagePath);
  if (withEp) check(`agent with an endpoint passes ("${withEp.agentName}")`,
    !checkMarkReady({ agent: withEp }).code, true);
  if (noEp) {
    check(`agent with no endpoint & no file is REJECTED ("${noEp.agentName}")`,
      checkMarkReady({ agent: noEp }).code, 'failed-precondition');
    check('   ...but passes when a URL is supplied in the call',
      !checkMarkReady({ agent: noEp, endpointUrl: 'https://example.com/x' }).code, true);
    check('   ...and a javascript: URL is rejected',
      checkMarkReady({ agent: noEp, endpointUrl: 'javascript:alert(1)' }).code, 'invalid-argument');
  }
  const fileOnly = deployApproved.find((a) => a.endpointFile?.storagePath);
  if (fileOnly) check(`agent with an uploaded file passes ("${fileOnly.agentName}")`,
    !checkMarkReady({ agent: fileOnly }).code, true);
  check(`all ${notDeployApproved.length} non-deploy-approved agents rejected even with a URL`,
    notDeployApproved.every((a) => checkMarkReady({ agent: a, endpointUrl: 'https://x.com' }).code === 'failed-precondition'),
    true);
  check('archived agent rejected',
    checkMarkReady({ agent: { ...deployApproved[0], archived: true } }).code, 'failed-precondition');

  // Non-reusable exemption (2026-09-16): a tool built for one specific
  // purpose is never handed to a second user, so the whole reason this gate
  // exists does not apply. Reuse noEp (deploy-approved, no endpoint, no
  // file) rather than fabricating a fixture, and confirm the exemption is
  // keyed on the VALUE, not just any truthy reusable field.
  if (noEp) {
    check('   Non-reusable agent with no endpoint/file PASSES (the new exemption)',
      !checkMarkReady({ agent: { ...noEp, reusable: 'Non-reusable' } }).code, true);
    check('   ...but "Reusable with Conditions" (a different value) is still REJECTED',
      checkMarkReady({ agent: { ...noEp, reusable: 'Reusable with Conditions' } }).code, 'failed-precondition');
    check('   ...and plain "Reusable" is still REJECTED',
      checkMarkReady({ agent: { ...noEp, reusable: 'Reusable' } }).code, 'failed-precondition');
  }

  console.log('\n   safeEndpointUrl:');
  check('   https passes', safeEndpointUrl('https://a.com/b'), 'https://a.com/b');
  check('   bare host gets https', safeEndpointUrl('a.com/b'), 'https://a.com/b');
  check('   javascript: rejected', safeEndpointUrl('javascript:alert(1)'), '');
  check('   data: rejected', safeEndpointUrl('data:text/html,x'), '');
  check('   empty rejected', safeEndpointUrl(''), '');

  // ── 3. rename ───────────────────────────────────────────────────────
  console.log('\n3) rename decider + value');
  const anyAgent = deployApproved[0];
  check('admin may decide', admins.every((u) => checkRenameDecider({ agent: anyAgent, role: u.role, userApproveAreas: u.approveAreas }) === null), true);
  check('staff may NOT decide, even in-area (approver act, not staff)',
    checkRenameDecider({ agent: anyAgent, role: 'staff', userApproveAreas: anyAgent.approveArea || [] })?.code,
    'permission-denied');
  check('creator may NOT self-approve their own rename request',
    checkRenameDecider({ agent: anyAgent, role: 'user', userApproveAreas: anyAgent.approveArea || [] })?.code,
    'permission-denied');
  if (platform) {
    const plat = deployApproved.find((a) => (a.approveArea || []).includes('Platform, DevOps & Operations'));
    if (plat) check(`area approver may decide on "${plat.agentName}"`,
      checkRenameDecider({ agent: plat, role: 'approver', userApproveAreas: platform.approveAreas }) === null, true);
    const sec = deployApproved.find((a) => (a.approveArea || []).includes('Security'));
    if (sec) check('   ...blocked outside their area',
      checkRenameDecider({ agent: sec, role: 'approver', userApproveAreas: platform.approveAreas }) === null, false);
  }
  check('empty new name rejected', checkRenameValue({ agent: anyAgent, requestedName: '  ' })?.code, 'invalid-argument');
  check('unchanged name rejected', checkRenameValue({ agent: anyAgent, requestedName: anyAgent.agentName })?.code, 'invalid-argument');
  check('valid new name accepted', checkRenameValue({ agent: anyAgent, requestedName: 'Something Else' }), null);

  // ── 4. upload shares the same actor test now ────────────────────────
  console.log('\n4) upload permission now shares checkAgentActor');
  let creatorUploadFixed = 0;
  live.filter((a) => a.deploymentStatus === 'approved').forEach((a) => {
    (a.creatorEmails || []).forEach((e) => {
      const u = emailToUser.get(String(e || '').toLowerCase());
      if (u && u.role === 'user' && checkUploadPermission({ agent: a, ...ctx(u) }) === null) creatorUploadFixed += 1;
    });
  });
  console.log(`   base-'user' creators who can now upload on their own agent: ${creatorUploadFixed} (was 0 before this change)`);
  check('non-deploy-approved still blocked for upload even for admin',
    admins.every((u) => notDeployApproved.every((a) => checkUploadPermission({ agent: a, ...ctx(u) })?.code === 'failed-precondition')),
    true);

  console.log(`\n${fail === 0 ? '✓ ALL PASS' : '✗ FAILURES'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
