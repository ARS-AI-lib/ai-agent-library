// Prompt for analyzeDuplicate (moved out of index.js 2026-09-29 so the eval
// script exercises the real shipped prompt — same reasoning as chatPrompt.js).
function buildPrompt(draft, candidates, connectionCandidates, coreAbilityOptions, categoryOptions, approveAreaOptions, teamContext = null) {
  const candidatesShort = candidates.slice(0, 15).map((c, i) => ({
    i,
    agentName: c.agentName,
    description: (c.description || '').slice(0, 400),
    coreAbility: c.coreAbility,
    useCase: c.useCase,
    reusable: c.reusable || '(ไม่ระบุ)',
    reuseCondition: (c.reuseCondition || '').slice(0, 200),
    ruleConfidence: c.ruleConfidence,
    // How the library already files this item (2026-09-29) — lets the model
    // see the team and placement of similar items instead of deciding blind.
    owner: c.owner || '',
    approveArea: Array.isArray(c.approveArea) ? c.approveArea : [],
    category: Array.isArray(c.category) ? c.category : [],
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

เรื่องทีม (Team): candidate แต่ละตัวมี owner ติดมา ถ้า owner ตรงกับทีมของ Draft และมีงานย่อยทับกัน
ให้ถือเป็นสัญญาณแรงว่า Draft อาจเป็น "เวอร์ชันใหม่/ลงทะเบียนซ้ำ" ของงานทีมตัวเอง — ระบุใน reason
แต่ห้ามเพิ่ม confidence เพียงเพราะเป็นทีมเดียวกันถ้าไม่มีงานย่อยทับกันจริง

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
   DISCIPLINE ใช้หลักเดียวกับ Approve Area: ถ้า Team context มี dominantCategory และ Draft เป็นงาน
   แนวเดียวกับพี่น้อง ให้ใช้ค่านั้น แหกได้เมื่อเนื้องานต่างชัดเจนพร้อมเหตุผลใน category_reason
   (PRODUCT ไม่ใช้ Team context — ต้องมีหลักฐานในตัว Draft เท่านั้น ตามกฎด้านล่าง)
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
   ⭐ ใช้ "Team context" ด้านล่างเป็นค่าเริ่มต้น: ถ้าทีมของ Draft มี dominantArea และ Draft เป็นงาน
   แนวเดียวกับพี่น้องในทีม (เช่น เป็นขั้นหนึ่งใน pipeline เดียวกัน) ให้ใช้ dominantArea นั้น
   เพื่อให้ approver คนเดียวดูแลงานทั้งชุด — แหกจากทีมได้ก็ต่อเมื่อ "เนื้องาน" ของ Draft ต่างจาก
   พี่น้องชัดเจน (เช่น ทีมสินเชื่อทำ security scanner) และต้องเขียนเหตุผลใน approve_area_reason
   ถ้าไม่มี Team context หรือ dominantArea เป็น null ให้เลือกจากเนื้องานตามปกติ
   approve_area_reason: 1 ประโยคภาษาไทย บอกว่าเลือกเพราะอะไร (ตามทีม / ต่างจากทีมเพราะ ...)
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
  "approve_area_reason": "...",
  "category_reason": "..." (string ว่างได้ถ้าตามทีม),
  "overall_risk": "high" | "medium" | "low",
  "summary": "..."
}

ในผลลัพธ์ candidates ให้เรียงจาก confidence ของคุณมากไปน้อย และตัด candidate ที่ verdict=unrelated
และ confidence < 25 ออก เพื่อให้เหลือเฉพาะที่มีนัยสำคัญ

Draft ใหม่:
${JSON.stringify(draft, null, 2)}

Candidates สำหรับตรวจความซ้ำ (ruleConfidence = แค่คะแนนเทียบคำ เชื่อถือไม่ได้):
${JSON.stringify(candidatesShort, null, 2)}

Team context (ทีมของ Draft จัดของที่มีอยู่แล้วไว้อย่างไร — null = ไม่ทราบทีม/ทีมใหม่):
${JSON.stringify(teamContext, null, 2)}

Connection candidates สำหรับ integration_suggestions (คำนวณจาก Output↔Input + SDLC step + tool + team):
${JSON.stringify(connShort, null, 2)}`;
}

module.exports = { buildPrompt };
