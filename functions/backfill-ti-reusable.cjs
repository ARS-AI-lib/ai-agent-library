// Mark every Tech Innovation agent/skill as `reusable: 'Non-reusable'`
// (2026-09-23, one-off).
//
//   node functions/backfill-ti-reusable.cjs            # dry run
//   node functions/backfill-ti-reusable.cjs --apply
//
// ── Why a script and not the Edit form ──
// All 15 docs owned by Tech Innovation sit at devProgress 100 with
// deploymentStatus 'approved', so `isReadyToUseLocked` hides the Reusable
// field in EditAgentModal. Admin SDK is the only path left.
//
// ── Why it matters (not cosmetic) ──
// CLAUDE.md §25: 'Non-reusable' is the exception that lets an agent reach 100%
// without an endpoint or attached file, on both the client and
// agentReadyRules.js. Leaving these 15 with reusable '' keeps them under the
// stricter gate that was never meant for single-team tools.
//
// ── Scope ──
// owner == 'Tech Innovation', UNION the paired sub-skills of those docs
// (the brief said "and the skills cascaded with them"). Pairing is resolved by
// the real `pairedSubSkills()` from src/lib/agentUtils.js via loadEsm — never a
// copy of the rule (CLAUDE.md §20/§27). In practice this adds nothing: every
// child of these two parents is itself owned by Tech Innovation. The union is
// here so the script stays correct if that stops being true.
//
// `reusable` is NOT part of the embedded text (see functions/embedText.js), so
// no vector rebuild is needed after this runs.
const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const OWNER = 'Tech Innovation';
const TARGET = 'Non-reusable';
const SRC = path.join(__dirname, '..', 'src', 'lib');

// Same loader as backfill-approve-area.cjs — run the client module for real
// rather than re-implementing its rules on this side.
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
const { pairedSubSkills } = utils;
if (typeof pairedSubSkills !== 'function') {
  console.error('✗ failed to load pairedSubSkills from src/lib/agentUtils.js — aborting');
  process.exit(1);
}

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

(async () => {
  const snap = await db.collection('agents').get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const owned = all.filter((a) => (a.owner || '').trim() === OWNER);
  const byId = new Map(owned.map((a) => [a.id, a]));
  owned.forEach((a) => pairedSubSkills(a, all).forEach((c) => byId.set(c.id, c)));

  const rows = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  const todo = rows.filter((a) => (a.reusable || '') !== TARGET);

  console.log(`owner "${OWNER}" = ${owned.length} · +paired sub-skills = ${rows.length} · to write = ${todo.length}\n`);
  rows.forEach((a) => {
    const cur = a.reusable || '(empty)';
    const mark = (a.reusable || '') === TARGET ? '=' : '→';
    const extra = byId.has(a.id) && (a.owner || '').trim() !== OWNER ? `  [sub-skill of ${a.matchingAgent || '?'}]` : '';
    console.log(`  ${a.id.padEnd(14)} ${mark} ${String(cur).padEnd(24)} ${a.agentName || ''}${extra}`);
  });

  if (!APPLY) {
    console.log('\nDRY RUN — re-run with --apply to write.');
    return;
  }

  let batch = db.batch();
  let n = 0;
  for (const a of todo) {
    batch.update(db.collection('agents').doc(a.id), {
      reusable: TARGET,
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  if (n % 400 !== 0) await batch.commit();
  console.log(`\n✓ wrote ${todo.length} docs`);
})().catch((e) => { console.error(e); process.exit(1); });
