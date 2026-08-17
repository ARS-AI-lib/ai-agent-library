// Give every agent doc an explicit `deploymentStatus` (2026-08-12).
//
//   node functions/backfill-deployment-status.cjs            # dry run
//   node functions/backfill-deployment-status.cjs --apply
//
// ── Why ──
// 71 of 245 agent docs (legacy CSV imports; PreRegModal has always written
// 'none' for anything submitted through the app) have NO deploymentStatus key
// at all. In Firestore Security Rules, dot-access on a key the document does
// not have raises an evaluation error, and an error DENIES the write — so
// every rule branch containing
//     !(resource.data.deploymentStatus in ['requested', 'approved'])
// denied ALL detail/SDLC/approveArea edits on those 71 docs, for everyone
// except admin (who short-circuits on the isAdmin() branch before reaching
// them). The user-visible symptom was a bare "Missing or insufficient
// permissions" in the Edit modal, naming no field.
//
// Concrete case that triggered this: `Writer Research Intelligence
// (Competitor)` — the reporter is in its creatorEmails and is an approver for
// its area, and every other conjunct of the Tier B branch verifies true
// against the real doc (payload is a subset of the 21 allowed keys,
// isOwnerCreatorOrApprover passes on creatorEmails, devProgress 20 <= 95).
// The absent-field term was the only one left.
//
// firestore.rules has been fixed to read these with .get(field, default), so
// this backfill is NOT what makes editing work again — the rules are. This
// exists so the stored data stops being lopsided (two shapes of the same doc
// type), which is what let the rules bug hide for so long.
//
// Deliberately does NOT touch `archived`, which is absent on every doc: no
// rule reads it off the existing document (the archive branch validates
// request.resource.data.archived), and the client already treats absent as
// not-archived. Writing it to 245 docs would be churn with no defect behind it.
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

(async () => {
  const snap = await db.collection('agents').get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const todo = all.filter((a) => a.deploymentStatus === undefined);

  console.log(`agents: ${all.length} · missing deploymentStatus: ${todo.length}`);
  const byStatus = {};
  todo.forEach((a) => { const k = a.approvalStatus || '(none)'; byStatus[k] = (byStatus[k] || 0) + 1; });
  console.log('breakdown by approvalStatus:', JSON.stringify(byStatus));
  console.log(`\nall of these would be set to deploymentStatus: 'none'`);
  todo.slice(0, 10).forEach((a) => console.log(`   · ${a.agentName}`));
  if (todo.length > 10) console.log(`   … and ${todo.length - 10} more`);

  // 'none' is correct for every one of them by construction: a doc that had
  // ever been through the deploy flow would carry a value already, since every
  // write that advances deploymentStatus sets it explicitly.
  if (!APPLY) { console.log('\n[dry run] nothing written. re-run with --apply'); return; }
  if (!todo.length) { console.log('\nnothing to do.'); return; }

  // Batched in chunks of 400 (Firestore caps a batch at 500 writes).
  let done = 0;
  for (let i = 0; i < todo.length; i += 400) {
    const batch = db.batch();
    todo.slice(i, i + 400).forEach((a) => {
      batch.update(db.collection('agents').doc(a.id), {
        deploymentStatus: 'none',
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
    done += Math.min(400, todo.length - i);
  }
  console.log(`\n✔ set deploymentStatus:'none' on ${done} docs`);
})().catch((e) => { console.error(e); process.exit(1); });
