// Emulator test: deploy request may carry deployChecklist + screening (2026-11-26).
//   npx firebase-tools emulators:exec --config firebase.rules-test.json \
//     --only auth,firestore --project wolfy-481609 "node functions/verify-screening-rules.cjs"
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
const report = (name, ok, extra) => { if (!ok) failed++; console.log(`${ok ? '✓' : '✗'} ${name}${!ok && extra ? ` — ${extra}` : ''}`); };
const allowed = async (name, p) => { try { await p; report(name, true); } catch (e) { report(name, false, e.code || e.message); } };
const denied = async (name, p) => { try { await p; report(name, false, 'expected denial, got success'); } catch (e) { report(name, e.code === 'permission-denied', e.code || e.message); } };

async function connect(key, email) {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'fake-key' }, key);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const r = await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: `emu-${email}`, email, email_verified: true, name: email.split('@')[0] })));
  const db = fsdk.getFirestore(app, DB);
  fsdk.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  return { uid: r.user.uid, db };
}

(async () => {
  const creator = await connect('creator', 'cr@arise.tech');
  const other = await connect('other', 'ot@arise.tech');
  await adb.collection('users').doc(creator.uid).set({ role: 'user', email: 'cr@arise.tech' });
  await adb.collection('users').doc(other.uid).set({ role: 'user', email: 'ot@arise.tech' });
  const mk = async (id) => adb.collection('agents').doc(id).set({
    agentName: id, approvalStatus: 'approved', createdBy: creator.uid, creatorEmails: ['cr@arise.tech'],
    devProgress: 40, deploymentStatus: 'none', aiAgent: true, skillMd: false,
  });
  await Promise.all(['a1', 'a2', 'a3'].map(mk));

  const base = (n) => ({
    devProgress: 95, deploymentStatus: 'requested', deployRequestedBy: creator.uid,
    deployRequestedAt: fsdk.serverTimestamp(), progressUpdatedAt: fsdk.serverTimestamp(), updatedAt: fsdk.serverTimestamp(), ...n,
  });
  const extras = {
    deployChecklist: { tier: 'T2', checked: ['rbac'], at: fsdk.serverTimestamp() },
    permittedDomains: 'DGL', prohibitedUses: 'none', requiredSkills: 'ไม่ต้อง', tool: 'n8n', llm: 'Gemini',
    screening: { v: 1, answers: { C1: 0 }, level: 'Low', total: 0, must: [], should: [], preAt: fsdk.serverTimestamp(), deployAt: fsdk.serverTimestamp() },
  };
  const ref = (u, id) => fsdk.doc(u.db, 'agents', id);

  await allowed('creator deploy request + deployChecklist + screening', fsdk.updateDoc(ref(creator, 'a1'), base(extras)));
  await denied('creator deploy request with an extra unknown key', fsdk.updateDoc(ref(creator, 'a2'), base({ ...extras, sneaky: true })));
  await denied('non-creator cannot file the request', fsdk.updateDoc(ref(other, 'a3'), base(extras)));
  await denied('screening alone (no deploy fields) is not a creator edit', fsdk.updateDoc(ref(creator, 'a3'), { screening: extras.screening, updatedAt: fsdk.serverTimestamp() }));

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
