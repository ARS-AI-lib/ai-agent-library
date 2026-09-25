// 2026-08-07 full re-audit, run locally with ADC — supersedes the narrower
// backfill-scope.cjs / backfill-categories.cjs, which only filled MISSING
// data (customerFacing/internalUse both unset, or category empty). Those
// scripts left WRONG-BUT-PRESENT data untouched by design — but a real audit
// found exactly that failure mode: 5 "ALPHA - …" skills (Doc Extraction, EPIC
// Analyzer, Story analyzer, Summarizer, Jira issue creation) plus
// skill-creator carry customerFacing: true even though they're internal dev
// tooling (they process Jira/Epics/User Stories for the internal dev team,
// nothing in them reaches a bank customer). That data was explicitly set,
// probably at original import, and both narrower scripts skip agents with
// explicit flags on purpose — so it never got re-checked.
//
// This script reads EVERY approved, non-archived agent's actual
// name/description/output against its CURRENT scope + category, and only
// flags a change when the model disagrees. Two independent checks per agent
// (scope, category) — an agent can be right on one and wrong on the other.
//
//   node functions/audit-scope-category.cjs            # dry run: report only
//   node functions/audit-scope-category.cjs --apply    # write only the flagged disagreements

const { GoogleGenAI } = require('@google/genai');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const PROJECT = 'wolfy-481609';
const { GEN_MODEL, THINK_OFF } = require('./modelConfig');
const MODEL = GEN_MODEL;
const BATCH_SIZE = 15; // smaller than the other backfill scripts — full description+output per item this time, not just a fragment

const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT });
const db = getFirestore(app, 'ai-agent-lib');
const ai = new GoogleGenAI({ vertexai: true, project: PROJECT, location: 'asia-southeast1' });

function safeParseJson(s) {
  const stripped = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(stripped); } catch {}
  const m = stripped.match(/\[[\s\S]*\]/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

function currentScope(a) {
  if (a.customerFacing === true) return 'External';
  if (a.internalUse === true) return 'Internal';
  return 'Internal (default, no explicit flag)';
}

function buildBatchPrompt(agents, categoryOptions) {
  const items = agents.map((a) => ({
    id: a.id,
    name: a.agentName,
    description: (a.description || '').slice(0, 500),
    output: (a.output || '').slice(0, 250),
    owner: a.owner || '',
    current_scope: currentScope(a),
    current_category: a.category || [],
  }));
  return `คุณกำลังตรวจสอบข้อมูลของ Agent/Skill ทุกตัวในไลบรารีว่า "scope" (Internal/External) และ
"category" ที่บันทึกไว้ตอนนี้ตรงกับสิ่งที่ description/output จริงบอกไหม — งานนี้คือ AUDIT ไม่ใช่
การจัดครั้งแรก ดังนั้นให้ยึดตามเนื้อหาจริงเป็นหลัก ไม่ใช่ยึดตามค่าที่บันทึกไว้เดิม

── SCOPE ──
"Internal" = ใช้/ผลลัพธ์อยู่ภายในทีมงาน Arise/Infinitas เท่านั้น (ช่วยพนักงานเขียนโค้ด, ทำเทส,
วิเคราะห์ Epic/User Story ของทีม dev เอง, สรุปรายงานภายใน, เป็นส่วนประกอบของ orchestrator ภายใน)
"External" = ผลลัพธ์หรือการโต้ตอบไปถึงลูกค้า/บุคคลภายนอกโดยตรง (chatbot ตอบคำถามลูกค้า,
สร้างเนื้อหา/คำแนะนำที่ส่งตรงถึงลูกค้า)
⚠️ ระวังกรณีชื่อคล้ายลูกค้าแต่จริงๆ ใช้ภายใน เช่น "Jira issue creation", "EPIC Analyzer",
"Story analyzer" — พวกนี้ทำงานกับ Jira/Epic/User Story ของทีม dev เอง ไม่เกี่ยวกับลูกค้าธนาคารเลย
= Internal แม้ผู้ใช้จะพิมพ์ "ลูกค้า" หมายถึง requester ภายในทีมก็ตาม

── CATEGORY ── ต้องเลือกจากรายการนี้เท่านั้น (เลือกได้ 1-2 หมวดที่ตรงที่สุด):
[${categoryOptions.map((c) => `"${c}"`).join(', ')}]

หน้าที่: ต่อแต่ละรายการ ตอบ:
- scope: "Internal" | "External" (คำตอบที่ถูกต้องตามเนื้อหาจริง ไม่ใช่ตามค่าที่บันทึกไว้)
- scope_changed: true ถ้า scope ต่างจาก current_scope, ไม่งั้น false
- category: array ของหมวดที่ถูกต้อง (1-2 หมวด)
- category_changed: true ถ้า category ต่างจาก current_category (เทียบเป็น set ไม่สนลำดับ), ไม่งั้น false
- confident: true ถ้ามั่นใจจากเนื้อหาจริง, false ถ้า description บางเกินไปจะฟันธง (ถ้า false จะไม่ถูกใช้เขียน)

ตอบเป็น JSON array เท่านั้น ไม่มีข้อความอื่น รูปแบบ:
[{"id":"...","scope":"Internal","scope_changed":false,"category":["..."],"category_changed":false,"confident":true}, ...]

รายการ:
${JSON.stringify(items, null, 2)}`;
}

async function auditBatch(agents, categoryOptions) {
  const resp = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: buildBatchPrompt(agents, categoryOptions) }] }],
    config: {
      temperature: 0.1, maxOutputTokens: 4096, responseMimeType: 'application/json',
      thinkingConfig: THINK_OFF,
    },
  });
  const text = resp?.text || resp?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = safeParseJson(text);
  if (!Array.isArray(parsed)) throw new Error(`unparseable batch response (${text.slice(0, 200)})`);
  return parsed;
}

function sameSet(a, b) {
  const sa = new Set(a || []), sb = new Set(b || []);
  if (sa.size !== sb.size) return false;
  for (const v of sa) if (!sb.has(v)) return false;
  return true;
}

(async () => {
  const schemaSnap = await db.collection('config').doc('schema').get();
  const categoryOptions = schemaSnap.data()?.category || [];
  console.log(`category options (${categoryOptions.length}): ${categoryOptions.join(', ')}`);

  const snap = await db.collection('agents').get();
  const agents = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const approved = agents.filter((a) => a.approvalStatus === 'approved' && !a.archived && (a.description || '').trim() && a.description.trim().toUpperCase() !== 'TBC');
  const skipped = agents.filter((a) => a.approvalStatus === 'approved' && !a.archived).length - approved.length;
  console.log(`\nauditing ${approved.length} agents with real descriptions (${skipped} skipped — empty/TBC, no signal to audit against)`);

  const results = [];
  for (let i = 0; i < approved.length; i += BATCH_SIZE) {
    const batch = approved.slice(i, i + BATCH_SIZE);
    console.log(`  auditing ${i + 1}-${i + batch.length} of ${approved.length}…`);
    const parsed = await auditBatch(batch, categoryOptions);
    parsed.forEach((r) => {
      const agent = batch.find((a) => a.id === r.id);
      if (!agent) return;
      const scope = ['Internal', 'External'].includes(r.scope) ? r.scope : null;
      const category = Array.isArray(r.category) ? r.category.filter((c) => categoryOptions.includes(c)) : [];
      const realScopeChange = scope && scope !== (agent.customerFacing === true ? 'External' : 'Internal');
      const realCategoryChange = category.length > 0 && !sameSet(category, agent.category);
      if (!r.confident) return;
      if (realScopeChange || realCategoryChange) {
        results.push({
          id: agent.id, agentName: agent.agentName, owner: agent.owner,
          oldScope: currentScope(agent), newScope: scope, scopeChanged: realScopeChange,
          oldCategory: agent.category || [], newCategory: category, categoryChanged: realCategoryChange,
        });
      }
    });
  }

  console.log(`\n=== flagged disagreements: ${results.length} ===\n`);
  const scopeChanges = results.filter((r) => r.scopeChanged);
  const categoryChanges = results.filter((r) => r.categoryChanged);
  console.log(`scope changes: ${scopeChanges.length}`);
  scopeChanges.forEach((r) => console.log(`   · ${r.agentName} (${r.owner || '—'}): ${r.oldScope} → ${r.newScope}`));
  console.log(`\ncategory changes: ${categoryChanges.length}`);
  categoryChanges.forEach((r) => console.log(`   · ${r.agentName}: [${r.oldCategory.join(', ')}] → [${r.newCategory.join(', ')}]`));

  if (!APPLY) {
    console.log('\n[dry run] nothing written. re-run with --apply');
    return;
  }
  if (!results.length) { console.log('\nnothing to do.'); return; }

  for (let i = 0; i < results.length; i += 400) {
    const batch = db.batch();
    results.slice(i, i + 400).forEach((r) => {
      const update = { updatedAt: FieldValue.serverTimestamp() };
      if (r.scopeChanged) {
        update.customerFacing = r.newScope === 'External';
        update.internalUse = r.newScope === 'Internal';
      }
      if (r.categoryChanged) update.category = r.newCategory;
      batch.update(db.collection('agents').doc(r.id), update);
    });
    await batch.commit();
  }
  console.log(`\n✅ applied ${results.length} corrections`);
})().catch((e) => { console.error('FAILED:', e.message || e); process.exit(1); });
