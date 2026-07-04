// Backfill script — run once in Cloud Shell to make the 144 existing
// migrated agents visible on the new dashboard.
//
// Sets `approvalStatus: 'approved'` on every /agents doc that doesn't
// already have an `approvalStatus` field. Does NOT touch the existing
// `status` field (still ='active' from Phase 1 migration — untouched,
// different meaning, kept as-is).
//
// Usage:
//   npm install firebase-admin
//   node backfill-approval-status.cjs
//
// Requires Application Default Credentials — already available for free
// inside Cloud Shell (gcloud auth is pre-configured there).
//
// NOTE: uses the modular firebase-admin API (initializeApp/getFirestore)
// — newer firebase-admin versions dropped the old namespaced
// `admin.firestore()` call, so this avoids the "admin.firestore is not
// a function" error on recent installs.

const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const app = initializeApp({ projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib'); // named, non-default Firestore DB

async function run() {
  const snap = await db.collection('agents').get();
  console.log(`พบ ${snap.size} documents ใน /agents`);

  let toUpdate = [];
  snap.forEach((doc) => {
    const data = doc.data();
    if (!data.approvalStatus) {
      toUpdate.push(doc.ref);
    }
  });

  console.log(`จะ backfill approvalStatus='approved' ให้ ${toUpdate.length} documents`);
  if (toUpdate.length === 0) {
    console.log('ไม่มีอะไรต้องทำ — ทุก document มี approvalStatus อยู่แล้ว');
    return;
  }

  // Firestore batch writes are capped at 500 ops — chunk just in case.
  const CHUNK = 400;
  for (let i = 0; i < toUpdate.length; i += CHUNK) {
    const batch = db.batch();
    toUpdate.slice(i, i + CHUNK).forEach((ref) => {
      batch.update(ref, { approvalStatus: 'approved' });
    });
    await batch.commit();
    console.log(`✅ commit แล้ว ${Math.min(i + CHUNK, toUpdate.length)}/${toUpdate.length}`);
  }

  console.log('🎉 เสร็จแล้ว — รีเฟรช dashboard ดูได้เลย');
}

run().catch((err) => {
  console.error('❌ Backfill ล้มเหลว:', err);
  process.exit(1);
});
