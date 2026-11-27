// Emulator test: deploy request may carry deployChecklist + screening (2026-11-26).
//   npx firebase-tools emulators:exec --config firebase.rules-test.json \
//     --only auth,firestore --project wolfy-481609 "node functions/verify-screening-rules.cjs"
const fs = require('fs');
const path = require('path');
function loadEsm(file) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', file), 'utf8').replace(/^\s*import\s[^;]*;\s*$/gm, '').replace(/^export\s+/gm, '');
  const decls = [...code.matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  return new Function(`${code}\n;return { ${[...new Set(decls)].join(', ')} };`)();
}
const { buildWorkflowDoc } = loadEsm('registrationType.js');
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
  const staff = await connect('staff', 'st@arise.tech');
  const committee = await connect('committee', 'cm@arise.tech');
  await adb.collection('users').doc(staff.uid).set({ role: 'staff', email: 'st@arise.tech' });
  await adb.collection('users').doc(committee.uid).set({ role: 'committee', email: 'cm@arise.tech' });
  await Promise.all(['a1', 'a2', 'a3', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'e1', 'e2', 'e3', 'e4', 'e5'].map(mk));

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

  // A deploy request must carry the checklist AND the assessment (2026-11-27, Motion Principles incident)
  const noScreening = { ...extras }; delete noScreening.screening;
  const noChecklist = { ...extras }; delete noChecklist.deployChecklist;
  await denied('deploy request WITHOUT screening is refused (stale tab)', fsdk.updateDoc(ref(creator, 'e1'), base(noScreening)));
  await denied('deploy request WITHOUT deployChecklist is refused', fsdk.updateDoc(ref(creator, 'e2'), base(noChecklist)));
  await denied('deploy request with screening lacking deployAt is refused', fsdk.updateDoc(ref(creator, 'e3'), base({ ...extras, screening: { ...extras.screening, deployAt: null } })));
  await denied('deploy request with a malformed checklist (no list) is refused', fsdk.updateDoc(ref(creator, 'e3'), base({ ...extras, deployChecklist: { tier: 'T2', checked: 'x', at: fsdk.serverTimestamp() } })));
  await allowed('deploy request with checklist + complete screening still passes', fsdk.updateDoc(ref(creator, 'e4'), base(extras)));

  // Approving needs a completed assessment on the doc; rejecting never does
  const approver = await connect('approver', 'ap@arise.tech');
  await adb.collection('users').doc(approver.uid).set({ role: 'approver', email: 'ap@arise.tech' });
  await adb.collection('agents').doc('e5').update({ deploymentStatus: 'requested', devProgress: 95 });
  const decide = (v) => ({ deploymentStatus: v, deployDecidedBy: approver.uid, deployDecidedAt: fsdk.serverTimestamp(), updatedAt: fsdk.serverTimestamp() });
  await denied('approver cannot APPROVE a request without an assessment', fsdk.updateDoc(ref(approver, 'e5'), decide('approved')));
  await allowed('approver can still REJECT a request without an assessment', fsdk.updateDoc(ref(approver, 'e5'), decide('rejected')));
  await adb.collection('agents').doc('e5').update({ deploymentStatus: 'requested', screening: { v: 2, answers: {}, deployAt: new Date() } });
  await allowed('approver can approve once the assessment (deployAt) exists', fsdk.updateDoc(ref(approver, 'e5'), decide('approved')));

  // Declaration fields in detail edit (Task 10, 2026-11-27)
  const five = { permittedDomains: 'DGL', prohibitedUses: 'ไม่มีข้อห้าม', tool: 'ไม่ใช้ tool', requiredSkills: 'ไม่ต้อง', llm: 'ยังไม่ได้ทดสอบ' };
  const up = () => ({ updatedAt: fsdk.serverTimestamp() });
  await allowed('creator Tier B edit of all five declaration fields', fsdk.updateDoc(ref(creator, 'd1'), { ...five, ...up() }));
  await allowed('creator Tier B edit of tool alone', fsdk.updateDoc(ref(creator, 'd2'), { tool: 'n8n', ...up() }));
  await allowed('creator Tier B edit of five + description', fsdk.updateDoc(ref(creator, 'd2'), { ...five, description: 'x', ...up() }));
  await denied('five + a non-listed field is denied', fsdk.updateDoc(ref(creator, 'd3'), { ...five, approveArea: ['QA'], ...up() }));
  await denied('non-owner cannot edit the five', fsdk.updateDoc(ref(other, 'd3'), { ...five, ...up() }));
  await allowed('staff Tier A edit of the five', fsdk.updateDoc(ref(staff, 'd4'), { ...five, ...up() }));
  await allowed('committee Tier A edit of the five', fsdk.updateDoc(ref(committee, 'd5'), { ...five, ...up() }));
  await adb.collection('agents').doc('d6').update({ deploymentStatus: 'requested' });
  await denied('creator cannot edit the five once a deploy request is in flight', fsdk.updateDoc(ref(creator, 'd6'), { ...five, ...up() }));

  // Workflow registration (2026-11-26): the doc the form builds must pass the create rule.
  const starter = { agentName: 'Starter', aiAgent: false, skillMd: true, approvalStatus: 'pending', createdBy: creator.uid, creatorEmails: ['cr@arise.tech'], matchingAgent: 'Flow', devProgress: 0, deploymentStatus: 'none', createdAt: fsdk.serverTimestamp(), updatedAt: fsdk.serverTimestamp() };
  await allowed('creator creates the Starter skill', fsdk.setDoc(fsdk.doc(creator.db, 'agents', 'wf-starter'), starter));
  await allowed('creator creates the workflow doc built by buildWorkflowDoc', fsdk.setDoc(fsdk.doc(creator.db, 'agents', 'wf-doc'), buildWorkflowDoc(starter, 'Flow', 'wf-starter', ['m1', 'm2'])));
  await denied('another user cannot create a workflow in the creator\'s name', fsdk.setDoc(fsdk.doc(other.db, 'agents', 'wf-doc2'), buildWorkflowDoc(starter, 'Flow2', 'wf-starter', [])));

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
