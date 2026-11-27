// Emulator test for the assessment-backfill rules (2026-11-27).
//   npx firebase-tools emulators:exec --config firebase.rules-test.json \
//     --only auth,firestore --project wolfy-481609 "node functions/verify-backfill-rules.cjs"
// Acts as each role through the CLIENT SDK (so rules are really evaluated);
// seeds via the Admin SDK (bypasses rules). Audience table comes from the
// shipped src/lib/inbox.js — not copied.
const fs = require('fs');
const path = require('path');

function loadEsm(file) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', file), 'utf8')
    .replace(/^\s*import\s[^;]*;\s*$/gm, '').replace(/^export\s+/gm, '');
  const decls = [...code.matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  return new Function(`${code}\n;return { ${[...new Set(decls)].join(', ')} };`)();
}

const { initializeApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithCredential, GoogleAuthProvider } = require('firebase/auth');
const fsdk = require('firebase/firestore');
const admin = require('firebase-admin');
const { getFirestore: adminFs, Timestamp } = require('firebase-admin/firestore');

const PROJECT = 'wolfy-481609';
const DB = 'ai-agent-lib';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const adminApp = admin.initializeApp({ projectId: PROJECT }, 'admin');
const adb = adminFs(adminApp, DB);

let failed = 0;
function report(name, ok, extra) {
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${name}${!ok && extra ? ` — ${extra}` : ''}`);
}
const allowed = async (name, p) => { try { await p; report(name, true); } catch (e) { report(name, false, e.code || e.message); } };
const denied = async (name, p) => { try { await p; report(name, false, 'expected denial, got success'); } catch (e) { report(name, e.code === 'permission-denied', e.code || e.message); } };

const ACTORS = {
  user: { email: 'u@arise.tech', role: 'user' },
  approver: { email: 'ap@arise.tech', role: 'approver' },
  staff: { email: 'st@infinitaskt.com', role: 'staff' },
  committee: { email: 'co@arise.tech', role: 'committee' },
  admin: { email: 'ad@arise.tech', role: 'admin' },
  gmail: { email: 'x@gmail.com', role: 'admin', verified: true },      // role doc exists but domain is wrong
  unverified: { email: 'uv@arise.tech', role: 'admin', verified: false }, // role doc exists but email unverified
};

async function connect(key, a) {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'fake-key' }, key);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const cred = GoogleAuthProvider.credential(JSON.stringify({
    sub: `emu-${a.email}`, email: a.email, email_verified: a.verified !== false, name: a.email.split('@')[0],
  }));
  const r = await signInWithCredential(auth, cred);
  const db = fsdk.getFirestore(app, DB);
  fsdk.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  return { uid: r.user.uid, db };
}

const ts = () => fsdk.serverTimestamp();

(async () => {
  const c = {};
  for (const [k, a] of Object.entries(ACTORS)) c[k] = await connect(k, a);
  for (const [k, a] of Object.entries(ACTORS)) await adb.doc(`users/${c[k].uid}`).set({ role: a.role, email: a.email });
  const now = Timestamp.now();
  // inboxMessages (toEmail stored lower-cased)
  await adb.doc('inboxMessages/m-u').set({ toEmail: 'u@arise.tech', title: 't', body: 'b', link: '', kind: 'assessment-backfill', createdAt: now });
  await adb.doc('inboxMessages/m-ap').set({ toEmail: 'ap@arise.tech', title: 't', body: 'b', link: '', kind: 'assessment-backfill', createdAt: now });
  await adb.doc('assessmentCampaigns/current').set({ dueDate: '2026-12-31', channels: [], sends: [] });
  await adb.doc('assessmentReviews/r1').set({ agentId: 'a1', agentName: 'A', approveArea: 'QA', answers: {}, decl: {}, verdict: null, previous: null, requestedBy: 'u@arise.tech', requestedByUid: c.user.uid, createdAt: now, status: 'pending' });
  // agent owned by the user (creator) with approved-free status
  await adb.doc('agents/a1').set({ agentName: 'A', approvalStatus: 'approved', createdBy: c.user.uid, creatorEmails: ['u@arise.tech'], deploymentStatus: 'none', devProgress: 50 });

  const d = (k, col, id) => fsdk.doc(c[k].db, col, id);

  // ── /inboxMessages ──
  await allowed('inboxMessages own read', fsdk.getDoc(d('user', 'inboxMessages', 'm-u')));
  await denied('inboxMessages other read denied', fsdk.getDoc(d('user', 'inboxMessages', 'm-ap')));
  await denied('inboxMessages admin reading other denied', fsdk.getDoc(d('admin', 'inboxMessages', 'm-u')));
  try {
    const s = await fsdk.getDocs(fsdk.query(fsdk.collection(c.user.db, 'inboxMessages'), fsdk.where('toEmail', '==', 'u@arise.tech')));
    report('inboxMessages filtered list returns only own', s.size === 1 && s.docs[0].id === 'm-u', `size ${s.size}`);
  } catch (e) { report('inboxMessages filtered list', false, e.code || e.message); }
  await denied('inboxMessages unfiltered list denied', fsdk.getDocs(fsdk.collection(c.user.db, 'inboxMessages')));
  await denied('inboxMessages gmail read denied', fsdk.getDoc(d('gmail', 'inboxMessages', 'm-u')));
  await denied('inboxMessages create denied', fsdk.setDoc(d('user', 'inboxMessages', 'x'), { toEmail: 'u@arise.tech', title: 't', body: 'b', link: '', kind: 'assessment-backfill', createdAt: ts() }));
  await denied('inboxMessages admin create denied', fsdk.setDoc(d('admin', 'inboxMessages', 'x'), { toEmail: 'u@arise.tech' }));
  await denied('inboxMessages update denied', fsdk.updateDoc(d('user', 'inboxMessages', 'm-u'), { title: 'z' }));
  await denied('inboxMessages delete denied', fsdk.deleteDoc(d('user', 'inboxMessages', 'm-u')));

  // ── /assessmentCampaigns ──
  for (const [k, ok] of Object.entries({ admin: 1, committee: 1, approver: 0, staff: 0, user: 0 })) {
    await (ok ? allowed : denied)(`campaign read ${k} ${ok ? 'allowed' : 'denied'}`, fsdk.getDoc(d(k, 'assessmentCampaigns', 'current')));
  }
  await denied('campaign write admin denied', fsdk.setDoc(d('admin', 'assessmentCampaigns', 'current'), { dueDate: 'x' }));
  await denied('campaign write committee denied', fsdk.setDoc(d('committee', 'assessmentCampaigns', 'z'), { dueDate: 'x' }));

  // ── /assessmentReviews ──
  for (const [k, ok] of Object.entries({ user: 1, approver: 1, staff: 0, committee: 1, admin: 1, gmail: 0 })) {
    // 'user' is the requestedBy; staff is neither approver-or-above nor requester
    await (ok ? allowed : denied)(`review read ${k} ${ok ? 'allowed' : 'denied'}`, fsdk.getDoc(d(k, 'assessmentReviews', 'r1')));
  }
  await denied('review read other user denied', fsdk.getDoc(d('staff', 'assessmentReviews', 'r1')));
  await adb.doc('assessmentReviews/r2').set({ agentId: 'a1', requestedBy: 'x@arise.tech', requestedByUid: 'someone-else', status: 'pending' });
  await denied('review read with different requestedByUid denied', fsdk.getDoc(d('user', 'assessmentReviews', 'r2')));
  await denied('review create denied', fsdk.setDoc(d('user', 'assessmentReviews', 'n'), { requestedBy: c.user.uid }));
  await denied('review admin create denied', fsdk.setDoc(d('admin', 'assessmentReviews', 'n'), { requestedBy: c.admin.uid }));
  await denied('review update denied', fsdk.updateDoc(d('approver', 'assessmentReviews', 'r1'), { status: 'approved' }));
  await denied('review delete denied', fsdk.deleteDoc(d('user', 'assessmentReviews', 'r1')));

  // ── agent.assessment not client-writable by a creator ──
  const A = { assessment: { level: 'Low' }, updatedAt: ts() };
  await denied('creator alone writing assessment denied', fsdk.updateDoc(d('user', 'agents', 'a1'), A));
  await denied('creator progress update + assessment denied', fsdk.updateDoc(d('user', 'agents', 'a1'), { devProgress: 60, ...A }));
  await denied('creator detail edit + assessment denied', fsdk.updateDoc(d('user', 'agents', 'a1'), { description: 'x', ...A }));
  await denied('creator deploy request + assessment denied', fsdk.updateDoc(d('user', 'agents', 'a1'), { devProgress: 95, deploymentStatus: 'requested', assessment: { level: 'Low' }, updatedAt: ts() }));
  await denied('staff writing assessment denied', fsdk.updateDoc(d('staff', 'agents', 'a1'), A));
  await denied('approver writing assessment denied', fsdk.updateDoc(d('approver', 'agents', 'a1'), A));
  await allowed('creator normal progress update still allowed', fsdk.updateDoc(d('user', 'agents', 'a1'), { devProgress: 60, updatedAt: ts() }));

  console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('fatal', e); process.exit(1); });
