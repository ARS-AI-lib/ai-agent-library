// Emulator test: /assessments + /assessmentArchive rules (2026-11-26).
//   firebase emulators:exec --config firebase.rules-test.json --only auth,firestore \
//     --project wolfy-481609 "node functions/verify-assessment-rules.cjs"
const { initializeApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithCredential, GoogleAuthProvider } = require('firebase/auth');
const fsdk = require('firebase/firestore');
const admin = require('firebase-admin');
const { getFirestore: adminFs } = require('firebase-admin/firestore');

const PROJECT = 'wolfy-481609';
const DB = 'ai-agent-lib';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const adb = adminFs(admin.initializeApp({ projectId: PROJECT }, 'admin'), DB);
let failed = 0;
const report = (n, ok, x) => { if (!ok) failed++; console.log(`${ok ? '✓' : '✗'} ${n}${!ok && x ? ` — ${x}` : ''}`); };
const allowed = async (n, p) => { try { await p; report(n, true); } catch (e) { report(n, false, e.code || e.message); } };
const denied = async (n, p) => { try { await p; report(n, false, 'expected denial, got success'); } catch (e) { report(n, e.code === 'permission-denied', e.code || e.message); } };

async function connect(key, email, role) {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'fake-key' }, key);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const r = await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: `emu-${email}`, email, email_verified: true, name: email.split('@')[0] })));
  await adb.collection('users').doc(r.user.uid).set({ role, email, approveAreas: [] });
  const db = fsdk.getFirestore(app, DB);
  fsdk.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  return { uid: r.user.uid, db };
}

(async () => {
  const user = await connect('user', 'u@arise.tech', 'user');
  const other = await connect('other', 'o@arise.tech', 'user');
  const approver = await connect('approver', 'ap@arise.tech', 'approver');
  const committee = await connect('committee', 'co@arise.tech', 'committee');
  const admin_ = await connect('admin', 'ad@arise.tech', 'admin');

  // agents the records point at
  await adb.collection('agents').doc('a1').set({ agentName: 'A', createdBy: user.uid, creatorEmails: ['u@arise.tech'], owner: 'T' });
  await adb.collection('agents').doc('a2').set({ agentName: 'B', createdBy: 'someone-else', creatorEmails: ['x@arise.tech'], owner: 'T' });
  const thisYear = new Date().getUTCFullYear();
  const rec = (uid, over = {}) => ({
    agentId: 'a1', agentName: 'A', owner: 'T', approveArea: ['QA'], stage: 'pre', answers: { C1: 'C1a' },
    decl: { description: 'd' }, createdBy: uid, year: thisYear, createdAt: fsdk.serverTimestamp(), ...over,
  });
  const col = (u) => fsdk.collection(u.db, 'assessments');

  await allowed('known user creates a pre record in their own name', fsdk.setDoc(fsdk.doc(user.db, 'assessments', 'r1'), rec(user.uid)));
  await allowed('known user creates a deploy record', fsdk.setDoc(fsdk.doc(user.db, 'assessments', 'r2'), rec(user.uid, { stage: 'deploy' })));
  await denied('record in someone else\'s name is denied', fsdk.setDoc(fsdk.doc(other.db, 'assessments', 'r3'), rec(user.uid)));
  await denied('extra key is denied', fsdk.setDoc(fsdk.doc(user.db, 'assessments', 'r4'), rec(user.uid, { sneaky: true })));
  await denied('bad stage is denied', fsdk.setDoc(fsdk.doc(user.db, 'assessments', 'r5'), rec(user.uid, { stage: 'x' })));
  await denied('client createdAt in the past is denied', fsdk.setDoc(fsdk.doc(user.db, 'assessments', 'r6'), rec(user.uid, { createdAt: fsdk.Timestamp.fromDate(new Date('2020-01-01')) })));
  await denied('record for an agent that does not exist is denied', fsdk.setDoc(fsdk.doc(user.db, 'assessments', 'r7'), rec(user.uid, { agentId: 'ghost' })));
  await denied('record for ANOTHER creator\'s agent is denied', fsdk.setDoc(fsdk.doc(user.db, 'assessments', 'r8'), rec(user.uid, { agentId: 'a2' })));
  await denied('forged past year (escapes the archive guard) is denied', fsdk.setDoc(fsdk.doc(user.db, 'assessments', 'r9'), rec(user.uid, { year: 2020 })));
  await denied('oversized answers map is denied', fsdk.setDoc(fsdk.doc(user.db, 'assessments', 'r10'), rec(user.uid, { answers: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`q${i}`, 'o'])) })));
  await allowed('admin may record for any agent', fsdk.setDoc(fsdk.doc(admin_.db, 'assessments', 'r11'), rec(admin_.uid, { agentId: 'a2' })));
  await denied('creator cannot update', fsdk.updateDoc(fsdk.doc(user.db, 'assessments', 'r1'), { year: 2025 }));
  await denied('creator cannot delete', fsdk.deleteDoc(fsdk.doc(user.db, 'assessments', 'r1')));
  await denied('admin cannot update either (immutable)', fsdk.updateDoc(fsdk.doc(admin_.db, 'assessments', 'r1'), { year: 2025 }));

  await allowed('approver lists all', fsdk.getDocs(col(approver)));
  await allowed('committee lists all', fsdk.getDocs(col(committee)));
  await allowed('admin lists all', fsdk.getDocs(col(admin_)));
  await denied('plain user cannot list (not even their own)', fsdk.getDocs(col(user)));
  await denied('plain user cannot get a record', fsdk.getDoc(fsdk.doc(user.db, 'assessments', 'r1')));

  await adb.collection('assessmentArchive').doc('2025').set({ count: 1 });
  await denied('admin cannot read the archive from the client', fsdk.getDoc(fsdk.doc(admin_.db, 'assessmentArchive', '2025')));
  await denied('nobody can write the archive from the client', fsdk.setDoc(fsdk.doc(admin_.db, 'assessmentArchive', '2024'), { count: 0 }));

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
