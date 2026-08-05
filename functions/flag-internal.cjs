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
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

// 2026-08-04 addition: ALPHA's own tool skills are registered as agent docs in
// the SAME library it searches (query_library, capability_search, …, plus the
// two "AI Agent Library ..." meta entries describing ALPHA/its orchestrator
// itself). Found the same way as the .md files: a user asked "แสดงทั้งหมด"
// after a capped list, the model fell back to a vague capability_search, and
// `get_agent_detail` / `query_library` came back as top "Ready to Use" hits —
// their descriptions are generic filter/search boilerplate ("กรอง/นับ/จัดกลุ่ม
// Agent/Skill ในไลบรารี…") that embeds close to nearly any library-related
// question, the same failure mode as the prompt fragments.
//
// `owner === 'Wolfy'` looked like it might be a shortcut but is NOT safe to use
// — verified against real data it also covers legitimate, pick-up-and-use
// agents (Epic Writer, User Story Writer, ALPHA - Summarizer, …). An exact name
// allowlist is the only rule precise enough here; these names are the fixed,
// deterministic set in functions/chatPrompt.js's TOOL_DECLARATIONS plus the two
// self-referential library entries — not something to pattern-match.
const SELF_REFERENTIAL_NAMES = new Set([
  'get_agent_detail', 'query_library', 'capability_search', 'query_sdlc',
  'duplicate_check', 'search_library', 'agent_library_connection_suggest',
  'AI Agent Library Chat Assistant', 'AI Agent Library Copilot',
]);

// Narrow, explicit rule: the name ends in ".md", OR is one of the fixed
// self-referential names above. Everything else is left alone — no guessing
// at intent from descriptions.
const isInternal = (a) => /\.md$/i.test(a.agentName || '') || SELF_REFERENTIAL_NAMES.has(a.agentName);

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
