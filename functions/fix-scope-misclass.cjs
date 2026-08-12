// Reclassify agents wrongly marked customerFacing (2026-08-11), plus fix two
// sdlcStage values that disagree with their own process's real stage.
//
//   node functions/fix-scope-misclass.cjs            # dry run
//   node functions/fix-scope-misclass.cjs --apply
//
// ── Why these are wrong ──
// "customerFacing" has to mean "a customer interacts with this agent at
// runtime, with no internal human reviewing its output before they see it".
// The alternative reading ("its output eventually ships to customers") is
// degenerate: code agents ship code, design agents ship UI, copy agents ship
// copy — under that reading nearly every Build-stage agent is External and the
// axis carries no information at all.
//
// The live data confirms the runtime reading is the one actually in use: of 27
// External agents, 25 are in-product runtime agents (Nok chatbot answering
// customer questions, Starwolfs pushing to investor screens, Nok compliance
// scanning customer-bound messages) and NONE of those 25 carry an
// sdlcProcessMapping — they're products, not dev-process tools.
//
// The proof for the UX Writer family is stronger still: the SAME team
// registered the SAME tool per app with a copy-pasted description
// ("ผู้ช่วยคิดข้อความบนหน้าจอของแอป{X} ให้สอดคล้องกับ Content style guide…")
// and split them arbitrarily — NEXT and Lotto were filed Internal (T1),
// เป๋าตัง and ถุงเงิน External (T3). Same tool, two answers = data-entry
// inconsistency, not a real distinction. Every other agent that team owns on
// process 8.2 Copywriting (Content Strategy, Voice and Tone, Content Audit,
// Writing & Language Craft, …) is Internal too.
//
// Governance angle: T3/T4 imply the heavier controls (Red Team / CAB / PVT)
// that exist because a customer can prompt-inject the agent or receive
// unreviewed output. These agents have a human reviewer plus the whole
// release pipeline in front of them; classifying them T3/T4 spends that
// scrutiny in the wrong place and dilutes the genuinely risky T4s.
//
// NOT touched (verified genuinely customer-facing at runtime):
//   Starwolf - ปรับภาษาให้เข้ากับแต่ละ Style นักลงทุน  (per-recipient, live)
//   Nok - ปรับคำให้เข้าใจง่าย พร้อมส่งออก              ("พร้อมส่งออก" = live send)
// Also NOT touched: 6.answer-writer.md / 6.commodity-price-inquiry.md /
//   7.no-citation-fallback.md (Tech Innovation) — these are ALPHA's own prompt
//   fragments and belong to the separate `internalTool` data-quality problem
//   already tracked in CLAUDE.md §5; changing scope alone would half-fix them.
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');

// agentName -> { reason }  (all become customerFacing:false, internalUse:true)
const TO_INTERNAL = {
  'UX Writer AI Agent': 'performs process 8.2 Copywriting; used by UX Writers, output reviewed before release. T4 -> T2',
  'UX Writer skill เป๋าตัง': 'identical tool/description to UX Writer skill NEXT & Lotto, which are already Internal. T3 -> T1',
  'UX Writer skill ถุงเงิน': 'identical tool/description to UX Writer skill NEXT & Lotto, which are already Internal. T3 -> T1',
  'Social Listening (Social Voice Insight Gathering)': 'researcher-facing analysis on process 1.2; customer never invokes it. T3 -> T1',
};

// agentName -> correct sdlcStage, where the stored stage contradicts the real
// stage of the process the agent itself is mapped to.
const FIX_STAGE = {
  'UX Writer AI Agent': ['Build'],                        // process 8.2 Copywriting is Build, was "Design"
  'Timeline Change Detector and Risk Validation': ['Build'], // process 6.2 Project Governance is Build, was "Design"
};

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

const isSkill = (a) => a?.aiAgent === false && a?.skillMd === true;
const tierOf = (a) => {
  const s = isSkill(a), ext = a?.customerFacing === true;
  if (s && !ext) return 'T1'; if (!s && !ext) return 'T2';
  if (s && ext) return 'T3'; return 'T4';
};
const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : (v ? [v] : []));

(async () => {
  const snap = await db.collection('agents').get();
  const byName = new Map();
  snap.forEach((d) => {
    const a = { id: d.id, ...d.data() };
    if (a.approvalStatus !== 'approved' || a.archived === true) return;
    byName.set(a.agentName, a);
  });

  const writes = [];
  const problems = [];

  for (const [name, reason] of Object.entries(TO_INTERNAL)) {
    const a = byName.get(name);
    if (!a) { problems.push(`✗ not found: "${name}"`); continue; }
    if (a.customerFacing !== true) { problems.push(`• already Internal, skipping: "${name}"`); continue; }
    const patch = { customerFacing: false, internalUse: true };
    const after = { ...a, ...patch };
    writes.push({ a, patch, note: `${tierOf(a)} -> ${tierOf(after)}  · ${reason}` });
  }

  for (const [name, stage] of Object.entries(FIX_STAGE)) {
    const a = byName.get(name);
    if (!a) { problems.push(`✗ not found (stage fix): "${name}"`); continue; }
    const cur = arr(a.sdlcStage);
    if (cur.length === stage.length && cur.every((s, i) => s === stage[i])) {
      problems.push(`• stage already correct, skipping: "${name}"`); continue;
    }
    const existing = writes.find((w) => w.a.agentName === name);
    const note = `sdlcStage [${cur.join(', ') || '—'}] -> [${stage.join(', ')}] (matches process ${arr(a.sdlcProcessMapping).join(', ')})`;
    if (existing) { existing.patch.sdlcStage = stage; existing.note += `\n        ${note}`; }
    else writes.push({ a, patch: { sdlcStage: stage }, note });
  }

  console.log(`Plan: ${writes.length} agents to update\n`);
  writes.forEach((w) => {
    console.log(`  ${w.a.agentName}`);
    console.log(`        ${w.note}`);
    console.log(`        patch: ${JSON.stringify(w.patch)}`);
    console.log(`        SDLC kept: stage=${arr(w.a.sdlcStage).join('; ') || '—'} process=${arr(w.a.sdlcProcessMapping).join('; ') || '—'} useCase=${arr(w.a.useCase).join('; ') || '—'}`);
  });
  if (problems.length) { console.log('\nNotes:'); problems.forEach((p) => console.log('  ' + p)); }

  if (!APPLY) { console.log(`\nDry run only — re-run with --apply to write.`); return; }

  const { FieldValue } = require('firebase-admin/firestore');
  for (const w of writes) {
    await db.collection('agents').doc(w.a.id).update({ ...w.patch, updatedAt: FieldValue.serverTimestamp() });
  }
  console.log(`\n✔ Updated ${writes.length} agents.`);
})().catch((e) => { console.error(e); process.exit(1); });
