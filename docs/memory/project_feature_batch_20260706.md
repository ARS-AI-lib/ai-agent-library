---
name: project_feature_batch_20260706
description: "Locked spec for 5-feature batch (Ask ALPHA size, chat expansion, chat resize, staff role, custom related-role) grilled 2026-07-06"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5b7ada72-a449-4ebc-b37a-4269b922e007
---

Grilled & locked 2026-07-06. Five features to build after the SDLC Timeline work:

1. **Ask ALPHA button** — ลดขนาดปุ่ม + font ให้เล็กลง (cosmetic, `ChatAssistant.jsx`/`.css`).

2. **Chat expansion (integration/tech-stack Q&A)** — ALPHA ตอบเรื่อง expansion ได้ โดย:
   - "ต่อกับ agent ตัวไหน / จุดไหน" → reuse connection logic เดิม (`integration_suggestions` / `connection_suggest` จาก pre-reg Cloud Function `analyzeDuplicate`), grounded กับ agent data จริง
   - "วิธี/tech stack" → LLM เสริมได้ **เฉพาะ best-practice ทั่วไป** (REST API, webhook, message queue, shared DB, MCP ฯลฯ) เท่านั้น
   - **ห้ามเด็ดขาด**: กุ endpoint/API/โครงสร้างภายในของ agent ตัวใดตัวหนึ่งที่ระบบไม่มีข้อมูล; ต้องอิง connection data จริงเมื่อพูดถึง agent เจาะจง; ระวัง security (ห้ามแนะวิธี bypass auth/leak internal)

3. **Chat resize** — drag ปรับ **ความกว้างอย่างเดียว** (ไม่ปรับสูง). Default plan: persist localStorage, drag ที่ขอบซ้าย, min ~340px max ~640px.

4. **เพิ่ม role 'staff'** — export All Data ได้ **ทุกสถานะ (Approved+Pending+Rejected)** เหมือน admin/committee. กระทบน้อย: แก้ `isKnownUser()` ใน firestore.rules + `showAll` gate ใน `ExportDataModal.jsx` + `ROLES` array ใน `UserManagementModal.jsx`. staff ไม่ได้สิทธิ์ approve/edit/user-mgmt อัตโนมัติ (gate ด้วย role list ที่ไม่รวม staff). **หมายเหตุ**: staff จะเห็น pending ที่ปกติ scope ตาม area ใน UI — user ยอมรับแล้ว (เลือกทุกสถานะเอง). "export all data" เป็น UI gate ล้วน ไม่ใช่ security boundary (read rule เปิดให้ known user อ่าน agent ทั้งหมดอยู่แล้ว).

5. **Custom related role** — เปลี่ยน `MultiSelect` → combobox tag-input ที่ auto-complete + พิมพ์เพิ่ม role ใหม่เองได้ (ทั้ง `PreRegModal` + `EditAgentModal`). ปัจจุบัน relatedRole **เป็น multi-select อยู่แล้ว** และ option ถูก derive จาก relatedRole ของ agent จริง (ไม่ได้อยู่ใน /config/schema). requirement เพิ่ม:
   - persist role ใหม่เข้า list กลาง**ทันที**
   - ถ้า user ใช้ `,` หรือ `/` คั่น → แยกเก็บคนละ option
   - dedupe: ถ้า role ซ้ำที่มีอยู่แล้วไม่ต้องเก็บเพิ่ม
   - **ข้อจำกัดที่ต้อง flag**: `/config/{id}` write = admin-only ใน rules ปัจจุบัน → regular user เพิ่ม role เข้า /config/schema ตรง ๆ ไม่ได้. ทางเลือก: (a) derive option list จาก agent data ทั้งหมดที่ client อ่านได้ (รวม pending) แทน — "list กลาง" ได้ฟรีไม่ต้องแก้ rules, หรือ (b) เพิ่ม scoped rule ให้ known user arrayUnion เข้า relatedRole เท่านั้น. ต้องคุยก่อน implement.

## Second grill 2026-07-06 (legend + submit analysis)

6. **Status legend overhaul** — retired the "Not Start" bucket everywhere:
   - Progress bucket (`ST_DEF`/`status.js`): 0-10% now = **To Do** (was: 0%=Not Start, 1-10%=To Do). To Do took the old Not-Start grey (#6b7280/#9ca3af); Pilot took the old To-Do blue (#3d5a8e/#4a6fa5); the olive Pilot (#8ea82a) is **retired**. `ST_ORDER` = ['td','ip','pilot','ru']. Propagates to StatusLegend, AgentCard, all cards (they read ST_DEF), skills.js (derives labels), `.aproc` cards in SDLCTab.css (hardcoded — updated to match).
   - Timeline (`TL_ST`/`timeline.js`): **keep** forecast (Done/Pilot/On track/At risk/Delayed) — just removed `notstart` (0%-progress items now forecast on-track/at-risk/delayed by launch date) and recolored Pilot olive→blue. `timelineStatus()` notstart returns folded into ontime/delay. TimelinePage `order` array dropped notstart.
   - ⚠️ Known cosmetic: timeline now has TWO blues (On-track bright #2f6bff, Pilot muted #3d5a8e) — user chose "keep forecast + recolor Pilot"; eyeball after deploy.
   - New-submission default `developmentPhase` changed 'Not Start' → 'To Do' (PreRegModal).

7. **Ask ALPHA button** — logo 30→35px, button stays 38px (item done in batch 1, refined here).

8. **Submit analysis tech-stack hint** — `analyzeDuplicate` now emits `tech_stack_hint` (general best-practice only, same guardrail as chat; suppressed to '' when no integration_suggestions). Rendered under integration suggestions in PreRegModal. Mirrors chat's expansion capability at submit time.

## Third grill 2026-07-06 (timeline color + paired sub-skill lock)

9. **Timeline On track recolor** — On track olive-green (old Pilot #8ea82a/#f4f6e5/#5a6b1c), Pilot blue — resolves the two-blues clash from item 6. `TL_ST.ontime` in timeline.js.

10. **Paired sub-skill lock** (big one) — a skill registered as part of a parent Agent (Agent+Skill flow) is now LOCKED to that parent:
    - **Pairing signal** = `matchingAgent` includes parent name AND same `createdBy` (reliable; matchingAgent alone can be an AI-suggested false link). Helpers `pairedSubSkills(agent, all)` + `isPairedSubSkill(skill, all)` in agentUtils.js.
    - **No own controls**: locked sub-skill hides the update-progress button + deploy-request button (AgentDetailModal) AND the Dev Progress/Launch Date inputs in EditAgentModal (`lockProgress` prop from App). Lock note shown instead.
    - **Live progress cascade**: every parent progress/launch edit (AgentDetailModal.handleSave) writes the same devProgress/developmentPhase/launchDate to all pairedSubSkills. Deploy request (handleRequestDeploy) cascades devProgress=95+requested too.
    - **Deploy decision cascade**: PendingApprovalModal deploy approve/reject cascades onto paired sub-skills (was missing — new-entry approve/reject already cascaded since 2026-07-03).
    - **Queue de-dup**: paired sub-skills filtered out of the deploy queue + Pending badge count (App `parentDeployRequests`, PendingApprovalModal `visibleDeploy`) — the parent represents the package.
    - **NO firestore.rules change needed** — all cascade writes pass existing rules because sub-skill shares createdBy with the parent (the exact key the progress-update/deploy-request/deploy-decision rules check).
    - Note: existing already-approved sub-skills won't auto-sync until the parent's next update (no migration run).

See [[project_backlog_decisions_20260704]] — staff role revives the Owner/role topic but different scope.
