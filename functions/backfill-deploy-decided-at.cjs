#!/usr/bin/env node
/**
 * Backfill `deployDecidedAt` on legacy deploy-approved agents (2026-08-18).
 *
 * `PendingApprovalModal.jsx`'s `decideDeploy()` writes `deployDecidedAt:
 * serverTimestamp()` on every approve/reject made through the modal. 15 of
 * the 29 currently deploy-approved agents predate that field — they were
 * bulk-approved outside the modal on 2026-08-07 (confirmed: only two
 * distinct `updatedAt` timestamps across all 15, `09:13:06` and `09:28:29`,
 * i.e. one batch operation, not 15 separate decisions).
 *
 * `updatedAt` on those docs IS the real approval moment — it was set by the
 * very same write that flipped `deploymentStatus` to `'approved'` — so this
 * copies it into `deployDecidedAt` rather than inventing a value.
 *
 * `deployDecidedBy` is deliberately left unset: who ran that legacy batch
 * isn't recorded anywhere, and guessing would be worse than an absent field.
 *
 * Usage:  node functions/backfill-deploy-decided-at.cjs           # dry run
 *         node functions/backfill-deploy-decided-at.cjs --apply   # write
 */

const admin = require('firebase-admin');

const APPLY = process.argv.includes('--apply');

admin.initializeApp({ projectId: 'wolfy-481609' });
const db = admin.firestore();
db.settings({ databaseId: 'ai-agent-lib' });

(async () => {
  const snap = await db.collection('agents').get();
  const targets = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((a) => a.approvalStatus === 'approved' && a.archived !== true)
    .filter((a) => a.deploymentStatus === 'approved' && !a.deployDecidedAt);

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — deploy-approved agents missing deployDecidedAt: ${targets.length}\n`);

  if (!targets.length) {
    console.log('nothing to do');
    return;
  }

  for (const a of targets) {
    const src = a.updatedAt?.toDate ? a.updatedAt.toDate().toISOString() : '(no updatedAt either)';
    console.log(`  ${(a.agentName || '').slice(0, 40).padEnd(42)} deployDecidedAt <- updatedAt (${src})`);
  }

  if (!APPLY) {
    console.log('\ndry run — nothing written (pass --apply to write)');
    return;
  }

  console.log('\n── writing ──');
  let ok = 0;
  for (const a of targets) {
    if (!a.updatedAt) {
      console.log(`  ⚠ skipped ${a.agentName} — no updatedAt to copy from`);
      continue;
    }
    await db.collection('agents').doc(a.id).update({ deployDecidedAt: a.updatedAt });
    ok += 1;
    console.log(`  ✓ ${a.agentName}`);
  }
  console.log(`\nเสร็จ: ${ok}/${targets.length}`);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
