// Inserts the "AI Agent Library Copilot" meta-agent + its skills into /agents so
// the AI Agent Library itself documents the AI feature that powers Pre-Registration
// duplicate-detection + connection-suggestion, plus a placeholder for the planned
// (not-yet-built) chat assistant entry point.
//
// Source: grill-me sessions 2026-07-01 — table reviewed and revised twice by
// Tinnapat:
//   Round 1: initial 5-entry table + "reusable" re-defined as "another team could
//            pull this and apply it to their own work" (not just reuse within app).
//   Round 2: dropped SDLC fields (these entries aren't themselves SDLC-mapped
//            processes) + useCase; coreAbility locked to the fixed dropdown list;
//            relatedRole narrowed to AI Creator / SME (SME = AI Approver) for
//            anything tied to the review workflow, Developer for anything freely
//            reusable as a generic library-agnostic function; renamed the two
//            "Reusable with Conditions" items to make the AI-Library-specific
//            coupling explicit in the name itself; added the not-yet-built chat
//            assistant as a 10%-progress placeholder for the phase-next roadmap.
//
// Dry-run by default (prints what WOULD be written). Pass --apply to commit.
//
// Usage:
//   node insert-copilot-meta-agents.cjs            # dry run
//   node insert-copilot-meta-agents.cjs --apply    # writes to Firestore
//
// Requires Application Default Credentials (already configured in Cloud Shell).
// Safe to re-run: checks for existing agentName before inserting (no duplicates
// created on a second run).

const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');

const app = initializeApp({ projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

const OWNER = 'Wolfy';
const CREATOR = 'Tinnapat Pongtongmuang';

// Shared fields common to all docs. No sdlcStage/sdlcProcessMapping/useCase —
// these entries document the AI-feature tooling itself, not an SDLC-mapped
// business process, so those fields don't apply.
const BASE = {
  owner: OWNER,
  creator: CREATOR,
  createdBy: '', // uid unknown from this script — same gap as the existing
                  // owner/creator backfill pattern; backfill-owner-creator.cjs
                  // convention already tolerates this.
  approvalStatus: 'approved',
  approvedBy: OWNER,
  internalUse: true,
  customerFacing: false,
  reuseCondition: '',
};

const DOCS = [
  {
    agentName: 'AI Agent Library Copilot',
    aiAgent: true,
    skillMd: false,
    description: 'Orchestrator agent ที่รับ draft agent/skill ใหม่จากผู้ใช้ วิเคราะห์ความซ้ำซ้อนกับไลบรารีที่มีอยู่ แนะนำการเชื่อมต่อกับของเดิม และให้คำตอบ verdict ผ่านการเรียก skills ที่ลงทะเบียนไว้ + Vertex AI (Gemini 2.5 Flash) สำหรับตัดสินเชิงความหมาย',
    coreAbility: ['Analytical', 'Decision Making'],
    relatedRole: ['AI Creator', 'SME'],
    input: 'Draft agent/skill (agentName, description, coreAbility, input, output, businessValue, tool, owner)',
    output: 'Structured JSON: overall_risk, candidates[] (verdict+confidence+reason), integration_suggestions[], suggested_matching_agent, suggested_ability, summary',
    businessValue: 'ลดความซ้ำซ้อนของ Agent/Skill ในไลบรารี, เร่งการตัดสินใจตอน pre-registration, ลดภาระ manual review ของ approver',
    reusable: 'Reusable with Conditions',
    reuseCondition: 'ต้องเขียน prompt Vertex AI ใหม่ให้ตรง domain ของทีมที่จะนำไปใช้ + ปรับ data schema ที่ส่งเข้า (ปัจจุบัน hardcode field ของ AI Agent Library) — ชื่อจึงระบุ "AI Agent Library" ตรงๆ เพื่อสื่อว่าผูกกับระบบนี้',
    hml: true,
    humanJob: 'Approver/Committee (SME) ตัดสินใจสุดท้ายว่าจะ approve/reject — Agent ให้แค่คำแนะนำ ไม่ auto-approve/reject เอง (ยกเว้น hard-block ที่ >=80% confidence ซึ่ง block การ submit แต่ไม่ auto-reject)',
    tool: 'Vertex AI (Gemini 2.5 Flash), Firestore (named DB: ai-agent-lib), Cloud Functions',
    llm: 'Gemini 2.5 Flash (thinkingBudget: 0)',
    dataPrivacy: 'ข้อมูล draft + candidates ส่งผ่าน Vertex AI ภายใน GCP project เดียวกัน (wolfy-481609) ไม่ออกนอก org',
    matchingAgent: '',
    developmentPhase: 'Pilot',
    devProgress: 90,
  },
  {
    agentName: 'search_library',
    aiAgent: false,
    skillMd: true,
    description: 'ค้นหา Agent/Skill ที่มีอยู่แล้วในไลบรารีที่ใกล้เคียงกับ draft ที่ให้มา (rule-based nearest-neighbour, ไม่กรอง threshold) คืน top-15 พร้อมคะแนนดิบ — ใช้เป็น "หน้าด่าน" ก่อนส่งให้ AI ตัดสินเชิงความหมาย',
    coreAbility: ['Utility', 'Analytical'],
    relatedRole: ['Developer'],
    input: 'draft{agentName, description, coreAbility, input, output, businessValue}, limit(default 15)',
    output: 'Array of {existing, confidence} เรียงจากคะแนนมากไปน้อย ไม่กรอง threshold',
    businessValue: 'เตรียม candidate list ให้ AI เห็นครบแม้ surface-token similarity ต่ำ — ป้องกัน AI พลาด duplicate ที่คำไม่ตรงกันตรงๆ',
    reusable: 'Reusable',
    hml: false,
    humanJob: '',
    tool: 'lib/similarity.js (rankCandidates)',
    llm: '',
    dataPrivacy: 'ไม่มี PII — เทียบเฉพาะ text fields ของ agent metadata',
    matchingAgent: 'AI Agent Library Copilot',
    developmentPhase: 'Pilot',
    devProgress: 90,
  },
  {
    agentName: 'duplicate_check',
    aiAgent: false,
    skillMd: true,
    description: 'ให้คะแนนความซ้ำของ draft เทียบทั้งไลบรารี คืนเฉพาะที่ทับซ้อน >= เกณฑ์ medium (40%) เรียงมากไปน้อย — เป็น deterministic fallback เมื่อ Vertex AI ไม่พร้อมใช้งาน',
    coreAbility: ['Analytical', 'Compliance'],
    relatedRole: ['Developer'],
    input: 'draft{agentName, description, coreAbility, input, output, businessValue}, limit(default 5)',
    output: 'Array of matches ที่ confidence >= 40% พร้อม risk level (low/medium/high)',
    businessValue: 'Fallback ที่ทำงานได้แม้ Vertex AI ล่ม — ระบบไม่ block การใช้งานทั้งหมดถ้า AI service down',
    reusable: 'Reusable',
    hml: false,
    humanJob: '',
    tool: 'lib/similarity.js (findDuplicates)',
    llm: '',
    dataPrivacy: 'ไม่มี PII',
    matchingAgent: 'AI Agent Library Copilot',
    developmentPhase: 'Pilot',
    devProgress: 90,
  },
  {
    agentName: 'agent_library_connection_suggest',
    aiAgent: false,
    skillMd: true,
    description: 'หา Agent/Skill ที่ draft "ต่อกับตัวนี้ได้" ผ่าน directional scoring: Output↔Input data-handoff (0.50), process-step adjacency ตาม catalog เฉพาะขององค์กร (0.20), tool overlap (0.15), team match (0.15) — คืนพร้อมทิศทาง (draft→existing หรือ existing→draft), ประเภท (Data Handoff/Trigger/Shared Context) และเหตุผล',
    coreAbility: ['Analytical', 'Project Management'],
    relatedRole: ['AI Creator', 'SME'],
    input: 'draft{agentName, input, output, tool, owner}, limit(default 6)',
    output: 'Top-6 connection suggestions พร้อม direction, type, confidence, reason',
    businessValue: 'ช่วยผู้ submit idea เห็นโอกาส reuse/integrate กับของเดิมแทนที่จะสร้างซ้ำ — ลด fragmentation ของ agent ecosystem',
    reusable: 'Reusable with Conditions',
    reuseCondition: 'Step-adjacency scoring ต้องมี process catalog ของตัวเอง (ordered list) ถึงจะได้คะแนนส่วนนี้ (20% ของ weight) — ปัจจุบันผูกกับ SDLC catalog เฉพาะของ Krungthai ทีมอื่นต้องมี catalog เทียบเท่าถึงจะได้คะแนนเต็ม ไม่งั้นเหลือแค่ data-handoff+tool+team (80%) — ชื่อจึงระบุ "agent_library" ตรงๆ',
    hml: false,
    humanJob: '',
    tool: 'lib/connections.js (findConnectionSuggestions, buildCatalog)',
    llm: 'ไม่ใช้ (pure function, deterministic; ผลลัพธ์ถูกส่งต่อให้ Vertex AI เป็น "untrusted hint" เพื่อตัดสินอีกชั้น)',
    dataPrivacy: 'ไม่มี PII',
    matchingAgent: 'AI Agent Library Copilot',
    developmentPhase: 'Pilot',
    devProgress: 90,
  },
  {
    agentName: 'get_agent_detail',
    aiAgent: false,
    skillMd: true,
    description: 'ดึงข้อมูลเต็มของ Agent/Skill หนึ่งตัวจากไลบรารีด้วยชื่อ (case-insensitive) — ใช้ตอบคำถามเจาะจงตัวใดตัวหนึ่ง (เตรียมไว้สำหรับ chat entry point ที่ยังไม่ build)',
    coreAbility: ['Utility'],
    relatedRole: ['Developer'],
    input: 'agentName: string',
    output: 'Agent object เต็ม หรือ null ถ้าไม่พบ',
    businessValue: 'รองรับ future chat UX ("ขอดูรายละเอียด PO/BA หน่อย") โดยไม่ต้อง refactor เพิ่ม',
    reusable: 'Reusable',
    hml: false,
    humanJob: '',
    tool: 'lib/skills.js (SKILLS.get_agent_detail)',
    llm: '',
    dataPrivacy: 'ไม่มี PII',
    matchingAgent: 'AI Agent Library Copilot',
    developmentPhase: 'Pilot',
    devProgress: 90,
  },
  // ── Not yet built — roadmap placeholder ──────────────────────────────
  {
    agentName: 'AI Agent Library Chat Assistant',
    aiAgent: true,
    skillMd: false,
    description: 'แชทที่คุยกับ AI Agent Library ด้วยภาษาธรรมชาติ แทนที่จะกรอกฟอร์ม Pre-Registration อย่างเดียว — เรียก skill registry เดียวกับ AI Agent Library Copilot (search_library, duplicate_check, agent_library_connection_suggest, get_agent_detail) ผ่าน LLM function-calling. ⚠️ ยังไม่ได้ build — SKILL_TOOLS descriptor พร้อมใช้แล้วใน lib/skills.js แต่ยังไม่มี chat frontend/backend',
    coreAbility: ['Conversational', 'Utility'],
    relatedRole: ['AI Creator', 'SME'],
    input: 'ข้อความภาษาธรรมชาติจากผู้ใช้ (เช่น "มี agent ที่ทำ requirement analysis อยู่แล้วไหม")',
    output: 'คำตอบภาษาธรรมชาติ พร้อมผลลัพธ์จาก skill ที่ถูกเรียก (ผ่าน function-calling)',
    businessValue: 'ลด friction ในการค้นหา/สอบถามไลบรารี — ไม่ต้องเปิดฟอร์ม Pre-Registration เพื่อแค่ถามว่ามีของซ้ำไหม',
    reusable: 'Reusable with Conditions',
    reuseCondition: 'ยังไม่ build — เมื่อสร้างแล้วจะมีเงื่อนไขเดียวกับ AI Agent Library Copilot (ต้องปรับ prompt/schema ตาม domain ของทีมที่จะนำไปใช้)',
    hml: true,
    humanJob: 'เหมือน AI Agent Library Copilot — SME ยังคงเป็นผู้ approve/reject สุดท้าย',
    tool: 'lib/skills.js (SKILL_TOOLS) — วางแผนไว้ ยังไม่ได้ต่อ LLM function-calling จริง',
    llm: 'วางแผนใช้ Gemini 2.5 Flash เช่นเดียวกับ Copilot (ยังไม่ implement)',
    dataPrivacy: 'เดียวกับ AI Agent Library Copilot (ยังไม่ implement)',
    matchingAgent: '',
    developmentPhase: 'In Progress',
    devProgress: 10,
  },
];

async function run() {
  const existingSnap = await db.collection('agents').get();
  const existingNames = new Set(existingSnap.docs.map((d) => (d.data().agentName || '').trim()));

  let toCreate = 0;
  let skipped = 0;

  for (const doc of DOCS) {
    if (existingNames.has(doc.agentName)) {
      console.log(`  ⏭️  "${doc.agentName}" มีอยู่แล้ว — ข้าม (รันสคริปต์นี้ปลอดภัย ไม่สร้างซ้ำ)`);
      skipped++;
      continue;
    }
    console.log(`  ➕ "${doc.agentName}" (${doc.aiAgent ? 'Agent' : 'Skill'}) — ${doc.developmentPhase} ${doc.devProgress}% — matchingAgent: ${doc.matchingAgent || '—'}`);
    toCreate++;
    if (APPLY) {
      await db.collection('agents').add({
        ...BASE,
        ...doc,
        launchDate: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  console.log(`\n${toCreate} docs ${APPLY ? 'ถูกสร้างแล้ว' : 'จะถูกสร้าง'}, ${skipped} docs ข้าม (มีอยู่แล้ว)`);
  if (!APPLY) {
    console.log('ℹ️  Dry run เท่านั้น — รันใหม่พร้อม --apply เพื่อบันทึกจริง');
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
