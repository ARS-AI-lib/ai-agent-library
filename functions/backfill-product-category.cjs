// Tag the product-specific agents with their product vertical (2026-08-17).
//
//   node functions/backfill-product-category.cjs            # dry run
//   node functions/backfill-product-category.cjs --apply
//
// ── Why these were missing ──
// The 4 product categories (NEXT / เป๋าตัง, เป๋าตุง, ถุงเงิน / CLIX / Core bank)
// were added 2026-08-10 as forward-looking config and sat at ZERO agents for a
// week, because nothing could write one:
//   • `suggested_category` was a single STRING, wrapped into a 1-element array
//     by PreRegModal — one category per agent, and since the prompt described
//     category only as "โดเมนงาน/สายงาน" with discipline examples, the
//     discipline answer always won.
//   • 3 of these 4 skills never even reached the AI (no analysisRuns doc);
//     their categories came from backfill-categories.cjs, same framing.
//   • No UI could add one afterwards — EditAgentModal had no category field.
// All three are fixed in the same change as this script; this backfills the
// agents that predate the fix.
//
// ── Scope ──
// Only 5 of 239 active agents mention a product anywhere in their name,
// description or output — checked directly. This library is overwhelmingly
// cross-product tooling, so the product categories being near-empty is the
// CORRECT answer for the other 234; do not be tempted to widen this.
//
// An explicit name→product map, deliberately NOT keyword matching: "NEXT" is a
// common English word and matching on it would mis-tag unrelated agents.
//
// APPENDS to category — never replaces. The discipline categories these agents
// already carry (Writing & Content / Design & UI) stay exactly as they are.
//
// Approver routing is unaffected: all 5 carry a stored `approveArea`, which is
// layer 1 of agentApproveAreas() and outranks the category layer. Verified by
// direct query before writing this. The script re-checks it per row and
// refuses to touch any agent where that is not true.
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');

const PAOTANG = 'เป๋าตัง, เป๋าตุง, ถุงเงิน';

// agentName -> { add: [...products], why }
const FIXES = {
  'UX Writer skill เป๋าตัง': { add: [PAOTANG], why: 'copy for the เป๋าตัง app' },
  'UX Writer skill ถุงเงิน': { add: [PAOTANG], why: 'copy for the ถุงเงิน app (same category groups all three wallets)' },
  'UX Writer skill Lotto': { add: [PAOTANG], why: 'its own description says "Feature Lotto ของแอปเป๋าตัง"' },
  'UX Writer skill NEXT': { add: ['NEXT'], why: 'copy for the NEXT app' },
  // The parent agent explicitly lists VB, NEXT, เป๋าตัง, lotto, ถุงเงิน.
  // VB has no category in the taxonomy — flagged for a human decision rather
  // than silently dropped; see the VB note printed at the end of this run.
  'UX Writer AI Agent': { add: ['NEXT', PAOTANG], why: 'covers VB, NEXT, เป๋าตัง, Lotto, ถุงเงิน — VB has no category yet' },
};

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');
const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : (v ? [v] : []));

(async () => {
  const [snap, cfg] = await Promise.all([
    db.collection('agents').get(),
    db.collection('config').doc('schema').get(),
  ]);
  const allowed = cfg.exists ? (cfg.data().category || []) : [];
  const products = cfg.exists ? (cfg.data().productCategory || []) : [];
  if (!allowed.length || !products.length) {
    console.error('✗ /config/schema.category or .productCategory is empty — run seed-approve-area-schema.cjs --apply first');
    process.exit(1);
  }

  const byName = new Map();
  snap.forEach((d) => {
    const a = { id: d.id, ...d.data() };
    if (a.approvalStatus !== 'approved' || a.archived === true) return;
    byName.set(a.agentName, a);
  });

  const writes = [];
  const problems = [];
  for (const [name, { add, why }] of Object.entries(FIXES)) {
    const a = byName.get(name);
    if (!a) { problems.push(`✗ not found: "${name}"`); continue; }
    // Every product must be a real, currently-allowed product category.
    const bad = add.filter((c) => !allowed.includes(c) || !products.includes(c));
    if (bad.length) { problems.push(`✗ "${name}": not a known product category: ${bad.join(', ')}`); continue; }
    // Refuse to touch an agent whose routing is NOT already pinned by a stored
    // approveArea — for those, adding a category could genuinely move the
    // approver, which is not something a category backfill should ever do.
    if (!arr(a.approveArea).length) {
      problems.push(`✗ "${name}": no stored approveArea — adding a category could change its routing, skipping`);
      continue;
    }
    const before = arr(a.category);
    const after = [...new Set([...before, ...add])];
    if (after.length === before.length) { problems.push(`• already tagged, skipping: "${name}"`); continue; }
    writes.push({ a, before, after, why });
  }

  console.log(`Plan: ${writes.length} agents to update\n`);
  writes.forEach(({ a, before, after, why }) => {
    console.log(`  ${a.agentName}`);
    console.log(`      ${why}`);
    console.log(`      category:   ${JSON.stringify(before)}`);
    console.log(`               -> ${JSON.stringify(after)}`);
    console.log(`      approveArea (unchanged, pins routing): ${JSON.stringify(arr(a.approveArea))}`);
  });

  if (problems.length) { console.log('\nNotes:'); problems.forEach((p) => console.log('  ' + p)); }

  console.log('\n⚠️  OPEN QUESTION: "UX Writer AI Agent" also serves **VB**, which has no');
  console.log('    category in the taxonomy. Decide whether to add a VB vertical');
  console.log('    (approveAreas.js VERTICAL_CATEGORIES + re-run seed) or leave it.');

  if (!APPLY) { console.log('\nDry run only — re-run with --apply to write.'); return; }
  if (!writes.length) { console.log('\nnothing to do.'); return; }

  for (const { a, after } of writes) {
    await db.collection('agents').doc(a.id).update({ category: after, updatedAt: FieldValue.serverTimestamp() });
  }
  console.log(`\n✔ Updated ${writes.length} agents.`);
})().catch((e) => { console.error(e); process.exit(1); });
