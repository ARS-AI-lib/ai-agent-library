// Clears users.approveAreas values left over from the old 7-SDLC-stage
// taxonomy (2026-08-10 replaced by the 12 discipline areas in
// src/lib/approveAreas.js). None of the old values ("Discovery", "Design",
// "Build", "Across Phase", "Business", ...) match the new AREA_ORDER, so a
// user still holding one is scoped to an area that no longer exists —
// visually looks assigned in UserManagementModal, but matches nothing in
// agentApproveAreas() and so approves nothing. Clearing to [] makes that
// state honest (empty picker) instead of misleadingly non-empty, ahead of
// deliberate reassignment against the new areas.
//
//   node functions/clear-stale-approve-areas.cjs           # dry run
//   node functions/clear-stale-approve-areas.cjs --apply
const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');

const src = fs
  .readFileSync(path.join(__dirname, '..', 'src', 'lib', 'approveAreas.js'), 'utf8')
  .replace(/^\s*import\s[^;]*;\s*$/gm, '')
  .replace(/^export\s+/gm, '');
const { AREA_ORDER } = new Function(`${src}\n;return { AREA_ORDER };`)();

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

(async () => {
  const snap = await db.collection('users').get();
  const toClear = [];
  snap.forEach((d) => {
    const u = d.data();
    const cur = Array.isArray(u.approveAreas) ? u.approveAreas : [];
    if (!cur.length) return;
    // Only clear values that are ENTIRELY stale — if a user somehow already
    // holds a mix of old and new-taxonomy values, leave them alone and flag
    // for a human rather than silently dropping a real assignment.
    const stale = cur.filter((a) => !AREA_ORDER.includes(a));
    const valid = cur.filter((a) => AREA_ORDER.includes(a));
    if (!stale.length) return;
    toClear.push({ id: d.id, email: u.email || d.id, role: u.role, stale, valid });
  });

  console.log(`=== users with stale (pre-2026-08-10) approveAreas: ${toClear.length} ===`);
  toClear.forEach((u) => {
    console.log(`  ${u.email}  role=${u.role}  stale=${JSON.stringify(u.stale)}${u.valid.length ? `  KEEPING valid=${JSON.stringify(u.valid)}` : ''}`);
  });

  console.log(`\n${APPLY ? 'CLEARING' : 'DRY RUN — would clear'} ${toClear.length} user(s)`);
  if (!APPLY) { console.log('re-run with --apply to write.'); return; }

  const batch = db.batch();
  toClear.forEach((u) => batch.update(db.collection('users').doc(u.id), { approveAreas: u.valid }));
  await batch.commit();
  console.log('✓ done');
})();
