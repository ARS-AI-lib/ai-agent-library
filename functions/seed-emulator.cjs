// Local-only seed for the Firestore emulator (redesign work, 2026-10-01).
//
//   node functions/seed-emulator.cjs export          # READ production → .emulator-seed/ai-agent-lib.json
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
//   node functions/seed-emulator.cjs import          # write that file into the EMULATOR only
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
//   node functions/seed-emulator.cjs promote <email> <role>   # set a role on an emulator user
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
//   node functions/seed-emulator.cjs inbox           # Inbox fixtures (announcements + emu.user requests)
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
  if (mode === 'inbox') {
    // Inbox browser-check fixtures (2026-11-17). Fixed doc ids → re-running
    // overwrites instead of piling up duplicates. Owned by emu.user, who must
    // have signed in once so their /users doc (and uid) exists.
    const OWNER = 'emu.user@arise.tech';
    const q = await db.collection('users').where('email', '==', OWNER).get();
    if (q.empty) throw new Error(`no emulator user with email ${OWNER} — sign in once with that test button first, then re-run "inbox"`);
    const uid = q.docs[0].id;
    const DAY = 864e5;
    const now = Date.now();
    const ts = (ms) => Timestamp.fromMillis(ms);
    const admin = (await db.collection('users').where('email', '==', 'tinnapat.p@arise.tech').get()).docs[0];
    const author = admin ? admin.id : 'seed-admin';
    const ann = (title, body, audience, extra = {}) => ({
      title, body, audience, pinned: false, expiresAt: null,
      createdBy: author, createdByName: 'Emulator Admin',
      createdAt: ts(now - DAY), updatedAt: ts(now - DAY), ...extra,
    });
    const anns = {
      'emu-ann-all': ann('Welcome to the Inbox',
        'Plain text only.\n<b>x</b> https://example.com/page and javascript:alert(1)', 'all'),
      'emu-ann-approvers': ann('Approver briefing', 'Only approver, staff, committee and admin should see this.', 'approvers', { pinned: true, createdAt: ts(now - 3 * DAY) }),
      'emu-ann-leads': ann('Leads only', 'Only committee and admin should see this.', 'leads'),
      'emu-ann-expired': ann('Expired notice', 'Nobody should see this (expired yesterday).', 'all', { expiresAt: ts(now - DAY) }),
    };
    const base = (name, extra) => ({
      agentName: name, owner: 'Emulator Team', creator: 'Emu User',
      creatorEmails: [OWNER], createdBy: uid, aiAgent: true, skillMd: false,
      devProgress: 50, deploymentStatus: 'none', approveArea: ['Development'],
      category: ['Software Development'], reusable: 'Reusable',
      createdAt: ts(now - 2 * DAY), updatedAt: ts(now - 2 * DAY), ...extra,
    });
    const agents = {
      'emu-inbox-pending': base('Inbox Pending Item', { approvalStatus: 'pending' }),
      'emu-inbox-deploy': base('Inbox Deploy Requested Item', { approvalStatus: 'approved', devProgress: 95, deploymentStatus: 'requested', deployRequestedAt: ts(now - DAY) }),
      'emu-inbox-rej-recent': base('Inbox Rejected Recent', { approvalStatus: 'rejected', rejectionReason: 'Duplicate of an existing agent', rejectedAt: ts(now - 3 * DAY), updatedAt: ts(now - 3 * DAY) }),
      'emu-inbox-rej-old': base('Inbox Rejected Old', { approvalStatus: 'rejected', rejectionReason: 'Too old to show', rejectedAt: ts(now - 15 * DAY), updatedAt: ts(now - 15 * DAY) }),
    };
    const b = db.batch();
    Object.entries(anns).forEach(([id, d]) => b.set(db.collection('announcements').doc(id), d));
    Object.entries(agents).forEach(([id, d]) => b.set(db.collection('agents').doc(id), d));
    await b.commit();
    console.log(`announcements: ${Object.keys(anns).length} · agents for ${OWNER} (${uid}): ${Object.keys(agents).length}`);
    return;
  }
  throw new Error('usage: export | import | promote <email> <role> | inbox');
})().catch((e) => { console.error(e.message); process.exit(1); });
