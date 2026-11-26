// Archive behaviour against the Firestore emulator (2026-11-26).
//   firebase emulators:exec --config firebase.rules-test.json --only firestore \
//     --project wolfy-481609 "node functions/verify-assessment-archive-run.cjs"
const admin = require('firebase-admin');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { archiveYear, listArchivedYears, loadArchivedYear } = require('./assessmentArchive');
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const db = getFirestore(admin.initializeApp({ projectId: 'wolfy-481609' }), 'ai-agent-lib');
let pass = 0; let fail = 0;
const eq = (n, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w); ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${n}${ok ? '' : ` got ${JSON.stringify(g)} want ${JSON.stringify(w)}`}`); };
const cfgV = (v) => ({ version: v, thresholds: { md: 7, hi: 14 }, questions: [{ id: 'C1', code: 'C1' }] });
const rec = (id, year) => db.collection('assessments').doc(id).set({ agentId: 'a', agentName: id, owner: 'T', approveArea: [], stage: 'pre', answers: {}, decl: {}, createdBy: 'u', year, createdAt: Timestamp.fromDate(new Date(`${year}-06-01T00:00:00Z`)) });

(async () => {
  await Promise.all([rec('p1', 2025), rec('p2', 2025), rec('c1', 2026), rec('o1', 2024)]);
  const r1 = await archiveYear({ db, FieldValue, year: 2025, by: 'admin@x', cfg: cfgV(1) });
  eq('archived 2 records', r1.archived, 2);
  const left = (await db.collection('assessments').get()).docs.map((d) => d.id).sort();
  eq('originals of 2025 are gone, other years untouched', left, ['c1', 'o1']);
  const years = await listArchivedYears(db);
  eq('archive lists year 2025 with count 2', years.map((y) => [y.year, y.count]), [[2025, 2]]);
  const y25 = await loadArchivedYear(db, 2025);
  eq('items carry their data + archivedAt, createdAt as ISO', [y25.items.length, y25.items.every((i) => typeof i.createdAt === 'string' && i.archivedAt), y25.items.map((i) => i.id).sort()], [2, true, ['p1', 'p2']]);
  eq('config snapshot stored at archive time', y25.configSnapshot.version, 1);

  // straggler for the same year + a newer config: count grows, snapshot is NOT replaced
  await rec('p3', 2025);
  const r2 = await archiveYear({ db, FieldValue, year: 2025, by: 'admin@x', cfg: cfgV(2) });
  eq('re-run moves only the straggler', r2.archived, 1);
  const y25b = await loadArchivedYear(db, 2025);
  eq('count cumulative (3), snapshot unchanged (v1)', [(await listArchivedYears(db))[0].count, y25b.items.length, y25b.configSnapshot.version], [3, 3, 1]);
  const r3 = await archiveYear({ db, FieldValue, year: 2025, by: 'admin@x', cfg: cfgV(2) });
  eq('re-run with nothing left is a no-op', r3.archived, 0);
  eq('unknown year → null', await loadArchivedYear(db, 1999), null);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
