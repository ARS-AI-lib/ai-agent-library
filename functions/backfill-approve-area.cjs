// Backfills agent.approveArea for the 12 discipline-based approver areas
// (2026-08-10). Replaces the old "area = SDLC stage" scheme, under which 79
// of 243 agents (Internal, no sdlcStage) resolved to an EMPTY area list and
// were therefore invisible to every scoped approver.
//
//   node functions/backfill-approve-area.cjs            # dry run
//   node functions/backfill-approve-area.cjs --apply    # write agents
//   node functions/backfill-approve-area.cjs --verbose  # list every agent
//
// Users are deliberately NOT migrated. The 5 existing approvers still carry
// stage-shaped approveAreas (Discovery/Design/Test/Deployment); mapping a
// stage onto the new areas would over-grant (the Design stage alone spans UX
// Research, UI & Visual Design, Architecture & Engineering and Data), and the
// intent is to assign approvers deliberately in the UI once the areas exist.
// The script prints a suggested mapping as guidance and leaves /users alone.
//
// ── Why it loads the real src/lib modules instead of copying the tables ──
// The 12-area taxonomy and its fallback chain must not exist twice. CLAUDE.md
// has repeated warnings about exactly this class of drift (normalizeProgress,
// extractProcessId). So rather than re-declare PROCESS_AREA/CATEGORY_AREA/
// ROLE_AREA here, this script reads the actual ESM sources, strips their
// import/export syntax, and evaluates them with their dependencies injected —
// meaning it exercises the SAME agentApproveAreas() the web app runs. If the
// resolver changes, this script changes with it for free.
const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const VERBOSE = process.argv.includes('--verbose');

// ── Load the real client modules ─────────────────────────────────────
const SRC = path.join(__dirname, '..', 'src', 'lib');
function loadEsm(file, injected = {}) {
  const code = fs
    .readFileSync(path.join(SRC, file), 'utf8')
    .replace(/^\s*import\s[^;]*;\s*$/gm, '') // drop ESM imports; deps come from `injected`
    .replace(/^export\s+/gm, '');            // `export function f` -> `function f`
  const names = Object.keys(injected);
  // Collect every top-level declaration so callers can pick what they need.
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
if (!Array.isArray(AREA_ORDER) || AREA_ORDER.length !== 12 || typeof agentApproveAreas !== 'function') {
  console.error('✗ failed to load src/lib/approveAreas.js — aborting rather than writing guesses');
  process.exit(1);
}

// Which layer produced the answer. Mirrors the chain in approveAreas.js for
// REPORTING only — never for deciding. The decision always comes from the
// real agentApproveAreas() above, so a mismatch here can only mislabel a log
// line, never write a wrong area.
function explain(a) {
  if (Array.isArray(a.approveArea) && a.approveArea.filter((x) => AREA_ORDER.includes(x)).length) return 'already-set';
  if (a.internalTool === true) return 'internalTool';
  if (utils.agentProcessIds(a).some((id) => areas.PROCESS_AREA[areas.normRole(id)])) return 'process';
  const roles = utils.splitRoles(a.relatedRole).map(areas.normRole);
  if (roles.some((r) => areas.ROLE_FIRST_AREA[r])) return 'role-first';
  if (utils.agentCategories(a).some((c) => areas.CATEGORY_AREA[c])) return 'category';
  if (roles.some((r) => areas.ROLE_AREA[r])) return 'role';
  if (tier.isInternalOrExternal(a) === 'External') return 'external-default';
  return 'UNRESOLVED';
}

// ── Manual overrides (decided 2026-08-10, before the first --apply) ──
// The dry run surfaced six agents where the CATEGORY layer beat the ROLE
// layer and produced a placement a human could see was wrong. Recorded here
// rather than fixed by weakening the resolver, because each is a one-off
// judgement about a specific agent, not a rule — bending the general chain to
// suit six rows would misroute others.
//
// They are written as a normal approveArea value, i.e. exactly what an admin
// would have set by hand in EditAgentModal afterwards; layer 1 of the chain
// then keeps them stable forever.
const MANUAL_AREA = {
  // Sibling of 20 other AIPhbt lending agents, all of which land in
  // Business & Product; only this one's Software Development category
  // pulled it into engineering.
  'AIPhbt - Document Anomaly': ['Business & Product'],
  // Both ALPHA entries: user's call, overriding the script's category-driven
  // answer of Architecture & Engineering.
  'ALPHA - Jira Information Retrieval': ['Business Analysis'],
  'ALPHA - Doc Extraction': ['Delivery Management'],
  // Operations-owned document pipelines for the Nok product; their
  // Writing & Content category describes the payload, not the discipline.
  'Nok - document extraction (PDF > TEXT)': ['Business & Product'],
  'Nok - document extraction (from document)': ['Business & Product'],
};

// Not an area fix — a missed flag. This entry is one of ALPHA's own prompt
// fragments (siblings 1.identity.md, 2.voice.md, 4.orchestrator.md … are all
// flagged) but flag-internal.cjs never matched it, because its name lacks the
// ".md" suffix the script keys on. Setting the flag here fixes its approver
// routing AND its chat search ranking, which is the actual bug.
// The flag-internal.cjs gap itself is filed separately.
const FLAG_INTERNAL = ['1. knowledge selector'];

// Guidance only — printed, never written. See header note.
const STAGE_HINT = {
  Initiation: 'Business & Product / Governance, Risk & Procurement',
  Discovery: 'Business Analysis',
  Design: 'UX Research + UI & Visual Design + Architecture & Engineering + Data & Analytics',
  Build: 'spans 7 areas — assign deliberately',
  Test: 'Quality & Testing',
  Deployment: 'Platform, DevOps & Operations + Quality & Testing',
  'Post Development': 'Platform, DevOps & Operations',
  Business: 'Business & Product',
};

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

(async () => {
  const [snap, userSnap] = await Promise.all([
    db.collection('agents').get(),
    db.collection('users').get(),
  ]);

  const bySource = {};
  const byArea = {};
  const unresolved = [];
  const wasOrphan = [];
  const writes = [];
  let considered = 0;

  snap.forEach((d) => {
    const a = { id: d.id, ...d.data() };
    if (a.approvalStatus !== 'approved' || a.archived === true) return;
    considered++;

    const override = MANUAL_AREA[a.agentName];
    const flagInternal = FLAG_INTERNAL.includes(a.agentName);
    const resolved = override || agentApproveAreas(flagInternal ? { ...a, internalTool: true } : a);
    const source = override ? 'manual-override' : (flagInternal ? 'internalTool (flag fixed here)' : explain(a));
    bySource[source] = (bySource[source] || 0) + 1;

    if (!resolved.length) { unresolved.push(a.agentName); return; }
    resolved.forEach((ar) => { byArea[ar] = (byArea[ar] || 0) + 1; });

    // Would the OLD rule have left this agent unroutable? (External →
    // ['Business'], else sdlcStage verbatim.) These are the agents this
    // whole change exists to rescue — reported separately so the before/
    // after claim is evidence, not assertion.
    const stages = Array.isArray(a.sdlcStage) ? a.sdlcStage.filter(Boolean) : (a.sdlcStage ? [a.sdlcStage] : []);
    const oldEmpty = a.customerFacing !== true && !stages.length;
    if (oldEmpty) wasOrphan.push(`${a.agentName}  →  ${resolved.join(' + ')}   [${source}]`);

    if (source !== 'already-set') writes.push({ id: a.id, name: a.agentName, areas: resolved, source, flagInternal });
    if (VERBOSE) console.log(`  ${a.agentName}  →  ${resolved.join(' + ')}   [${source}]`);
  });

  console.log(`\n=== approved + active agents: ${considered} ===`);
  console.log('\nresolved by layer:');
  Object.entries(bySource).sort((x, y) => y[1] - x[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  ${k}`));

  console.log('\nagents per area:');
  AREA_ORDER.forEach((ar) => console.log(`  ${String(byArea[ar] || 0).padStart(4)}  ${ar}`));

  console.log(`\n=== rescued: agents the OLD stage rule left with NO area (${wasOrphan.length}) ===`);
  wasOrphan.forEach((s) => console.log('  ' + s));

  if (unresolved.length) {
    console.log(`\n✗ UNRESOLVED (${unresolved.length}) — must be 0 before --apply:`);
    unresolved.forEach((s) => console.log('  ' + s));
  } else {
    console.log('\n✓ unresolved: 0');
  }

  console.log('\n=== current approvers (NOT migrated by this script) ===');
  userSnap.forEach((d) => {
    const u = d.data();
    if (u.role !== 'approver') return;
    const cur = u.approveAreas || [];
    console.log(`  ${u.email || d.id}: ${JSON.stringify(cur)}`);
    cur.forEach((c) => { if (STAGE_HINT[c]) console.log(`      ${c} ≈ ${STAGE_HINT[c]}`); });
  });

  console.log(`\n${APPLY ? 'WRITING' : 'DRY RUN — would write'} approveArea on ${writes.length} agents`);
  if (!APPLY) { console.log('re-run with --apply to write.'); return; }
  if (unresolved.length) { console.error('refusing to write while unresolved > 0'); process.exit(1); }

  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    writes.slice(i, i + 400).forEach((w) => batch.update(db.collection('agents').doc(w.id), {
      approveArea: w.areas,
      ...(w.flagInternal ? { internalTool: true } : {}),
    }));
    await batch.commit();
    console.log(`  committed ${Math.min(i + 400, writes.length)}/${writes.length}`);
  }
  console.log('✓ done');
})();
