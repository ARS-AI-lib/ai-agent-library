#!/usr/bin/env node
/**
 * Backfill `launchDate` on agents already at 100% without one (2026-08-19).
 *
 * ⚠️ THESE DATES ARE ESTIMATES, AND THE DATA SAYS SO.
 * The intended source was `deployDecidedAt` — the real moment a deployment was
 * approved. Measured: **0 of the 17 targets have it.** All 17 are Figma skills
 * with `deploymentStatus: 'none'`; they were bulk-created at 100% and never
 * went through a deploy request at all, so no real launch event was ever
 * recorded for any of them.
 *
 * The user chose `createdAt` as the fallback after that was raised. It is a
 * creation date, not a launch, and it feeds Timeline and Dashboard — which sits
 * uneasily beside SYSTEM-OVERVIEW:353 ("อย่าใส่ตัวเลขปลอมหรือประมาณเอาเด็ดขาด").
 * So every row written here is stamped `launchDateEstimated: true` and listed
 * in the Dashboard's Data Quality Watchlist, keeping the estimate visible
 * rather than letting it pass as an observed fact.
 *
 * Going forward this script is not needed: markAgentReady records the actual
 * transition timestamp, which is a real event and is NOT flagged.
 *
 * Usage:  node functions/backfill-launch-date.cjs           # dry run
 *         node functions/backfill-launch-date.cjs --apply   # write
 */

const admin = require('firebase-admin');

const APPLY = process.argv.includes('--apply');

admin.initializeApp({ projectId: 'wolfy-481609' });
const db = admin.firestore();
db.settings({ databaseId: 'ai-agent-lib' });

const progressOf = (raw) => {
  if (typeof raw === 'number') return raw;
  const m = String(raw || '').match(/\d+/);
  return m ? Number(m[0]) : 0;
};

(async () => {
  const snap = await db.collection('agents').get();
  const targets = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((a) => a.approvalStatus === 'approved' && a.archived !== true)
    .filter((a) => progressOf(a.devProgress) === 100 && !a.launchDate);

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — agents at 100% with no launchDate: ${targets.length}\n`);
  if (!targets.length) { console.log('nothing to do'); return; }

  const usable = targets.filter((a) => a.createdAt);
  const unusable = targets.filter((a) => !a.createdAt);

  targets.forEach((a) => {
    const src = a.createdAt?.toDate ? a.createdAt.toDate().toISOString().slice(0, 10) : '(no createdAt)';
    console.log(`  ${(a.agentName || '').slice(0, 42).padEnd(44)} launchDate <- createdAt (${src})`);
  });
  if (unusable.length) {
    console.log(`\n  ⚠ ${unusable.length} have no createdAt either and will be SKIPPED`);
  }

  if (!APPLY) {
    console.log('\ndry run — nothing written (pass --apply to write)');
    return;
  }

  console.log('\n── writing ──');
  let ok = 0;
  for (const a of usable) {
    await db.collection('agents').doc(a.id).update({
      launchDate: a.createdAt,
      // The marker that keeps this honest — read by the Dashboard watchlist.
      launchDateEstimated: true,
    });
    ok += 1;
    console.log(`  ✓ ${a.agentName}`);
  }
  console.log(`\nเสร็จ: ${ok}/${targets.length}${unusable.length ? ` (ข้าม ${unusable.length})` : ''}`);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
