// Local-only seed for the Firestore emulator (redesign work, 2026-10-01).
//
//   node functions/seed-emulator.cjs export          # READ production → .emulator-seed/ai-agent-lib.json
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
//   node functions/seed-emulator.cjs import          # write that file into the EMULATOR only
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
//   node functions/seed-emulator.cjs promote <email> <role>   # set a role on an emulator user
//
// Safety: `export` only ever calls get(); `import`/`promote` refuse to run unless
// FIRESTORE_EMULATOR_HOST points at localhost, so they cannot touch production.
// The seed forces /config/mail to provider 'none' so the emulator never sends
// Teams messages or email.
const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

const [mode, ...args] = process.argv.slice(2);
const FILE = path.join(__dirname, '..', '.emulator-seed', 'ai-agent-lib.json');
const COLLECTIONS = ['agents', 'config', 'sdlcProcesses', 'sdlcUseCases', 'users', 'agentStats',
  'renameRequests', 'categoryProposals', 'agentVectors', 'analysisRuns', 'workshopTeams'];

const emuHost = process.env.FIRESTORE_EMULATOR_HOST || '';
const isEmu = /^(127\.0\.0\.1|localhost):\d+$/.test(emuHost);

initializeApp({ projectId: 'wolfy-481609' });
const db = getFirestore('ai-agent-lib');

const enc = (v) => {
  if (v instanceof Timestamp) return { __ts: v.toMillis() };
  if (Array.isArray(v)) return v.map(enc);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)]));
  return v;
};
const dec = (v) => {
  if (v && typeof v === 'object' && !Array.isArray(v) && '__ts' in v) return Timestamp.fromMillis(v.__ts);
  if (Array.isArray(v)) return v.map(dec);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dec(x)]));
  return v;
};

(async () => {
  if (mode === 'export') {
    if (emuHost) throw new Error('Unset FIRESTORE_EMULATOR_HOST for export (it reads production, read-only).');
    const out = {};
    for (const c of COLLECTIONS) {
      const snap = await db.collection(c).get();
      out[c] = snap.docs.map((d) => ({ id: d.id, data: enc(d.data()) }));
      console.log(`  ${c}: ${snap.size}`);
    }
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(out));
    console.log(`wrote ${FILE}`);
    return;
  }
  if (!isEmu) throw new Error(`Refusing: FIRESTORE_EMULATOR_HOST must be localhost (got "${emuHost}").`);
  if (mode === 'import') {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const [c, docs] of Object.entries(data)) {
      for (let i = 0; i < docs.length; i += 400) {
        const b = db.batch();
        docs.slice(i, i + 400).forEach((d) => b.set(db.collection(c).doc(d.id), dec(d.data)));
        await b.commit();
      }
      console.log(`  ${c}: ${docs.length}`);
    }
    await db.doc('config/mail').set({ provider: 'none', enabled: false, emailEnabled: false }, { merge: true });
    console.log('mail provider forced to none (emulator)');
    return;
  }
  if (mode === 'promote') {
    const [email, role] = args;
    const q = await db.collection('users').where('email', '==', email).get();
    if (q.empty) throw new Error(`no emulator user with email ${email} — sign in once first`);
    for (const d of q.docs) await d.ref.update({ role, approveAreas: role === 'user' ? [] : (d.data().approveAreas || []) });
    console.log(`${email} -> ${role} (${q.size} doc)`);
    return;
  }
  throw new Error('usage: export | import | promote <email> <role>');
})().catch((e) => { console.error(e.message); process.exit(1); });
