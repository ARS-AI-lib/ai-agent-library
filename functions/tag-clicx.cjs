// Append the `CLICX` product category to every agent/skill owned by the
// promptfin team (2026-10-30, one-off requested by user).
//
//   node functions/tag-clicx.cjs            # dry run — READ THIS OUTPUT FIRST
//   node functions/tag-clicx.cjs --apply
//
// ── Why there is no hardcoded id list here ──
// Unlike tag-virtual-assistant.cjs (whose trigger was a fuzzy name/description
// sweep that could not be re-derived safely), this one has a CLEAN, explicit
// trigger: the `owner` field the user named. So the selection is a field match
// and the script can re-derive it — but it ASSERT the count against the number
// the user stated (8) and refuses to write if they disagree. A silent
// over- or under-selection is the failure mode this guard exists for.
//
// ── Append, never replace ──
// `category` is an array holding a discipline and optionally a product
// (CLAUDE.md §23). These docs keep whatever they already carry; this only adds
// one entry, deduped. This is exactly what backfill-categories.cjs got wrong —
// that script REPLACES and must never be run again.
//
// ── Approve-area safety ──
// `category` feeds layer 5 of agentApproveAreas(). CLICX maps to
// 'Business & Product' in CATEGORY_AREA (verified offline: the resolver really
// does return it). Two cases, and the difference matters:
//   • doc HAS a stored `approveArea` → layer 1 wins, routing cannot move.
//   • doc has NO stored area → adding CLICX DOES add 'Business & Product' to
//     its routing. That is layer 5 doing its job, not a bug — but it is a real
//     change in who can approve the doc, so it must be a deliberate decision,
//     not a side effect.
// The script asserts the FULL resolver output before/after and ABORTS if any
// doc would move, so this can never happen silently. It does NOT write
// `approveArea` — if the abort fires, decide that separately.
const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const CATEGORY = 'CLICX';
const OWNER = 'promptfin';
const EXPECTED = 8;
const SRC = path.join(__dirname, '..', 'src', 'lib');

// local fold for the owner string only — deliberately not imported: this is a
// one-off comparison for a human-typed free-text field, not a shipped rule.
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

function loadEsm(file, injected = {}) {
  const code = fs
    .readFileSync(path.join(SRC, file), 'utf8')
    .replace(/^\s*import\s[^;]*;\s*$/gm, '')
    .replace(/^export\s+/gm, '');
  const names = Object.keys(injected);
  const decls = [...code.matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  const body = `${code}\n;return { ${[...new Set(decls)].join(', ')} };`;
  return new Function(...names, body)(...names.map((n) => injected[n]));
}

const tier = loadEsm('tier.js');
const utils = loadEsm('agentUtils.js', { getType: tier.getType, getTier: tier.getTier });
const areas = loadEsm('approveAreas.js', {
  agentProcessIds: utils.agentProcessIds,
  splitRoles: utils.splitRoles,
  agentCategories: utils.agentCategories,
  isInternalOrExternal: tier.isInternalOrExternal,
});
const { agentApproveAreas, CATEGORY_AREA } = areas;
if (typeof agentApproveAreas !== 'function') {
  console.error('✗ failed to load src/lib/approveAreas.js — aborting');
  process.exit(1);
}

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

(async () => {
  const snap = await db.collection('agents').get();
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const catOf = (a) => (Array.isArray(a.category) ? a.category : (a.category ? [a.category] : []));
  const areaOf = (a) => (Array.isArray(a.approveArea) ? a.approveArea : (a.approveArea ? [a.approveArea] : []));

  const selected = rows.filter((a) => norm(a.owner) === OWNER);
  // Catch near-misses so nothing is dropped silently.
  const nearMiss = rows.filter(
    (a) => norm(a.owner) !== OWNER && norm(a.owner).includes(OWNER)
  );
  const alsoInTeam = rows.filter((a) => norm(a.team) === OWNER && norm(a.owner) !== OWNER);

  console.log(`collection size: ${rows.length}`);
  console.log(`CATEGORY_AREA['${CATEGORY}'] = ${JSON.stringify(CATEGORY_AREA[CATEGORY])}\n`);

  let shifted = 0;
  const todo = [];

  selected.forEach((a) => {
    const before = catOf(a);
    const after = before.includes(CATEGORY) ? before : [...before, CATEGORY];

    const areaBefore = agentApproveAreas({ ...a, category: before }).join(' | ');
    const areaAfter = agentApproveAreas({ ...a, category: after }).join(' | ');
    const moved = areaBefore !== areaAfter;
    if (moved) shifted++;
    if (after.length !== before.length) todo.push({ id: a.id, after });

    console.log(`  ${a.id.padEnd(22)} ${String(a.agentName || '').slice(0, 42)}`);
    console.log(`      owner=${JSON.stringify(a.owner)} team=${JSON.stringify(a.team)}`);
    console.log(`      category: [${before.join(', ')}] -> [${after.join(', ')}]`);
    console.log(`      storedArea=[${areaOf(a).join(', ')}]  resolver: ${areaBefore}${moved ? `  ⚠ -> ${areaAfter}` : '  (unchanged)'}`);
    console.log(`      status=${a.approvalStatus} archived=${!!a.archived} deploy=${a.deploymentStatus}`);
    console.log('');
  });

  console.log(`${selected.length} doc(s) with owner === "${OWNER}" · already tagged = ${selected.length - todo.length} · to write = ${todo.length} · approve-area shifts = ${shifted}`);
  if (nearMiss.length) {
    console.log(`\n⚠ ${nearMiss.length} doc(s) whose owner CONTAINS "${OWNER}" but is not an exact match (not selected):`);
    nearMiss.forEach((a) => console.log(`   ${a.id} — owner=${JSON.stringify(a.owner)} name=${a.agentName}`));
  }
  if (alsoInTeam.length) {
    console.log(`\n⚠ ${alsoInTeam.length} doc(s) whose team === "${OWNER}" but owner differs (not selected):`);
    alsoInTeam.forEach((a) => console.log(`   ${a.id} — owner=${JSON.stringify(a.owner)} team=${JSON.stringify(a.team)} name=${a.agentName}`));
  }

  if (shifted) {
    console.error(
      `\n✗ ${shifted} doc(s) have NO stored approveArea, so adding CLICX would add ` +
        `'Business & Product' to their routing — NOT writing. Decide that change ` +
        `deliberately (or set approveArea explicitly) before re-running.`
    );
    process.exit(1);
  }
  if (selected.length !== EXPECTED) {
    console.error(`\n✗ expected ${EXPECTED} doc(s), found ${selected.length} — NOT writing. Send this output back before anything is changed.`);
    process.exit(1);
  }
  if (!APPLY) {
    console.log('\nDRY RUN — review the rows above, then re-run with --apply to write.');
    return;
  }

  let batch = db.batch();
  let n = 0;
  for (const t of todo) {
    batch.update(db.collection('agents').doc(t.id), {
      category: t.after,
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  if (n % 400 !== 0) await batch.commit();
  console.log(`\n✓ wrote ${todo.length} doc(s)`);
})().catch((e) => { console.error(e); process.exit(1); });
