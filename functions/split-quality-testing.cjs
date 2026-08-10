// One-time migration for the 2026-08-10 "Quality & Testing" split into
// "SIT" + "QA", with load/performance and code-quality work reassigned to
// Development (see src/lib/approveAreas.js's header for the full rules).
//
// Same reason a script is needed as for the Architecture/Development split:
// agent.approveArea is a STORED field and layer 1 of agentApproveAreas()
// always wins, so a taxonomy change in code does nothing for the 31 agents
// already carrying the retired "Quality & Testing" string.
//
//   node functions/split-quality-testing.cjs           # dry run
//   node functions/split-quality-testing.cjs --apply
//
// ── Why `owner` decides these, not the resolver ──────────────────────
// The user's rule for EXISTING entries is explicitly owner-based, and the
// live data backs it up completely — the 31 agents split by owner into six
// clean groups that each map to exactly one area:
//
//   SIT-TQM (13)          → SIT          role "Tester", processes 11.1/11.2/11.3
//   arise-perf (6)        → Development  output "Load Test Scripts, Metrics"
//   PQA (5)               → QA           UAT-phase reporting//tracking
//   arise-reviewer (4)    → Development  input "Pull Request", output "Review Comments"
//   Development (1)       → Development  `tester (QA)`: outputs unit/e2e test files
//   Digital Experience Team (2) → (resolver decides — a design team, not a test team)
//
// Two of these would resolve WRONG without the owner rule, which is exactly
// why it exists rather than leaning on the tables:
//   • QA Gitlab Publisher — owner SIT-TQM, but sits on process 13.2 (UAT), so
//     PROCESS_AREA would send it to QA. Owner wins → SIT.
//   • Knowledge Base Agent — owner PQA, but sits on process 11.2, so
//     PROCESS_AREA would send it to SIT. Owner wins → QA.
// Both are written as stored approveArea, i.e. exactly what an admin would
// have set by hand afterwards, so layer 1 keeps them stable from here on.
const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const OLD_AREA = 'Quality & Testing';

const OWNER_AREA = {
  'SIT-TQM': ['SIT'],
  'arise-perf': ['Development'],
  'PQA': ['QA'],
  'arise-reviewer': ['Development'],
  'Development': ['Development'],
};

// Separate from the split, but part of the same rule the user just set:
// "an agent may span more than one area but should not exceed 2 unless truly
// necessary". Exactly one agent library-wide currently has 3. Architecture is
// the weakest of its three signals (1 of its 4 roles is Software Architect,
// against UI Designer/UX Designer/Developer), and dropping it puts this agent
// on the same pairing as its 7 sibling Figma skills.
const TRIM_TO_TWO = {
  'Figma Generate Diagram': ['Development', 'UI & Visual Design'],
};

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

const { AREA_ORDER, agentApproveAreas, isKnownArea } = areas;
if (!Array.isArray(AREA_ORDER) || AREA_ORDER.includes(OLD_AREA) || !AREA_ORDER.includes('SIT') || !AREA_ORDER.includes('QA')) {
  console.error('✗ src/lib/approveAreas.js is not the post-split taxonomy (need SIT + QA, no "Quality & Testing") — aborting');
  process.exit(1);
}
// Every owner-mapped and trim-mapped area must be real, or we would write a
// value the resolver's layer-1 filter silently drops (→ unroutable agent).
for (const [k, v] of [...Object.entries(OWNER_AREA), ...Object.entries(TRIM_TO_TWO)]) {
  const bad = v.filter((a) => !isKnownArea(a));
  if (bad.length) { console.error(`✗ "${k}" maps to unknown area(s): ${bad.join(', ')}`); process.exit(1); }
}

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

(async () => {
  const snap = await db.collection('agents').get();
  const writes = [];
  const unresolved = [];
  const bySource = {};

  snap.forEach((d) => {
    const a = { id: d.id, ...d.data() };
    if (a.approvalStatus !== 'approved' || a.archived === true) return;
    const cur = Array.isArray(a.approveArea) ? a.approveArea : [];

    let next = null;
    let source = null;

    if (TRIM_TO_TWO[a.agentName]) {
      next = TRIM_TO_TWO[a.agentName];
      source = 'trim-to-2';
    } else if (cur.includes(OLD_AREA)) {
      const byOwner = OWNER_AREA[a.owner];
      if (byOwner) {
        next = byOwner;
        source = `owner:${a.owner}`;
      } else {
        // Not a test-team owner (Digital Experience Team) — let the resolver
        // decide from the new tables, same as the previous split's approach.
        next = agentApproveAreas({ ...a, approveArea: [] });
        source = 'resolver';
      }
    }

    if (!next) return;
    if (!next.length) { unresolved.push(a.agentName); return; }
    if (next.length === cur.length && next.every((x, i) => x === cur[i])) return; // already correct

    bySource[source] = (bySource[source] || 0) + 1;
    writes.push({ id: a.id, name: a.agentName, owner: a.owner || '(none)', old: cur, next, source });
  });

  console.log(`=== agents to update: ${writes.length} ===\n`);
  writes
    .slice()
    .sort((x, y) => x.source.localeCompare(y.source) || x.name.localeCompare(y.name))
    .forEach((w) => {
      console.log(`  ${w.name}`);
      console.log(`      ${JSON.stringify(w.old)}  →  ${JSON.stringify(w.next)}   [${w.source}]`);
    });

  console.log('\nby source:');
  Object.entries(bySource).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(3)}  ${k}`));

  const over = writes.filter((w) => w.next.length > 2);
  console.log(`\nresults with >2 areas: ${over.length}   <-- should be 0`);
  over.forEach((w) => console.log(`  ${w.name} -> ${JSON.stringify(w.next)}`));

  if (unresolved.length) {
    console.error(`\n✗ ${unresolved.length} would resolve to [] — refusing:`);
    unresolved.forEach((n) => console.error('  ' + n));
    process.exit(1);
  }
  console.log('\n✓ none resolve to []');

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
