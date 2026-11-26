// One-off: fix SDLC process mappings + rewrite tm-* descriptions.
// Dry-run by default. Pass --apply to write.
// Run from functions/ (firebase-admin installed): node fix-sdlc-mapping.cjs [--apply]
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

const APPLY = process.argv.includes('--apply');

// docId -> { name (guard), map: [processKey...] }  processKey = pid (numbered) or exact process name
const MAP_FIXES = {
  THWnnBQgwp40bA179evM: { name: 'Walkthrough Deck Generation', map: ['1.5', '2.1', '2.2', '3.2', '3.3'] },
  '04WovUqImxftMd2xP1nT': { name: 'HLD for Existing Project', map: ['4.1', '2.1'] },
  Oo8HqfmDW5m6cl5p6hGZ: { name: 'AIPhbt - Rotation & Crop', map: [] },
  ORQBklSBPm4r6ZfKndA3: { name: 'component-check-connection', map: ['14.1', '7.2', '7.3'] },
  MghgqQKxh3nSl6U2crL8: { name: 'uat-test-case-generator', map: ['11.1', '11.2'], hml: true },
  mJJkMtEduEcbv8oI0KOT: { name: 'copywriting_difference_report', map: ['11.3', '7.3'], hml: true },
  MizYnhj5AP7au1LSiTxN: { name: 'PVT Testcase Generator', map: ['14.2B'] },
  zgWUttVV6WLcGyVvMBLE: { name: 'Handover Tech Spec', map: ['9.1', 'NFR Gathering'] },
  Lt7Q7tDFbhUpqpbVRfla: { name: 'CutOver-Live-Dashboard', map: ['7.4'] },
};

const DESC_FIXES = {
  '9AIZXkFQJEdXjfTV6X7k': { name: 'tm-contract-testing', desc: 'Testing standards for TM Vault v4 smart contracts — how to structure and write unit, simulation, and end-to-end tests, plus common mistakes.' },
  '42uNqliTf3vqN5jFCAwj': { name: 'tm-contract-schedules', desc: 'Reference for TM Vault v4 contract schedules — event types, ScheduledEvent setup (incl. end-of-month), timezone rules, and creating/rescheduling events from hooks.' },
  Pm9azIzVRzpBaQxXM63W: { name: 'tm-contract-hooks', desc: 'Reference for all TM Vault v4 hook types — when each fires, hot-path rules, decorator requirements, timezone handling, and common mistakes.' },
  RVYq2XZU95OVLbUO0MH4: { name: 'tm-contract-balances', desc: 'Reference for TM Vault v4 balance handling — balance coordinates, Phase, posting instruction types, debit/credit by T-side, and the CustomInstruction pattern.' },
  SuGJKxUVCDUCX8NOMecw: { name: 'tm-contract-specialist', desc: 'Entry-point skill for any Thought Machine Vault v4 smart-contract work — hooks, balances, fetchers, parameters, schedules, and contract testing.' },
  c1Z9yjHLqk0xfQ7MRKam: { name: 'tm-vault-smart-contract', desc: 'Builds and tests Thought Machine Vault Core products — smart contracts, supervisor contracts, and feature modules with simulation and unit tests (Contracts Language API 4.x).' },
  c3RQJvU7Q5s8JY4A3KSA: { name: 'tm-contract-core', desc: 'Core structure rules for TM Vault v4 smart contracts — metadata block, global-scope constraints, float prohibition, sandbox restrictions, and a pre-submit checklist.' },
  nUrNckKV7E60S6nXIsuH: { name: 'tm-contract-fetchers', desc: 'Reference for TM Vault v4 data fetchers — @fetch_account_data vs @requires, DefinedDateTime, timezone rules, and common declaration mistakes.' },
  sXWGRtS9lvfF12ITrVma: { name: 'tm-contract-parameters', desc: 'Reference and patterns for TM Vault v4 parameters — GLOBAL/TEMPLATE/INSTANCE tiers, reading from hooks, shapes, update permissions, and common mistakes.' },
};

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const isNumeric = (s) => /^\d/.test(String(s || ''));

(async () => {
  const procs = (await db.collection('sdlcProcesses').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const allAgents = (await db.collection('agents').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const byId = Object.fromEntries(allAgents.map((a) => [a.id, a]));

  function canon(key) {
    if (isNumeric(key)) {
      const hits = procs.filter((p) => String(p.id) === String(key));
      if (hits.length !== 1) throw new Error(`process id "${key}" -> ${hits.length} matches`);
      const p = hits[0];
      return `${p.id} ${p.name || p.processName}`;
    }
    const hits = procs.filter((p) => norm(p.name || p.processName) === norm(key) || norm(p.id) === norm(key));
    if (hits.length !== 1) throw new Error(`process name "${key}" -> ${hits.length} matches`);
    const p = hits[0];
    return isNumeric(p.id) ? `${p.id} ${p.name || p.processName}` : p.name || p.processName;
  }

  const resolvedMap = {};
  for (const [id, f] of Object.entries(MAP_FIXES)) resolvedMap[id] = f.map.map(canon);

  console.log('=== MAPPING CHANGES ===');
  for (const [id, f] of Object.entries(MAP_FIXES)) {
    const doc = byId[id];
    if (!doc) { console.log(`!! MISSING AGENT ${id} (${f.name})`); continue; }
    const cur = Array.isArray(doc.sdlcProcessMapping)
      ? doc.sdlcProcessMapping
      : doc.sdlcProcessMapping ? [doc.sdlcProcessMapping] : [];
    console.log(`\n[${id}] ${doc.agentName}`);
    if (norm(doc.agentName) !== norm(f.name)) console.log(`   !! NAME MISMATCH doc="${doc.agentName}" expected="${f.name}"`);
    console.log(`   OLD: ${JSON.stringify(cur)}`);
    console.log(`   NEW: ${JSON.stringify(resolvedMap[id])}`);
    if (f.hml === true) console.log(`   HML: ${JSON.stringify(doc.hml)} -> true${doc.hml === true ? '  (already true — no change)' : ''}`);
  }

  console.log('\n=== DESCRIPTION CHANGES ===');
  for (const [id, f] of Object.entries(DESC_FIXES)) {
    const doc = byId[id];
    if (!doc) { console.log(`!! MISSING ${id} (${f.name})`); continue; }
    console.log(`\n[${id}] ${doc.agentName}`);
    if (norm(doc.agentName) !== norm(f.name)) console.log(`   !! NAME MISMATCH doc="${doc.agentName}" expected="${f.name}"`);
    const cur = String(doc.description || '');
    console.log(`   OLD (${cur.length} chars): ${cur.slice(0, 90).replace(/\s+/g, ' ')}…`);
    console.log(`   NEW: ${f.desc}`);
  }

  if (!APPLY) { console.log('\n(DRY RUN — nothing written. Re-run with --apply to write.)'); return; }

  let n = 0;
  console.log('\n=== APPLYING ===');
  for (const [id, f] of Object.entries(MAP_FIXES)) {
    const ref = db.collection('agents').doc(id);
    const snap = await ref.get();
    if (!snap.exists) { console.log(`skip missing ${id}`); continue; }
    if (norm(snap.data().agentName) !== norm(f.name)) { console.log(`skip name mismatch ${id}`); continue; }
    const patch = { sdlcProcessMapping: resolvedMap[id], updatedAt: FieldValue.serverTimestamp() };
    if (f.hml === true && snap.data().hml !== true) patch.hml = true;
    await ref.update(patch);
    n++; console.log(`WROTE map  ${id}  ${f.name}  -> ${JSON.stringify(resolvedMap[id])}${patch.hml ? '  (+hml=true)' : ''}`);
  }
  for (const [id, f] of Object.entries(DESC_FIXES)) {
    const ref = db.collection('agents').doc(id);
    const snap = await ref.get();
    if (!snap.exists) { console.log(`skip missing ${id}`); continue; }
    if (norm(snap.data().agentName) !== norm(f.name)) { console.log(`skip name mismatch ${id}`); continue; }
    await ref.update({ description: f.desc, updatedAt: FieldValue.serverTimestamp() });
    n++; console.log(`WROTE desc ${id}  ${f.name}`);
  }
  console.log(`\nDONE — ${n} docs updated.`);
})().catch((e) => { console.error(e); process.exit(1); });
