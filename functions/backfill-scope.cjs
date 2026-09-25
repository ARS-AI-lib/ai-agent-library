// Backfill for the 2026-08-07 Tier logic fix, run locally with ADC.
//
// src/lib/tier.js's Internal/External priority used to guess "External" for
// any agent missing BOTH customerFacing and internalUse, based on whether it
// had an sdlcStage. Checked against the real 242-item library: that branch
// hit 24 agents, and EVERY ONE was actually internal (Tech Innovation/นก*
// internal tooling, several literal internal orchestrator prompt fragments)
// — the guess was backwards. tier.js now defaults missing data to Internal
// instead, which is correct on its own, but "the code defaults it" is not
// the same as "the data is actually right" — an agent that IS genuinely
// customer-facing but never had its Scope radio set (pre-dates the
// required-field form, or was migrated) would now silently under-report as
// Internal instead of over-reporting as External. This script closes that
// gap FOR REAL by reading each ambiguous agent's own description/output and
// asking the same kind of Vertex classifier analyzeDuplicate already uses.
//
// Deliberately conservative: an agent whose description is empty or the
// literal placeholder "TBC" carries no real signal to read — the script
// leaves those alone entirely (no write), trusting tier.js's Internal
// default rather than having the model guess from nothing.
//
//   node functions/backfill-scope.cjs            # dry run: report only
//   node functions/backfill-scope.cjs --apply    # actually write

const { GoogleGenAI } = require('@google/genai');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const PROJECT = 'wolfy-481609';
const { GEN_MODEL, THINK_OFF } = require('./modelConfig');
const MODEL = GEN_MODEL;
const BATCH_SIZE = 20;

const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT });
const db = getFirestore(app, 'ai-agent-lib');
const ai = new GoogleGenAI({ vertexai: true, project: PROJECT, location: 'asia-southeast1' });

function hasRealContent(a) {
  const d = (a.description || '').trim();
  return !!d && d.toUpperCase() !== 'TBC';
}

function safeParseJson(s) {
  const stripped = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(stripped); } catch {}
  const m = stripped.match(/\[[\s\S]*\]/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

function buildBatchPrompt(agents) {
  const items = agents.map((a) => ({
    id: a.id,
    name: a.agentName,
    description: (a.description || '').slice(0, 400),
    output: (a.output || '').slice(0, 200),
    owner: a.owner || '',
  }));
  return `คุณกำลังช่วยแก้ข้อมูลเก่าที่ตกหล่น — Agent/Skill แต่ละตัวด้านล่างนี้ไม่เคยถูกระบุว่า
"Internal Use" (ใช้ภายในองค์กร Arise/Infinitas เท่านั้น) หรือ "Customer Facing" (ลูกค้า/บุคคลภายนอก
เป็นผู้ใช้งานหรือเป็นผู้ได้รับผลลัพธ์โดยตรง) — งานของคุณคืออ่าน description/output จริงแล้วตัดสิน

หลักตัดสิน: "Internal" คือใช้/ผลลัพธ์อยู่ภายในทีมงาน Arise/Infinitas เท่านั้น (เช่น ช่วยพนักงาน
เขียนโค้ด, ทำเทส, สรุปรายงานภายใน, เป็นส่วนประกอบของ orchestrator ภายใน) "External" คือผลลัพธ์หรือ
การโต้ตอบไปถึงลูกค้า/บุคคลภายนอกโดยตรง (เช่น chatbot ตอบคำถามลูกค้า, สร้างเอกสารส่งลูกค้า)
⚠️ ค่า default ที่ปลอดภัยกว่าคือ Internal — ถ้าไม่มั่นใจจริงๆ ให้ตอบ Internal ไม่ใช่เดา External

ตอบเป็น JSON array เท่านั้น ไม่มีข้อความอื่น รูปแบบ:
[{"id": "...", "scope": "Internal" | "External", "confident": true|false}, ...]
"confident": false หมายถึงข้อมูลไม่พอจะฟันธง (ยังต้องตอบ scope มาด้วย แต่ผลจะไม่ถูกใช้เขียนถ้า confident=false)

รายการ:
${JSON.stringify(items, null, 2)}`;
}

async function classifyBatch(agents) {
  const resp = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: buildBatchPrompt(agents) }] }],
    config: {
      temperature: 0.1, maxOutputTokens: 2048, responseMimeType: 'application/json',
      thinkingConfig: THINK_OFF,
    },
  });
  const text = resp?.text || resp?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = safeParseJson(text);
  if (!Array.isArray(parsed)) throw new Error(`unparseable batch response (${text.slice(0, 200)})`);
  return parsed;
}

(async () => {
  const snap = await db.collection('agents').get();
  const agents = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const approved = agents.filter((a) => a.approvalStatus === 'approved' && !a.archived);
  const ambiguous = approved.filter((a) => a.customerFacing !== true && a.internalUse !== true);
  console.log(`approved non-archived: ${approved.length}`);
  console.log(`ambiguous (no customerFacing/internalUse set): ${ambiguous.length}`);

  const readable = ambiguous.filter(hasRealContent);
  const noSignal = ambiguous.filter((a) => !hasRealContent(a));
  console.log(`  -> has real description to classify from: ${readable.length}`);
  console.log(`  -> no real content (left as-is, tier.js default = Internal): ${noSignal.length}`);
  if (noSignal.length) noSignal.forEach((a) => console.log(`     · ${a.agentName} (${a.owner || '—'})`));

  const results = []; // { id, agentName, scope, confident }
  for (let i = 0; i < readable.length; i += BATCH_SIZE) {
    const batch = readable.slice(i, i + BATCH_SIZE);
    console.log(`\nclassifying ${i + 1}-${i + batch.length} of ${readable.length}…`);
    const parsed = await classifyBatch(batch);
    parsed.forEach((r) => {
      const agent = batch.find((a) => a.id === r.id);
      if (!agent) return;
      const scope = ['Internal', 'External'].includes(r.scope) ? r.scope : null;
      results.push({ id: agent.id, agentName: agent.agentName, owner: agent.owner, scope, confident: r.confident === true });
    });
  }

  const toWrite = results.filter((r) => r.scope && r.confident);
  const lowConfidence = results.filter((r) => r.scope && !r.confident);
  const externalHits = toWrite.filter((r) => r.scope === 'External');

  console.log(`\nclassified: ${results.length}`);
  console.log(`confident (will write): ${toWrite.length}`);
  console.log(`low-confidence (left as-is, tier.js default applies): ${lowConfidence.length}`);
  lowConfidence.forEach((r) => console.log(`   · ${r.agentName}`));
  console.log(`\n⭐ classified as External — review these carefully: ${externalHits.length}`);
  externalHits.forEach((r) => console.log(`   · ${r.agentName} (${r.owner || '—'})`));
  console.log(`\nclassified as Internal: ${toWrite.length - externalHits.length}`);

  if (!APPLY) {
    console.log('\n[dry run] nothing written. re-run with --apply');
    return;
  }
  if (!toWrite.length) { console.log('\nnothing to do.'); return; }

  for (let i = 0; i < toWrite.length; i += 400) {
    const batch = db.batch();
    toWrite.slice(i, i + 400).forEach((r) => {
      batch.update(db.collection('agents').doc(r.id), {
        customerFacing: r.scope === 'External',
        internalUse: r.scope === 'Internal',
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
  }
  console.log(`\n✅ scope written for ${toWrite.length} agents`);
})().catch((e) => { console.error('FAILED:', e.message || e); process.exit(1); });
