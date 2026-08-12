// Flags internal prompt-file entries with internalTool: true.
//
// These are implementation fragments of other agents (6.answer-writer.md,
// 5.query-planner.md, 3.safety.md …), not tools anyone can pick up and use.
// They stay in the library and stay visible in the web UI — they are only
// pushed DOWN in chat search ranking, because they were outranking every real
// agent on generic queries ("เขียน code" put 6.answer-writer.md at #1, 0.773).
//
//   node functions/flag-internal.cjs          # dry run
//   node functions/flag-internal.cjs --apply
//
// 2026-08-11: this script no longer declares the rule. It lives in
// src/lib/internalTool.js so the client (PreRegModal, which now stamps the
// flag at submit time) and this backfill share ONE definition — same
// anti-drift discipline as normalizeProgress / agentApproveAreas. This file
// now only backfills entries that predate the submit-time stamp, or that were
// renamed into scope afterwards.
const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

// Load the real client module (same technique as backfill-approve-area.cjs):
// strip ESM syntax, evaluate, pick out what we need. Guarantees this script
// exercises the exact rule the app runs.
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

const { isInternalToolName } = loadEsm('internalTool.js');
if (typeof isInternalToolName !== 'function') {
  console.error('✗ could not load isInternalToolName from src/lib/internalTool.js — aborting rather than flagging with a guessed rule');
  process.exit(1);
}

const isInternal = (a) => isInternalToolName(a.agentName);

(async () => {
  const snap = await db.collection('agents').get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const target = all.filter(isInternal);
  const already = target.filter((a) => a.internalTool === true);
  const todo = target.filter((a) => a.internalTool !== true);
  // Safety net: anything already flagged that no longer matches the rule would
  // mean someone renamed a doc — report it rather than silently unflag.
  const stray = all.filter((a) => a.internalTool === true && !isInternal(a));

  console.log(`agents: ${all.length}`);
  console.log(`matching ".md": ${target.length} (flagged already: ${already.length})`);
  console.log(`to flag: ${todo.length}`);
  todo.forEach((a) => console.log(`   · ${a.agentName}`));
  if (stray.length) console.log(`\n⚠️ flagged but no longer matches (left untouched): ${stray.map((a) => a.agentName).join(', ')}`);

  if (!APPLY) { console.log('\n[dry run] nothing written. re-run with --apply'); return; }
  if (!todo.length) { console.log('\nnothing to do.'); return; }

  const batch = db.batch();
  // Only this one field is written — no timestamps, no other mutation, so the
  // change can never disturb approval state, progress, or ownership.
  todo.forEach((a) => batch.update(db.collection('agents').doc(a.id), { internalTool: true }));
  await batch.commit();
  console.log(`\n✅ flagged ${todo.length}`);
})().catch((e) => { console.error('FAILED:', e.message || e); process.exit(1); });
