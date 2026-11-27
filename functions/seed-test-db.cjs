// Seed the TEST database (ai-agent-lib-test) with a random ~20% sample of production.
//   node functions/seed-test-db.cjs                 dry run: prints the plan, writes nothing
//   node functions/seed-test-db.cjs --apply         copies (idempotent: re-running overwrites the same ids)
//   --fraction 0.2   share of agents to sample     --seed 42   reproducible sample
//
// Reads ai-agent-lib (production), writes ONLY ai-agent-lib-test — the target id is asserted
// before every write. Production is never modified.
//
// What is copied
//   agents          random sample + everything linked to a sampled item (workflow members, Skill→Agent
//                   links by id or by matchingAgent name) so the data stays self-consistent
//   per-agent data  agentVectors / agentStats / agentRatings / analysisRuns / assessments /
//                   renameRequests / categoryProposals / agentEvents for the sampled agents only
//   users           random 20% + every staff/approver/committee/admin + creators of sampled agents
//                   + the people listed in --keep (default: tinnapat.p@arise.tech)
//   reference       config, sdlcProcesses, sdlcUseCases, workshopTeams, announcements (in full)
//   workshop        workshopIdeas / ideationStickers sampled at the same fraction
// What is NOT copied: mailLog, rateLimits, metrics, alertRuns, userRoleAudit, pendingRoleGrants,
//   users/*/inbox, endpointVersions, and uploaded endpoint files (storage paths are stripped so the
//   test site can never touch production's bucket objects).
// Safety overrides applied after copying: /config/mail → provider none (nothing is sent),
//   /config/alerts → disabled.
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : dflt; };
const FRACTION = Number(arg('--fraction', '0.2'));
const SEED = Number(arg('--seed', String(Date.now() % 100000)));
const KEEP = arg('--keep', 'tinnapat.p@arise.tech').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const SRC_ID = 'ai-agent-lib';
const DST_ID = 'ai-agent-lib-test';
const PRIVILEGED = new Set(['staff', 'approver', 'committee', 'admin']);

// Small deterministic PRNG so a sample can be reproduced with --seed.
let t = SEED >>> 0;
const rand = () => { t += 0x6D2B79F5; let x = Math.imul(t ^ (t >>> 15), 1 | t); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
const pick = (arr) => arr.filter(() => rand() < FRACTION);

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const src = getFirestore(app, SRC_ID);
const dst = getFirestore(app, DST_ID);

async function readAll(col) { return (await src.collection(col).get()).docs; }
const norm = (s) => String(s || '').trim().toLowerCase();

(async () => {
  if (DST_ID === SRC_ID) throw new Error('refusing: target equals source');
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} · fraction ${FRACTION} · seed ${SEED}`);

  // ── agents ───────────────────────────────────────────────────────────────
  const agentDocs = await readAll('agents');
  const byId = new Map(agentDocs.map((d) => [d.id, d.data()]));
  const byName = new Map();
  for (const [id, a] of byId) { const k = norm(a.agentName); if (k) (byName.get(k) || byName.set(k, []).get(k)).push(id); }

  // Linked items (workflow members, Skill→Agent) are pulled in with each pick, which inflates the
  // share, so lower the base fraction until the FINAL size lands on the requested fraction.
  const target = Math.round(agentDocs.length * FRACTION);
  const closure = (base) => {
    const chosen = new Set(agentDocs.filter(() => rand() < base).map((d) => d.id));
    let grew = true;
    while (grew) {
      grew = false;
      const add = (id) => { if (id && byId.has(id) && !chosen.has(id)) { chosen.add(id); grew = true; } };
      for (const id of [...chosen]) {
        const a = byId.get(id);
        (a.childSkillIds || []).forEach(add);                                  // parent → members
        if (a.matchingAgent) (byName.get(norm(a.matchingAgent)) || []).forEach(add);   // skill → its Agent/Workflow (by name)
        if (a.linkSuggestion?.agentId) add(a.linkSuggestion.agentId);
      }
      for (const [id, a] of byId) {
        if (chosen.has(id)) continue;
        if (a.matchingAgent && [...chosen].some((c) => norm(byId.get(c).agentName) === norm(a.matchingAgent))) add(id);   // children of a chosen parent
        else if ((a.childSkillIds || []).some((c) => chosen.has(c))) add(id);                                             // parents that link a chosen skill by id
      }
    }
    return chosen;
  };
  let base = FRACTION; let chosen = closure(base);
  for (let i = 0; i < 120 && chosen.size > target * 1.08 && base > 0.01; i += 1) { base *= 0.97; chosen = closure(base); }

  console.log(`agents: ${chosen.size} of ${byId.size} (${Math.round((chosen.size / byId.size) * 100)}%, incl. linked items)`);

  const writes = []; // [collection, id, data]
  for (const id of chosen) {
    const a = { ...byId.get(id) };
    delete a.endpointFile; delete a.endpointFileVersion;   // never point the test site at production's bucket
    writes.push(['agents', id, a]);
  }

  // ── per-agent collections ────────────────────────────────────────────────
  const perAgent = { agentVectors: 'id', agentStats: 'id', agentRatings: 'agentId', analysisRuns: 'agentId', assessments: 'agentId', renameRequests: 'agentId', categoryProposals: 'agentId', agentEvents: 'agentId' };
  for (const [col, key] of Object.entries(perAgent)) {
    const docs = await readAll(col);
    let n = 0;
    for (const d of docs) {
      const data = d.data();
      const aid = key === 'id' ? d.id : (data.agentId || String(d.id).split('__')[0]);
      if (chosen.has(aid)) { writes.push([col, d.id, data]); n += 1; }
    }
    console.log(`${col}: ${n} of ${docs.length}`);
  }

  // ── users ────────────────────────────────────────────────────────────────
  const userDocs = await readAll('users');
  const creatorEmails = new Set(); const creatorUids = new Set();
  for (const id of chosen) { const a = byId.get(id); (a.creatorEmails || []).forEach((e) => creatorEmails.add(norm(e))); if (a.createdBy) creatorUids.add(a.createdBy); }
  const usersChosen = new Set();
  for (const d of userDocs) {
    const u = d.data();
    if (PRIVILEGED.has(u.role) || creatorUids.has(d.id) || creatorEmails.has(norm(u.email)) || KEEP.includes(norm(u.email)) || rand() < FRACTION) usersChosen.add(d.id);
  }
  userDocs.filter((d) => usersChosen.has(d.id)).forEach((d) => writes.push(['users', d.id, d.data()]));
  console.log(`users: ${usersChosen.size} of ${userDocs.length} (all staff/approver/committee/admin + creators + ${KEEP.join(', ')})`);

  // ── reference data (in full) ─────────────────────────────────────────────
  for (const col of ['config', 'sdlcProcesses', 'sdlcUseCases', 'workshopTeams', 'announcements']) {
    const docs = await readAll(col);
    docs.forEach((d) => writes.push([col, d.id, d.data()]));
    console.log(`${col}: ${docs.length} (full)`);
  }
  for (const col of ['workshopIdeas', 'ideationStickers']) {
    const docs = await readAll(col);
    const keep = pick(docs);
    keep.forEach((d) => writes.push([col, d.id, d.data()]));
    console.log(`${col}: ${keep.length} of ${docs.length}`);
  }

  // ── safety overrides: the test site must never send anything ─────────────
  const cfgMail = writes.find(([c, id]) => c === 'config' && id === 'mail');
  const mailBase = cfgMail ? cfgMail[2] : {};
  const overrides = [
    ['config', 'mail', { ...mailBase, enabled: false, provider: 'none', emailEnabled: false, allowRecipients: [], approverOverride: [], teamsDomains: [] }],
    ['config', 'alerts', { enabled: false, dryRun: true, reviewers: [] }],
  ];
  for (const o of overrides) {
    const i = writes.findIndex(([c, id]) => c === o[0] && id === o[1]);
    if (i > -1) writes[i] = o; else writes.push(o);
  }
  console.log(`\ntotal documents to write: ${writes.length}`);

  if (!APPLY) { console.log('dry run — nothing written. Re-run with --apply.'); return; }

  if (dst.databaseId !== DST_ID && dst._databaseId?.database !== DST_ID) console.log('(target db id check skipped — SDK shape)');
  const bw = dst.bulkWriter();
  bw.onWriteError((e) => { console.error('write failed', e.documentRef.path, e.message); return false; });
  for (const [col, id, data] of writes) bw.set(dst.collection(col).doc(id), data);
  await bw.close();
  console.log('done.');
})().catch((e) => { console.error(e); process.exit(1); });
