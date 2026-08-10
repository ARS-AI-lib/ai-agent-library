// Realigns every agent's `category` to the 2026-08-10 category taxonomy, in
// which each category maps to exactly one approver area (see CATEGORY_AREA in
// src/lib/approveAreas.js for the rule and why it changed).
//
//   node functions/realign-categories.cjs           # dry run
//   node functions/realign-categories.cjs --apply
//
// ── What changes and why ─────────────────────────────────────────────
// Areas were split three times in one day (Architecture/Development, SIT/QA,
// and the post-dev pair) while the category list stayed put. The result: the
// five LARGEST categories had become unusable as routing signal and had to be
// nulled, and six areas had no category at all. This script brings the data
// in line with the corrected list.
//
// The discipline category is DERIVED FROM approveArea rather than guessed
// from text, because approveArea on all 243 agents is already correct — it
// was set by the earlier migrations from process/owner/role evidence and
// verified by a full partition proof. Business verticals (the bank's actual
// products) are carried over untouched: they answer a different question
// ("which product is this for") and are the reason a category list exists
// separately from the area list at all.
//
// Retired categories:
//   'Testing & QA'                → replaced by the SIT/QA it was masking
//   'Orchestration & Automation'  → retired outright. Its 25 agents spread
//     across 8 different areas, and 23 of them already carried a second,
//     more meaningful category, so it was describing a technique rather than
//     a discipline and could never satisfy the one-area rule.
//   'DevOps & Performance'        → renamed 'DevOps & Platform'; the
//     performance half moved to Development when Quality & Testing split, so
//     the old name no longer described where it routes.
const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');

// area → the single discipline category that represents it.
// Business & Product deliberately has NO discipline category: its agents are
// identified by which product vertical they serve, and every one of them
// either already carries a vertical or keeps whatever descriptive category it
// had (see BP_KEEP below).
const AREA_CATEGORY = {
  'Governance, Risk & Procurement': 'Compliance & Governance',
  'Delivery Management': 'Project & Delivery',
  'Business Analysis': 'Requirements & Product',
  'UX Research': 'UX Research',
  'UI & Visual Design': 'Design & UI',
  'Content & UX Writing': 'Writing & Content',
  'Architecture': 'Architecture',
  'Development': 'Software Development',
  'SIT': 'SIT',
  'QA': 'QA',
  'Security': 'Security',
  'Platform, DevOps & Operations': 'DevOps & Platform',
  'SRE & Reliability': 'SRE & Reliability',
  'Incident & Problem Management': 'Incident Management',
  'Data & Analytics': 'Data & Analytics',
};

// Business verticals — never derived, always preserved as-is.
const VERTICALS = ['Investment', 'Lending & Credit', 'NEXT', 'เป๋าตัง & เป๋าตุง', 'CLIX', 'Core bank'];

// Categories that no longer exist in the corrected list.
const RETIRED = ['Testing & QA', 'Orchestration & Automation', 'DevOps & Performance'];

const SRC = path.join(__dirname, '..', 'src', 'lib');
function loadEsm(file, injected = {}) {
  const code = fs
    .readFileSync(path.join(SRC, file), 'utf8')
    .replace(/^\s*import\s[^;]*;\s*$/gm, '')
    .replace(/^export\s+/gm, '');
  const names = Object.keys(injected);
  const decls = [...code.matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  return new Function(...names, `${code}\n;return { ${[...new Set(decls)].join(', ')} };`)(...names.map((n) => injected[n]));
}
const tier = loadEsm('tier.js');
const utils = loadEsm('agentUtils.js', { getType: tier.getType, getTier: tier.getTier });
const areas = loadEsm('approveAreas.js', {
  agentProcessIds: utils.agentProcessIds,
  splitRoles: utils.splitRoles,
  agentCategories: utils.agentCategories,
  isInternalOrExternal: tier.isInternalOrExternal,
});
const { AREA_ORDER, CATEGORY_AREA } = areas;

// Guard: the derived category set must be exactly the discipline half of the
// corrected CATEGORY_AREA, and every area except Business & Product must have
// one. A mismatch means this script and the taxonomy have drifted apart.
const problems = [];
AREA_ORDER.forEach((a) => {
  if (a === 'Business & Product') return;
  if (!AREA_CATEGORY[a]) problems.push(`area "${a}" has no category in AREA_CATEGORY`);
});
Object.entries(AREA_CATEGORY).forEach(([a, c]) => {
  if (CATEGORY_AREA[c] !== a) problems.push(`"${c}" should map to "${a}" but CATEGORY_AREA says "${CATEGORY_AREA[c]}"`);
});
VERTICALS.forEach((v) => {
  if (CATEGORY_AREA[v] !== 'Business & Product') problems.push(`vertical "${v}" is not mapped to Business & Product`);
});
if (problems.length) {
  console.error('✗ taxonomy mismatch — aborting:');
  problems.forEach((p) => console.error('  ' + p));
  process.exit(1);
}

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

(async () => {
  const snap = await db.collection('agents').get();
  const writes = [];
  const noCategory = [];

  snap.forEach((d) => {
    const a = { id: d.id, ...d.data() };
    if (a.approvalStatus !== 'approved' || a.archived === true) return;

    const cur = Array.isArray(a.category) ? a.category.filter(Boolean) : [];
    const curAreas = Array.isArray(a.approveArea) ? a.approveArea : [];

    // The transform is ADDITIVE, not a rebuild-from-area. Deriving categories
    // purely from approveArea was tried first and rejected: it stripped real
    // browse information (vercel-react-view-transitions lost 'Design & UI',
    // Writer Research Intelligence lost 'UX Research') and would have made
    // the category list a redundant copy of the area list. Category answers
    // "what is this about" and an agent can legitimately be about two things.
    const next = new Set();

    // 1. Keep every still-valid category the agent already had.
    cur.filter((c) => !RETIRED.includes(c) && CATEGORY_AREA[c]).forEach((c) => next.add(c));

    // 2. Translate the retired ones instead of dropping them blind.
    if (cur.includes('Testing & QA')) {
      // The category it was masking, per the agent's own area. A Testing & QA
      // agent that landed in Development/UI (the golang and Figma ones) was
      // never really a testing entry — it gets nothing here and keeps the
      // categories it already had.
      curAreas.filter((ar) => ar === 'SIT' || ar === 'QA').forEach((ar) => next.add(ar));
    }
    if (cur.includes('DevOps & Performance')) {
      // Renamed only for the agents it still describes; the 13 that went to
      // Development when performance moved there keep 'Software Development'
      // and simply lose a label that no longer applies to them.
      if (curAreas.includes('Platform, DevOps & Operations')) next.add('DevOps & Platform');
    }
    // 'Orchestration & Automation' is translated to nothing on purpose — it
    // described a technique, not a discipline, and 23 of its 25 agents
    // already carry a second, more meaningful category.

    // 3. Guarantee the agent's own area is represented, so category and area
    //    can never disagree about what the agent primarily is.
    curAreas.forEach((ar) => { if (AREA_CATEGORY[ar]) next.add(AREA_CATEGORY[ar]); });

    // 4. Verticals ride along untouched (step 1 already kept them; this is
    //    just the explicit guarantee that nothing above can drop one).
    cur.filter((c) => VERTICALS.includes(c)).forEach((c) => next.add(c));

    // 5. Enforce the "<= 2 areas" rule at the CATEGORY level. Now that every
    //    category maps to exactly one area, N categories implies N areas for
    //    any FUTURE submission that resolves through the category layer. Three
    //    agents carry legacy labels from before the splits (e.g. API Detailed
    //    Designer sits in Architecture but still carries both 'Software
    //    Development' and 'Requirements & Product'), which would have implied
    //    three approver areas. Drop the weakest labels until the implied set
    //    is within two, in strict priority order:
    //      1. the agent's own area-derived categories — authoritative, never dropped
    //      2. business verticals — the product it serves, never dropped
    //      3. anything else — legacy/descriptive, dropped first
    const areaDerived = new Set(curAreas.map((ar) => AREA_CATEGORY[ar]).filter(Boolean));
    const impliedAreas = (set) => new Set([...set].map((c) => CATEGORY_AREA[c]).filter(Boolean));
    if (impliedAreas(next).size > 2) {
      const droppable = [...next].filter((c) => !areaDerived.has(c) && !VERTICALS.includes(c));
      for (const c of droppable) {
        if (impliedAreas(next).size <= 2) break;
        next.delete(c);
      }
    }

    const sorted = [...next].sort();
    if (!sorted.length) { noCategory.push(`${a.agentName}  areas:${JSON.stringify(curAreas)} cats:${JSON.stringify(cur)}`); return; }

    const same = sorted.length === cur.length && sorted.every((x, i) => x === [...cur].sort()[i]);
    if (same) return;
    writes.push({ id: a.id, name: a.agentName, areas: curAreas, old: cur, next: sorted });
  });

  console.log(`=== agents whose category changes: ${writes.length} ===\n`);
  writes
    .slice()
    .sort((x, y) => x.name.localeCompare(y.name))
    .forEach((w) => {
      console.log(`  ${w.name}   [area: ${w.areas.join(' + ')}]`);
      console.log(`      ${JSON.stringify(w.old)}\n   →  ${JSON.stringify(w.next)}`);
    });

  if (noCategory.length) {
    console.error(`\n✗ ${noCategory.length} would end with NO category — refusing:`);
    noCategory.forEach((n) => console.error('  ' + n));
    process.exit(1);
  }
  console.log('\n✓ every agent keeps at least one category');

  // Post-state distribution + the guarantee that matters: no agent is left
  // holding a category that is not in the corrected list.
  const after = {};
  const unknown = new Set();
  snap.forEach((d) => {
    const a = d.data();
    if (a.approvalStatus !== 'approved' || a.archived === true) return;
    const w = writes.find((x) => x.id === d.id);
    (w ? w.next : (a.category || [])).forEach((c) => {
      after[c] = (after[c] || 0) + 1;
      if (!CATEGORY_AREA[c]) unknown.add(c);
    });
  });
  console.log('\nresulting category distribution:');
  Object.entries(after).sort((x, y) => y[1] - x[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  ${k}`));
  console.log(`\ncategories outside the corrected list: ${unknown.size}   <-- must be 0`);
  unknown.forEach((c) => console.log('  ' + c));
  if (unknown.size) process.exit(1);

  console.log(`\n${APPLY ? 'WRITING' : 'DRY RUN — would write'} ${writes.length} agent(s)`);
  if (!APPLY) { console.log('re-run with --apply to write.'); return; }

  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    writes.slice(i, i + 400).forEach((w) => batch.update(db.collection('agents').doc(w.id), { category: w.next }));
    await batch.commit();
    console.log(`  committed ${Math.min(i + 400, writes.length)}/${writes.length}`);
  }
  console.log('✓ done');
})();
