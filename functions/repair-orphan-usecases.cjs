// Repair the 3 agents orphaned by functions/dedupe-usecases.cjs (2026-08-11).
//
//   node functions/repair-orphan-usecases.cjs            # dry run
//   node functions/repair-orphan-usecases.cjs --apply
//
// ── What happened ──
// dedupe-usecases.cjs collapsed 21 duplicate sdlcUseCases NAMES down to one
// doc each (106 -> 82 docs). Agents reference a use case by name, so any agent
// whose surviving doc now sits under a DIFFERENT process than the one the
// agent itself declares no longer matches in SDLCTab's Use-Case view (that
// view requires name match AND the agent's own sdlcProcessMapping to include
// the UC's process — see agentsForUC() in SDLCTab.jsx). Three agents landed
// in that gap. Nothing was lost: their useCase strings are intact, they just
// stopped rendering under a process card.
//
// ── Why each fix is what it is ──
//   golang-lint          — declares 10.1 Development, useCase "Assisted Code
//                          Review" now lives only at 10.3 Code Review. It IS
//                          a code-review tool (golangci-lint workflows), so
//                          the PROCESS is what was wrong. Move it to 10.3.
//   golang-unit-testing  — declares 10.2 Unit Test, useCase "Assist Write
//   Unit Test Generator    Code Build Locally" now lives only at 10.1. Here
//                          the reverse is true: 10.2 is exactly the right
//                          process for a unit-test tool, and the use-case
//                          LABEL was the wrong part. 10.2 has zero use cases
//                          in the catalog now, so there is nothing valid to
//                          point them at — clear useCase rather than invent a
//                          catalog entry (that is the SDLC team's call).
//
// All three are stage "Build" and 10.1/10.2/10.3 are all Build, so no
// sdlcStage change is needed. All three carry a stored approveArea
// (["Development"]), which is layer 1 of agentApproveAreas() and therefore
// wins outright — approver routing is unaffected by any of these edits.
//
// Footnote for whoever reads this next: the dedupe also left 4 processes with
// zero use cases (1.5, 7.2, 10.2, 14.3B) because everything they held was a
// duplicate name owned by another process. That is accurate, not a bug.
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');

// agentName -> { patch, why }
const FIXES = {
  'golang-lint': {
    patch: { sdlcProcessMapping: ['10.3 Code Review'] },
    why: 'process 10.1 -> 10.3 so it matches its own useCase "Assisted Code Review"',
  },
  'golang-unit-testing': {
    patch: { useCase: [] },
    why: 'clear useCase (10.2 Unit Test has no use case in the catalog); process 10.2 stays',
  },
  'Unit Test Generator': {
    patch: { useCase: [] },
    why: 'same as above; also normalises a legacy plain-string useCase to an array',
  },
};

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');
const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : (v ? [v] : []));

(async () => {
  const snap = await db.collection('agents').get();
  const byName = new Map();
  snap.forEach((d) => {
    const a = { id: d.id, ...d.data() };
    if (a.approvalStatus !== 'approved' || a.archived === true) return;
    byName.set(a.agentName, a);
  });

  const writes = [];
  const problems = [];
  for (const [name, { patch, why }] of Object.entries(FIXES)) {
    const a = byName.get(name);
    if (!a) { problems.push(`✗ not found: "${name}" — data changed since the audit, skipping`); continue; }
    writes.push({ a, patch, why });
  }

  console.log(`Plan: ${writes.length} agents to update\n`);
  writes.forEach(({ a, patch, why }) => {
    console.log(`  ${a.agentName}`);
    console.log(`      ${why}`);
    Object.keys(patch).forEach((k) => {
      console.log(`      ${k}: ${JSON.stringify(arr(a[k]))}  ->  ${JSON.stringify(patch[k])}`);
    });
    console.log(`      unchanged: stage=${arr(a.sdlcStage).join('; ')} approveArea=${JSON.stringify(arr(a.approveArea))}`);
  });

  if (problems.length) {
    console.log('\n⚠ Problems:');
    problems.forEach((p) => console.log('  ' + p));
    console.log('  Refusing to apply a partial fix — resolve the above first.');
    if (APPLY) process.exit(1);
  }

  if (!APPLY) { console.log(`\nDry run only — re-run with --apply to write.`); return; }

  for (const { a, patch } of writes) {
    await db.collection('agents').doc(a.id).update({ ...patch, updatedAt: FieldValue.serverTimestamp() });
  }
  console.log(`\n✔ Updated ${writes.length} agents.`);
})().catch((e) => { console.error(e); process.exit(1); });
