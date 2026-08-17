// ⚠️ COMPLETED ONE-SHOT — DO NOT RE-RUN (note added 2026-08-17).
// It writes `category: [r.suggested_category]`, a single-element REPLACE, and
// its prompt only ever asks for one discipline. Since 2026-08-17 an agent's
// category may also carry a product vertical (see VERTICAL_CATEGORIES in
// src/lib/approveAreas.js) — re-running this would silently strip every
// product tag in the library. The live submit-time path in functions/index.js
// is the maintained one; if a re-backfill is ever genuinely needed, port that
// discipline+product prompt over first.
//
// One-time backfill for the 2026-08 left-sidebar Category shortcuts, run
// locally with ADC. Uses the SAME model + the SAME "closest existing category,
// almost never propose a new one" instruction as functions/index.js's
// analyzeDuplicate, so old (backfilled) and new (submit-time) categorization
// are judged by one consistent standard — never a separate keyword-matching
// script that could disagree with the live AI path.
//
// Also fixes two known, non-guessed data issues while it's already touching
// this data (see plans/agent-skill-structured-horizon.md):
//   1. The 5 "Initiation & Discovery" sdlcStage agents → split into their real
//      stage (Initiation ×4 / Discovery ×1), derived from sdlcProcessMapping,
//      not asked of the AI.
//   2. /config/schema.sdlcStage: drop "Across Phase" (unused, not in the
//      sdlcProcesses catalog), add "Post Development" (in the catalog, missing
//      from the form's option list). Neither value is used by any agent today,
//      so this cannot change what any existing agent shows.
//
//   node functions/backfill-categories.cjs            # dry run: report only
//   node functions/backfill-categories.cjs --apply    # actually write

const { GoogleGenAI } = require('@google/genai');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const PROJECT = 'wolfy-481609';
const MODEL = 'gemini-2.5-flash';
const BATCH_SIZE = 25; // agents per Vertex call — keeps prompt+response comfortably under budget

const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT });
const db = getFirestore(app, 'ai-agent-lib');
const ai = new GoogleGenAI({ vertexai: true, project: PROJECT, location: 'asia-southeast1' });

// Must match functions/index.js's FALLBACK_CATEGORY — kept as a separate copy
// on purpose (same convention as FALLBACK_CORE_ABILITY vs. this script): a
// standalone backfill script should never import server-only function code,
// and both read the LIVE /config/schema.category first, falling back to this
// only if that doc is missing.
const FALLBACK_CATEGORY = [
  'Design & UI', 'UX Research', 'Writing & Content', 'Requirements & Product',
  'Software Development', 'DevOps & Performance', 'Testing & QA',
  'Lending & Credit', 'Investment', 'Project & Delivery',
];

// Same leading-id extraction as src/lib/agentUtils.js's extractProcessId —
// duplicated here because this is a plain CommonJS script and that file is an
// ES module the functions runtime doesn't load. Kept intentionally tiny.
function extractProcessId(s) {
  if (!s) return '';
  const t = String(s).replace(/[​‌‍﻿]/g, '').replace(/\s+/g, ' ').trim();
  const m = t.match(/^(\d+\.\d+[A-Za-z]?)\b/);
  return m ? m[1] : t;
}

// Verified 2026-08 against the real 5 agents carrying "Initiation & Discovery"
// — see agent-skill-structured-horizon.md for the per-agent table.
const STAGE_FIX_BY_PROCESS_ID = {
  '1.1': 'Initiation', '1.2': 'Initiation', '1.5': 'Initiation',
  '2.1': 'Discovery',
};

function safeParseJson(s) {
  const stripped = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(stripped); } catch {}
  const m = stripped.match(/\[[\s\S]*\]/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

function buildBatchPrompt(agents, categoryOptions) {
  const items = agents.map((a) => ({
    id: a.id,
    name: a.agentName,
    description: (a.description || '').slice(0, 300),
    coreAbility: Array.isArray(a.coreAbility) ? a.coreAbility : [a.coreAbility].filter(Boolean),
    owner: a.owner || '',
  }));
  return `คุณเป็นผู้จัดหมวดหมู่ Agent/Skill ขององค์กรตาม "โดเมนงาน" (Category) — คนละมิติกับ
Core Ability (Core Ability = ชนิดความสามารถ เช่น Analytical/Documentation, Category = สายงาน/โดเมน
เช่น Lending & Credit, Design & UI) ต้องเลือกจากรายการนี้เท่านั้น สำหรับ suggested_category:
[${categoryOptions.map((c) => `"${c}"`).join(', ')}]

หน้าที่: ต่อแต่ละรายการด้านล่าง ให้
- suggested_category: หมวดที่ใกล้เคียงที่สุดเสมอ (ห้ามเป็น null แม้จะดูใหม่/ไม่เข้าพวกขนาดไหนก็ตาม)
- proposed_new_category: null เกือบทุกครั้ง (หมวดเดิมควรพอสำหรับ >90% ของรายการ) มีค่าเฉพาะเมื่อ
  รายการนั้นเป็นสายงาน/โดเมนที่ใหม่จริงๆ จนหมวดเดิมทุกหมวดไม่เหมาะสมเลย — ถ้ามี ตอบเป็น
  {"name": "ชื่อหมวดใหม่สั้นๆ ภาษาอังกฤษ", "reason": "เหตุผลสั้นๆ ภาษาไทย"} ไม่งั้น null

ตอบเป็น JSON array เท่านั้น ไม่มีข้อความอื่น รูปแบบ:
[{"id": "...", "suggested_category": "...", "proposed_new_category": null}, ...]

รายการ:
${JSON.stringify(items, null, 2)}`;
}

async function categorizeBatch(agents, categoryOptions) {
  const resp = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: buildBatchPrompt(agents, categoryOptions) }] }],
    config: {
      temperature: 0.1, maxOutputTokens: 4096, responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
  const text = resp?.text || resp?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = safeParseJson(text);
  if (!Array.isArray(parsed)) throw new Error(`unparseable batch response (${text.slice(0, 200)})`);
  return parsed;
}

(async () => {
  const schemaSnap = await db.collection('config').doc('schema').get();
  const categoryOptions = (schemaSnap.data()?.category?.length ? schemaSnap.data().category : FALLBACK_CATEGORY);
  console.log(`category options (${categoryOptions.length}): ${categoryOptions.join(', ')}`);

  const snap = await db.collection('agents').get();
  const agents = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  console.log(`\nagents in Firestore: ${agents.length}`);

  // ── Part 1: "Initiation & Discovery" stage fix ──────────────────────
  const stageFixTargets = agents.filter((a) => (a.sdlcStage || []).includes('Initiation & Discovery'));
  console.log(`\n── Initiation & Discovery fix ──`);
  console.log(`agents carrying "Initiation & Discovery": ${stageFixTargets.length}`);
  const stageFixes = stageFixTargets.map((a) => {
    const pid = extractProcessId(a.sdlcProcessMapping);
    const newStage = STAGE_FIX_BY_PROCESS_ID[pid];
    return { agent: a, pid, newStage };
  });
  stageFixes.forEach(({ agent, pid, newStage }) => {
    console.log(`   · ${agent.agentName} (${pid || '—'}) → ${newStage || '⚠️ NO MAPPING — left untouched'}`);
  });

  // ── Part 2: config/schema.sdlcStage cleanup ─────────────────────────
  const currentStageOptions = schemaSnap.data()?.sdlcStage || [];
  const stageOptionsFixed = currentStageOptions.includes('Across Phase') || !currentStageOptions.includes('Post Development');
  console.log(`\n── config/schema.sdlcStage ──`);
  console.log(`current: ${currentStageOptions.join(', ')}`);
  if (stageOptionsFixed) {
    const next = [...new Set([...currentStageOptions.filter((s) => s !== 'Across Phase'), 'Post Development'])];
    console.log(`will become: ${next.join(', ')}`);
  } else {
    console.log('already correct — nothing to do.');
  }

  // ── Part 3: Category backfill ───────────────────────────────────────
  console.log(`\n── Category backfill ──`);
  const needsCategory = agents.filter((a) => !(a.category || []).length);
  console.log(`agents with no category yet: ${needsCategory.length}`);

  const results = []; // { id, agentName, suggested_category, proposed_new_category }
  for (let i = 0; i < needsCategory.length; i += BATCH_SIZE) {
    const batch = needsCategory.slice(i, i + BATCH_SIZE);
    console.log(`  classifying ${i + 1}-${i + batch.length} of ${needsCategory.length}…`);
    const parsed = await categorizeBatch(batch, categoryOptions);
    parsed.forEach((r) => {
      const agent = batch.find((a) => a.id === r.id);
      if (!agent) return; // model echoed an id we didn't send — ignore
      const suggested = categoryOptions.includes(r.suggested_category) ? r.suggested_category : null;
      const proposed = (r.proposed_new_category && typeof r.proposed_new_category.name === 'string' && r.proposed_new_category.name.trim())
        ? { name: r.proposed_new_category.name.trim().slice(0, 60), reason: String(r.proposed_new_category.reason || '').trim().slice(0, 300) }
        : null;
      results.push({ id: agent.id, agentName: agent.agentName, suggested_category: suggested, proposed_new_category: proposed });
    });
  }

  const noCategory = results.filter((r) => !r.suggested_category);
  const withProposal = results.filter((r) => r.proposed_new_category);
  console.log(`\nclassified: ${results.length}`);
  console.log(`no valid category returned (left uncategorized — needs a re-run or manual look): ${noCategory.length}`);
  noCategory.forEach((r) => console.log(`   ⚠️ ${r.agentName}`));
  console.log(`new-category proposals: ${withProposal.length}`);
  withProposal.forEach((r) => console.log(`   · ${r.agentName} → "${r.proposed_new_category.name}" (fallback: ${r.suggested_category}) — ${r.proposed_new_category.reason}`));

  if (!APPLY) {
    console.log('\n[dry run] nothing written. re-run with --apply');
    return;
  }

  // Write order: stage fixes, schema cleanup, then category writes — each
  // independent, so a failure partway through never leaves categories half
  // written because of an unrelated stage-fix problem.
  if (stageFixes.length) {
    const batch = db.batch();
    stageFixes.forEach(({ agent, newStage }) => {
      if (!newStage) return;
      const nextStages = agent.sdlcStage.filter((s) => s !== 'Initiation & Discovery').concat(newStage);
      batch.update(db.collection('agents').doc(agent.id), { sdlcStage: [...new Set(nextStages)], updatedAt: FieldValue.serverTimestamp() });
    });
    await batch.commit();
    console.log(`\n✅ stage fix applied to ${stageFixes.filter((f) => f.newStage).length} agents`);
  }

  if (stageOptionsFixed) {
    const next = [...new Set([...currentStageOptions.filter((s) => s !== 'Across Phase'), 'Post Development'])];
    await db.collection('config').doc('schema').set({ sdlcStage: next }, { merge: true });
    console.log('✅ config/schema.sdlcStage updated');
  }

  if (results.length) {
    for (let i = 0; i < results.length; i += 400) {
      const batch = db.batch();
      results.slice(i, i + 400).forEach((r) => {
        if (!r.suggested_category) return;
        batch.update(db.collection('agents').doc(r.id), { category: [r.suggested_category], updatedAt: FieldValue.serverTimestamp() });
      });
      await batch.commit();
    }
    console.log(`✅ category written for ${results.filter((r) => r.suggested_category).length} agents`);
  }

  if (withProposal.length) {
    const batch = db.batch();
    withProposal.forEach((r) => {
      const ref = db.collection('categoryProposals').doc();
      batch.set(ref, {
        name: r.proposed_new_category.name,
        reason: r.proposed_new_category.reason,
        agentId: r.id,
        agentName: r.agentName,
        fallbackCategory: r.suggested_category,
        status: 'pending',
        createdBy: 'backfill-categories.cjs',
        createdAt: FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
    console.log(`✅ ${withProposal.length} category proposals filed for admin review`);
  }

  console.log('\n✅ done');
})().catch((e) => { console.error('FAILED:', e.message || e); process.exit(1); });
