// Collapse duplicate sdlcUseCases names (2026-08-11 audit) that were pure
// name collisions — same UC label registered under multiple processes, with
// no field on the doc (no description exists at all: id/name/owner/
// processId/processName/creator only) that could justify more than one home.
// Confirmed root cause of SDLCTab's Use-Case view double-counting agents
// under every process sharing a label — see agentsForUC() in SDLCTab.jsx.
//
// Scope: Groups A+B only (14 names, 31 extra docs). Group C — 7 names split
// across SIT (12.x) vs UAT (13.x) — is a REAL pairing (different owner,
// different team, different environment) and is deliberately left alone per
// explicit decision; those need renaming apart, not collapsing, as a
// separate task.
//
//   node functions/dedupe-usecases.cjs            # dry run
//   node functions/dedupe-usecases.cjs --apply     # delete the extra docs
//
// Safe by construction: agents reference a use case by NAME (agent.useCase
// string), never by sdlcUseCases doc id, so deleting the extra docs cannot
// orphan or corrupt any agent data — it only removes the duplicate catalog
// entries that caused the same name to be joinable against multiple
// processes. Doesn't touch any agent doc.
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');

// name (case-insensitive match) -> processId to KEEP. Every other doc
// sharing that name gets deleted. Reasoning logged per group in chat/plan;
// summarized inline here.
const KEEP = {
  // ── Group A: name unambiguously belongs to one process ──
  'assisted code review': '10.3',                 // Code Review
  'ivt test execution assistant, logger & progress reporter': '14.3A', // IVT, not PVT
  'defect severity and priority assessment': '11.3', // Defect Management
  'test case generation & fulfillment': '11.2',    // Test Case Development — all 9 referencing agents declare 11.2 themselves
  'uxw change tracker assistant': '8.2',           // UXW = UX Writer -> Copywriting
  'requirement refiner assistant': '2.1',          // Requirement Gathering (1.4 Legal & 1.5 are unrelated copies)
  'assist write code build locally': '10.1',       // Development
  'user story curator': '2.2',                     // High-level User Story Development
  'pc document control assistant': '1.6',          // PC = Project (Review) Committee, matches 1.6 owner; agent's own mapping is 1.6

  // ── Group B: cross-phase utility, picking the best single existing home ──
  'mom generator': '6.2',                          // Project Governance (meeting minutes belong to governance, not any one phase)
  'open issue tracker': '2.1',                     // Requirement Gathering
  'test artifact synchronization': '12.2',         // SIT Test Execution (0 agents reference this name today — arbitrary-but-reasonable pick among 12.2/13.2/14.3B)
  'cross-team feedback management': '8.1',         // UI Design (Hi-fi) — cross-team review before Build
  'design input readiness': '3.3',                 // UI Design (Low-fi) — readiness check before design starts
};

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

(async () => {
  const snap = await db.collection('sdlcUseCases').get();
  const ucs = snap.docs.map((d) => ({ _id: d.id, ...d.data() }));
  const norm = (s) => String(s || '').trim().toLowerCase();

  const byName = new Map();
  ucs.forEach((u) => {
    const k = norm(u.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(u);
  });

  const toDelete = [];
  const problems = [];

  for (const [name, keepProcessId] of Object.entries(KEEP)) {
    const rows = byName.get(name);
    if (!rows || rows.length < 2) {
      problems.push(`✗ "${name}" — expected duplicates in DB, found ${rows ? rows.length : 0}. Skipping (data may have changed since audit).`);
      continue;
    }
    const keeper = rows.find((r) => r.processId === keepProcessId);
    if (!keeper) {
      problems.push(`✗ "${name}" — no existing doc with processId "${keepProcessId}" to keep. Skipping — refusing to invent a new one.`);
      continue;
    }
    rows.filter((r) => r._id !== keeper._id).forEach((r) => toDelete.push({ name: rows[0].name, keep: keeper, drop: r }));
  }

  console.log(`Plan: delete ${toDelete.length} duplicate docs across ${Object.keys(KEEP).length} names\n`);
  toDelete.forEach((d) => {
    console.log(`  "${d.name}"`);
    console.log(`      KEEP   [${d.keep._id}] process ${d.keep.processId} (${d.keep.processName || ''})`);
    console.log(`      DELETE [${d.drop._id}] process ${d.drop.processId} (${d.drop.processName || ''})`);
  });

  if (problems.length) {
    console.log('\n⚠ Problems (not applied for these names):');
    problems.forEach((p) => console.log('  ' + p));
  }

  if (!APPLY) {
    console.log(`\nDry run only — ${toDelete.length} docs would be deleted. Re-run with --apply to write.`);
    return;
  }

  for (const d of toDelete) {
    await db.collection('sdlcUseCases').doc(d.drop._id).delete();
  }
  console.log(`\n✔ Deleted ${toDelete.length} docs. sdlcUseCases now has ${ucs.length - toDelete.length} docs (was ${ucs.length}).`);
})().catch((e) => { console.error(e); process.exit(1); });
