// Emulator test for the Inbox security rules (2026-11-17).
//   npx firebase-tools emulators:exec --config firebase.rules-test.json \
//     --only auth,firestore --project wolfy-481609 "node functions/verify-inbox-rules.cjs"
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
const { allowedAudiences } = loadEsm('inbox.js');

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
// Payload shapes sent by createAnnouncement/updateAnnouncement — keep equal to src/lib/announcements.js.
const CREATE_KEYS = ['title', 'body', 'audience', 'pinned', 'expiresAt', 'createdBy', 'createdByName', 'createdAt', 'updatedAt'];
const createPayload = (uid, expiresAt) => ({
  title: 'Posted', body: 'Body', audience: 'approvers', pinned: true, expiresAt,
  createdBy: uid, createdByName: 'Co', createdAt: ts(), updatedAt: ts(),
});
const updatePayload = (expiresAt) => ({ title: 'T2', body: 'B2', audience: 'all', pinned: false, expiresAt, updatedAt: ts() });
function valid(uid, over = {}) {
  return {
    title: 'Hello', body: 'World', audience: 'all', pinned: false, expiresAt: null,
    createdBy: uid, createdByName: 'Someone', createdAt: ts(), updatedAt: ts(), ...over,
  };
}

(async () => {
  const c = {};
  for (const [k, a] of Object.entries(ACTORS)) c[k] = await connect(k, a);
  for (const [k, a] of Object.entries(ACTORS)) {
    await adb.doc(`users/${c[k].uid}`).set({ role: a.role, email: a.email });
  }
  const seedAuthor = c.committee.uid;
  for (const aud of ['all', 'approvers', 'leads']) {
    await adb.doc(`announcements/seed-${aud}`).set({
      title: `seed ${aud}`, body: 'b', audience: aud, pinned: false, expiresAt: null,
      createdBy: seedAuthor, createdByName: 'Seed', createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
  }
  const ref = (k, id) => fsdk.doc(c[k].db, 'announcements', id);
  const col = (k) => fsdk.collection(c[k].db, 'announcements');

  // ── read by id ──
  const matrix = {
    user: { all: 1, approvers: 0, leads: 0 }, approver: { all: 1, approvers: 1, leads: 0 },
    staff: { all: 1, approvers: 1, leads: 0 }, committee: { all: 1, approvers: 1, leads: 1 },
    admin: { all: 1, approvers: 1, leads: 1 }, gmail: { all: 0, approvers: 0, leads: 0 },
    unverified: { all: 0, approvers: 0, leads: 0 },
  };
  for (const [k, row] of Object.entries(matrix)) {
    for (const [aud, ok] of Object.entries(row)) {
      const p = fsdk.getDoc(ref(k, `seed-${aud}`));
      await (ok ? allowed : denied)(`read-by-id ${k} ${aud} ${ok ? 'allowed' : 'denied'}`, p);
    }
  }

  // ── list queries ──
  for (const k of ['user', 'approver', 'staff', 'committee', 'admin']) {
    const want = allowedAudiences(ACTORS[k].role);
    try {
      const snap = await fsdk.getDocs(fsdk.query(col(k), fsdk.where('audience', 'in', want)));
      const got = snap.docs.map((d) => d.data().audience).sort().join(',');
      report(`list in-query ${k} returns ${want.join('+')}`, got === [...want].sort().join(','), `got ${got}`);
    } catch (e) { report(`list in-query ${k}`, false, e.code || e.message); }
  }
  await denied('list unfiltered user denied', fsdk.getDocs(col('user')));

  // ── create ──
  const u = (k) => c[k].uid;
  await allowed('create committee valid', fsdk.setDoc(ref('committee', 'n1'), valid(u('committee'))));
  await allowed('create admin valid', fsdk.setDoc(ref('admin', 'n2'), valid(u('admin'), { audience: 'leads', expiresAt: fsdk.Timestamp.now() })));
  await denied('create approver denied', fsdk.setDoc(ref('approver', 'x1'), valid(u('approver'))));
  await denied('create user denied', fsdk.setDoc(ref('user', 'x2'), valid(u('user'))));
  const bad = valid(u('committee')); delete bad.createdByName;
  await denied('create missing createdByName denied', fsdk.setDoc(ref('committee', 'x3'), bad));
  await denied('create 121-char title denied', fsdk.setDoc(ref('committee', 'x4'), valid(u('committee'), { title: 'a'.repeat(121) })));
  await allowed('create 120-char title allowed', fsdk.setDoc(ref('committee', 'x4b'), valid(u('committee'), { title: 'a'.repeat(120) })));
  await denied('create empty title denied', fsdk.setDoc(ref('committee', 'x4c'), valid(u('committee'), { title: '' })));
  await denied('create 5001-char body denied', fsdk.setDoc(ref('committee', 'x5'), valid(u('committee'), { body: 'b'.repeat(5001) })));
  await denied('create audience everyone denied', fsdk.setDoc(ref('committee', 'x6'), valid(u('committee'), { audience: 'everyone' })));
  await denied('create extra field denied', fsdk.setDoc(ref('committee', 'x7'), valid(u('committee'), { extra: 1 })));
  await denied('create createdBy != own uid denied', fsdk.setDoc(ref('committee', 'x8'), valid(u('admin'))));

  // ── composer payloads (src/lib/announcements.js) ──
  await allowed('composer create expiresAt null', fsdk.setDoc(ref('committee', 'c1'), createPayload(u('committee'), null)));
  await allowed('composer create expiresAt Timestamp', fsdk.setDoc(ref('admin', 'c2'), createPayload(u('admin'), fsdk.Timestamp.fromDate(new Date(Date.now() + 864e5)))));
  const noExp = createPayload(u('committee'), null); delete noExp.expiresAt;
  report('composer payload has all 9 keys', CREATE_KEYS.every((k) => k in createPayload('x', null)));
  await denied('composer create omitting expiresAt denied', fsdk.setDoc(ref('committee', 'c3'), noExp));
  await allowed('composer update five fields + updatedAt (null)', fsdk.updateDoc(ref('committee', 'c1'), updatePayload(null)));
  await allowed('composer update five fields + updatedAt (Timestamp)', fsdk.updateDoc(ref('admin', 'c2'), updatePayload(fsdk.Timestamp.now())));

  // ── update / delete ──
  await allowed('update committee edits other author doc', fsdk.updateDoc(ref('committee', 'n2'), { title: 'Edited', updatedAt: ts() }));
  await denied('update changing createdBy denied', fsdk.updateDoc(ref('committee', 'n2'), { createdBy: u('committee') }));
  await denied('update changing createdByName denied', fsdk.updateDoc(ref('committee', 'n2'), { createdByName: 'Forged', updatedAt: ts() }));
  await denied('update changing createdAt denied', fsdk.updateDoc(ref('committee', 'n2'), { createdAt: ts() }));
  await denied('update by approver denied', fsdk.updateDoc(ref('approver', 'n1'), { title: 'hax' }));
  await denied('delete by approver denied', fsdk.deleteDoc(ref('approver', 'n1')));
  await allowed('delete by committee allowed', fsdk.deleteDoc(ref('committee', 'n1')));

  // ── own inbox state ──
  const st = (k, uid) => fsdk.doc(c[k].db, 'users', uid, 'inbox', 'state');
  const ids = (n) => Array.from({ length: n }, (_, i) => `id${i}`);
  await allowed('inbox own write', fsdk.setDoc(st('user', u('user')), { readIds: ['a', 'b'], updatedAt: ts() }));
  await allowed('inbox own read', fsdk.getDoc(st('user', u('user'))));
  await allowed('inbox own write 300 ids', fsdk.setDoc(st('user', u('user')), { readIds: ids(300), updatedAt: ts() }));
  await denied('inbox other read denied', fsdk.getDoc(st('approver', u('user'))));
  await denied('inbox other write denied', fsdk.setDoc(st('approver', u('user')), { readIds: [], updatedAt: ts() }));
  await denied('inbox 301 ids denied', fsdk.setDoc(st('user', u('user')), { readIds: ids(301), updatedAt: ts() }));
  await denied('inbox extra key denied', fsdk.setDoc(st('user', u('user')), { readIds: [], updatedAt: ts(), x: 1 }));
  await denied('inbox readIds not list denied', fsdk.setDoc(st('user', u('user')), { readIds: 'a', updatedAt: ts() }));

  console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('fatal', e); process.exit(1); });
