// One-time migration — remaps the old 3-tier role model to the new 4-tier
// one on every existing /users doc:
//   viewer → user
//   editor → approver
//   admin  → admin (unchanged)
//
// Dry-run by default (prints what WOULD change, writes nothing). Pass
// --apply to actually write.
//
// Usage:
//   node migrate-roles-v2.cjs            # dry run
//   node migrate-roles-v2.cjs --apply    # writes changes
//
// Requires Application Default Credentials (already configured in Cloud Shell).

const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');

const app = initializeApp({ projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib'); // named, non-default Firestore DB

const ROLE_MAP = { viewer: 'user', editor: 'approver', admin: 'admin' };

async function run() {
  const snap = await db.collection('users').get();
  console.log(`พบ ${snap.size} documents ใน /users`);

  let toChange = 0;
  let unmapped = 0;
  const batch = db.batch();

  snap.forEach((doc) => {
    const data = doc.data();
    const oldRole = data.role;
    const newRole = ROLE_MAP[oldRole];
    if (!newRole) {
      console.log(`  ⚠️  ${doc.id} (${data.email || '?'}) มี role ที่ไม่รู้จัก: "${oldRole}" — ข้าม`);
      unmapped++;
      return;
    }
    if (newRole === oldRole) return; // already 'admin', no change needed
    console.log(`  ${doc.id} (${data.email || '?'}): ${oldRole} → ${newRole}`);
    toChange++;
    if (APPLY) batch.update(doc.ref, { role: newRole });
  });

  console.log(`\n${toChange} docs ${APPLY ? 'กำลังอัปเดต' : 'จะถูกอัปเดต'}, ${unmapped} docs ข้าม (role ไม่รู้จัก)`);

  if (APPLY && toChange > 0) {
    await batch.commit();
    console.log('✅ Commit สำเร็จ');
  } else if (!APPLY) {
    console.log('ℹ️  Dry run เท่านั้น — รันใหม่พร้อม --apply เพื่อบันทึกจริง');
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
