// Vertex AI–backed duplicate-check assistant for the AI Agent Library
// Pre-Registration flow. Runs as an authenticated Firebase Callable in the
// asia-southeast1 region; rejects unauthenticated calls.
//
// Input  (from client):
//   { draft: {...}, candidates: [{ agentName, description, coreAbility, useCase, reusable, reuseCondition, ruleConfidence }, ...] }
// Output (JSON):
//   { candidates: [{ agentName, confidence, verdict, reason }, ...],
//     suggested_matching_agent, suggested_ability, overall_risk }
//
// Token discipline: candidates list is hard-capped at 15 and only carries
// the four fields above; the prompt asks for short Thai reasoning
// (≤180 chars per candidate). Total prompt typically stays under 8K tokens.

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { GoogleGenAI } = require('@google/genai');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

setGlobalOptions({ region: 'asia-southeast1', maxInstances: 5 });

const adminApp = initializeApp();
const db = getFirestore(adminApp, 'ai-agent-lib'); // named DB, not "(default)"

// Core Ability is a choice field owned by /config/schema (never hardcoded —
// same rule as the React form's dropdown) so the AI's suggested_ability
// allowlist can't drift from whatever an admin has configured. Cached for the
// life of the function instance; a schema edit picks up on the next cold start.
const FALLBACK_CORE_ABILITY = [
  'Analytical', 'Code Generation', 'Compliance', 'Conversational',
  'Decision Making', 'Documentation', 'Media Creation',
  'Project Management', 'Testing & QA', 'Utility',
];
let coreAbilityCache = null;
async function getCoreAbilityOptions() {
  if (coreAbilityCache) return coreAbilityCache;
  try {
    const snap = await db.collection('config').doc('schema').get();
    const opts = snap.data()?.coreAbility;
    coreAbilityCache = Array.isArray(opts) && opts.length ? opts : FALLBACK_CORE_ABILITY;
  } catch {
    coreAbilityCache = FALLBACK_CORE_ABILITY;
  }
  return coreAbilityCache;
}

// Category — a DOMAIN grouping (Design & UI, Lending & Credit, …), deliberately
// separate from Core Ability (a capability TYPE like Analytical/Documentation).
// Same allowlist pattern as Core Ability above: /config/schema.category is the
// single source of truth an admin can edit without redeploy, and the model must
// pick from this list — never invent a name — EXCEPT via the explicit
// proposed_new_category escape hatch below, which routes through admin approval
// rather than writing straight to the list (2026-08 decision — see plan
// agent-skill-structured-horizon.md).
// Mirrors CATEGORY_AREA's key set in src/lib/approveAreas.js (realigned
// 2026-08-10 so every category maps to exactly one approver area). Only a
// fallback for when /config/schema is unreachable — that doc is the live list.
const FALLBACK_CATEGORY = [
  'Compliance & Governance', 'Project & Delivery', 'Requirements & Product',
  'UX Research', 'Design & UI', 'Writing & Content', 'Architecture',
  'Software Development', 'SIT', 'QA', 'Security', 'DevOps & Platform',
  'SRE & Reliability', 'Incident Management', 'Data & Analytics',
  'Investment', 'Lending & Credit', 'NEXT', 'เป๋าตัง, เป๋าตุง, ถุงเงิน', 'CLIX', 'Core bank',
];
// Which of the above are PRODUCTS rather than disciplines. Mirrors
// VERTICAL_CATEGORIES in src/lib/approveAreas.js; the live value comes from
// /config/schema.productCategory, seeded from that same constant.
const FALLBACK_PRODUCT_CATEGORY = [
  'Investment', 'Lending & Credit', 'NEXT', 'เป๋าตัง, เป๋าตุง, ถุงเงิน', 'CLIX', 'Core bank',
];
let categoryCache = null;
// Returns { all, disciplines, products }. Splitting these matters: until
// 2026-08-17 the model was handed one flat 21-item list and told to pick the
// single closest "โดเมนงาน", so it could not tell a product from a discipline
// and the discipline answer always won — all four product categories sat at 0
// agents for a week. The two lists are now presented separately in the prompt.
async function getCategoryOptions() {
  if (categoryCache) return categoryCache;
  let all = FALLBACK_CATEGORY;
  let products = FALLBACK_PRODUCT_CATEGORY;
  try {
    const snap = await db.collection('config').doc('schema').get();
    const opts = snap.data()?.category;
    const prod = snap.data()?.productCategory;
    if (Array.isArray(opts) && opts.length) all = opts;
    if (Array.isArray(prod) && prod.length) products = prod;
  } catch {
    /* keep fallbacks */
  }
  // Only treat a product as such if it is actually in the live category list,
  // so a stale productCategory entry can never widen what the model may pick.
  products = products.filter((p) => all.includes(p));
  categoryCache = { all, products, disciplines: all.filter((c) => !products.includes(c)) };
  return categoryCache;
}

// The 12 approver areas (2026-08-10). Mirrors AREA_ORDER in
// src/lib/approveAreas.js — Cloud Functions cannot import the client ESM
// module, so this is the one unavoidable copy. It is only ever a FALLBACK:
// /config/schema.approveArea is the live list and is seeded from AREA_ORDER
// by functions/seed-approve-area-schema.cjs, so the two can only diverge if
// the config doc is missing entirely.
const FALLBACK_APPROVE_AREA = [
  'Business & Product', 'Governance, Risk & Procurement', 'Delivery Management',
  'Business Analysis', 'UX Research', 'UI & Visual Design', 'Content & UX Writing',
  'Architecture', 'Development', 'SIT', 'QA', 'Security',
  'Platform, DevOps & Operations', 'SRE & Reliability',
  'Incident & Problem Management', 'Data & Analytics',
];
let approveAreaCache = null;
async function getApproveAreaOptions() {
  if (approveAreaCache) return approveAreaCache;
  try {
    const snap = await db.collection('config').doc('schema').get();
    const opts = snap.data()?.approveArea;
    approveAreaCache = Array.isArray(opts) && opts.length ? opts : FALLBACK_APPROVE_AREA;
  } catch {
    approveAreaCache = FALLBACK_APPROVE_AREA;
  }
  return approveAreaCache;
}

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'wolfy-481609';
const LOCATION = 'asia-southeast1';
const MODEL = 'gemini-2.5-flash';

const ai = new GoogleGenAI({ vertexai: true, project: PROJECT_ID, location: LOCATION });
const GENERATION_CONFIG = {
  // Low temperature for consistency — the same draft should score about the
  // same each run. Not 0 (a hair of flexibility is fine); true "identical
  // every time" comes from the client-side analysis cache, not from here.
  temperature: 0.1,
  maxOutputTokens: 4096,
  responseMimeType: 'application/json',
  // Gemini 2.5 Flash has "thinking" on by default, which eats into
  // maxOutputTokens BEFORE the actual JSON answer is generated. With a
  // long prompt (15 dup candidates + 8 connection candidates) thinking
  // alone can exhaust the budget, leaving an empty/truncated response
  // that fails to parse (the "unparseable output" 500). This isn't a
  // structured-output task that benefits from extended reasoning, so
  // disable it entirely.
  thinkingConfig: { thinkingBudget: 0 },
};

function buildPrompt(draft, candidates, connectionCandidates, coreAbilityOptions, categoryOptions, approveAreaOptions) {
  const candidatesShort = candidates.slice(0, 15).map((c, i) => ({
    i,
    agentName: c.agentName,
    description: (c.description || '').slice(0, 400),
    coreAbility: c.coreAbility,
    useCase: c.useCase,
    reusable: c.reusable || '(ไม่ระบุ)',
    reuseCondition: (c.reuseCondition || '').slice(0, 200),
    ruleConfidence: c.ruleConfidence,
  }));
  const connShort = (connectionCandidates || []).slice(0, 8).map((c) => ({
    agentName: c.agentName,
    direction: c.direction,   // draft→existing (draft ส่งข้อมูลต่อให้), existing→draft (มารับจากตัวนี้)
    type: c.type,             // Data Handoff | Trigger | Shared Context/Tool
    reusable: c.reusable || '(ไม่ระบุ)',  // อย่าเสนอ "Non-reusable" เป็น sub-skill ที่ใช้ร่วม
    ruleConfidence: c.ruleConfidence,
    reason: c.reason,
  }));

  return `คุณเป็นสถาปนิกระบบ AI Agent/Skill ขององค์กร มีหน้าที่ตรวจสอบว่า "Draft ใหม่"
ที่ผู้ใช้กำลังจะลงทะเบียน ซ้ำซ้อนหรือเกี่ยวข้องกับ Agent/Skill ที่มีอยู่แล้วหรือไม่

สำคัญมาก: "ruleConfidence" ที่ติดมากับแต่ละ candidate เป็นแค่คะแนนเทียบคำผิวเผิน
(token overlap) เชื่อถือไม่ได้ — candidate ที่ ruleConfidence ต่ำอาจซ้ำกันจริงในเชิงความหมาย
ก็ได้ (เช่น เขียนคนละภาษา ใช้คำต่างกัน แต่ทำงานเดียวกัน) คุณต้องตัดสินจาก "ความหมาย เป้าหมาย
input/output และคุณค่าทางธุรกิจ" ของมันจริงๆ ไม่ใช่ยึดตาม ruleConfidence

สำคัญมาก (เรื่อง Reusability): แต่ละ candidate มีสถานะ "reusable" ที่ต้องเอามาชั่งด้วย
เพราะ "เหมือนกัน" กับ "ควรใช้ของเดิมแทน" ไม่ใช่เรื่องเดียวกัน:
- ของเดิมเป็น "Reusable" (นำกลับมาใช้ได้อิสระ): ถ้าทับซ้อนสูง → โน้มไปทาง clear_duplicate
  ("ใช้ของเดิมได้เลย ไม่ต้องสร้างใหม่") — reusability ยิ่งเสริมน้ำหนักว่าซ้ำ
- ของเดิมเป็น "Reusable with Conditions": ต้องดู reuseCondition ประกอบ — ถ้า Draft ใหม่
  ไม่เข้าเงื่อนไขนั้น (เช่น ต่างทีม/ต่างบริบท/เงื่อนไขใช้ไม่ได้) การสร้างใหม่อาจมีเหตุผล →
  ลด confidence ลงจากที่ความหมายเหมือน และให้ verdict เป็น likely_overlap/distinct_but_related
  พร้อมอธิบายเงื่อนไขใน reason
- ของเดิมเป็น "Non-reusable" (เฉพาะเจาะจงมาก คนอื่นเอาไปใช้ไม่ได้): แม้ความหมายจะคล้ายมาก
  ก็ "ไม่ใช่ตัวบล็อก" การสร้างใหม่ เพราะของเดิมนำไปใช้ต่อไม่ได้ → ให้ลด confidence ของความซ้ำลง
  และโน้มไป distinct_but_related โดยระบุใน reason ว่า "ของเดิม specific เกินไป จึงสร้างใหม่ได้"
กล่าวคือ: confidence ที่คุณให้ = "ควรใช้ของเดิมแทนแค่ไหน" ไม่ใช่แค่ "ข้อความเหมือนแค่ไหน"

เป้าหมายของ Library (สำคัญที่สุด — ยึดเป็นหลักในการตัดสิน): องค์กรต้องการให้ Library เป็น
"agent เฉพาะทางหลายๆ ตัวที่หน้าที่ไม่ทับกัน" ไม่ใช่ agent เหมารวมที่ทำหลายงานซ้ำกับของเดิม
ดังนั้นการที่ Draft ทำ "ฟังก์ชันย่อยใดๆ" ซ้ำกับของเดิม = ปัญหา (ควรเตือนให้ใช้ของเดิม/เชื่อมต่อ
แทนการสร้างใหม่) — ยกเว้นกรณี Non-reusable/เฉพาะ product ตามกฎ Reusability ด้านบน

กฎหลักการจัด verdict (เรียงตามลำดับการตรวจ — ตรวจข้อ 1 ก่อนเสมอ):
1. ⭐ ตรวจ "ฟังก์ชันย่อยที่ทับกัน" ก่อนเป็นอันดับแรก: แตก Draft ออกเป็นงานย่อยๆ (sub-functions)
   แล้วดูว่ามีงานย่อยใด "ทำสิ่งเดียวกัน" กับของเดิมหรือไม่ (เช่น ทั้งคู่ต่าง break down user story,
   ทั้งคู่ต่างวิเคราะห์ requirement, ทั้งคู่ผลิต output ชนิดเดียวกัน)
   → ถ้ามีงานย่อยทับกัน "จริง" แม้เพียงส่วนเดียว = likely_overlap (ทับซ้อนบางส่วน) เป็นค่าเริ่มต้น
   ห้ามลดชั้นไป distinct_but_related เพียงเพราะ Draft "ทำอย่างอื่นเพิ่มด้วย" หรือ "มี handoff กับของเดิม"
2. distinct_but_related สงวนไว้เฉพาะกรณี "ส่งของต่อกันล้วนๆ (pure handoff) ไม่มีงานย่อยใดทำซ้ำกันเลย"
   เท่านั้น เช่น ตัวหนึ่ง "ผลิต user stories จาก requirement" อีกตัว "รับ user stories ไปออกแบบ HLA"
   โดยไม่มีงานย่อยอื่นซ้ำกัน = complementary → distinct_but_related, confidence ต่ำ (15-45)
   ⚠️ แต่ถ้าลังเลระหว่าง likely_overlap กับ distinct_but_related ให้เอนไป likely_overlap เสมอ
3. clear_duplicate: งานย่อยแทบทั้งหมดทับกัน (ของเดิมทำได้เกือบทุกอย่างที่ Draft ทำ) และของเดิม reusable
- ให้ถือว่า Output ที่เหมือนกัน (ผลิตของอย่างเดียวกัน) เป็นสัญญาณซ้ำที่หนักกว่า Input ที่เหมือนกันมาก
- confidence ต้องสอดคล้องกับ reason เสมอ: ถ้า reason ระบุว่ามีงานย่อยทับกัน ห้ามให้ verdict เป็น
  distinct_but_related (ต้องเป็น likely_overlap ขึ้นไป); ถ้า reason ระบุว่าไม่มีงานย่อยใดซ้ำเลย
  ห้ามให้ confidence สูง

สำคัญ (confidence กับ verdict ต้องไปทางเดียวกันเสมอ): confidence = "ควรใช้ของเดิมแทนแค่ไหน / ซ้ำแค่ไหน"
ไม่ใช่ "เกี่ยวข้องกันแค่ไหน" ตัวเลขต้องอยู่ในช่วงที่ตรงกับ verdict ที่เลือก (ห้ามให้เลขสูงคู่กับ
verdict ที่แปลว่าไม่ซ้ำ เช่น 70 คู่กับ distinct_but_related = ผิด เพราะทำให้คนอ่านสับสน):
- clear_duplicate       → confidence 75-100
- likely_overlap        → confidence 45-85
- distinct_but_related  → confidence 15-45   (เฉพาะ pure handoff — ไม่มีงานย่อยใดซ้ำกันเลย)
- unrelated             → confidence 0-15
เช่น ตัวที่ "รับ Output ของอีกตัวไปทำงานต่อ" โดยไม่มีงานย่อยอื่นซ้ำ = distinct_but_related → 15-45
(ความเชื่อมโยงไปอยู่ใน integration_suggestions ไม่ใช่ในตัวเลข confidence) — แต่ถ้ามันทำงานย่อย
ทับกันด้วยแม้จะมี handoff ก็ตาม = likely_overlap (45-85) ไม่ใช่ distinct_but_related

หน้าที่ (ทำให้ครบทุกข้อ):
1. ต่อแต่ละ candidate: ให้ verdict + confidence (0-100 ตามช่วงของ verdict ด้านบน)
   + reason ภาษาไทยกระชับ (ไม่เกิน 180 ตัวอักษร ระบุจุดที่เหมือน/ต่างให้ชัด โดยเฉพาะ Input→Output)
2. integration_suggestions: ระบบได้คำนวณ "Connection candidates" แบบ rule-based มาให้แล้ว
   (ดูด้านล่าง — มีทิศทาง direction, ประเภท type, และเหตุผลจากการเทียบ Output↔Input จริง)
   ให้คุณ (ก) ยืนยัน/ปรับ candidate เหล่านี้ที่สมเหตุสมผล และ (ข) เพิ่มการเชื่อมต่อเชิงความหมาย
   ที่ rule พลาดได้ ถ้ามี — ตอบเป็น list { "agentName", "how" } โดย "how" อธิบายสั้นๆ เป็นภาษาไทย
   ว่าควรเชื่อมแบบไหน (เช่น "ส่ง Output ไปเป็น Input ของตัวนี้", "ใช้เป็น sub-skill",
   "trigger ต่อใน pipeline", "รวมเป็น orchestrator เดียวกัน") — ยึดตาม direction ที่ระบบให้มา
   ถ้าไม่มีให้เป็น []
2b. tech_stack_hint: คำแนะนำ "วิธี integrate เชิงเทคนิค" แบบ best-practice ทั่วไปสั้นๆ ภาษาไทย
   1-2 ประโยค (เช่น "เชื่อมผ่าน REST API แบบ request/response", "ใช้ message queue ถ้าต้องทำแบบ async",
   "expose เป็น MCP tool ให้ orchestrator เรียก", "แชร์ผ่าน shared database/storage")
   ⛔ เฉพาะหลักการสถาปัตยกรรมทั่วไปเท่านั้น — ห้ามกุ/เดา endpoint จริง, ชื่อ API, credential,
   หรือ technical spec ของ agent ตัวใดตัวหนึ่ง (ระบบไม่มีข้อมูลระดับนั้น) และห้ามพูดเรื่อง bypass
   auth/security ถ้าไม่มี integration_suggestions เลย (draft ไม่ควรต่อกับอะไร) ให้เป็น "" (string ว่าง)
3. suggested_matching_agent: ถ้า Draft เป็น Skill ที่ควรผูกกับ Agent ตัวใดตัวหนึ่ง ใส่ชื่อ ไม่งั้น null
4. suggested_ability: ถ้า ability ที่ผู้ใช้ระบุไม่ตรงกับ description จริง ใส่ชื่อ ability ที่เหมาะกว่า ไม่งั้น null
   ⚠️ ต้องเลือกจากรายการ Core Ability ที่กำหนดไว้เท่านั้น (ห้ามคิดคำใหม่เอง):
   [${coreAbilityOptions.map((a) => `"${a}"`).join(', ')}]
   ถ้าไม่มีตัวไหนในลิสต์นี้เหมาะสมจริงๆ ให้ตอบ null แทนการสร้างคำใหม่
5b. suggested_category: ตอบเป็น **array 1-2 ค่า** ประกอบด้วย
   (ก) DISCIPLINE — 1 ตัว **บังคับ** = "งานนี้เกี่ยวกับเรื่องอะไร" (คนละมิติกับ Core Ability:
       Core Ability = ชนิดความสามารถ เช่น Analytical/Documentation)
       เลือกจากรายการนี้เท่านั้น:
       [${categoryOptions.disciplines.map((c) => `"${c}"`).join(', ')}]
       เลือกตัวที่ "ใกล้เคียงที่สุด" เสมอ แม้ Draft จะดูใหม่/ไม่เข้าพวกขนาดไหนก็ตาม
       ห้ามเว้นว่าง — ค่านี้ต้องมีเสมอทันทีที่ submit
   (ข) PRODUCT — 0 หรือ 1 ตัว **ไม่บังคับ** = "ทำให้ผลิตภัณฑ์ตัวไหนโดยเฉพาะ"
       เลือกจากรายการนี้เท่านั้น:
       [${categoryOptions.products.map((c) => `"${c}"`).join(', ')}]
       ⚠️ ใส่ก็ต่อเมื่อ Draft **ผูกกับผลิตภัณฑ์นั้นจริงๆ** — เช่น ชื่อหรือคำอธิบายระบุแอปนั้น
       ตรงๆ หรือใช้ได้เฉพาะกับแอปนั้น
       ถ้าเป็นเครื่องมือทั่วไปที่ใช้ข้ามผลิตภัณฑ์ได้ (ซึ่งเป็นกรณีส่วนใหญ่) **อย่าใส่**
       อย่าเดาจากชื่อทีมหรือ owner — ต้องมีหลักฐานในตัวเนื้อหา Draft เอง
   ตัวอย่าง: ["Writing & Content", "NEXT"] (skill เขียน copy ของแอป NEXT)
            ["Software Development"] (เครื่องมือ dev ทั่วไป ไม่ผูก product)
6. proposed_new_category: ปกติหมวดเดิมด้านบนควรพอสำหรับ Draft ส่วนใหญ่ (>90%) — ให้ค่านี้เป็น
   null เกือบทุกครั้ง มีค่าเฉพาะเมื่อ Draft เป็นสายงาน/โดเมนที่ "ใหม่จริงๆ" จนหมวดเดิมทุกหมวด
   ไม่เหมาะสมเลย (ไม่ใช่แค่ "ใกล้เคียงแต่ไม่เป๊ะ" — กรณีนั้นให้ใช้ suggested_category แทน)
   ถ้ามี ตอบเป็น {"name": "ชื่อหมวดใหม่สั้นๆ ภาษาอังกฤษ", "reason": "เหตุผลสั้นๆ ภาษาไทยว่าทำไมหมวดเดิมไม่พอ"}
   ไม่งั้นตอบ null
6b. suggested_approve_area: "สายงานไหนควรเป็นคนอนุมัติ Draft นี้" — คนละมิติกับ Category
   (Category = Draft นี้เกี่ยวกับเรื่องอะไร ใช้ค้นหา, Approve Area = ใครมีความเชี่ยวชาญพอ
   จะตรวจว่างานนี้ทำได้จริง/ซ้ำของเดิม/คุณภาพผ่าน) เลือกจากรายการนี้เท่านั้น ห้ามคิดคำใหม่:
   [${approveAreaOptions.map((a) => `"${a}"`).join(', ')}]
   ตอบเป็น array ได้ถ้างานคร่อมสายงานจริงๆ (เช่น skill ที่แปลง design เป็น code
   = ["UI & Visual Design", "Architecture & Engineering"]) แต่ปกติควรมีตัวเดียว
   เลือกตามเนื้องานจริง ไม่ใช่ตามโดเมนธุรกิจ เช่น agent คำนวณวงเงินสินเชื่อ
   → "Business & Product" ไม่ใช่ "Architecture & Engineering" แม้จะเขียนด้วยโค้ดก็ตาม
7. overall_risk: high | medium | low — ประเมินจาก verdict ที่แรงที่สุด
   (มี clear_duplicate=high, มี likely_overlap=medium, นอกนั้น low)
   ⭐ กฎ breadth เพิ่มเติม (ตัวเหมารวม/kitchen-sink): ถ้า Draft ทับงานย่อยกับของเดิม "ตั้งแต่ 3 ตัวขึ้นไป"
   (คือมี candidate ที่ verdict เป็น likely_overlap หรือ clear_duplicate รวมกัน ≥ 3 ตัว) ให้ดัน
   overall_risk เป็นอย่างน้อย "medium" แม้แต่ละตัวจะทับกันไม่มาก เพราะมันคือสัญญาณว่า Draft
   กำลังรวมงานที่กระจายอยู่ในหลาย agent เดิมมาไว้ในตัวเดียว (ขัดกับหลัก agent เฉพาะทาง)
8. summary: สรุปภาพรวมภาษาไทย 1-2 ประโยค ว่าควรสร้างใหม่ / ใช้ของเดิม / เชื่อมต่อของเดิม
   ถ้าเข้ากรณี breadth (ทับ ≥3 ตัว) ให้ระบุชัดใน summary ว่า "Draft นี้ทำงานทับกับ Agent เดิมหลายตัว
   ควรพิจารณาแยกเป็น skill เฉพาะทาง หรือใช้/เชื่อมของเดิมแทนการสร้างตัวเหมารวม"

verdict 4 ระดับ:
- clear_duplicate: ทำงานเหมือนกันแทบทั้งหมด ควรใช้ของเดิม
- likely_overlap: ทับซ้อนบางส่วน ควรพิจารณารวมหรือเชื่อมต่อ
- distinct_but_related: ต่างกัน แต่อยู่ในโดเมนเดียวกัน อาจเชื่อมต่อกันได้
- unrelated: ไม่เกี่ยวข้องกัน

ตอบเป็น JSON อย่างเดียว ไม่มีข้อความอื่น รูปแบบ:
{
  "candidates": [{"agentName": "...", "confidence": 0-100, "verdict": "...", "reason": "..."}, ...],
  "integration_suggestions": [{"agentName": "...", "how": "..."}, ...],
  "tech_stack_hint": "..." (string ว่างได้),
  "suggested_matching_agent": "..." หรือ null,
  "suggested_ability": "..." หรือ null,
  "suggested_category": ["<discipline>"] หรือ ["<discipline>", "<product>"],
  "proposed_new_category": {"name": "...", "reason": "..."} หรือ null,
  "suggested_approve_area": ["..."],
  "overall_risk": "high" | "medium" | "low",
  "summary": "..."
}

ในผลลัพธ์ candidates ให้เรียงจาก confidence ของคุณมากไปน้อย และตัด candidate ที่ verdict=unrelated
และ confidence < 25 ออก เพื่อให้เหลือเฉพาะที่มีนัยสำคัญ

Draft ใหม่:
${JSON.stringify(draft, null, 2)}

Candidates สำหรับตรวจความซ้ำ (ruleConfidence = แค่คะแนนเทียบคำ เชื่อถือไม่ได้):
${JSON.stringify(candidatesShort, null, 2)}

Connection candidates สำหรับ integration_suggestions (คำนวณจาก Output↔Input + SDLC step + tool + team):
${JSON.stringify(connShort, null, 2)}`;
}

function safeParseJson(s) {
  // Strip markdown code fences in case the model wraps JSON in ```json ... ```
  // despite responseMimeType: 'application/json' (seen occasionally).
  const stripped = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(stripped); } catch {}
  const m = stripped.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

exports.analyzeDuplicate = onCall(
  { cors: true, timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign-in required.');
    }
    const { draft, candidates, connectionCandidates } = request.data || {};
    if (!draft || !Array.isArray(candidates) || candidates.length === 0) {
      // No candidates → nothing to analyze; return empty result without burning quota.
      return { candidates: [], integration_suggestions: [], suggested_matching_agent: null, suggested_ability: null, suggested_category: [], proposed_new_category: null, suggested_approve_area: [], overall_risk: 'low', summary: '' };
    }

    const [coreAbilityOptions, categoryOptions, approveAreaOptions] = await Promise.all([
      getCoreAbilityOptions(), getCategoryOptions(), getApproveAreaOptions(),
    ]);
    const prompt = buildPrompt(draft, candidates, connectionCandidates, coreAbilityOptions, categoryOptions, approveAreaOptions);

    let text = '';
    let finishReason = '';
    try {
      const resp = await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: GENERATION_CONFIG,
      });
      const cand = resp?.candidates?.[0];
      text = resp?.text || cand?.content?.parts?.[0]?.text || '';
      finishReason = cand?.finishReason || '';
    } catch (e) {
      throw new HttpsError('internal', `Vertex AI call failed: ${e.message || e}`);
    }

    const parsed = safeParseJson(text);
    if (!parsed) {
      // Log the raw response to Cloud Logging so a future failure is
      // diagnosable without having to reproduce it interactively.
      console.error('analyzeDuplicate: unparseable Vertex response', {
        finishReason,
        textLength: text.length,
        textPreview: text.slice(0, 500),
      });
      const hint = finishReason === 'MAX_TOKENS' ? ' (finishReason=MAX_TOKENS — response was truncated)' : '';
      throw new HttpsError('internal', `Vertex AI returned unparseable output.${hint}`);
    }

    parsed.candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
    parsed.integration_suggestions = Array.isArray(parsed.integration_suggestions) ? parsed.integration_suggestions : [];
    // Tech-stack hint only makes sense when there IS something to integrate with —
    // suppress it otherwise so the UI never shows integration advice for a draft
    // that stands alone (2026-07-06).
    parsed.tech_stack_hint = (typeof parsed.tech_stack_hint === 'string' && parsed.integration_suggestions.length > 0)
      ? parsed.tech_stack_hint : '';
    parsed.suggested_matching_agent = parsed.suggested_matching_agent || null;
    // Defense in depth: don't trust the model to always obey the prompt's
    // allowlist instruction — drop any suggested_ability that isn't one of
    // the fixed Core Ability values rather than let a fabricated one reach the UI.
    parsed.suggested_ability = coreAbilityOptions.includes(parsed.suggested_ability)
      ? parsed.suggested_ability : null;
    // Same defense-in-depth as suggested_ability above: never trust the model
    // to have obeyed the category allowlist — an unvalidated string would
    // poison the sidebar with a name /config/schema.category never approved.
    // Now an ARRAY (2026-08-17): 1 discipline + optionally 1 product. A bare
    // string is still accepted so an in-flight response from the previous
    // deploy keeps working during rollout.
    // At most one product survives: the prompt asks for one, and letting the
    // model tag an agent with three apps would defeat the point of the filter.
    {
      const raw = Array.isArray(parsed.suggested_category)
        ? parsed.suggested_category
        : [parsed.suggested_category];
      const valid = raw.filter((c) => categoryOptions.all.includes(c));
      const disciplines = valid.filter((c) => !categoryOptions.products.includes(c));
      const products = valid.filter((c) => categoryOptions.products.includes(c));
      parsed.suggested_category = [...disciplines.slice(0, 1), ...products.slice(0, 1)];
    }
    // Same allowlist treatment for the approver area. An empty array is a fine
    // outcome — approveArea is optional on an agent doc and the client-side
    // resolver falls back to process/category/role — so unlike
    // suggested_category there is nothing lost by dropping bad values. Accepts
    // a bare string too, since the model returns a single area often enough
    // that being strict about the array shape would throw away good answers.
    parsed.suggested_approve_area = (
      Array.isArray(parsed.suggested_approve_area)
        ? parsed.suggested_approve_area
        : [parsed.suggested_approve_area]
    ).filter((a) => approveAreaOptions.includes(a));
    // proposed_new_category must be a well-formed {name, reason} or null — drop
    // anything malformed rather than let a half-shaped object reach Firestore.
    parsed.proposed_new_category = (
      parsed.proposed_new_category
      && typeof parsed.proposed_new_category.name === 'string'
      && parsed.proposed_new_category.name.trim()
    ) ? { name: parsed.proposed_new_category.name.trim().slice(0, 60), reason: String(parsed.proposed_new_category.reason || '').trim().slice(0, 300) }
      : null;
    parsed.summary = typeof parsed.summary === 'string' ? parsed.summary : '';
    parsed.overall_risk = ['high', 'medium', 'low'].includes(parsed.overall_risk)
      ? parsed.overall_risk : 'medium';
    return parsed;
  }
);

// ── AI Agent Library Chat Assistant (2026-07-02) ─────────────────────
// Read-only v1, floating icon on every tab. Client-mediated function-calling:
// this function decides WHICH client-side skill (from src/lib/skills.js) to
// call next, or composes the final answer — it never sees the full library,
// only whatever a skill result includes. Stateless per call: the client
// resends the last ≤6 turns of conversation plus any tool results
// accumulated so far in the current user-message turn (client enforces a
// 3-call loop cap; this function does not track state across calls).
//
// Request:  { history: [{role:'user'|'model', text}], message: string|null,
//             toolResults: [{name, args, result}] }
//   - `message` is set only on the FIRST call of a turn (the new user input).
//   - `toolResults` accumulates as the client runs tool_call responses; empty
//     on the first call.
// Response: one of
//   { type: 'tool_call', name, args }
//   { type: 'answer', text }

const CHAT_MODEL = 'gemini-2.5-flash';
const CHAT_GENERATION_CONFIG = {
  // A bit more flexibility than the duplicate-checker's 0.1 — this is
  // conversational, not a scored judgement that needs to be reproducible.
  temperature: 0.4,
  // 2048 (was 1024) — 2026-07-30: answers now carry readiness markers, the
  // disclaimer footnotes and endpoint links, and some entries list ten-plus
  // creators. Real answers were being cut off mid-list, which silently
  // dropped the very footnote explaining the "*" markers.
  maxOutputTokens: 2048,
  // thinkingBudget: -1 (dynamic) — 2026-07-22 fix. This was copied from the
  // duplicate-checker's config below (thinkingBudget: 0), which is correct
  // THERE because it's a deterministic JSON classifier that needs speed, not
  // reasoning. Copied onto the conversational assistant it did the opposite
  // of what the system prompt asks for: multi-step SDLC-gap analysis,
  // weighing pros/cons, resolving a vague follow-up against prior turns. With
  // thinking off the model pattern-matches the literal sentence instead of
  // reasoning through it — reported by the user as answers that felt shallow
  // and overly literal (a vague follow-up got a request for clarification
  // instead of an inference from context). Dynamic thinking lets the model
  // decide how much reasoning a given turn needs.
  thinkingConfig: { thinkingBudget: -1 },
};

// Tool shapes as presented to the LLM for the chat entry point. These are
// deliberately NOT identical to skills.js's SKILL_TOOLS descriptors — e.g.
// connection_suggest here takes just an existing agentName (the natural
// shape for a chat question like "ตัวนี้ต่อกับอะไรได้"), not a full draft
// object; the client resolves agentName → the real agent record and feeds it
// into the underlying findConnectionSuggestions skill. search_library and
// duplicate_check (draft-vs-library checks) are intentionally NOT exposed
// here — those need a full structured draft object, which this read-only v1
// has no reliable way to assemble from free-text chat (same fabrication-risk
// reasoning that deferred the "AI pre-fills the form" feature to a later phase).
const { TOOL_DECLARATIONS, CHAT_SYSTEM_PROMPT } = require('./chatPrompt');

// Builds the Gemini `contents` array from the transcript + any tool results
// accumulated so far this turn. Function-call/response turns are appended in
// the documented alternating shape: model→functionCall, user→functionResponse.
function buildChatContents(history, message, toolResults) {
  const contents = (history || []).map((h) => ({
    role: h.role === 'model' ? 'model' : 'user',
    parts: [{ text: h.text }],
  }));
  if (message) {
    contents.push({ role: 'user', parts: [{ text: message }] });
  }
  (toolResults || []).forEach(({ name, args, result }) => {
    contents.push({ role: 'model', parts: [{ functionCall: { name, args } }] });
    contents.push({ role: 'user', parts: [{ functionResponse: { name, response: { result } } }] });
  });
  return contents;
}

exports.chatLibrary = onCall(
  // 60s (was 30s) — dynamic thinking adds latency on top of the existing
  // tool-call loop; give it headroom instead of racing the old ceiling.
  { cors: true, timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign-in required.');
    }
    const { history, message, toolResults } = request.data || {};
    if (!message && !(toolResults || []).length) {
      throw new HttpsError('invalid-argument', 'Either message or toolResults must be provided.');
    }

    const contents = buildChatContents(history, message, toolResults);

    let resp;
    try {
      resp = await ai.models.generateContent({
        model: CHAT_MODEL,
        contents,
        config: {
          ...CHAT_GENERATION_CONFIG,
          systemInstruction: { role: 'system', parts: [{ text: CHAT_SYSTEM_PROMPT }] },
          tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        },
      });
    } catch (e) {
      throw new HttpsError('internal', `Vertex AI call failed: ${e.message || e}`);
    }

    const calls = resp?.functionCalls;
    if (Array.isArray(calls) && calls.length > 0) {
      const { name, args } = calls[0];
      bumpChatMetrics({ tool: name, intent: args?.intent });
      return { type: 'tool_call', name, args: args || {} };
    }

    const text = (resp?.text || '').trim();
    bumpChatMetrics({ answer: true, text });
    return { type: 'answer', text: text || 'ขอโทษครับ ลองถามใหม่อีกครั้งได้ไหมครับ' };
  }
);

// ── Content-free chat metrics (2026-08-04) ───────────────────────────
// Every quality problem this assistant has had was found the same way: a user
// hit it, got annoyed, and reported it. That is a slow and lossy feedback
// loop — plenty of bad answers never get reported at all.
//
// These counters exist to break that loop WITHOUT weakening the standing
// decision that chat is session-only and no transcript is ever stored. What
// goes to Firestore is strictly arithmetic:
//   · how many turns happened
//   · which tool the model picked (and which readiness intent)
//   · whether the reply was a recommendation list or prose
//   · whether the reply said "not found"
// No message text, no user identity, no agent names. `text` is inspected in
// memory only, to set a boolean, and is never written anywhere.
//
// A rising notFound rate, or query_library winning capability questions, is
// exactly the signal that used to be invisible.
function bumpChatMetrics({ tool, intent, answer, text }) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const inc = FieldValue.increment(1);
    const patch = { turns: inc };
    if (tool) {
      patch[`tool_${tool}`] = inc;
      if (intent) patch[`intent_${intent}`] = inc;
    }
    if (answer) {
      const isList = /(^|\n)\s*@@\s*.+\|/.test(text || '');
      patch[isList ? 'answer_list' : 'answer_prose'] = inc;
      // Heuristic, and only ever used as a trend line — not a correctness claim.
      if (/ไม่พบ|ยังไม่มี|ไม่มี Agent|ไม่มี Skill/.test(text || '')) patch.answer_notFound = inc;
    }
    // Fire-and-forget: metrics must never delay or fail a user's answer.
    db.collection('metrics').doc(`chat-${day}`).set(patch, { merge: true })
      .catch((e) => console.warn('chat metrics write failed:', e?.message || e));
  } catch (e) {
    console.warn('chat metrics skipped:', e?.message || e);
  }
}

// ── Semantic index for agents/skills (2026-08-04) ────────────────────
// Why this exists: `capability_search` used to score with character trigrams,
// which is lexical, not semantic. Measured failure — the Thai query "เทสเคส"
// returned ZERO results because the library stores "Testcase" in English, and
// "เขียนเทสเคส" returned 3 wrong hits that matched only on the common verb
// "เขียน" while missing every correct answer. Recall failures like that are
// invisible and cannot be recovered downstream by the LLM, so retrieval itself
// had to change. See memory: project-chat-retrieval-rearchitecture.
//
// Model choice is deliberate and measured: text-multilingual-embedding-002 at
// 256 dims, NOT gemini-embedding-001. The newer model is natively 3072-dim and
// truncating it to 256 collapses score separation — an investment-news skill
// ranked #8 for a test-case query under it, versus #14 under this one.
// Model/dimension/text-shape all live in embedText.js so the function, the
// bootstrap script and the calibration scripts cannot drift apart.
const { EMBED_MODEL, EMBED_DIM, buildEmbedText, contentHash, embedTexts } = require('./embedText');

/**
 * Rebuild the /agentVectors index.
 *
 * Deliberately NOT a Firestore trigger: Eventarc wildcard triggers on this
 * project have a documented history of showing ACTIVE while silently never
 * firing (CLAUDE.md §9). A plain callable invoked after save — plus a manual
 * full rebuild — is boring, observable, and self-healing via the hash check.
 *
 * Request: { agentId?: string, full?: boolean }
 *   - agentId → reindex just that doc (the fire-and-forget path after a save)
 *   - full    → sweep every agent, embed only those whose content hash moved,
 *               and prune vectors whose agent no longer exists
 * Response: { scanned, embedded, skipped, pruned }
 *
 * EVERY agent is indexed regardless of approvalStatus/archived. The chat
 * filters to recommendable entries and the duplicate checker deliberately
 * includes archived ones; doing that filtering here would silently break the
 * latter, so the index stays complete and callers narrow it.
 */
exports.reindexAgentVectors = onCall(
  { cors: true, timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign-in required.');
    }
    const { agentId, full } = request.data || {};

    // A full sweep re-embeds the entire library, so it is both the expensive
    // path and the one worth abusing. Hiding the menu behind `isAdmin` in the
    // UI is presentation, not enforcement — a callable is reachable by any
    // signed-in user who knows its name, so the role is verified HERE too.
    //
    // The single-doc path stays open to any signed-in caller on purpose: it
    // fires automatically after a save, and anyone allowed to save an agent
    // must be able to keep its vector current.
    if (full) {
      const role = (await db.collection('users').doc(request.auth.uid).get()).data()?.role;
      if (role !== 'admin') {
        throw new HttpsError('permission-denied', 'Full reindex is admin-only.');
      }
    }
    if (!agentId && !full) {
      throw new HttpsError('invalid-argument', 'Pass either agentId or full:true.');
    }

    const agents = [];
    if (agentId) {
      const snap = await db.collection('agents').doc(agentId).get();
      if (!snap.exists) {
        // A delete racing the save hook is normal, not an error — drop any
        // stale vector and report it rather than failing the caller.
        await db.collection('agentVectors').doc(agentId).delete().catch(() => {});
        return { scanned: 0, embedded: 0, skipped: 0, pruned: 1 };
      }
      agents.push({ id: snap.id, ...snap.data() });
    } else {
      const snap = await db.collection('agents').get();
      snap.docs.forEach((d) => agents.push({ id: d.id, ...d.data() }));
    }

    // Existing hashes tell us what can be skipped. One read of the whole
    // vector collection is far cheaper than a per-doc get in a 250-doc sweep.
    const existing = new Map();
    const vecSnap = await db.collection('agentVectors').get();
    vecSnap.docs.forEach((d) => existing.set(d.id, d.data()?.hash));

    const pending = [];
    let skipped = 0;
    agents.forEach((a) => {
      const text = buildEmbedText(a);
      if (!text) { skipped++; return; }
      const hash = contentHash(text);
      if (existing.get(a.id) === hash) { skipped++; return; }
      pending.push({ id: a.id, text, hash });
    });

    let embedded = 0;
    if (pending.length) {
      const vectors = await embedTexts(ai, pending.map((p) => p.text), 'RETRIEVAL_DOCUMENT');
      if (vectors.length !== pending.length) {
        throw new HttpsError('internal', `Embedding count mismatch: got ${vectors.length}, expected ${pending.length}`);
      }
      // Firestore caps a batch at 500 writes.
      for (let i = 0; i < pending.length; i += 400) {
        const batch = db.batch();
        pending.slice(i, i + 400).forEach((p, j) => {
          batch.set(db.collection('agentVectors').doc(p.id), {
            v: vectors[i + j],
            hash: p.hash,
            model: EMBED_MODEL,
            dim: EMBED_DIM,
            updatedAt: new Date().toISOString(),
          });
        });
        await batch.commit();
        embedded += Math.min(400, pending.length - i);
      }
    }

    // Prune only on a full sweep — during a single-doc reindex we have no idea
    // which other agents still exist, so pruning there would delete the index.
    let pruned = 0;
    if (full) {
      const live = new Set(agents.map((a) => a.id));
      const dead = [...existing.keys()].filter((id) => !live.has(id));
      for (let i = 0; i < dead.length; i += 400) {
        const batch = db.batch();
        dead.slice(i, i + 400).forEach((id) => batch.delete(db.collection('agentVectors').doc(id)));
        await batch.commit();
      }
      pruned = dead.length;
    }

    return { scanned: agents.length, embedded, skipped, pruned };
  }
);

/**
 * Embed a free-text lookup (a chat question, or a Pre-Registration draft) so
 * the client can cosine it against the vectors it already holds.
 *
 * The client cannot call Vertex directly (no credentials in the browser, and
 * it must not have any), so this thin callable is the only way the client-side
 * tool loop keeps working. Keeping similarity math on the client is what lets
 * ALL business logic — tier, readiness, archive scoping — stay in skills.js
 * instead of being duplicated server-side, which is exactly the drift that
 * made normalizeProgress a standing rule in CLAUDE.md.
 *
 * Request:  { text: string }
 * Response: { v: number[], dim, model }
 */
// ── Rate limiting (2026-08-04) ────────────────────────────────────────
// embedQuery has no privilege gap (every signed-in user legitimately needs it
// — chat and the Pre-Registration duplicate check both call it for normal,
// intended use) but it DOES have no cost ceiling: each call is a live Vertex
// AI request, and a callable is reachable by anyone who knows its name, not
// just through the UI's own call sites.
//
// Calibrated against real usage, not guessed: chat calls this at most once per
// tool call within a turn, and duplicate-check calls it once per button click
// — a handful of calls per minute even for someone rapidly iterating. 20/min
// covers that with slack for a burst (e.g. quickly re-running a check a few
// times) while still cutting a scripted loop off within seconds instead of
// letting it run indefinitely.
//
// Fixed 60s window, keyed per uid+fn so one function's limit can never starve
// another. Fails OPEN on any Firestore error — a rate-limit outage must never
// be the reason a legitimate search breaks.
const RATE_LIMIT_WINDOW_MS = 60_000;
// recordAgentEvent is generous — it fires on ordinary browsing (opening a
// detail modal, clicking through search results), so the cap is a runaway
// guard, not a usage budget. submitRating is tight: a human rates a handful of
// things in a sitting, and the per-user-per-agent doc already caps the useful
// rate at 1 per agent.
// attachEndpointFile is deliberately mean: it is admin/staff/approver only,
// each call carries up to 5 MB, and nobody legitimately attaches files in bulk.
// getEndpointFile is the download path — a user may reasonably grab several
// skills in a row, but not hundreds.
// markAgentReady fires once per agent going live, plus one per paired
// sub-skill in the client-side cascade — the largest real parent has 7
// children, so 30/min leaves generous headroom over any legitimate burst.
// decideRenameRequest is a deliberate human approval action; nobody decides
// renames in bulk.
const RATE_LIMITS = {
  embedQuery: 20, recordAgentEvent: 120, submitRating: 20,
  attachEndpointFile: 10, getEndpointFile: 60,
  markAgentReady: 30, decideRenameRequest: 20,
};

async function enforceRateLimit(uid, fnName) {
  const max = RATE_LIMITS[fnName];
  if (!max) return;
  const windowStart = Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS);
  const ref = db.collection('rateLimits').doc(`${fnName}_${uid}_${windowStart}`);
  try {
    const count = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const next = (snap.data()?.count || 0) + 1;
      tx.set(ref, {
        count: next,
        // Bookkeeping only, read by nothing — lets a Firestore TTL policy on
        // this field garbage-collect old windows if one is ever configured;
        // harmless if not.
        expireAt: new Date(Date.now() + RATE_LIMIT_WINDOW_MS * 2),
      }, { merge: true });
      return next;
    });
    if (count > max) {
      throw new HttpsError('resource-exhausted', `Rate limit exceeded: max ${max} requests per ${RATE_LIMIT_WINDOW_MS / 1000}s.`);
    }
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    console.warn('rate limit check failed, allowing request:', e?.message || e);
  }
}

exports.embedQuery = onCall(
  { cors: true, timeoutSeconds: 30 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign-in required.');
    }
    await enforceRateLimit(request.auth.uid, 'embedQuery');
    const text = String(request.data?.text || '').trim().slice(0, 4000);
    if (!text) {
      throw new HttpsError('invalid-argument', 'text is required.');
    }
    const [v] = await embedTexts(ai, [text], 'RETRIEVAL_QUERY');
    if (!v) {
      throw new HttpsError('internal', 'Embedding failed.');
    }
    return { v, dim: EMBED_DIM, model: EMBED_MODEL };
  }
);

// ── Feedback & Rating + usage statistics (2026-08-18) ────────────────
// Both callables below write via the admin SDK, which is the entire point:
// /agentStats, /agentRatings and /agentEvents are `write: if false` in
// firestore.rules, so a client cannot forge a counter or a score. Rules can
// force an increment to be exactly +1 but cannot stop a loop calling it, so
// the codebase's existing answer (/metrics, bumpChatMetrics) is to remove the
// client write path entirely — these follow that.

const EVENT_KINDS = new Set(['detail', 'endpoint', 'search']);
// Counter field on /agentStats/{agentId} per event kind.
const EVENT_FIELD = { detail: 'detailOpens', endpoint: 'endpointClicks', search: 'searchHits' };
const COMMENT_MAX = 1000;
// Keep the public review list bounded — it is read on every detail-modal open.
const REVIEWS_PAGE = 50;

// Bangkok has no DST, so a fixed +7h offset is exact and permanent — no
// Intl/timeZone dependency needed. Reading UTC-getters off the shifted Date
// yields Bangkok wall-clock date parts regardless of the server's own TZ.
// (2026-08-19: added after discovering `new Date().toISOString()` — used
// everywhere date-keys were needed before this — is pure UTC, so the old
// "daily" reset actually landed at 07:00 Bangkok, not midnight. Nobody had
// noticed; fixed here rather than carried into the new weekly logic below.)
function bangkokParts(date = new Date()) {
  const b = new Date(date.getTime() + 7 * 3600 * 1000);
  return { y: b.getUTCFullYear(), m: b.getUTCMonth(), d: b.getUTCDate(), dow: b.getUTCDay() };
}
function bangkokDayKey(date = new Date()) {
  const { y, m, d } = bangkokParts(date);
  return new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
}
// Key = the date of the Sunday that starts this Bangkok-local week (Sun 00:00
// – Sat 23:59). `d - dow` rolling negative (week's Sunday falls in the
// previous month) is normalised for free by Date.UTC.
function bangkokWeekKey(date = new Date()) {
  const { y, m, d, dow } = bangkokParts(date);
  return new Date(Date.UTC(y, m, d - dow)).toISOString().slice(0, 10);
}

/**
 * Record one usage event for an agent.
 *
 * De-duplicated per user, per agent, per kind — but the bucket size differs
 * by kind (2026-08-19, tightened from a flat "per day" for all three):
 *   - `detail` (view) and `endpoint` (use): per Bangkok-local WEEK
 *     (Sun 00:00 – Sat 23:59). Someone opening the same agent five times on
 *     a Tuesday and twice more on Thursday is one interested person, not
 *     seven — daily buckets were inflating that into up to 7x.
 *   - `search`: stays per Bangkok-local DAY (unchanged cadence, just the
 *     Bangkok-correct boundary now instead of the old UTC one, since the
 *     helper was written anyway).
 * Either way this is what makes the number meaningful as well as
 * un-inflatable: "12 people opened this this week" survives being put in
 * front of an executive, "12 clicks" does not. The marker doc mirrors the
 * /rateLimits doc-id-encoding convention.
 *
 * Callers treat this as fire-and-forget — see the client hooks. Telemetry must
 * never delay or break a UI action, same posture as bumpChatMetrics.
 */
exports.recordAgentEvent = onCall(
  { cors: true, timeoutSeconds: 15 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign-in required.');
    const uid = request.auth.uid;
    await enforceRateLimit(uid, 'recordAgentEvent');

    const agentId = String(request.data?.agentId || '').trim();
    const kind = String(request.data?.kind || '').trim();
    if (!agentId) throw new HttpsError('invalid-argument', 'agentId is required.');
    if (!EVENT_KINDS.has(kind)) throw new HttpsError('invalid-argument', `kind must be one of ${[...EVENT_KINDS].join('|')}.`);

    const period = kind === 'search' ? bangkokDayKey() : bangkokWeekKey();
    const markerRef = db.collection('agentEvents').doc(`${agentId}__${uid}__${period}__${kind}`);
    const statsRef = db.collection('agentStats').doc(agentId);

    // create() throws ALREADY_EXISTS if this user already triggered this kind
    // for this agent in this period — that rejection IS the dedup, no read
    // needed. Old marker docs (pre-2026-08-19) used a `day` field and a
    // day-keyed doc ID; this doc ID scheme differs for detail/endpoint now,
    // so there's no collision risk — old docs simply sit inert.
    try {
      await markerRef.create({
        agentId, uid, kind, period,
        createdAt: FieldValue.serverTimestamp(),
        // For a future TTL policy, same as /rateLimits. Nothing reads it today.
        expireAt: new Date(Date.now() + 90 * 864e5),
      });
    } catch (e) {
      if (e?.code === 6 || /already exists/i.test(e?.message || '')) return { counted: false, reason: 'duplicate' };
      throw e;
    }

    await statsRef.set({
      [EVENT_FIELD[kind]]: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { counted: true };
  }
);

/**
 * Create or update the caller's rating (1-5) + optional comment for an agent.
 *
 * Three things are enforced here rather than in rules:
 *   1. The owner/creator of an agent may not rate it. Rules could do a get()
 *      on the agent doc, but the ownership test is an EMAIL match against
 *      creatorEmails (plus the owner team string) — the same rule
 *      isMyAgent/canUpdateProgress already use client-side — and expressing
 *      that in rules would duplicate logic that must not drift.
 *   2. One rating per user per agent, by construction: the doc id is
 *      {agentId}__{uid}, so a second submit updates rather than stacks.
 *   3. The histogram on /agentStats moves by a DELTA (remove old bucket, add
 *      new) so changing a rating cannot inflate ratingCount.
 *
 * The identified row lives in /agentRatings (author + admin readable) while a
 * uid-free copy goes to /agentStats/{id}/reviews for peers. The split is what
 * makes "anonymous" true at the data layer instead of a UI convention.
 */
exports.submitRating = onCall(
  { cors: true, timeoutSeconds: 20 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign-in required.');
    const uid = request.auth.uid;
    const email = String(request.auth.token?.email || '').toLowerCase();
    await enforceRateLimit(uid, 'submitRating');

    const agentId = String(request.data?.agentId || '').trim();
    const rating = Number(request.data?.rating);
    const comment = String(request.data?.comment || '').trim().slice(0, COMMENT_MAX);
    if (!agentId) throw new HttpsError('invalid-argument', 'agentId is required.');
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new HttpsError('invalid-argument', 'rating must be an integer 1-5.');
    }

    const agentSnap = await db.collection('agents').doc(agentId).get();
    if (!agentSnap.exists) throw new HttpsError('not-found', 'Agent not found.');
    const agent = agentSnap.data();
    if (agent.approvalStatus !== 'approved' || agent.archived === true) {
      throw new HttpsError('failed-precondition', 'Only an active agent can be rated.');
    }

    // Self-rating guard. Digital Experience Team alone owns ~35% of the
    // library, so without this a public score would mostly measure how
    // enthusiastically each team rates itself.
    const creatorEmails = Array.isArray(agent.creatorEmails) ? agent.creatorEmails : [];
    const isCreator = !!email && creatorEmails.some((e) => String(e || '').toLowerCase() === email);
    if (isCreator || agent.createdBy === uid) {
      throw new HttpsError('permission-denied', 'ให้คะแนน Agent/Skill ของตัวเองไม่ได้');
    }

    const ratingRef = db.collection('agentRatings').doc(`${agentId}__${uid}`);
    const statsRef = db.collection('agentStats').doc(agentId);

    // Transaction, not a batch: the histogram delta depends on the PREVIOUS
    // rating, so read and write must be atomic or two concurrent submits from
    // the same user could both see "no previous rating" and each add +1 to
    // ratingCount. Same runTransaction idiom as enforceRateLimit above.
    const freshReviewId = statsRef.collection('reviews').doc().id;
    const updated = await db.runTransaction(async (tx) => {
      const prev = await tx.get(ratingRef);
      const prevRating = prev.exists ? Number(prev.data()?.rating) : null;
      const reviewId = (prev.exists && prev.data()?.reviewId) || freshReviewId;

      const patch = { updatedAt: FieldValue.serverTimestamp() };
      if (prevRating !== rating) {
        patch[`r${rating}`] = FieldValue.increment(1);
        if (prevRating >= 1 && prevRating <= 5) {
          // Moving between buckets — the total is unchanged, so ratingCount
          // must NOT move or changing your mind would inflate it.
          patch[`r${prevRating}`] = FieldValue.increment(-1);
        } else {
          patch.ratingCount = FieldValue.increment(1);   // brand-new rater only
        }
      }

      tx.set(ratingRef, {
        agentId, uid, rating, comment, reviewId,
        ...(prev.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      // The peer-visible copy — note there is no uid in this payload.
      tx.set(statsRef.collection('reviews').doc(reviewId), {
        rating, comment,
        ...(prev.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      tx.set(statsRef, patch, { merge: true });
      return prev.exists;
    });

    return { ok: true, updated };
  }
);

// ── Endpoint file attachments + SSO-gated download (2026-08-18) ──────────
//
// WHY THESE EXIST AT ALL. Skill files used to be static objects on Firebase
// Hosting under /skills/*. Measured before writing a line of this:
//
//     curl https://wolfy-ai-library.web.app/skills/duplicate-check.zip
//     → HTTP 200 · 4,879 bytes · no cookie, no token, no VPN
//
// Hosting is a CDN with no auth layer, so "files from our site require login"
// cannot be built there — it has to move behind something that can read a
// Firebase Auth token. That is these two callables.
//
// WHY THE CLIENT NEVER TOUCHES CLOUD STORAGE. Same posture as /metrics and
// /agentStats: remove the client write path entirely rather than try to
// constrain it. It also buys a lot of setup we simply never have to do —
// no Firebase Storage product enablement, no storage.rules to publish (and
// therefore none to accidentally overwrite for the Portfolio app sharing this
// GCP project), no CORS configuration, and no signed-URL IAM grant. The bucket
// stays private with no public object, no download token, and no ACL.
//
// Bytes travel as base64 through the callable. That is affordable here because
// the files are small — the largest thing in the library is a 728 KB folder and
// the existing skill zips are ~5 KB — and it keeps the whole feature inside one
// already-working transport. If files ever get big, swap in a V4 signed URL
// minted by these same functions; no client change is needed for that.

// The authorisation and file-shape rules live in their own module so
// verify-endpoint-files.cjs can test the real thing rather than a copy — the
// same split, for the same reason, as embedText.js and chatPrompt.js.
const {
  safeName, isOrgEmail, checkUploadPermission, checkUploadFile,
} = require('./endpointFileRules');
const {
  checkAgentActor, checkMarkReady, checkRenameDecider, checkRenameValue,
} = require('./agentReadyRules');

const BUCKET = 'wolfy-481609.appspot.com';
const ENDPOINT_FILE_PREFIX = 'endpointFiles';

// Origins that serve this SPA. The client sends its own origin so a preview
// channel builds a working link, but it is NEVER trusted verbatim — an
// unrecognised origin falls back to canonical. Storing a client-supplied
// origin would let a caller point an agent's endpoint at any site they like.
const LIBRARY_ORIGINS = new Set([
  'https://wolfy-ai-library.web.app',
  'https://wolfy-481609.web.app',
  'https://wolfy-ai-library.firebaseapp.com',
  'https://wolfy-481609.firebaseapp.com',
]);
const CANONICAL_ORIGIN = 'https://wolfy-ai-library.web.app';

// Auth already restricts sign-in to the org's Workspace domains, but the
// download callable IS the SSO gate, so it re-checks rather than inheriting an
// assumption made elsewhere.
function assertOrgEmail(request) {
  if (!isOrgEmail(request.auth?.token?.email)) {
    throw new HttpsError('permission-denied', 'Organisation account required.');
  }
}

/** Turn a rule-module refusal into the callable's error. */
function raise(refusal) {
  if (refusal) throw new HttpsError(refusal.code, refusal.message);
}

/**
 * Attach a file to an agent's endpoint.
 *
 * Eligibility is `deploymentStatus === 'approved'`. Worth recording why the
 * other two conditions originally asked for were dropped: all 26 agents in
 * that state are ALREADY at devProgress 100 (checked against live data), and
 * "deploy approved" implies "deploy requested" — so the extra clauses filtered
 * exactly nothing and would only have been a second place to drift.
 *
 * Area scoping uses the agent's STORED `approveArea`. It deliberately does not
 * call agentApproveAreas(): that resolver lives in src/lib/approveAreas.js,
 * which is not part of the deployed function bundle, and copying its tables
 * here is explicitly forbidden (CLAUDE.md §20 — the same anti-drift rule as
 * normalizeProgress). The stored field is layer 1 of that resolver and wins
 * over every other layer anyway, and all 26 eligible agents carry one, so the
 * two agree today. If an agent somehow has no stored area, this degrades to
 * admin-only rather than guessing — a safe direction to fail in.
 */
exports.attachEndpointFile = onCall(
  { cors: true, timeoutSeconds: 60, memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign-in required.');
    assertOrgEmail(request);
    const uid = request.auth.uid;
    await enforceRateLimit(uid, 'attachEndpointFile');

    const { agentId, filename, contentType, dataBase64, origin } = request.data || {};
    if (!agentId || typeof agentId !== 'string') {
      throw new HttpsError('invalid-argument', 'agentId is required.');
    }
    if (!dataBase64 || typeof dataBase64 !== 'string') {
      throw new HttpsError('invalid-argument', 'File payload is required.');
    }

    // The UI hides this behind a role check; a callable is reachable by any
    // signed-in user who knows its name, so the role is verified HERE too —
    // same reasoning as the full-reindex guard above.
    const userDoc = (await db.collection('users').doc(uid).get()).data() || {};
    const agentRef = db.collection('agents').doc(agentId);
    const agentSnap = await agentRef.get();
    if (!agentSnap.exists) throw new HttpsError('not-found', 'Agent not found.');
    const agent = agentSnap.data() || {};

    raise(checkUploadPermission({
      agent,
      role: userDoc.role,
      userEmail: request.auth.token?.email,
      userUid: uid,
      userApproveAreas: userDoc.approveAreas,
    }));

    const buf = Buffer.from(dataBase64, 'base64');
    raise(checkUploadFile({ filename, buf }));

    const name = safeName(filename);
    const storagePath = `${ENDPOINT_FILE_PREFIX}/${agentId}/${name}`;
    const bucket = getStorage(adminApp).bucket(BUCKET);
    await bucket.file(storagePath).save(buf, {
      contentType: contentType || 'application/octet-stream',
      resumable: false,
      // No public ACL and no download token: the ONLY way to these bytes is
      // getEndpointFile, which checks the caller's auth token.
      metadata: { cacheControl: 'private, max-age=0', metadata: { agentId, uploadedBy: uid } },
    });

    // A re-upload under a different filename would otherwise orphan the old
    // object in the bucket forever.
    const prevPath = agent.endpointFile?.storagePath;
    if (prevPath && prevPath !== storagePath) {
      await bucket.file(prevPath).delete().catch(() => {});
    }

    const base = LIBRARY_ORIGINS.has(String(origin || '')) ? origin : CANONICAL_ORIGIN;
    const endpoint = `${base}/f/${encodeURIComponent(agentId)}`;
    const replacedEndpoint = String(agent.endpoint || '').trim();

    await agentRef.update({
      endpoint,
      endpointFile: {
        name,
        size: buf.length,
        contentType: contentType || 'application/octet-stream',
        storagePath,
        uploadedAt: FieldValue.serverTimestamp(),
        uploadedBy: uid,
      },
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { ok: true, endpoint, replacedEndpoint, name, size: buf.length };
  },
);

/**
 * Serve an attached file to a signed-in org user.
 *
 * THIS FUNCTION IS THE SSO GATE. The /f/{agentId} URL stored in `endpoint`
 * resolves to the SPA (Hosting rewrites ** to index.html), the SPA forces
 * Google sign-in before it renders, and only then does it get here. So the
 * link can be pasted into a chat and still cannot leak the bytes — which is
 * exactly what the old static /skills/*.zip URLs could not promise.
 */
exports.getEndpointFile = onCall(
  { cors: true, timeoutSeconds: 60, memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign-in required.');
    assertOrgEmail(request);
    await enforceRateLimit(request.auth.uid, 'getEndpointFile');

    const { agentId } = request.data || {};
    if (!agentId || typeof agentId !== 'string') {
      throw new HttpsError('invalid-argument', 'agentId is required.');
    }

    const snap = await db.collection('agents').doc(agentId).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Agent not found.');
    const file = snap.data()?.endpointFile;
    if (!file?.storagePath) throw new HttpsError('not-found', 'No file is attached to this agent.');

    const [buf] = await getStorage(adminApp).bucket(BUCKET).file(file.storagePath).download();
    return {
      name: file.name || 'download',
      contentType: file.contentType || 'application/octet-stream',
      size: buf.length,
      dataBase64: buf.toString('base64'),
    };
  },
);

// ── Ready-to-Use gate + rename approval (2026-08-19) ─────────────────
//
// WHY THESE ARE CLOUD FUNCTIONS AND NOT RULES. Both need to answer "is this
// user the approver/staff FOR THIS AGENT'S AREA", and security rules cannot
// evaluate agentApproveAreas() (a 7-layer resolver in src/lib). Rename has two
// further reasons: rules freeze `agentName` entirely once deploymentStatus is
// requested/approved (only admin can rename today, which is exactly the
// limitation being lifted), and approving a rename must rewrite the children's
// `matchingAgent` in the same batch — see decideRenameRequest for why that is
// not optional.

/** Read the caller's /users doc once; both callables need role + areas. */
async function actorContext(request) {
  const uid = request.auth.uid;
  const userDoc = (await db.collection('users').doc(uid).get()).data() || {};
  return {
    uid,
    role: userDoc.role,
    userEmail: request.auth.token?.email,
    userUid: uid,
    userApproveAreas: userDoc.approveAreas,
  };
}

/**
 * Flip one agent to 100% (Ready to Use).
 *
 * Enforces the gate the feature exists for: an agent cannot be declared ready
 * with no way to actually reach it — it must end up with an endpoint URL or an
 * uploaded file. Also fills in `launchDate` when the agent has none, using the
 * moment of this transition, which is a real observed event rather than a
 * guess.
 *
 * Sub-skill cascade is deliberately NOT done here. The client calls this once
 * per `pairedSubSkills()` entry instead, so the one correct pairing helper
 * (src/lib/agentUtils.js — name + submitter matching) stays the only
 * implementation rather than being re-derived server-side where it would drift
 * (CLAUDE.md §20). Every cascaded write is then independently authorised, and
 * atomicity is unchanged from the loop this replaces.
 */
exports.markAgentReady = onCall(
  { cors: true, timeoutSeconds: 30 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign-in required.');
    if (!isOrgEmail(request.auth.token?.email)) {
      throw new HttpsError('permission-denied', 'Organisation account required.');
    }
    await enforceRateLimit(request.auth.uid, 'markAgentReady');

    const { agentId, endpointUrl, launchDate } = request.data || {};
    if (!agentId || typeof agentId !== 'string') {
      throw new HttpsError('invalid-argument', 'agentId is required.');
    }

    const actor = await actorContext(request);
    const agentRef = db.collection('agents').doc(agentId);
    const agentSnap = await agentRef.get();
    if (!agentSnap.exists) throw new HttpsError('not-found', 'Agent not found.');
    const agent = agentSnap.data() || {};

    raise(checkAgentActor({ agent, ...actor }));
    const ready = checkMarkReady({ agent, endpointUrl });
    raise(ready.code ? ready : null);

    let launch = agent.launchDate || null;
    if (launchDate) {
      const d = new Date(launchDate);
      if (isNaN(d.getTime())) throw new HttpsError('invalid-argument', 'launchDate is not a valid date.');
      launch = d;
    } else if (!launch) {
      // Requirement 4: no launch date given and none stored -> the moment it
      // went live. This is a real observed event, so it is NOT flagged with
      // launchDateEstimated — that marker is reserved for the one-off backfill
      // of pre-existing rows, where the date genuinely is a guess.
      launch = FieldValue.serverTimestamp();
    }

    await agentRef.update({
      devProgress: 100,
      // Literal rather than importing developmentPhaseLabel() from src/lib
      // (not in the function bundle): this callable only ever writes 100, and
      // phaseForProgress(100) is 'ru' whose label is exactly this string.
      developmentPhase: 'Ready to Use',
      ...(ready.endpoint ? { endpoint: ready.endpoint } : {}),
      launchDate: launch,
      readyMarkedBy: actor.uid,
      readyMarkedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { ok: true, endpoint: ready.endpoint || '', launchWasAutoSet: !agent.launchDate && !launchDate };
  },
);

/**
 * Approve or reject a pending rename request.
 *
 * ⚠️ THE CHILD REWRITE IS THE WHOLE POINT OF THE BATCH.
 * `pairedSubSkills()` matches parents by NAME, and sub-skills store the
 * parent's name in `matchingAgent`. Measured on live data: 20 agents have
 * paired sub-skills and 51 agents are sub-skills (VA Agent has 7, Guardrail
 * Agent 6). Renaming a parent without rewriting its children detaches all of
 * them at once and silently breaks the progress cascade, the deploy-request
 * and deploy-decision cascades, the approval-queue de-duplication, and the
 * sub-skill progress lock. A half-applied rename is precisely that bug, so
 * name + children + decision stamp all land in one db.batch().
 *
 * The child match here is intentionally narrow and literal — same
 * `matchingAgent` string, same submitter — rather than a port of
 * pairedSubSkills(). It only has to find the docs that literally store the old
 * name, which is exactly what needs updating.
 */
exports.decideRenameRequest = onCall(
  { cors: true, timeoutSeconds: 30 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign-in required.');
    if (!isOrgEmail(request.auth.token?.email)) {
      throw new HttpsError('permission-denied', 'Organisation account required.');
    }
    await enforceRateLimit(request.auth.uid, 'decideRenameRequest');

    const { requestId, verdict } = request.data || {};
    if (!requestId || typeof requestId !== 'string') {
      throw new HttpsError('invalid-argument', 'requestId is required.');
    }
    if (verdict !== 'approved' && verdict !== 'rejected') {
      throw new HttpsError('invalid-argument', 'verdict must be approved or rejected.');
    }

    const actor = await actorContext(request);
    const reqRef = db.collection('renameRequests').doc(requestId);
    const reqSnap = await reqRef.get();
    if (!reqSnap.exists) throw new HttpsError('not-found', 'Rename request not found.');
    const req = reqSnap.data() || {};
    if (req.status !== 'pending') {
      throw new HttpsError('failed-precondition', 'This request has already been decided.');
    }

    const agentRef = db.collection('agents').doc(req.agentId);
    const agentSnap = await agentRef.get();
    if (!agentSnap.exists) throw new HttpsError('not-found', 'Agent not found.');
    const agent = agentSnap.data() || {};

    raise(checkRenameDecider({ agent, role: actor.role, userApproveAreas: actor.userApproveAreas }));

    const stamp = {
      status: verdict,
      decidedBy: actor.uid,
      decidedAt: FieldValue.serverTimestamp(),
    };

    if (verdict === 'rejected') {
      await reqRef.update(stamp);
      return { ok: true, verdict, childrenUpdated: 0 };
    }

    raise(checkRenameValue({ agent, requestedName: req.requestedName }));

    const oldName = String(agent.agentName || '').trim();
    const newName = String(req.requestedName || '').trim();

    // Children are found by the name they literally store. `matchingAgent` is
    // a string on every doc that has one (59 library-wide), so an equality
    // query finds them directly; the submitter check then mirrors
    // sameSubmitter()'s intent so an unrelated agent that merely happens to
    // reference the same name is not swept up.
    const childSnap = await db.collection('agents').where('matchingAgent', '==', oldName).get();
    const children = childSnap.docs.filter((d) => {
      const c = d.data();
      if (agent.createdBy && c.createdBy && c.createdBy === agent.createdBy) return true;
      const ca = String(c.creator || '').trim().toLowerCase();
      const cb = String(agent.creator || '').trim().toLowerCase();
      return !!ca && ca === cb;
    });

    const batch = db.batch();
    batch.update(agentRef, { agentName: newName, updatedAt: FieldValue.serverTimestamp() });
    children.forEach((d) => {
      batch.update(d.ref, { matchingAgent: newName, updatedAt: FieldValue.serverTimestamp() });
    });
    batch.update(reqRef, { ...stamp, appliedName: newName, childrenUpdated: children.length });
    await batch.commit();

    return { ok: true, verdict, childrenUpdated: children.length };
  },
);
