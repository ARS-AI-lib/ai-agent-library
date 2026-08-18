#!/usr/bin/env node
/**
 * Exercise the endpoint-file upload rules against LIVE data (2026-08-18).
 *
 * Requires `functions/endpointFileRules.js` — the same module index.js calls,
 * not a copy — so a rule change that breaks the matrix shows up here rather
 * than in production. Same reasoning as regression.cjs importing chatPrompt.js.
 *
 * Read-only: it queries agents and users and never writes anything.
 *
 * Usage:  node functions/verify-endpoint-files.cjs
 */

const admin = require('firebase-admin');
const {
  checkUploadPermission, checkUploadFile, safeName, isOrgEmail, MAX_UPLOAD_BYTES,
} = require('./endpointFileRules');

admin.initializeApp({ projectId: 'wolfy-481609' });
const db = admin.firestore();
db.settings({ databaseId: 'ai-agent-lib' });

let pass = 0;
let fail = 0;
function check(label, got, want) {
  const ok = got === want;
  ok ? (pass += 1) : (fail += 1);
  console.log(`   ${ok ? '✓' : '✗'} ${label}${ok ? '' : `   (got ${got}, want ${want})`}`);
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
  const eligible = live.filter((a) => a.deploymentStatus === 'approved');
  const ineligible = live.filter((a) => a.deploymentStatus !== 'approved');

  const allowed = (agent, u) =>
    checkUploadPermission({ agent, role: u.role, userApproveAreas: u.approveAreas }) === null;
  const countAllowed = (u) => eligible.filter((a) => allowed(a, u)).length;

  console.log(`live agents ${live.length} · deploy-approved ${eligible.length} · users ${users.length}\n`);

  // ── 1. role gate ────────────────────────────────────────────────────
  console.log('1) role gate');
  const admins = users.filter((u) => u.role === 'admin');
  const staff = users.filter((u) => u.role === 'staff');
  const approvers = users.filter((u) => u.role === 'approver');
  const plain = users.filter((u) => u.role === 'user');
  const committee = users.filter((u) => u.role === 'committee');

  check(`admin (${admins.length}) sees all ${eligible.length} eligible agents`,
    admins.every((u) => countAllowed(u) === eligible.length), true);
  check(`role "user" (${plain.length}) is blocked on every agent`,
    plain.every((u) => countAllowed(u) === 0), true);
  check(`role "committee" (${committee.length}) is blocked — not in UPLOAD_ROLES`,
    committee.every((u) => countAllowed(u) === 0), true);

  // ── 2. area scoping, measured not assumed ───────────────────────────
  console.log('\n2) area scoping (staff + approver)');
  const staffEmpty = staff.filter((u) => !(u.approveAreas || []).length);
  check(`all ${staff.length} staff currently hold no approveAreas`,
    staffEmpty.length === staff.length, true);
  check('...so every staff member is allowed 0 agents (empty area != wildcard)',
    staff.every((u) => countAllowed(u) === 0), true);

  console.log('\n   per-approver reach:');
  approvers
    .map((u) => ({ u, n: countAllowed(u) }))
    .sort((a, b) => b.n - a.n)
    .forEach(({ u, n }) => {
      console.log(`     ${String(n).padStart(3)}  ${(u.email || u.id).padEnd(34)} ${(u.approveAreas || []).join(', ') || '(none)'}`);
    });

  const platform = approvers.find((u) => (u.approveAreas || []).includes('Platform, DevOps & Operations'));
  if (platform) {
    const wantPlat = eligible.filter((a) => (a.approveArea || []).includes('Platform, DevOps & Operations')).length;
    check(`\n   ${platform.email} reaches exactly the ${wantPlat} Platform/DevOps agents`,
      countAllowed(platform), wantPlat);
    const security = eligible.find((a) => (a.approveArea || []).includes('Security'));
    if (security) {
      check(`   ...and is blocked on "${security.agentName}" (Security area)`,
        allowed(security, platform), false);
    }
  }
  // Scoped to roles that can actually upload. A committee member holds all 16
  // areas including Security, but committee is not in UPLOAD_ROLES, so it
  // grants nothing here — asserting over "every non-admin" would fail on that
  // and tell us nothing useful.
  const uploaderHasSecurity = users.some(
    (u) => (u.role === 'staff' || u.role === 'approver') && (u.approveAreas || []).includes('Security'),
  );
  check('   no staff/approver holds "Security" -> those agents are admin-only', uploaderHasSecurity, false);

  // ── 3. agent-state gate ─────────────────────────────────────────────
  console.log('\n3) agent state');
  const anAdmin = admins[0];
  check(`admin still blocked on all ${ineligible.length} non-deploy-approved agents`,
    ineligible.every((a) => !allowed(a, anAdmin)), true);
  check('admin blocked on an archived agent',
    allowed({ ...eligible[0], archived: true }, anAdmin), false);
  check('admin blocked on a pending agent',
    allowed({ ...eligible[0], approvalStatus: 'pending' }, anAdmin), false);
  check('agent with NO stored approveArea is admin-only (degrades safe)',
    approvers.some((u) => allowed({ ...eligible[0], approveArea: [] }, u)), false);

  // ── 4. file validation ──────────────────────────────────────────────
  console.log('\n4) file validation');
  const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100)]);
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(100)]);
  const exe = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(100)]); // "MZ"
  const text = Buffer.from('# hello\nสวัสดี\n');
  const okFile = (filename, buf) => checkUploadFile({ filename, buf }) === null;

  check('real .zip accepted', okFile('skill.zip', zip), true);
  check('real .pdf accepted', okFile('guide.pdf', pdf), true);
  check('.md with Thai text accepted', okFile('SKILL.md', text), true);
  check('.csv accepted', okFile('data.csv', text), true);
  check('.exe renamed to .zip REJECTED (magic bytes)', okFile('payload.zip', exe), false);
  check('.exe renamed to .pdf REJECTED (magic bytes)', okFile('payload.pdf', exe), false);
  check('binary renamed to .txt REJECTED (NUL byte)', okFile('notes.txt', exe), false);
  check('.docx rejected (not in allow-list)', okFile('report.docx', zip), false);
  check('.exe rejected outright', okFile('run.exe', exe), false);
  check('no extension rejected', okFile('README', text), false);
  check('empty file rejected', okFile('a.md', Buffer.alloc(0)), false);
  check(`${MAX_UPLOAD_BYTES / 1024 / 1024} MB + 1 byte rejected`,
    okFile('big.zip', Buffer.concat([zip, Buffer.alloc(MAX_UPLOAD_BYTES)])), false);

  // ── 5. filename safety ──────────────────────────────────────────────
  console.log('\n5) filename safety');
  check('path traversal stripped', safeName('../../etc/passwd'), 'passwd');
  check('windows path stripped', safeName('C:\\tmp\\evil.zip'), 'evil.zip');
  check('thai filename preserved', safeName('คู่มือ.pdf'), 'คู่มือ.pdf');
  check('never returns empty', safeName('///') !== '', true);

  // ── 6. org domain gate ──────────────────────────────────────────────
  console.log('\n6) org domain gate (the SSO check on download)');
  check('arise.tech accepted', isOrgEmail('a@arise.tech'), true);
  check('infinitaskt.com accepted', isOrgEmail('a@infinitaskt.com'), true);
  check('krungthai.com accepted', isOrgEmail('a@krungthai.com'), true);
  check('gmail rejected', isOrgEmail('a@gmail.com'), false);
  check('lookalike domain rejected', isOrgEmail('a@notarise.tech.evil.com'), false);
  check('empty rejected', isOrgEmail(''), false);

  console.log(`\n${fail === 0 ? '✓ ALL PASS' : '✗ FAILURES'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
