// Rename the retired category value `DevOps & Performance` → `DevOps & Platform`
// on the docs that still carry it (2026-10-30, one-off).
//
//   node functions/fix-devops-category.cjs            # dry run — read this first
//   node functions/fix-devops-category.cjs --apply
//
// Found by functions/count-categories.cjs: the value exists on live docs but in
// NEITHER /config/schema.category NOR CATEGORY_AREA — i.e. a doc tagged with a
// category the app no longer knows. It shows up as a stray sidebar group.
//
// This is a RENAME, not a strip: `DevOps & Performance` → `DevOps & Platform`
// is the mapping the repo already declares in two places —
//   src/lib/approveAreas.js  :  'DevOps & Platform': '...', // renamed from 'DevOps & Performance'
//   functions/realign-categories.cjs : RETIRED = [..., 'DevOps & Performance']
// so no product tag is being removed. If a doc somehow carries BOTH spellings
// the old one is dropped and the new one kept (that is still a rename, not a
// data loss — the doc is left with exactly one DevOps value).
//
// ⛔ Do NOT run realign-categories.cjs again to fix this (CLAUDE.md §27 freezes
// it as history and forbids re-running). This script touches only the one value.
//
// ── Approve-area safety ──
// `DevOps & Performance` is not a key in CATEGORY_AREA, so today it contributes
// NOTHING to routing. `DevOps & Platform` maps to 'Platform, DevOps & Operations'
// — so renaming can genuinely ADD an area to a doc that has no stored area for
// it. The script asserts the full agentApproveAreas() output before/after and
// ABORTS if any doc moves, so that can never happen silently. It does NOT write
// `approveArea`.
const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const RENAMES = { 'DevOps & Performance': 'DevOps & Platform' };
const OLD = Object.keys(RENAMES);
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
const { agentApproveAreas, CATEGORY_AREA } = areas;
if (typeof agentApproveAreas !== 'function') {
  console.error('✗ failed to load src/lib/approveAreas.js — aborting');
  process.exit(1);
}
// Guard: the target must be a real, known category. If someone retires it later
// this script must stop rather than write another orphan value.
for (const to of Object.values(RENAMES)) {
  if (!(to in CATEGORY_AREA)) {
    console.error(`✗ "${to}" is not a key of CATEGORY_AREA — aborting (category list changed?)`);
    process.exit(1);
  }
}

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

(async () => {
  const snap = await db.collection('agents').get();
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const catOf = (a) => (Array.isArray(a.category) ? a.category.filter(Boolean) : []);
  const areaOf = (a) => (Array.isArray(a.approveArea) ? a.approveArea : (a.approveArea ? [a.approveArea] : []));

  const rename = (cats) => {
    const out = [];
    for (const c of cats) {
      const to = RENAMES[c];
      if (to) {
        if (!out.includes(to)) out.push(to); // renamed; drop a duplicate new spelling
      } else if (!out.includes(c)) {
        out.push(c);
      }
    }
    return out;
  };

  const selected = rows.filter((a) => catOf(a).some((c) => OLD.includes(c)));
  console.log(`collection size: ${rows.length} · docs carrying ${OLD.join(' / ')} = ${selected.length}\n`);

  // Any other value that is not a known category — reported, never touched.
  const otherDrift = new Set();
  for (const a of rows) for (const c of catOf(a)) if (!(c in CATEGORY_AREA) && !OLD.includes(c)) otherDrift.add(c);

  let shifted = 0;
  const todo = [];
  for (const a of selected) {
    const before = catOf(a);
    const after = rename(before);
    const areaBefore = agentApproveAreas({ ...a, category: before }).join(' | ');
    const areaAfter = agentApproveAreas({ ...a, category: after }).join(' | ');
    const moved = areaBefore !== areaAfter;
    if (moved) shifted++;
    if (after.length !== before.length || after.join() !== before.join()) todo.push({ id: a.id, after });

    console.log(`  ${a.id.padEnd(22)} ${String(a.agentName || '').slice(0, 42)}`);
    console.log(`      owner=${JSON.stringify(a.owner)} category: [${before.join(', ')}] -> [${after.join(', ')}]`);
    console.log(`      storedArea=[${areaOf(a).join(', ')}]  resolver: ${areaBefore}${moved ? `  ⚠ -> ${areaAfter}` : '  (unchanged)'}`);
    console.log(`      status=${a.approvalStatus} archived=${!!a.archived}`);
    console.log('');
  }

  console.log(`${selected.length} doc(s) · to write = ${todo.length} · approve-area shifts = ${shifted}`);
  if (otherDrift.size) console.log(`⚠ other unknown category values on docs (not touched): ${[...otherDrift].join(', ')}`);

  if (!selected.length) { console.log('\nnothing to do.'); return; }
  if (shifted) {
    console.error(
      `\n✗ ${shifted} doc(s) would change approve area (they have no stored area for ` +
        `'Platform, DevOps & Operations') — NOT writing. Decide deliberately before re-running.`
    );
    process.exit(1);
  }
  if (!APPLY) { console.log('\nDRY RUN — review the rows above, then re-run with --apply to write.'); return; }

  let batch = db.batch();
  let n = 0;
  for (const t of todo) {
    batch.update(db.collection('agents').doc(t.id), { category: t.after, updatedAt: FieldValue.serverTimestamp() });
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  if (n % 400 !== 0) await batch.commit();
  console.log(`\n✓ wrote ${todo.length} doc(s)`);
})().catch((e) => { console.error(e); process.exit(1); });
