// Append the new `Virtual Assistant` category to the conversational
// agents/skills already in the library (2026-09-23, one-off).
//
//   node functions/tag-virtual-assistant.cjs            # dry run
//   node functions/tag-virtual-assistant.cjs --apply
//
// ── Why the id list is hardcoded ──
// A regex sweep over name/description returned 48 docs and was wrong on both
// sides: it caught UX Writer skills that merely contain the word "ผู้ช่วย",
// plus Survey Design and Figma skills, and it had no way to tell a
// conversational product from a document-QA prompt. The 28 below were read one
// by one. A regex re-run would silently re-introduce those false positives, so
// there is deliberately no rule here to re-derive.
//
// ── Append, never replace ──
// `category` is an array holding a discipline and optionally a product
// (CLAUDE.md §23). These docs keep whatever they already carry; this only adds
// one entry, deduped. This is exactly what backfill-categories.cjs got wrong —
// that script REPLACES and must never be run again.
//
// ── Approve-area safety ──
// `category` feeds layer 5 of agentApproveAreas(). Every one of the 28 has a
// stored `approveArea` (layer 1), which wins outright, so no approval routing
// moves. The script asserts that before writing rather than trusting the note.
const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const CATEGORY = 'Virtual Assistant';
const SRC = path.join(__dirname, '..', 'src', 'lib');

const IDS = [
  // VA stack (Tech Innovation) — orchestrator, guardrail and their prompt parts
  'agent_0079', 'agent_0080',
  'agent_0102', 'agent_0103', 'agent_0104', 'agent_0105', 'agent_0106', 'agent_0107',
  'agent_0108', 'agent_0109', 'agent_0110', 'agent_0111', 'agent_0112', 'agent_0113',
  'agent_0114',
  // This library's own chat (ALPHA) and the tools it calls
  'pYrXYO5EJZAbrQGPm4jT', 'tM9BRb0ZGbGrqVpqO39b', '3Nc5yiCg1vOzXwXf2eZr',
  'Kyry4e5iWOweGlV4WvIt', 'cmGiDbd0ZtM58mnd8Fi1', '1kFtOck4Abf67MO3NvXC',
  'TugZODmjFodpCOZ0WYXd', 'fSuc9H8StRP0Yw8nNm0W',
  // Other conversational products
  'agent_0004', 'agent_0141', 'agent_0085', 'agent_0087', 'agent_0088',
];

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
const { agentApproveAreas } = areas;
if (typeof agentApproveAreas !== 'function') {
  console.error('✗ failed to load src/lib/approveAreas.js — aborting');
  process.exit(1);
}

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

(async () => {
  const snaps = await db.getAll(...IDS.map((id) => db.collection('agents').doc(id)));

  const missing = snaps.filter((s) => !s.exists).map((s) => s.id);
  if (missing.length) {
    console.error(`✗ ${missing.length} id(s) not found — aborting: ${missing.join(', ')}`);
    process.exit(1);
  }

  const rows = snaps.map((s) => ({ id: s.id, ...s.data() }));
  let shifted = 0;
  const todo = [];

  rows.forEach((a) => {
    const before = Array.isArray(a.category) ? a.category : (a.category ? [a.category] : []);
    const after = before.includes(CATEGORY) ? before : [...before, CATEGORY];

    // Assert routing does not move. Compare the FULL resolver before/after,
    // which is the thing that actually decides who approves this doc.
    const areaBefore = agentApproveAreas({ ...a, category: before }).join(' | ');
    const areaAfter = agentApproveAreas({ ...a, category: after }).join(' | ');
    const moved = areaBefore !== areaAfter;
    if (moved) shifted++;

    console.log(`  ${a.id.padEnd(22)} ${(a.agentName || '').slice(0, 38).padEnd(40)}`);
    console.log(`      category: [${before.join(', ')}] -> [${after.join(', ')}]`);
    console.log(`      area    : ${areaBefore}${moved ? `  ⚠ -> ${areaAfter}` : '  (unchanged)'}`);

    if (after.length !== before.length) todo.push({ id: a.id, after });
  });

  console.log(`\n${rows.length} docs · to write = ${todo.length} · approve-area shifts = ${shifted}`);

  if (shifted) {
    console.error('✗ at least one doc would change approve area — aborting (see ⚠ above)');
    process.exit(1);
  }
  if (!APPLY) {
    console.log('\nDRY RUN — re-run with --apply to write.');
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
  console.log(`\n✓ wrote ${todo.length} docs`);
})().catch((e) => { console.error(e); process.exit(1); });
