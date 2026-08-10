// One-time migration for the 2026-08-10 "Architecture & Engineering" split
// into "Architecture" + "Development" (see src/lib/approveAreas.js's header
// for the full rationale and src/lib/approveAreas.js's AREA_ORDER for the
// new 13-area list).
//
// Why this script exists at all: agent.approveArea is a STORED field (layer
// 1 of agentApproveAreas() — always wins). Changing the taxonomy in code does
// nothing for an agent that already has "Architecture & Engineering" written
// to Firestore from the original backfill; that string just becomes stale
// data forever unless something rewrites it. This script targets EXACTLY the
// agents holding that stale value — nothing else. It must NOT touch the 6
// manual overrides or any AI-suggested approveArea from pre-registration,
// since none of those reference the old area name (confirmed before writing
// this script).
//
//   node functions/split-architecture-engineering.cjs           # dry run
//   node functions/split-architecture-engineering.cjs --apply
//   node functions/split-architecture-engineering.cjs --verbose
//
// Loads the REAL src/lib modules (same technique as backfill-approve-area.cjs
// and seed-approve-area-schema.cjs) so this exercises the actual new resolver,
// not a reimplementation that could drift from it.
const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const VERBOSE = process.argv.includes('--verbose');
const OLD_AREA = 'Architecture & Engineering';

const SRC = path.join(__dirname, '..', 'src', 'lib');
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

const { AREA_ORDER, agentApproveAreas } = areas;
if (!Array.isArray(AREA_ORDER) || AREA_ORDER.length !== 13 || AREA_ORDER.includes(OLD_AREA)) {
  console.error('✗ src/lib/approveAreas.js does not look like the post-split taxonomy — aborting');
  console.error('  (expected 13 areas with no "Architecture & Engineering" entry, got:', JSON.stringify(AREA_ORDER), ')');
  process.exit(1);
}

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

(async () => {
  const snap = await db.collection('agents').get();
  const affected = [];
  snap.forEach((d) => {
    const a = { id: d.id, ...d.data() };
    if (a.approvalStatus !== 'approved' || a.archived === true) return;
    if (!Array.isArray(a.approveArea) || !a.approveArea.includes(OLD_AREA)) return;
    affected.push(a);
  });

  console.log(`=== agents currently holding "${OLD_AREA}": ${affected.length} ===`);

  const writes = [];
  let unresolved = 0;
  affected.forEach((a) => {
    // Blank approveArea so the resolver recomputes from scratch (layers
    // 2-7) using the NEW tables, rather than trying to patch the stale
    // array in place — this is what correctly regenerates a multi-area
    // result like the 10 Figma agents (["Architecture & Engineering",
    // "UI & Visual Design"]) into the right new pairing.
    const recomputed = agentApproveAreas({ ...a, approveArea: [] });
    if (!recomputed.length) unresolved++;
    writes.push({ id: a.id, name: a.agentName, old: a.approveArea, next: recomputed });
    if (VERBOSE || !APPLY) {
      console.log(`  ${a.agentName}\n      ${JSON.stringify(a.approveArea)}  →  ${JSON.stringify(recomputed)}`);
    }
  });

  if (unresolved) {
    console.error(`\n✗ ${unresolved} agent(s) would resolve to [] — refusing to proceed (would reopen the invisible-queue bug)`);
    process.exit(1);
  }
  console.log(`\n✓ all ${writes.length} recompute to a non-empty area`);

  console.log(`\n${APPLY ? 'WRITING' : 'DRY RUN — would write'} ${writes.length} agent(s)`);
  if (!APPLY) { console.log('re-run with --apply to write.'); return; }

  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    writes.slice(i, i + 400).forEach((w) => batch.update(db.collection('agents').doc(w.id), { approveArea: w.next }));
    await batch.commit();
    console.log(`  committed ${Math.min(i + 400, writes.length)}/${writes.length}`);
  }
  console.log('✓ done');
})();
