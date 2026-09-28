// Backfill agent.approveArea for docs that never got one (2026-09-28).
//
// Why: PreRegModal computed inheritedFromAgent.approveArea from the AI's
// suggested_approve_area since 2026-08-10 (84dafa3) but never put it into
// either addDoc, so every submission since then had no stored area. The web
// queue hid this (agentApproveAreas() falls back 7 layers), but everything
// server-side reads the STORED field only: notification routing, endpoint
// upload / mark-ready permissions, Usage Report scoping.
//
// Value, in order:
//   1. analysisRuns/{id}.result.suggested_approve_area — what the form SHOULD
//      have written at submit time — filtered to /config/schema.approveArea
//   2. the real agentApproveAreas() (loaded from src/lib, never copied)
// Only docs with a missing/empty area are touched; a set area is never changed.
//
//   node functions/backfill-missing-approve-area.cjs          # dry run
//   node functions/backfill-missing-approve-area.cjs --apply
//
// (backfill-approve-area.cjs is the 2026-08-10 original — it asserts the old
// 12-area taxonomy and must not be re-run.)
const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const SRC = path.join(__dirname, '..', 'src', 'lib');

// Same loader as backfill-approve-area.cjs: evaluate the real ESM source.
function loadEsm(file, injected = {}) {
  const code = fs.readFileSync(path.join(SRC, file), 'utf8')
    .replace(/^\s*import\s[^;]*;\s*$/gm, '')
    .replace(/^export\s+/gm, '');
  const names = Object.keys(injected);
  const decls = [...code.matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  return new Function(...names, `${code}\n;return { ${[...new Set(decls)].join(', ')} };`)(...names.map((n) => injected[n]));
}
const tier = loadEsm('tier.js');
const utils = loadEsm('agentUtils.js', { getType: tier.getType, getTier: tier.getTier });
const { AREA_ORDER, agentApproveAreas } = loadEsm('approveAreas.js', {
  agentProcessIds: utils.agentProcessIds,
  splitRoles: utils.splitRoles,
  agentCategories: utils.agentCategories,
  isInternalOrExternal: tier.isInternalOrExternal,
});
if (!Array.isArray(AREA_ORDER) || !AREA_ORDER.length || typeof agentApproveAreas !== 'function') {
  console.error('✗ failed to load src/lib/approveAreas.js — aborting');
  process.exit(1);
}

const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' }), 'ai-agent-lib');

(async () => {
  const schema = (await db.collection('config').doc('schema').get()).data() || {};
  const valid = new Set(Array.isArray(schema.approveArea) && schema.approveArea.length ? schema.approveArea : AREA_ORDER);
  const categoryAreaMap = schema.categoryAreaMap || {};

  const agents = (await db.collection('agents').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const targets = agents.filter((a) => !(Array.isArray(a.approveArea) && a.approveArea.some((x) => valid.has(x))));

  const plan = [];
  for (const a of targets) {
    const kb = await db.collection('analysisRuns').doc(a.id).get();
    const ai = kb.exists ? (kb.data().result?.suggested_approve_area || []) : [];
    const fromAi = (Array.isArray(ai) ? ai : [ai]).filter((x) => valid.has(x));
    const area = fromAi.length ? fromAi : agentApproveAreas({ ...a, approveArea: [] }, categoryAreaMap).filter((x) => valid.has(x));
    plan.push({ a, area, source: fromAi.length ? 'ai' : (area.length ? 'resolver' : 'UNRESOLVED') });
  }

  const tally = plan.reduce((m, p) => ((m[p.source] = (m[p.source] || 0) + 1), m), {});
  plan.forEach((p) => console.log(`${p.source.padEnd(10)} ${String(p.a.approvalStatus).padEnd(9)} ${p.a.agentName}  →  ${p.area.join(', ') || '—'}`));
  console.log(`\ntargets ${plan.length} of ${agents.length} · ${JSON.stringify(tally)}`);

  if (!APPLY) { console.log('\nDRY RUN — nothing written'); process.exit(0); }
  let n = 0;
  for (const p of plan.filter((x) => x.area.length)) {
    await db.collection('agents').doc(p.a.id).update({ approveArea: p.area, updatedAt: FieldValue.serverTimestamp() });
    n += 1;
  }
  console.log(`\nAPPLIED ${n}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
