# CLAUDE.md — AI Agent Library Suite v2 (Krungthai Group / Arise)

> # 👉 อ่าน `docs/SYSTEM-OVERVIEW.md` ก่อนเริ่มงานทุกครั้ง
> ไฟล์นั้นคือภาพรวมระบบ + สถานะล่าสุด + แผน integrate ที่ **ตรวจกับโค้ดจริงแล้ว**
> ส่วนไฟล์นี้เป็น **กฎปฏิบัติ + ประวัติรายฟีเจอร์** (เรียงตามเวลา ไม่ใช่ภาพรวม)
> ถ้าสองไฟล์ขัดกัน **ให้ยึด SYSTEM-OVERVIEW** แล้วมาแก้ไฟล์นี้ให้ตรง

> ไฟล์นี้สรุปบริบทโปรเจกต์ทั้งหมดจากการคุยงานที่ผ่านมา ใช้เป็นจุดเริ่มต้นสำหรับ Claude Code session ใหม่
> วางไฟล์นี้ไว้ที่ root ของ repo เพื่อให้ Claude Code โหลดเป็น context อัตโนมัติ

---

## 1. ภาพรวมโปรเจกต์ (Project Overview)

**ชื่อระบบ:** AI Agent Library Suite v2
**องค์กร:** Krungthai Group (Arise)
**วัตถุประสงค์:** แทนที่ระบบเดิมที่ใช้ Google Sheets ด้วยเว็บแอป React + Firestore เพื่อ:
- ติดตาม AI Agents และ Skills ที่ map กับ SDLC processes
- จัดการ adoption tracking
- รองรับการ pre-registration ของ agent ใหม่ (พร้อม AI-assisted duplicate detection)

**Stack หลัก:**
- React + Vite
- Firestore Native Mode — **Named Database: `ai-agent-lib`** (ไม่ใช่ `(default)`)
- Firebase Auth (Google SSO) — จำกัด domain: `@arise.tech`, `@infinitaskt.com` (สะกดถูกต้อง ยืนยันจาก `src/lib/firebase.js` — ไม่ใช่ `infitas.com` หรือ `infitaskt.com`), `@krungthai.com`
- Cloud Functions (สำหรับ pre-registration → เรียก Vertex AI)
- Firebase Hosting — GCP project: `wolfy-481609`
- Vertex AI — ใช้วิเคราะห์ตอน pre-registration
- Deploy ตรงจาก local Mac ด้วย `npx firebase-tools` (เลิกใช้ Cloud Shell แล้ว 2026-07-22 — ดูข้อ 11)

**บุคคลสำคัญ:** K.Ko — ดูแล GCP/Firebase access และสิทธิ์ขององค์กร

---

## 2. สถาปัตยกรรม (Architecture — Locked for v2)

> ⚠️ **ข้อความเดิมตรงนี้ผิด** — เคยเขียนว่า "3 React apps แยกกัน: `/`, `/sdlc/`, `/portfolio/`"
> ตรวจกับ `src/main.jsx` แล้วไม่ตรง · รายละเอียดเต็มอยู่ใน `docs/SYSTEM-OVERVIEW.md` §2

ของจริง: repo นี้คือ **SPA เดียว** (ไม่ใช้ router library — เลือก component จาก `pathname` ใน `main.jsx`)

| Path | Component | หมายเหตุ |
|---|---|---|
| `/` | `App.jsx` | มี 3 **แท็บ**ข้างใน: Agent Library / SDLC AI Adoption / Dashboard |
| `/timeline` | `TimelinePage.jsx` | หน้าแยก access-gated ผ่าน `/config/timeline` |

**Portfolio เป็นคนละแอป คนละ repo คนละ hosting site (`wolfy-portfolio`)** — อยู่แค่ GCP project
เดียวกันเท่านั้น **นี่คือเหตุผลของกฎเหล็กเรื่อง scoped functions deploy ในข้อ 11**

- Roles: `user` / `staff` / `approver` / `committee` / `admin` (5 ระดับ — ดูข้อ 17)
  ⚠️ เอกสารเก่าเคยเขียนว่า `viewer/editor/admin` ซึ่ง **ผิดแล้ว** (โมเดล 2 ชั้นเดิม เลิกใช้ตั้งแต่ 2026-07-01)
- ต้อง login ก่อนถึงจะเข้าหน้าไหนได้เลย (ทุก path ต้อง auth)

---

## 3. Data Schema (Confirmed & Authoritative)

### Agent fields
- `agent.devProgress` → **อาจเป็น string `"90%"` หรือ number `90`** ขึ้นอยู่กับแหล่งที่มา (import CSV = string, UI save = number)
  - **ห้าม normalize เอง** — ใช้ `normalizeProgress(raw)` จาก `src/lib/agentUtils.js` เท่านั้น (single source of truth, อยู่ใน 4 call sites: `useAgents.js`, `timeline.js`, `EditAgentModal.jsx`, `ExportDataModal.jsx`)
- `agent.useCase` → **array** ของชื่อ UC (เดิมเป็น string — ยังมี doc เก่าที่เป็น string อยู่)
  - **ห้ามอ่านตรงๆ** — ใช้ `agentUseCaseNames(agent)` จาก `src/lib/agentUtils.js` ซึ่งรองรับทั้ง 2 แบบ
  - match กับ `sdlcUseCases.name` (case-insensitive) — ⚠️ ชื่อไม่ unique ดูข้อ 20
- `agent.sdlcProcessMapping` → **string** (ไม่ใช่ array) เช่น `"2.2 High-Level User Story Development"`
  - ดึง process ID ด้วย regex: `^(\d+\.\d+[A-Za-z]?)\b`
- `agent.approveArea` → **array** ของ Approve Area — ดูข้อ 20
- `agent.internalTool` → boolean, ติดอัตโนมัติตอน submit ผ่าน `isInternalToolName()` (ดูข้อ 20)
- `AI Agent` (boolean) และ `Skill.md` (boolean) → **required fields** ต้อง validate non-empty ตอน migrate และตอนกรอกฟอร์ม pre-registration

### SDLC collections
- `sdlcProcesses` — **58 รายการ**, มี field `owner` (อาจ sparse)
- `sdlcUseCases` — **82 รายการ** (เดิม 106 — ลบชื่อซ้ำ 24 doc เมื่อ 2026-08-11 ดูข้อ 20),
  fields: `processId`, `processName`, `name`, `owner`
  - ⚠️ **ไม่มี field `stage`** — ต้อง join ผ่าน `processId` ไปที่ `sdlcProcesses` เพื่อเอา stage
  - ⚠️ **ไม่มี field `description`** — ตัว doc มีแค่ชื่อ+process+owner ไม่มีอะไรอธิบายเนื้องาน

### Schema config
- ตัวเลือกของ choice fields (SDLC Stage, SDLC Process Mapping, Development Phase, Core Ability, Reusable) เก็บที่ `/config/schema` ใน Firestore — **ห้าม hardcode ใน React**

### Field ที่ถูกลบแล้ว
- `Workflow` — ลบออกจาก Sheet และ Firestore schema แล้ว ไม่กระทบ Tier หรือ Connections scoring

---

## 4. Business Logic (Client-side — ไม่ได้เก็บใน Firestore)

### Tier Classification
```
isSkill = (aiAgent === false && skillMd === true)
// อย่างอื่นทั้งหมด = Agent

Internal/External priority (เรียงตามลำดับ):
1. customerFacing === TRUE  → External
2. internalUse === TRUE     → Internal
3. ทั้งสอง false/empty + sdlcStage มีค่า → Internal
4. นอกเหนือจากนี้ → External

Tier:
- Skill + Internal = T1
- Agent + Internal = T2
- Skill + External = T3
- Agent + External = T4
```
ใช้ฟังก์ชันสำเร็จรูป: `getType()` จาก `src/lib/tier.js` และ `relationshipLabel()` จาก `src/lib/agentUtils.js` — **ห้าม inline-guess logic เอง**

---

## 5. สถานะปัจจุบัน (Current State — อัปเดต 2026-08-11)

**ทุกอย่างที่ระบุด้านล่าง deploy ขึ้น production แล้วและทดสอบผ่านแล้ว**
ข้อมูลจริงในระบบ ณ ตอนนี้: **agent/skill approved + not archived = 239 รายการ**
(รวม pending/rejected/archived ทั้งหมด 245 doc)

### เสร็จแล้ว — ของเดิม (ก่อน ส.ค.)
- Migration agent + SDLC catalog เข้า Firestore ครบ (ตอน migrate: 57 processes + 106 use cases —
  ปัจจุบันเป็น 58 + 82 ดูข้อ 3 และข้อ 20)
- `SDLCTab.jsx`, Dashboard (ข้อ 14), Timeline, Sign-in/Branding (ข้อ 16) — ครบ
- Chat Assistant "ALPHA" v1 (ข้อ 15) + Feature Batch 2026-07-06 (ข้อ 17)
- Deploy workflow ย้ายมา local direct แล้ว (ข้อ 11)

### เสร็จแล้ว — รอบล่าสุด (ส.ค. 2026)
- **Archive agent/skill** — ไม่ลบ แค่ซ่อนจากไลบรารี/แชท แต่ **ยังใช้ตรวจซ้ำได้** (approver+ เท่านั้น)
- **`endpoint` field** (optional) — ลิงก์ไปใช้งาน/ดาวน์โหลด แสดงเป็นไอคอนลิงก์ · sanitize ผ่าน `safeEndpointUrl()`
- **Preview card แสดง Owner แทน Creator** (detail card ยังแสดงครบ)
- **CSV export เพิ่ม UTF-8 BOM** — Excel เคยอ่านภาษาไทยเป็นตัวต่างดาว (Numbers ไม่เป็น เลยไม่มีใครเห็นบั๊ก)
- **Default view เปลี่ยนเป็น By Owner** (เดิม By Role)
  ⚠️ **เปลี่ยนอีกครั้ง 2026-08-20 เป็น By Category** — ดูข้อ 28
- **Import 73 รายการใหม่จาก Google Sheet** — เพิ่มอย่างเดียว ไม่แตะของเดิม
- **⭐ รื้อ semantic search ทั้งระบบ (ข้อ 18)** — งานใหญ่ที่สุดของรอบนี้
- **ตรวจซ้ำตอน Pre-Registration เป็น hybrid ด้วย** — เดิมพลาดตัวซ้ำที่เขียนคนละคำ (วัดได้อันดับ #89/#135/#43 จาก 244 = หลุด top-15 ทั้งหมด)
- **Metrics แบบไม่เก็บข้อความ** — `/metrics/chat-YYYY-MM-DD` นับ turn/tool/ไม่พบ · ข้อตกลง session-only ยังอยู่ครบ
- **Rate limit** `embedQuery` 20 ครั้ง/นาที/คน · **full reindex เช็ค role ฝั่ง server** (เดิมซ่อนแค่ปุ่ม)
- **ปุ่ม Rebuild Search Index** ในเมนู admin (เห็นเฉพาะ `role === 'admin'`)
- **ย้ายเครื่องทำงานสำเร็จ (2026-08-05)** — จาก Mac เดิม → เครื่องบริษัท (ดูข้อ 19)

### เสร็จแล้ว — รอบ 2026-08-10/11 (Approve Area + data quality)
- **⭐ Approve Area taxonomy 16 area** แทน SDLC stage — ดูข้อ 20 (งานใหญ่สุดของรอบนี้)
- **Staff archive ตาม area ตัวเอง** + **Approve Area แก้ได้เฉพาะ admin/staff**
- **แก้บั๊กข้อมูลหายเงียบ** — scope External เคยลบ SDLC field ทิ้งตอน Save (ดูข้อ 20 ท้ายหัวข้อ)
- **Use case ชื่อซ้ำ** — ลบ 24 doc (106→82) + แก้วิธี join ใน SDLC tab (ดูข้อ 21)
- **`internalTool` ติดอัตโนมัติตอน submit** — ดูข้อ 22

### ค้างอยู่ / ต้องเฝ้าดู
- **ต้อง publish `firestore.rules` ทุกครั้งที่แก้** ผ่าน Console (named DB `ai-agent-lib`) — collection ใหม่รอบนี้: `/agentVectors`, `/metrics`, `/rateLimits`
  ⚠️ **บทเรียน 2026-08-11:** deploy hosting แล้วแต่ลืม publish rules → ปุ่ม Archive ของ staff
  โผล่ใน UI แต่เขียนจริงไม่ผ่าน (permission denied) **ถ้าแก้ rules ต้อง publish คู่กับ deploy เสมอ**
- **เฝ้าดู `/metrics`** — ถ้า `answer_notFound` พุ่ง หรือ `tool_query_library` ชนะคำถามความสามารถ = retrieval เริ่มเพี้ยน
- **คุณภาพข้อมูลในไลบรารี** — มีคนลงทะเบียนไฟล์ prompt ภายใน (`*.md`) เป็น agent ทำให้ค้นหาเพี้ยน
  แก้ชั่วคราวด้วย `internalTool` flag แล้ว แต่ **ถ้ามีคนลงเพิ่มอาการจะกลับมา** — ควรคุยเป็นกติกาตอนอนุมัติ
- Connections 129 คู่ / UID backfill / Owner auto-fill — **cut แล้วทั้งหมด** อย่าเสนอซ้ำ (ดู memory backlog_decisions_20260704)

---

## 6. กฎการเขียนโค้ด/CSS ที่ต้องทำตาม

- **ห้าม append ไฟล์ (`>>`) เด็ดขาด — ให้ overwrite ทั้งไฟล์เสมอ** (เคยเกิด CSS class ชนกันมาแล้ว)
- Scope CSS class เฉพาะของ SDLC ด้วย prefix: `.aproc-`, `.uc-`, `.adopt-`, `.sdlc-`
- **ห้าม redefine class ที่มีอยู่แล้วใน `theme.css`**: `.sb`, `.sh`, `.sbar`, `.sname`, `.ttag`
- ห้ามแก้ไฟล์ที่ไม่อยู่ใน scope ของ task ปัจจุบัน (เคยพลาดแก้ไฟล์ Dashboard มาแล้วโดยไม่ตั้งใจ)
- Verify ด้วย `node --check` และ mock-DOM smoke test ก่อนส่งมอบไฟล์เสมอ
- CSV parsing: ใช้วิธี character-by-character พร้อม quote-state tracking (รองรับ multi-field quoted CSV) และตรวจนับ column ก่อน generate เป็น JS literal
- การแทนที่ HTML block ขนาดใหญ่ที่มีอักขระพิเศษ: ใช้ Python `str.index()` + heredoc แทน `str_replace`
- **⭐ Header/Label ต้องเป็นภาษาอังกฤษเสมอ ทุกจุดในเว็บ (สั่งไว้ 2026-08-20)** — `<label>`, หัวข้อ section,
  ชื่อปุ่ม, placeholder ของช่อง action (เช่น "Usage Channel", "1. Select Agent / Skill", "Upload File")
  ต้องเป็นอังกฤษหมด **ภาษาไทยอนุญาตเฉพาะข้อความอธิบาย/คำเตือน/เนื้อหาที่มาจากข้อมูลจริง**
  (เช่น "ต้องเป็น Creator/Approver ประจำ Area นี้", ชื่อ agent, เหตุผล reject) ไม่ใช่ label ของ field/ปุ่ม

---

## 7. AI Pre-Registration Feature (Locked Design)

> **Model (2026-09-25):** every generative call (analyzeDuplicate, chatLibrary, classifyRoleGroup) uses `GEN_MODEL` from `functions/modelConfig.js` = `gemini-3.5-flash` (the only Gemini 3 model in asia-southeast1; 2.5 Flash stops 31 Mar 2027). Use `thinkingLevel`, not `thinkingBudget` — sending both gives a 400. Never hardcode a model string. Embeddings are separate (`embedText.js`).

> **Library context (2026-09-29):** the prompt lives in `functions/duplicatePrompt.js` (moved out of index.js so the eval runs the real prompt).
> - The server builds a **Team context** from Firestore, using `draft.owner` → `summarizeTeam()` in `functions/libraryContextRules.js`. It is never taken from the client.
> - Candidates also carry `owner`, `approveArea` and `category`.
> - Rules: the team's dominant area/category (≥60%) is the default. The AI may depart from it only when the content clearly differs, and must then fill `approve_area_reason` / `category_reason`. Product tags still need evidence in the content itself. A same-team candidate with overlapping work is flagged as a possible new version.
> - Leave-one-out measurement (`eval-library-context.cjs`, 40 items): Approve Area 68%→90%, Category 63%→70%. The 3 duplicate test cases still come out clear_duplicate at 98.
> - Tests: `verify-library-context.cjs` (offline).

- Cloud Function → เรียก Vertex AI (Gemini 2.5 Flash, `thinkingBudget: 0`)
- 3 features: **A + B + D** (รายละเอียด feature C ถูกตัดออก)
- เป็น batch call, blocking UI, ตอบกลับเป็น structured JSON
- Cloud Function ชื่อจริง `exports.analyzeDuplicate` (ใน `functions/index.js`) — **build และ deploy แล้ว**
  - ตรวจ duplicate/overlap ระหว่าง Draft ใหม่กับ agent เดิม โดยพิจารณา sub-function overlap ก่อนเป็นอันดับแรก (ไม่ใช่แค่ text similarity)
  - พิจารณา `reusable` status ของของเดิมประกอบ (Reusable / Reusable with Conditions / Non-reusable) ในการให้ confidence
  - คืน `integration_suggestions`, `suggested_matching_agent`, `suggested_ability` (จำกัดตาม `/config/schema` เท่านั้น ห้าม LLM คิดคำใหม่), `overall_risk`, `summary`
- Owner field (Phase 2): จะเปลี่ยนจาก free-text เป็น auto-fill จาก credential ของผู้ login — ยังไม่ทำ

---

## 8. Connections Data

- มีทั้งหมด 129 คู่ (C001–C129) สร้างด้วย rule-based scoring แล้ว
- **ยังไม่ได้ migrate เข้า Firestore**

---

## 9. Infrastructure Lessons (สำคัญมาก — เคยเสียเวลาดีบักนาน)

- Eventarc Firestore trigger ที่ใช้ wildcard document pattern ต้องใช้ flag `--trigger-event-filters-path-pattern` (ไม่ใช่ `--trigger-event-filters`) — ถ้าใช้ผิด trigger จะโชว์ ACTIVE แต่ไม่ทำงานจริง
- ต้องเปิด `eventarcpublishing.googleapis.com` แยกจาก `eventarc.googleapis.com`
- Firestore service agent ต้องมี role `roles/eventarc.publisher`
- Compute service account ต้องมี role `roles/datastore.user`
- Firestore Security Rules สำหรับ named database `ai-agent-lib` **ต้อง publish ผ่าน named DB dropdown ใน Firebase Console** — ถ้าไป publish ที่ `(default)` จะไม่มีผลใดๆ
- ⛔ **ใน firestore.rules ห้ามอ่าน field ของ doc เดิมด้วย dot notation ถ้า field นั้นอาจไม่มี**
  — `resource.data.someField` บน doc ที่**ไม่มี key นั้น** จะ **raise error** และ error = **deny**
  ต้องใช้ `resource.data.get('someField', <default>)` เสมอ
  **เคสจริง (2026-08-12):** 71 จาก 245 doc (import จาก CSV เก่า) ไม่มี key `deploymentStatus`
  เลย ทุก branch ที่เขียน `!(resource.data.deploymentStatus in [...])` จึง **deny การแก้ไข
  detail/SDLC/approveArea ของ 71 ตัวนั้นกับทุกคนยกเว้น admin** (admin หลุดที่ `isAdmin()` ก่อน)
  อาการที่ผู้ใช้เห็นคือ **"Missing or insufficient permissions" เปล่าๆ ไม่บอกว่า field ไหน**
  → แก้ rules ให้ใช้ `.get()` แล้ว + backfill ด้วย `functions/backfill-deployment-status.cjs`
- Gmail SMTP AUTH ถูกบล็อกโดย Google Workspace org policy ของ `@arise.tech` → แก้โดยใช้ in-app pending approval badge อ่านตรงจาก Firestore (`status == "pending"`) แทนการส่งอีเมล

---

## 10. งานที่ค้างอยู่ (On the Horizon — อัปเดต 2026-08-05)

### เฝ้าดู (ไม่ใช่งานสร้าง)
1. **เฝ้าดู `/metrics/chat-YYYY-MM-DD`** — สัญญาณเตือนล่วงหน้า 2 ตัว **คนละสาเหตุกัน อย่าสับสน**
   - `answer_notFound` พุ่ง → **ปัญหา retrieval** (หาไม่เจอ) หรือไลบรารีขาดของจริงๆ
     ไล่ต่อด้วย `node functions/calibrate.cjs`
   - `tool_query_library` ชนะคำถามความสามารถ → **ปัญหา tool routing** โมเดลเลือก tool ผิด
     ❗ ไม่ใช่ปัญหา embedding — ไปแก้ `capability_search` จะแก้ผิดจุด ต้องไปดูคำอธิบาย tool
     ใน `functions/chatPrompt.js` แล้วรัน `regression.cjs` (มีเคสดักเรื่องนี้อยู่)
2. ~~รัน `flag-internal.cjs` เป็นระยะ~~ — **ไม่จำเป็นแล้ว** ตั้งแต่ 2026-08-11
   ของใหม่ถูกติดธงอัตโนมัติตอน submit (ดูข้อ 22) · สคริปต์เหลือไว้ backfill/ตรวจย้อนหลังเท่านั้น

### ยังไม่ตัดสินใจ
3. **กติกาว่าอะไรควร/ไม่ควรอยู่ในไลบรารี** — ปัญหาคุณภาพข้อมูลที่เจอรอบนี้แก้ปลายเหตุด้วย
   `internalTool` flag ไปแล้ว แต่ต้นเหตุคือไม่มีเกณฑ์ตอนอนุมัติ ควรคุยกันเป็นนโยบาย
3b. **3 ไฟล์ `.md` ที่ยัง `customerFacing=true`** (ดูข้อ 22 ท้ายหัวข้อ) — แก้ได้ด้วยสคริปต์สั้นๆ
   ยังไม่ทำเพราะผู้ใช้ยังไม่ตัดสินใจ
3c. **`agent.useCase` เก็บเป็นชื่อ ไม่ใช่ UC id** (ดูข้อ 21) — ต้นตอของปัญหาชื่อซ้ำ
   ถ้าจะแก้จริงเป็น schema change กระทบ SDLC tab / Dashboard / chat / ฟอร์ม
4. **Rename Firebase web app registration** จาก `test-auth` → `ai-agent-library`
   (เป็นแค่ชื่อเรียก ไม่กระทบ App ID/API key ไม่ต้อง redeploy — ทำเมื่อไหร่ก็ได้)
5. Setup backup admin account (deferred — accepted risk)

### ❌ Cut แล้ว = ตัดสินใจจบแล้วว่า "ไม่ทำ" — อย่าเสนอซ้ำ
> ⚠️ กลุ่มนี้ **ต่างจาก "พักไว้" ด้านล่างคนละเรื่อง** อย่าเอามารวมกัน
> ของในกลุ่มนี้ปิดถาวร · ของใน "พักไว้" **ยังเปิดอยู่และต้องกลับมาคุย**
- Migrate Connections 129 คู่เข้า Firestore
- Firebase Auth UID backfill ที่เหลือ
- เปลี่ยน Owner field เป็น auto-fill จาก credential
- (ทั้ง 3 ข้อดู memory `backlog_decisions_20260704`)

### ⏸️ พักไว้ = ยังไม่จบ ต้องกลับมาคุยต่อ (❗ไม่ใช่ Cut)
- **GitLab skill integration** + ข้อกำหนดจากทีม security ว่า `wolfy-481609` ควรเป็น sandbox
  เท่านั้น — ผู้ใช้สั่งเองว่า **"พักเรื่องนี้ไว้ก่อน จนกว่าจะได้ข้อสรุปเพิ่มเติม"** (2026-07-30)
  → **งานนี้ยังค้างอยู่จริง** ถ้าผู้ใช้ถามว่ามีอะไรค้าง ต้องรวมข้อนี้ด้วย และห้ามรายงานว่าถูก cut

---

## 11. Deploy Workflow (Local direct — เลิกใช้ Cloud Shell แล้ว 2026-07-22)

**เปลี่ยนวิธีแล้ว (2026-07-22):** deploy ตรงจาก local Mac ได้เลย ไม่ต้อง upload เข้า Cloud Shell อีก
- `npx firebase-tools` รันได้บนเครื่องนี้ (ไม่ต้องติดตั้ง global → เลี่ยง admin lock ที่เคยเป็นเหตุผลให้ต้องใช้ Cloud Shell) — firebase CLI login เป็น `tinnapat.p@arise.tech` อยู่แล้ว
- Source เดียวคือ **local + git** (`origin = github.com/ARS-AI-lib/ai-agent-library`, branch `main`) — Cloud Shell เลิกใช้ (local == deployed == origin/main ยืนยันด้วย diff แล้ว 2026-07-22)
- **Deploy hosting:** `npm run build` → `npx firebase-tools deploy --only hosting --project wolfy-481609` (deploy targets `main`=site `wolfy-481609` + `pretty`=site `wolfy-ai-library` ตาม `.firebaserc`)
- แนะนำ deploy preview channel ก่อน promote เมื่ออยากชัวร์: `npx firebase-tools hosting:channel:deploy <name> --project wolfy-481609` (ได้ URL ชั่วคราว ไม่แตะ live) แล้วค่อย deploy จริง
- เปลี่ยนแค่รูป/asset ใน `public/` โดยชื่อไฟล์เดิม ก็ต้อง rebuild + deploy hosting ใหม่เสมอ (CDN cache ตามชื่อไฟล์)

**📅 Upcoming platform dates (Google notices; no action needed yet):**
- **2027-03-28 — Cloud Build release channels:** the default for worker VMs becomes `regular` (Docker/Debian on the build host update faster).
  - We have no cloudbuild.yaml or Dockerfile. Cloud Build is used only behind the scenes by `firebase deploy --only functions:…` (Google's standard buildpacks), and Firebase Functions has no setting to choose a channel.
  - **After that date, watch the first functions deploy.** If you get `Build failed`, investigate. The old function keeps running until the new deploy succeeds, so users see no outage. Hosting is unaffected (Vite builds locally).
- **2027-03-31 — gemini-2.5-flash shuts down (asia-southeast1):** we already moved to `gemini-3.5-flash` on 2026-09-25 (see §7), so nothing is pending.

**⚠️ กฎเหล็ก — โปรเจกต์ `wolfy-481609` แชร์กับแอป Portfolio:** ทั้ง 2 แอปอยู่ GCP project เดียวกัน
- **ห้ามรัน `firebase deploy` เปล่าๆ หรือ `--only functions` เปล่าๆ เด็ดขาด**
  **ตัวเลขจริง (ยืนยันด้วย `npx firebase-tools functions:list` เมื่อ 2026-08-20 (นับใหม่รอบบ่าย)):**
  deploy อยู่จริง **15 ตัว** · `functions/index.js` ใน local มี **11 ตัว**
  (ตัวเลข 14 ที่เคยเขียนไว้ **ผิดตั้งแต่ตอนเขียน** — นับซ้ำอีกครั้ง 2026-08-20 ได้ 15)
  | | ชื่อ |
  |---|---|
  | AI Lib — มีใน local | `analyzeDuplicate`, `chatLibrary`, `embedQuery`, `reindexAgentVectors`, `recordAgentEvent`, `submitRating`, `attachEndpointFile`, `getEndpointFile`, `markAgentReady`, `decideRenameRequest`, `notifyEvent` |
  | AI Lib — **ไม่มีใน local** | `send-approval-email` (legacy zombie — ดูข้อ 26) |
  | **Portfolio (คนละ repo!)** | `files`, `logProjectActivity`, `logTaskActivity` |
  ⚠️ **ตารางนี้เพี้ยนมาแล้ว 3 รอบใน 2 สัปดาห์** (แก้ 2026-08-18 แล้วเพี้ยนอีก 2 ครั้งจากการเพิ่ม
  function ใหม่) → **ห้ามเชื่อตัวเลขในตารางนี้ ให้รัน `functions:list` ทุกครั้งก่อนแตะ functions**
  → unscoped deploy จะเสนอ **ลบ 4 ตัวที่ไม่มีใน local รวมของ Portfolio ทั้งหมด**
  **เวลาแก้ functions ให้ scope เฉพาะตัวที่แก้จริงเสมอ** เช่น
  `--only functions:analyzeDuplicate` · เพิ่ม function ใหม่ก็ scope เฉพาะตัวใหม่
  ⚠️ เอกสารเดิมเขียนว่า "6 ตัว / local 2 ตัว" ซึ่ง**ผิดทั้งคู่** — แก้แล้ว 2026-08-18
  ทุกครั้งที่จะแตะ functions **ให้รัน `functions:list` เช็คก่อน** อย่าเชื่อตัวเลขในเอกสาร
- Hosting ปลอดภัยโดยธรรมชาติ (target-isolated ต่อ repo `.firebaserc` — ไม่แตะ site `wolfy-portfolio`)
- **Firestore rules ยัง publish ผ่าน Console** (named DB dropdown `ai-agent-lib`) เหมือนเดิม — `firebase.json` ไม่มี firestore block (ตั้งใจ)
- Deploy เป็น production เสมอ → ขอ confirm ก่อนทุกครั้ง; Firebase เก็บ release เดิมให้ rollback ได้ (Console → Hosting → release history)

---

## 12. แนวทางการทำงานร่วมกัน (Working Preferences)

- สื่อสารหลักเป็นภาษาไทย
- ก่อน implement งานสำคัญ ให้คุย design decision ก่อน โดยเสนอเป็นตัวเลือกแบบ multiple-choice
- ผู้ใช้จับ logic bug ได้แม่นมาก ต้องอธิบายเหตุผลประกอบโค้ดเสมอ ไม่ใช่ส่งโค้ดเฉยๆ
- ถ้า component พังทั้งระบบ ชอบให้ rewrite ใหม่ทั้งไฟล์มากกว่า patch ทีละจุด
- หากแก้ปัญหาเดิมซ้ำหลายครั้งจะหงุดหงิด — ถ้าไฟล์/ขอบเขตงานใดอยู่นอก scope ให้บอกตรงๆ ทันที

---

## 13. Key Files Reference

| ไฟล์ | หน้าที่ |
|---|---|
| `src/lib/tier.js` | `getType()` — logic จัดกลุ่ม Tier |
| `src/lib/agentUtils.js` | `relationshipLabel()`, `extractProcessId`, `agentProcessIds`, `pairedSubSkills()`, `isPairedSubSkill()`, `sameSubmitter()` |
| `src/lib/status.js` | `ST_DEF`, `ST_ORDER`, `progressBucket()` — status bucket definitions (td/ip/pilot/ru — ไม่มี ns แล้ว) |
| `src/lib/timeline.js` | `TL_ST`, `timelineStatus()` — forecast colors/labels สำหรับ Timeline page |
| `src/components/SDLCTab.jsx` | หน้า SDLC Tracker — implement ครบแล้ว |
| `src/components/DashboardTab.jsx` / `DashboardTab.css` | Dashboard tab v1 (2026-07-07) — ดูข้อ 14 |
| `src/components/TimelinePage.jsx` | SDLC Timeline Gantt (Canvas-based) — access-gated ผ่าน `/config/timeline` |
| `src/components/TagMultiSelect.jsx` | Combobox tag-input ที่ free-add ได้ + persist ไป `/config/schema.relatedRole` |
| `src/components/ComboInput.jsx` | Text input + suggestion dropdown รองรับ `readOnly` prop (ใช้กับ Reusable) |
| `SDLCTab.css` / `theme.css` | สไตล์ — ระวัง class ชนกัน (ดูข้อ 6) |
| `functions/index.js` | Cloud Functions: `analyzeDuplicate` (pre-reg + `tech_stack_hint`) + `chatLibrary` (ALPHA chat) |
| `src/lib/skills.js` | Client-side skill registry ที่ ALPHA chat เรียกใช้ |
| `src/lib/chatGuardrails.js` | Client-side blocklist ก่อนถึง Vertex |
| `src/components/ChatAssistant.jsx` / `ChatAssistant.css` | Floating chat UI ของ ALPHA (drag-resize ได้) |
| `src/hooks/useConfigSchema.js` | `addRelatedRoles()` — grow-only write ไป `/config/schema` |
| `src/App.jsx` | รวม `LoginScreen`, mount `ChatAssistant`, cascade `isPairedSubSkill` ไปยัง `EditAgentModal` |
| `firestore.rules` | Security rules — ต้อง publish ผ่าน Firebase Console (named DB dropdown) เท่านั้น |
| `backfill-owner-creator-v2.cjs` | สคริปต์ backfill owner/creator |
| `sdlc-migrate.cjs` | สคริปต์ migrate SDLC catalog เข้า Firestore |
| **— เพิ่ม ส.ค. 2026 (ดูข้อ 18) —** | |
| `functions/embedText.js` | **single source of truth ของ embedding** — model/มิติ/ความละเอียด/รูปแบบข้อความ · แก้ตรงนี้แล้ว index ถูก rebuild อัตโนมัติผ่าน `contentHash` |
| `functions/chatPrompt.js` | `CHAT_SYSTEM_PROMPT` + `TOOL_DECLARATIONS` — แยกออกมาเพื่อให้ `regression.cjs` เทสของจริง ไม่ใช่สำเนา |
| `functions/regression.cjs` | **รันก่อน deploy แชททุกครั้ง** — 12 เคส ครอบโหมด B ด้วย |
| `functions/bootstrap-vectors.cjs` | สร้าง/อัปเดต index ทั้งชุด (dry-run ถ้าไม่ใส่ `--apply`) |
| `functions/flag-internal.cjs` | ติด `internalTool` ให้ไฟล์ `*.md` + tool ของ ALPHA เอง เพื่อกดอันดับ |
| `functions/calibrate.cjs` / `verify-dup.cjs` | เทียบ embeddings vs lexical บนข้อมูลจริง |
| `src/lib/reindex.js` | `reindexAgent()` fire-and-forget หลัง save + `rebuildAllVectors()` สำหรับปุ่ม admin |
| `docs/memory/` | **ต้นฉบับถาวรของ memory** — แก้แล้วต้อง copy กลับมา commit (ดูข้อ 19) |
| **— Approve Area / data quality (ดูข้อ 20-22) —** | |
| `src/lib/approveAreas.js` | ⭐ **single source of truth ของ Approve Area** — `AREA_ORDER` (16), `agentApproveAreas()` fallback chain 7 ชั้น · **ห้าม inline logic ที่อื่น** |
| `src/lib/internalTool.js` | ⭐ **กฎ `internalTool` ที่เดียว** — `isInternalToolName()` ใช้ร่วมกันระหว่าง client กับ `flag-internal.cjs` |
| `functions/backfill-approve-area.cjs` | backfill `approveArea` ครั้งแรก · มี `loadEsm()` เป็น pattern ต้นแบบให้สคริปต์อื่นโหลดโมดูล client จริง |
| `functions/seed-approve-area-schema.cjs` | เขียน `/config/schema.approveArea` จาก `AREA_ORDER` (รันซ้ำได้เมื่อ area เปลี่ยน) |
| `functions/dedupe-usecases.cjs` | ลบ use case ชื่อซ้ำ (ทำไปแล้ว 106→82 ดูข้อ 21) |
| `functions/repair-orphan-usecases.cjs` | ซ่อม 3 agent ที่ useCase หลุด process หลัง dedupe |
| `functions/fix-scope-misclass.cjs` | แก้ agent ที่ติด `customerFacing` ผิด (ดูข้อ 20 ท้ายหัวข้อ) |
| `functions/split-*.cjs` / `realign-categories.cjs` / `clear-stale-approve-areas.cjs` | migration รายรอบของ taxonomy — เก็บไว้อ้างอิงประวัติ |

---

## 14. Dashboard Tab (v1 — ตัดสินใจครบ + implement แล้ว 2026-07-07)

grilling session เคาะทุกข้อที่เคยค้าง:
- **ตำแหน่ง:** แท็บใหม่ "Dashboard" ใน Agent Library (`activeTab === 'dash'`) — ไม่ใช่ Portfolio app
- **ผู้ชม:** ผู้บริหาร (primary) + ทีม operation; **สิทธิ์:** role `staff/approver/committee/admin` เห็นอัตโนมัติ + allowlist `/config/dashboard.viewers[]` (pattern เดียวกับ Timeline; rules ครอบด้วย `/config/{id}` เดิมอยู่แล้ว ไม่ต้องแก้ rules)
- **ข้อมูล:** real-time (`useApprovedAgents` onSnapshot) — v1 ใช้เฉพาะข้อมูลที่มีจริง; **Adoption rate / Satisfaction rate ตัดออก** รอ marketplace integration ในอนาคต
- **Widgets:** KPI row (Total/RU/In Dev/Avg progress/Launch 90 วัน) · Delay/At-risk board (reuse `timelineStatus()` + axis เดียวกับ Timeline เพื่อให้ตัวเลขตรงกัน, คลิกเปิด AgentDetailModal) · SDLC Coverage gap map (`agentProcessIds()` join `sdlcProcesses`, process count 0 = gap สีแดง) · Status/Tier/Reusable distribution bars · Owner workload
- **Charts:** pure CSS/SVG — ไม่เพิ่ม chart dependency; สีดึงจาก `ST_DEF`/`TIER_DEF`/`TL_ST`
- ไฟล์: `src/components/DashboardTab.jsx` + `src/styles/DashboardTab.css` (prefix `.dash-`)

---

## 15. Chat Assistant "ALPHA" (v1 — Shipped 2026-07-02)

> **Thought signatures (Gemini 3, 2026-09-25):** `chatLibrary` returns `modelParts` (the functionCall parts + `thoughtSignature`), and `ChatAssistant.jsx` must put them back into `toolResults` unchanged. If they're missing, `buildChatContents()` inserts `skip_thought_signature_validator`. A functionCall without a signature gets a 400 (tested). Chat thinking = LOW (regression 17/17 and 16/17, compared with 2.5 dynamic 14/17 and 17/17). A/B: `REG_MODEL=… REG_THINK=… node functions/regression.cjs`

**Persona:** ชื่อ ALPHA, บุคลิกผู้ชาย พูดไทย ลงท้าย "ครับ" เท่านั้น, **ห้ามเอ่ยชื่อองค์กร/บริษัทในเครือเด็ดขาด** (แก้จากที่เคย mention Krungthai Group ไปแล้ว)

**Architecture:** Client-mediated function-calling — Cloud Function `chatLibrary` (`functions/index.js`) ตัดสินใจแค่ว่าจะเรียก tool ไหนหรือตอบข้อความสุดท้าย ตัว client (`src/components/ChatAssistant.jsx`) เป็นคนรัน tool จริงจาก `src/lib/skills.js` แล้วส่งผลกลับไป วนได้สูงสุด 3 รอบต่อ 1 คำถาม (`MAX_LOOP`)

**Tools:** `query_library`, `query_sdlc` (มี `withAgentCounts`/`onlyGaps` สำหรับวิเคราะห์ coverage gap), `capability_search` (semantic, ต้องส่งกลับให้ LLM เรียบเรียงเอง), `get_agent_detail`, `connection_suggest` — ผลลัพธ์บาง tool (`TEMPLATE_TOOLS`) ตอบด้วย template ภาษาไทย local โดยไม่ยิง Vertex ซ้ำ (ประหยัด cost)

**Guardrails:**
- Client-side blocklist ก่อนถึง Vertex เลย: `src/lib/chatGuardrails.js` (jailbreak, fake-admin, คำหยาบ)
- System prompt ฝั่ง server ปฏิเสธคำถามนอกขอบเขต/PII/คำแนะนำการเงิน-กฎหมาย-การแพทย์/action ที่เกิน read-only
- Read-only เสมอ — ไม่มี write ใดๆ จาก chat แม้ผู้ใช้จะอ้างว่าเป็น admin
- Session-only, ไม่เก็บ transcript ลง Firestore (ปิดหน้าต่าง = ล้างประวัติทันที)

**บั๊กที่เจอและแก้แล้วรอบแรก (2026-07-02) — เฝ้าดูซ้ำอีกครั้งหลัง deploy:**
1. AI ตอบ "ขอตรวจสอบข้อมูลให้สักครู่" แล้วหยุดโดยไม่เรียก tool จริง → เพิ่มกฎห้ามเด็ดขาดใน system prompt ว่าต้องเรียก tool ทันทีถ้าจะพูดว่ากำลังตรวจสอบ
2. `capability_search` เอา agent ที่ไม่เกี่ยวข้องกับคำถามจริงๆ (เช่น project-management skill) มาอ้างว่าตอบโจทย์ธุรกิจสินเชื่อ → เพิ่มกฎห้าม force-fit ผลลัพธ์ที่ไม่ตรงโดเมนจริง ต้องตอบตรงๆ ว่าไม่พบแทน

---

## 16. Sign-in Screen & Branding UI (Shipped 2026-07-02)

- **Logo:** "Wolfy" (หมาป่า outline สีฟ้า, PNG RGBA โปร่งใส) — เก็บที่ `agent-library/public/wolfy-logo.png` (ใช้กับ sign-in footer/Nav) และ `agent-library/public/wolfy-chat.png` (ใช้กับปุ่ม chat โดยเฉพาะ ขนาดต้นฉบับ 250×250)
- **Sign-in screen** (`LoginScreen` ใน `App.jsx`): พื้นหลังลาย network/circuit จางๆ (SVG data-URI inline ใน `theme.css`, opacity .05), ปุ่ม Google sign-in มี G-logo 4 สีมาตรฐาน, footer fixed ล่างสุด **เฉพาะหน้า sign-in** (Copyright ซ้าย, "Powered by Wolfy" + โลโก้ขวา)
- **Nav bar:** subtitle = "Powered by Wolfy" (`Nav.jsx`); Timeline ใน menu เปิดใน **same tab** (ไม่ใช่ new tab)
- **Chat button (Ask ALPHA):** 38px height, logo 35px, font 11.5px, pill shape, `var(--accent)` — ยุบเป็น circle ✕ ตอน panel เปิด; panel เริ่มที่ `bottom: 68px` (ชิดปุ่ม)
- **Domain spelling:** ยืนยันแล้วว่า `@infinitaskt.com` คือสะกดที่ถูกต้องจริง

---

## 17. Feature Batch (2026-07-06 — Shipped)

### Status Legend Overhaul
- **ลบ "Not Start" ออกทั้งหมด** — `ST_ORDER = ['td', 'ip', 'pilot', 'ru']`
- **To Do** รับสี Not Start เดิม (grey: `#6b7280`/`#9ca3af`)
- **Pilot** รับสีน้ำเงิน To Do เดิม (`#3d5a8e`/`#4a6fa5`) — สีมะกอกเดิม retired
- 0% agent → bucket = `'td'` (ไม่ใช่ `'ns'` แล้ว)
- `developmentPhase` default ใน PreRegModal เปลี่ยนจาก `'Not Start'` → `'To Do'`
- มีผลกับทุกส่วน: Library cards, SDLC tab, Adoption, Timeline, StatusLegend

### SDLC Timeline Page
- Canvas-based Gantt, access-gated ผ่าน Firestore `/config/timeline.viewers[]`
- Admin bypass: admin เห็น timeline เสมอโดยไม่ต้องอยู่ใน viewers list
- Nav bar เหมือน Library (IBM Plex Sans Thai Looped, accent colors)
- "← Back to Library" ใช้ `window.location.href = '/'` (same tab, ไม่ปิด window)
- Multi-agent dot → **list popup ก่อน** (Tier badge, scope icon, progress) → กดรายการ → detail modal
- **On track = olive green** (`#8ea82a`/`#f4f6e5`/`#5a6b1c`); Pilot = blue — แยกสองสีชัดเจน

### Chat: Resize + Expansion
- **Drag resize:** handle ที่ขอบซ้าย panel, width only, min 340px max 640px, persist `localStorage`
- **Integration/tech-stack Q&A:** ALPHA ตอบเรื่อง "ต่อกับ agent ไหน" (grounded กับ connection data) + best-practice tech stack (REST/webhook/MQ เท่านั้น — ห้ามกุ endpoint)
- `tech_stack_hint` ใน `analyzeDuplicate`: แสดงใต้ integration_suggestions ใน PreRegModal; ซ่อนถ้าไม่มี integration_suggestions

### Staff Role
- `ROLES = ['user', 'staff', 'approver', 'committee', 'admin']`
- Staff export All Data ได้ (Approved + Pending + Rejected) เหมือน admin/committee
- ไม่มีสิทธิ์ approve/user-mgmt
- Firestore rules: `isKnownUser()` รวม `'staff'` แล้ว
- ⚠️ **อัปเดต 2026-08-11 — staff ได้สิทธิ์เพิ่ม 2 อย่าง** (บรรทัด "ไม่มีสิทธิ์ edit" เดิมจึงคลาดเคลื่อน):
  - **แก้ field `approveArea` ได้** (admin + staff เท่านั้น) — `canEditApproveArea()` ดูข้อ 20
  - **Archive/Unarchive ได้เฉพาะ agent ที่อยู่ใน Approve Area ของตัวเอง** — `staffAreaMatch`

### TagMultiSelect (Custom Related Role)
- `src/components/TagMultiSelect.jsx` — combobox tag-input แทน MultiSelect สำหรับ Related Role
- Free-add role ใหม่ได้, split `,`/`/`, dedup case-insensitive, backspace ลบ tag สุดท้าย
- Persist ทันทีไป `/config/schema.relatedRole` ผ่าน `useConfigSchema.addRelatedRoles()`
- Firestore rules: grow-only rule สำหรับ `/config/schema` — known user เพิ่ม relatedRole ได้ (superset, ลบไม่ได้)

### Paired Sub-Skill Lock & Cascade
- **Pairing signal:** `sameSubmitter(a, b)` — `createdBy` ตรง **หรือ** `creator` (display name) ตรง (OR, ไม่ใช่ AND exclusive) เพราะสอง doc อาจถูกสร้างคนละ session → createdBy ต่างกันได้
- Sub-skill ที่ lock: ซ่อนปุ่ม update-progress + deploy-request (AgentDetailModal), ซ่อน progress/launch inputs (EditAgentModal), แสดงข้อความ "Status และ Progress ของ Skill นี้จะปรับตาม Agent หลัก"
- **Cascade จาก parent:** progress + launchDate + developmentPhase → `pairedSubSkills()` ทุกครั้งที่ handleSave
- **Deploy request cascade:** handleRequestDeploy → sub-skills ถูกตั้งเป็น `requested`/`devProgress=95` ด้วย
- **Deploy decision cascade:** `decideDeploy()` ใน PendingApprovalModal → cascade ไป sub-skills ที่อยู่ใน state `requested`
- **Queue de-dup:** `isPairedSubSkill` filter ออกจาก deploy queue + pending badge count
- **ไม่ต้องแก้ firestore.rules** — cascade write ผ่าน rule เดิมเพราะ sub-skill มี `createdBy` เดียวกับ parent (หรือผ่าน creator fallback ฝั่ง client เท่านั้น — Firestore rule ยังเช็ค `createdBy` ปกติ)

### Form UI Fixes (2026-07-06)
- `<select>` สำหรับ **Reusable** และ **Use Case** ถูกแทนด้วย `ComboInput` (design ตรงกับ Owner field)
  - Reusable: `readOnly={true}` (กดเลือกเท่านั้น, ไม่พิมพ์เอง)
  - Use Case: พิมพ์กรองได้
- Placeholder color: สีเทา (`var(--mu2)`) สม่ำเสมอทุก field ใน `.fg` (input/textarea/tms-input/ms-btn)
- `.fg .combo-wrap input { width: 100%; height: 36px }` — ป้องกัน input หดเมื่อ parent เป็น `display:block`
- `.fg .ms-btn { height: 36px; display:flex; align-items:center }` — สูงเท่า tms-box
- `.fg .tms-box { padding: 3px 8px }` + `.fg .tms-input { height:28px }` — ป้องกัน browser UA stylesheet ทำ input สูงกว่า ms-btn

### Pending Approval Modal
- Deploy Request: ชื่อ agent เป็น underline dotted กดเปิด AgentDetailModal ได้
- Deploy Request: แสดง "Launch: DD Mon YY" ถ้า `launchDate` มีค่า
- "รายการ" → "items" ในทุก modal


---

## 18. Semantic Search & Chat Re-architecture (Shipped 2026-08-04)

### ทำไมต้องรื้อ
`capability_search` เดิม **ไม่เคยเป็น semantic search** — มันคือการจับ substring ระดับตัวอักษร
(character trigram) ผลคือคำถามไทยหา field ภาษาอังกฤษไม่เจอ วัดจากไลบรารีจริง 244 รายการ:

| query | เดิม | หลังแก้ |
|---|---|---|
| `เทสเคส` | **0 รายการ** | TC Writer, TCM Masker, Test Designer |
| `เขียนเทสเคส` | ผ่านเกณฑ์ 37 ตัว · อันดับ 1 = `query_library` | ของถูกอยู่อันดับ 1-5 |
| `design system` | ผ่านเกณฑ์ 71 ตัว | Figma Apply Design System, Design System Builder |
| `debug bug` | Design Audit (UAT) ❌ | **RCA Fix Assistant** (คำอธิบายไม่มีคำว่า debug/bug เลย) |

**บทเรียน:** ที่ผ่านมาไล่แก้ *precision* (ของเกินเข้ามา) ทีละเคสด้วย stopwords/cutoff/prompt rules
ขณะที่ *recall* (ของถูกหายไป) พังเงียบอยู่ตลอด — **recall ที่พังกู้คืนด้วย prompt ไม่ได้**

### สถาปัตยกรรม
- **Model: `text-multilingual-embedding-002` @ 256 มิติ** — ไม่ใช่ `gemini-embedding-001`
  (ตัวหลัง native 3072 มิติ ย่อเหลือ 256 แล้วคะแนนกระจุก แยกของดีจากของมั่วไม่ออก)
- **Vector อยู่ที่ `/agentVectors/{agentId}`** โหลดตอนเปิดแชท (pattern เดียวกับ SDLC catalog)
  → cosine คำนวณใน `skills.js` ทำให้ business logic (tier/readiness/archive) **อยู่ที่เดียว**
  ไม่ต้องก๊อปไป server (กัน drift แบบเดียวกับกฎ `normalizeProgress`)
- **ปัดทศนิยม 4 ตำแหน่ง** (`EMBED_PRECISION`) → payload 1.26MB → **0.45MB** โดยอันดับไม่เปลี่ยนเลย
  (3 ตำแหน่งเริ่มเพี้ยน) ค่านี้ถูกใส่ใน `contentHash` ด้วย → เปลี่ยนเมื่อไหร่ index ถูก rebuild อัตโนมัติ
- **Hybrid เสมอ ไม่ใช่แทนที่** — union กับการค้นแบบเดิม ทำให้ recall **แย่ลงไม่ได้ในเชิงคณิตศาสตร์**
- ⛔ **ห้ามตั้ง score floor เพื่อบอกว่า "ไม่พบ"** — วัดแล้วคำถามหลอกได้ 0.687 ขณะที่คำถามจริงได้ 0.621
  cosine แยกไม่ออก การตัดสินว่าไม่พบเป็นหน้าที่ของ LLM เท่านั้น
- ⛔ **ห้ามใช้ Eventarc trigger** สำหรับ index (ดู §9) — ใช้ callable + hash check + ปุ่ม admin

### กฎการแสดงผล (สำคัญ)
**layout ไม่อยู่ใน prompt** — LLM ส่งมาแค่ `@@ ชื่อ | เหตุผล` (agent) กับ `## หัวข้อ | รายละเอียด` (SDLC)
แล้ว **client วาดเอง**จากข้อมูลจริง (status pill, ไอคอนลิงก์, การจัดกลุ่ม)
เหตุผล: โมเดลจัดรูปแบบไม่เหมือนเดิมทุกครั้งโดยธรรมชาติ — เคยเกิดหัวข้อ "Ready to Use:"
แต่ข้างในติดดาว (pilot) ขัดกันเอง การวาดจาก data ทำให้บั๊กประเภทนี้**เกิดไม่ได้เชิงโครงสร้าง**

### กฎอื่นที่ต้องรู้
- `intent: "usable_now" | "all"` **บังคับใน code ไม่ใช่ prompt** (prompt เคยห้ามแล้วโมเดลยัง list ของ in_dev มา 7 ตัว)
- **`type` filter ของ query_library ต้องระวัง** — คำว่า "Agent" ในภาษาพูดแปลว่า "เครื่องมือ AI" ไม่ใช่หมวด
  เคยทำให้ `"process 1.2 มี Agent 2 ตัวอะไรบ้าง"` ตอบ "ไม่พบ" ทั้งที่มีจริง (ของจริงเป็น Skill ทั้งคู่)
- **query ต้องขยายความ ไม่ใช่ keyword สั้น** — วัดแล้ว query ยาวดัน `fe-dev` จาก #72 → #11
- **`internalTool: true`** ใช้กดอันดับไฟล์ภายใน (`*.md`) + tool ของ ALPHA เอง ที่เคยชนะ agent จริง
  รันซ้ำได้ด้วย `node functions/flag-internal.cjs` (⚠️ `owner === 'Wolfy'` ใช้เป็นกฎไม่ได้ — โดน agent จริงด้วย)

### ต้องรันก่อน deploy แชททุกครั้ง
```bash
node functions/regression.cjs     # 12 เคส รวมโหมด B (Agile/SDLC/ขอไอเดีย)
```
ใช้ prompt จริงจาก `functions/chatPrompt.js` (ไม่ใช่สำเนา) → prompt เปลี่ยนแล้วพังจะรู้ทันที

---

## 19. ย้ายเครื่องทำงาน (Machine Migration)

### สิ่งที่ git พาไปให้ **ไม่ได้** — ต้องจัดการมือทุกครั้ง
| ของ | วิธี |
|---|---|
| `.env.local` | ⚠️ **Vite ฝังค่าตอน build** — ไม่มีไฟล์นี้ build แล้ว **login ไม่ได้** และถ้าเผลอ deploy จะทำ production พัง · สร้างใหม่จาก Firebase Console → Project settings → Web app config |
| firebase login | `npx firebase-tools login` |
| gcloud ADC | `gcloud auth application-default login` |
| ประวัติแชท | **ต่อข้ามเครื่องไม่ได้** — ความรู้ส่งต่อผ่านไฟล์นี้ + `docs/memory/` เท่านั้น |

### Memory restore (จำเป็น — memory ไม่โหลดเองจาก repo)
Claude Code อ่าน memory จาก `~/.claude/projects/<key>/memory/` โดย `<key>` = path ของ cwd
แทน `/` ด้วย `-` เช่น `/Users/xxx/work/ai-agent-library` → `-Users-xxx-work-ai-agent-library`
→ **เครื่องใหม่ key จะเปลี่ยนเสมอ** เพราะ username/path ต่างกัน

```bash
cp docs/memory/*.md ~/.claude/projects/<key ใหม่>/memory/
```
`docs/memory/` ใน repo คือ **ต้นฉบับถาวร** — แก้ memory แล้วอย่าลืม copy กลับมา commit

### เครื่องที่ติด admin lock
- ✅ `npm install`, `npx firebase-tools` (deploy ทั้งหมด) — **ไม่ต้องใช้ admin** เขียนลง `~/.npm` + project dir
- ⚠️ `gcloud` — ติดตั้งลง home directory ได้ (ดาวน์โหลด tarball แล้ว `./install.sh` ชี้ install dir ที่ `$HOME`)
  ถ้าองค์กรบล็อก ให้ใช้ Cloud Shell เฉพาะสคริปต์ที่ต้องใช้ ADC
- **สคริปต์ที่ต้องมี ADC:** `bootstrap-vectors.cjs`, `calibrate.cjs`, `regression.cjs`,
  `flag-internal.cjs`, `verify-dup.cjs` — **งาน deploy ปกติไม่ต้องใช้**

### Verification หลังย้าย (ทำให้ครบก่อนล้างเครื่องเก่า)
```bash
git log -1                                    # เห็น commit ล่าสุดจริง
npm run build                                 # พิสูจน์ว่า .env.local + deps ครบ
git rev-list --left-right --count origin/main...HEAD   # ต้องได้ 0 0 ก่อน deploy ใดๆ
node functions/regression.cjs                 # ผ่าน 12/12 (ต้องมี ADC)
node functions/bootstrap-vectors.cjs          # dry run → ทุกตัวต้อง up to date (ตัวเลขเปลี่ยนตามจำนวน agent จริง)
npx firebase-tools hosting:channel:deploy test-migration   # preview ไม่แตะ live
```

---

## 20. Approve Area — ระบบจัด routing ผู้อนุมัติ (Shipped 2026-08-10/11)

> ⚠️ **นี่คือฟีเจอร์ใหญ่สุดของรอบ ส.ค. ที่เอกสารเคยไม่มีเลย** — เพิ่งเขียนเพิ่ม 2026-08-11

### แนวคิด
เดิม approver ถูก scope ด้วย **SDLC stage** (7 ค่า + `'Business'`) ซึ่งกว้างเกินไป —
"Build approver" คนเดียวต้องอนุมัติทั้งงานเขียน copy และ penetration test **และ 79 agent (33%)
มองไม่เห็นโดย approver คนไหนเลย** เพราะไม่มี `sdlcStage`

เปลี่ยนเป็น **Approve Area = สายงาน (discipline)** 16 ค่า

### Single source of truth: `src/lib/approveAreas.js`
- `AREA_ORDER` — 16 area: Business & Product · Governance, Risk & Procurement · Delivery Management ·
  Business Analysis · UX Research · UI & Visual Design · Content & UX Writing · Architecture ·
  Development · SIT · QA · Security · Platform, DevOps & Operations · SRE & Reliability ·
  Incident & Problem Management · Data & Analytics
- `agentApproveAreas(agent, categoryAreaOverrides)` — **fallback chain 7 ชั้น ตามลำดับ:**
  1. `agent.approveArea` ที่เก็บไว้ (**ชนะเสมอ**)
  2. `agent.internalTool === true` → `['Platform, DevOps & Operations']`
  3. `sdlcProcessMapping` → `PROCESS_AREA`
  4. `relatedRole` → `ROLE_FIRST_AREA` (Security / Data & Analytics)
  5. `category` → `categoryAreaMap` (live override) / `CATEGORY_AREA`
  6. `relatedRole` → `ROLE_AREA`
  7. External + ไม่เหลืออะไร → `['Business & Product']`

> ⛔ **ห้าม inline logic นี้ที่ call site เด็ดขาด** — กฎเดียวกับ `normalizeProgress`/`getType`
> สคริปต์ฝั่ง Node ต้องโหลดไฟล์นี้จริงผ่าน `loadEsm()` (ดู `backfill-approve-area.cjs`) **ห้ามก๊อปตาราง**

### สิทธิ์
- **แก้ field `approveArea` ได้เฉพาะ admin + staff** — `canEditApproveArea()` ใน `agentUtils.js`
  (แคบกว่า `canEditSDLC` ที่ approver/createdBy ก็แก้ได้) เพราะ field นี้ตัดสินว่า
  **ใครได้อนุมัติ agent ตัวนี้** ถ้า approver ตั้งเองได้ = self-assign เข้าคิวตัวเอง
  → `firestore.rules` แยกเป็น branch ของตัวเอง (`hasOnly(['approveArea','updatedAt'])`)
  และ `EditAgentModal` เขียนเป็น updateDoc แยก (Write 2b) เพื่อให้ affectedKeys ตรง branch
- **Staff archive ได้เฉพาะ area ตัวเอง** (2026-08-11) — `staffAreaMatch` ใน `AgentDetailModal`
  ⚠️ scoping เป็น **UI-side** เหมือน approve/reject/deploy-decision (rules เช็คแค่ role)

### AI ช่วยเลือกตอน submit
`analyzeDuplicate` คืน `suggested_approve_area` (จำกัดตาม `/config/schema.approveArea`)
→ `PreRegModal` เขียนลง `approveArea` ตอน submit เลย

### 🔴 Bug 2026-08-10 → 2026-09-28: the form never saved approveArea
`PreRegModal` computed `inheritedFromAgent.approveArea` but **did not include it in either `addDoc`**, so every submission had no stored area. It went unnoticed for a month because the web UI's resolver fills the gap, but everything server-side (notifications, upload/mark-ready permissions, Usage Report scoping) reads **stored values only**. It was found when Teams cards showed "Approve Area ไม่ระบุ".
- Fixed: the field is written for both the parent agent and sub-skills.
- Backfill with `functions/backfill-missing-approve-area.cjs`: 67 docs (54 from the AI suggestion in `analysisRuns`, 13 from the resolver). Afterwards, 0 docs lack an area.
- ⛔ Do not rerun `backfill-approve-area.cjs`. It still asserts the old 12-area list.

### Scope (Internal/External) ≠ SDLC — แยกกันเด็ดขาด (แก้ 2026-08-11)
เคยมีบั๊ก: `EditAgentModal`/`PreRegModal` เขียน `sdlcStage/sdlcProcessMapping/useCase` เป็น `[]`
เมื่อ scope = External **และซ่อน field ทิ้ง** → agent External ที่มีข้อมูล SDLC จะ**โดนลบข้อมูลเงียบๆ
แค่กด Save** (เจอของจริง 2 ตัว) แก้แล้วโดย:
- ไม่ blank ตาม scope อีกต่อไป · ไม่ซ่อนกลุ่ม SDLC ตาม scope อีกต่อไป
- cascade drop-stale (ตัด process ที่ไม่อยู่ใน stage) ต้องรอ **ผู้ใช้แตะ field จริง** ก่อน
  (`stageTouched`/`processTouched` useRef) — เดิมยิงตอน mount แล้วลบข้อมูลของ agent
  ที่ stage กับ process ไม่ตรงกันเอง

**นิยาม "customer facing" ที่ใช้จริง:** ลูกค้าโต้ตอบกับ agent เองตอน runtime โดยไม่มีคนในองค์กร
รีวิวก่อน — **ไม่ใช่** "ผลลัพธ์ไปถึงลูกค้า" (ถ้าใช้นิยามหลัง agent เขียนโค้ด/ออกแบบ/เขียนเทส
กลายเป็น External หมด แกนนี้จะไร้ความหมาย) · agent ที่มี `sdlcProcessMapping` จริง = ทำงานใน
กระบวนการภายในตามนิยาม

---

## 21. Use Case Catalog — ชื่อซ้ำและวิธี join (2026-08-11)

### ปัญหาที่เจอ
`sdlcUseCases` มีชื่อซ้ำ 21 ชื่อ กิน 52 doc — ทีมต่างๆ จองชื่อเดียวกันคนละ process
และ `SDLCTab.agentsForUC()` เดิม join ด้วย **ชื่อล้วนๆ** → agent 1 ตัวถูกนับเข้าไปใน
**ทุก process ที่จองชื่อนั้น** (วัดได้ 24 การนับผี)

### แก้แล้ว 2 ชั้น
1. **ข้อมูล** — `functions/dedupe-usecases.cjs` ลบ 24 doc (106 → 82) เฉพาะกลุ่มที่ชื่อบอกชัดว่า
   ควรอยู่ process เดียว · **เหลือ 7 ชื่อที่ยังซ้ำโดยตั้งใจ** = คู่ SIT (12.x) / UAT (13.x)
   ซึ่งเป็นคนละทีม คนละ environment จริง **ห้ามยุบ**
2. **โค้ด** — `agentsForUC()` ต้อง match ชื่อ **และ** `sdlcProcessMapping` ของ agent เองต้องมี
   process นั้น · fallback เป็น name-only เฉพาะ agent ที่ไม่มี process mapping เลย (มี 4 ตัว)

⚠️ **ต้นตอที่ยังอยู่:** `agent.useCase` เก็บเป็น **ชื่อ** ไม่ใช่ UC id — ถ้ามีคนตั้งชื่อซ้ำอีก
อาการจะกลับมา · การเปลี่ยนไปเก็บ id เป็นงาน schema change ที่ยังไม่ได้ทำ

**ผลข้างเคียงที่ยอมรับแล้ว:** 4 process ไม่มี use case เหลือเลย (1.5, 7.2, 10.2, 14.3B)
เพราะของที่มีเป็นชื่อซ้ำที่เป็นของ process อื่น — ถูกต้องแล้ว ไม่ใช่บั๊ก

---

## 22. internalTool — กันไฟล์ prompt ภายในหลุดเข้าไลบรารี

- **กฎอยู่ที่เดียว: `src/lib/internalTool.js`** → `isInternalToolName(name)`
  = ชื่อลงท้าย `.md` **หรือ** อยู่ใน `SELF_REFERENTIAL_NAMES` (tool ของ ALPHA เอง 9 ชื่อ)
- **ติดอัตโนมัติตอน submit** ใน `PreRegModal` (ทั้ง agent หลักและ paired sub-skill) — 2026-08-11
- `functions/flag-internal.cjs` **โหลดกฎจากไฟล์เดียวกัน**ผ่าน `loadEsm()` ไม่ประกาศเอง
  → ใช้ backfill ของเก่า/ของที่ถูก rename เข้าเงื่อนไขทีหลัง
- ⚠️ `owner === 'Wolfy'` ใช้เป็นกฎไม่ได้ — โดน agent จริงด้วย
- **flag นี้ทำแค่ 3 อย่าง:** กดอันดับใน chat search (`INTERNAL_RANK_PENALTY` 0.85),
  route ไป area `Platform, DevOps & Operations` (ชั้น 2), และ filter "Platform Tools" ใน Sidebar
  — **ไม่ซ่อน และไม่แตะ scope/tier**
- ⚠️ **ค้างอยู่:** มี 3 ไฟล์ (`6.answer-writer.md`, `6.commodity-price-inquiry.md`,
  `7.no-citation-fallback.md`) ที่ `internalTool=true` แต่ `customerFacing=true` (T3) ขัดกันเอง
  — ยังไม่แก้ (อีก 10 ไฟล์ `.md` เป็น T1 ถูกต้องแล้ว)

---

## 23. Category — สายงาน + ผลิตภัณฑ์ (แก้ 2026-08-17)

### `category` มี 2 ชนิดปนกันในลิสต์เดียว (ตั้งใจ)
`/config/schema.category` มี 21 ค่า แบ่งเป็น
- **discipline** (15) — "งานนี้เกี่ยวกับเรื่องอะไร" เช่น `Writing & Content`, `Software Development`
- **product / business vertical** (6) — "ทำให้ผลิตภัณฑ์ตัวไหน" = `Investment`, `Lending & Credit`,
  `NEXT`, `เป๋าตัง, เป๋าตุง, ถุงเงิน`, `CLICX`, `Core bank`

**single source of truth ของฝั่ง product = `VERTICAL_CATEGORIES` ใน `src/lib/approveAreas.js`**
→ `CATEGORY_AREA` spread จากลิสต์นี้ (ทุกตัว route ไป `Business & Product`)
→ `seed-approve-area-schema.cjs` เขียนลง `/config/schema.productCategory` ให้ Cloud Function อ่าน
**ห้าม hardcode ลิสต์ product ที่อื่น** — `realign-categories.cjs` มีสำเนาเก่าที่ freeze ไว้แล้ว

`agent.category` เป็น **array** ถือได้ทั้ง discipline + product พร้อมกัน
เช่น `["Writing & Content", "NEXT"]`

### ทำไม product category ว่างเปล่าอยู่ 1 สัปดาห์ (บทเรียน)
เพิ่ม 4 product เข้าลิสต์ตั้งแต่ 2026-08-10 แต่ **0 agent** จนถึง 2026-08-17 เพราะ
**ไม่มี code path ไหนเขียนได้เลย** ซ้อนกัน 3 ชั้น:
1. `suggested_category` เป็น **string ตัวเดียว** + `PreRegModal` ห่อเป็น array 1 ช่อง
   → agent มี category ได้ตัวเดียว
2. prompt นิยาม category ว่า *"โดเมนงาน/สายงาน"* พร้อมตัวอย่าง discipline ล้วน
   **ไม่เคยบอกโมเดลว่าในลิสต์มี product ปนอยู่** → คำตอบ discipline ชนะทุกครั้ง
3. **ไม่มีช่องแก้ category ที่ไหนเลย** — AI เขียนครั้งเดียวตอนสร้าง แก้ทีหลังไม่ได้

→ แก้ครบทั้ง 3 ชั้นแล้ว: prompt แยกลิสต์ discipline/product ชัดเจน · `suggested_category`
เป็น **array (1 discipline + product ไม่บังคับ)** validate ฝั่ง server ตัดเหลือ discipline 1 +
product 1 · เพิ่มช่องแก้ใน Edit form

### สิทธิ์แก้ category = **admin เท่านั้น**
- `canEditCategory(userRole, isAdmin)` ใน `agentUtils.js` — **แคบกว่า `canEditApproveArea`
  (admin+staff)** เพราะ category ป้อนเข้า layer 5 ของ `agentApproveAreas()` ด้วย
  ถ้าใครก็แก้ได้ = re-route คิว approve ตัวเองได้
- ใช้ **`MultiSelect` (เลือกจากลิสต์)** ไม่ใช่ `TagMultiSelect` (พิมพ์เพิ่มเอง) โดยตั้งใจ —
  **admin ย้ายหมวดได้ แต่สร้างหมวดใหม่เองไม่ได้**
  หมวดใหม่มาทางเดียวคือ AI เสนอ → `categoryProposals` → `CategoryApprovalPanel`
- `firestore.rules`: **ถอด `category` ออกจาก Tier A และ Tier B แล้ว** (2026-08-17)
  เหลือเขียนผ่าน `isAdmin()` branch เท่านั้น · `EditAgentModal` เขียนเป็น Write 2c แยก updateDoc

### ⚠️ ห้ามรัน `backfill-categories.cjs` ซ้ำ
มันเขียน `category: [ตัวเดียว]` = **replace** → product tag หายหมด (ใส่คำเตือนไว้ในไฟล์แล้ว)

### ค้างอยู่
- ⚠️ **"VB" = CLICX** (CLICX คือชื่อของ Virtual Bank — ยืนยันจากผู้ใช้ 2026-08-17
  · **เปลี่ยนชื่อจาก `CLIX` → `CLICX` เมื่อ 2026-08-20** ตอนนั้นยังไม่มี agent ตัวไหนติดแท็กนี้
  จึงเป็นแค่การ retire ชื่อเก่าใน `/config/schema` ไม่ต้อง migrate agent สักตัว)
  **ไม่ใช่ vertical ใหม่** — `UX Writer AI Agent` ที่ระบุว่ารองรับ VB ควรแท็ก `CLICX` ไม่ใช่เพิ่ม
  category ใหม่ **แต่ตั้งใจปล่อยว่างไว้ก่อน** ผู้ใช้จะเพิ่ม skill/แท็กเองทีหลัง — ห้าม backfill เอง
- `CLICX` / `Core bank` ยังเป็น 0 — **ถูกต้อง ณ ตอนนี้** ไม่มี agent ตัวไหนทำให้ 2 ตัวนี้โดยเฉพาะ
  (ทั้งไลบรารี 239 ตัว มีแค่ 5 ตัวที่ผูกกับ product จริงๆ ที่เหลือเป็นเครื่องมือข้าม product)

---

## 24. Endpoint File Upload + SSO-gated download (2026-08-18)

### ปัญหาที่แก้ — ไฟล์ skill เคยเปิด public 100%
```
curl https://wolfy-ai-library.web.app/skills/duplicate-check.zip
→ HTTP 200 · 4,879 bytes · ไม่มี cookie ไม่มี token ไม่ต่อ VPN
```
**Firebase Hosting เป็น static CDN ไม่มีชั้น auth เลย** — จะบังคับ login บน path ของ Hosting
ไม่ได้เด็ดขาด ทั้ง 25 endpoint ที่ชี้มาที่ตัวเองจึงเปิดให้ทั้งอินเทอร์เน็ตโหลดมาตลอด

### สถาปัตยกรรม — client ไม่แตะ Cloud Storage เลย
ทุกอย่างผ่าน 2 callable (posture เดียวกับ `/metrics` + `/agentStats` = ตัด write path ฝั่ง client ทิ้ง)
**ผลพลอยได้ที่สำคัญ: ไม่ต้องทำ setup พวกนี้เลย**
- ❌ ไม่ต้องเปิด Firebase Storage เป็น product (ใช้ GCS bucket `wolfy-481609.appspot.com` ที่มีอยู่แล้ว)
- ❌ **ไม่มี `storage.rules` และไม่มี `storage` block ใน `firebase.json`** → ไม่มีอะไรให้ publish
  และไม่มีทางเผลอ overwrite ของ Portfolio ที่แชร์ GCP project เดียวกัน
- ❌ ไม่ต้องตั้ง CORS · ❌ ไม่ต้องขอสิทธิ์ IAM สำหรับ signed URL
- bucket ปิดสนิท: ไม่มี public ACL ไม่มี download token

ไฟล์เดินทางเป็น base64 ผ่าน callable ได้เพราะของจริงเล็กมาก (โฟลเดอร์ใหญ่สุด 728 KB, zip เดิม ~5 KB)
**เพดาน 5 MB** (callable จำกัด request 10 MB, base64 บวม 33%) · ถ้าอนาคตไฟล์ใหญ่ขึ้นให้เปลี่ยนเป็น
V4 signed URL จาก function เดิม **ไม่ต้องแก้ client**

### 🔑 `/f/{agentId}` คือกลไก SSO ทั้งหมด
`endpoint` ของไฟล์ที่อัปโหลด = `https://wolfy-ai-library.web.app/f/{agentId}`
Hosting rewrite `**` → `index.html` → **URL นี้โหลด SPA ไม่ใช่ไฟล์** → SPA บังคับ Google SSO ก่อน
render → แล้วค่อยเรียก `getEndpointFile`

**นี่คือเหตุผลที่ต้องทำแบบนี้:** ลิงก์นี้**ทนต่อการถูกก๊อปไปแปะในแชท** ใครเปิดก็ต้อง login
ต่างจาก Storage download token ที่เป็น bearer credential — ส่งต่อ URL = ส่งต่อสิทธิ์ ซึ่งคือรูเดิมเป๊ะๆ

### Key files
| ไฟล์ | หน้าที่ |
|---|---|
| `src/lib/endpointFiles.js` | ⭐ **`isLibraryFileUrl()` = single source of truth ว่า endpoint ไหน "เป็นของเรา"** · **ห้ามเช็ค host เองที่ call site** |
| `functions/endpointFileRules.js` | ⭐ **กฎ authz + validate ไฟล์** — แยกออกมาเพื่อให้เทสของจริง (pattern เดียวกับ `embedText.js`/`chatPrompt.js`) |
| `functions/verify-endpoint-files.cjs` | **รันก่อน deploy ทุกครั้ง** — 34 เคส ยิงกับ user/agent จริง (read-only) |
| `functions/migrate-skill-files.cjs` | ย้าย `public/skills/*` เข้า Storage (dry-run default) |
| `src/components/FileDownloadPage.jsx` | หน้า `/f/{agentId}` — มีปุ่ม sign-in จริง (ต่างจาก TimelinePage ที่แค่บอกให้ไป login) |
| `src/components/UploadEndpointFileModal.jsx` | popup แนบไฟล์ (เมนู ☰ → Attach Endpoint File) |

### สิทธิ์
- **อัปโหลด:** `admin` (ทุกตัว) · `staff`/`approver` (เฉพาะที่ area ตัวเองตรงกับ agent)
  — `committee` **ไม่มีสิทธิ์** (ไม่อยู่ใน `UPLOAD_ROLES`)
- **agent ต้อง `deploymentStatus === 'approved'`** เท่านั้น
  ⚠️ โจทย์เดิมขอ 3 เงื่อนไข (ขอ request + approve + 100%) แต่**ข้อมูลจริงบอกว่ายุบเหลือข้อเดียว**:
  ทั้ง 26 ตัวที่ deploy approved อยู่ที่ 100% อยู่แล้วทุกตัว และ approve ก็แปลว่าเคย request
  → เงื่อนไขที่ไม่กรองอะไรเลย = ที่ให้ drift เปล่าๆ
- **area เช็คจาก `agent.approveArea` ที่เก็บไว้ ไม่ได้เรียก `agentApproveAreas()`**
  เพราะ `src/lib/approveAreas.js` **ไม่ได้ถูก deploy ไปกับ functions** และการก๊อปตารางไปไว้ที่นั่น
  ผิดกฎข้อ 20 · stored คือ layer 1 ที่ชนะทุก layer อยู่แล้ว และทั้ง 26 ตัวมีครบ → ผลตรงกัน
  ถ้า agent ไหนไม่มี stored area จะ**เหลือ admin เท่านั้น** (fail ไปทางปลอดภัย)
- ⚠️ **staff ทั้ง 7 คนยัง `approveAreas` ว่าง → upload ไม่ได้สักตัว** (วัดแล้ว) เป็นเรื่องข้อมูล
  ไม่ใช่บั๊ก · ผู้ใช้เลือกเขียนกฎไว้ก่อนแล้วค่อย assign · modal บอกเหตุผลตรงๆ ไม่ใช่ซ่อนเมนู
- ปัจจุบัน approver ที่ upload ได้จริงมี **3 คน**: navanit_akra.s (23 ตัว), wimolrat.c + napaporn.k (2 ตัว)

### Validate ไฟล์
- นามสกุล: `zip` `md` `txt` `pdf` `csv` เท่านั้น
- **เช็ค magic bytes ด้วย** (`PK` / `%PDF`) → เปลี่ยนชื่อ `.exe` เป็น `.zip` ไม่ผ่าน ·
  ไฟล์ text ต้องไม่มี NUL byte
- `safeName()` ตัดเหลือ basename → `../../etc/passwd` → `passwd` (กันหลุดออกนอกโฟลเดอร์ของ agent)
- download callable เช็คโดเมนองค์กรซ้ำอีกชั้น (`isOrgEmail`) เพราะตัวมันเองคือด่าน SSO

### สิ่งที่ **ไม่** แตะ
- 38 endpoint ที่ `gitdev.devops.krungthai.com` + 2 ตัวที่ Cloud Run → เป็นระบบคนอื่น VPN คือด่านของเขา
- 2 agent ที่ endpoint ชี้ที่ `/` (Chat Assistant, Copilot) → เป็นลิงก์ "ไปใช้แอป" ไม่มีไฟล์ และแอป login อยู่แล้ว
- `firestore.rules` — **ไม่ต้องแก้** เพราะ `endpointFile`/`endpoint` เขียนโดย Function (admin SDK ข้าม rules)

### Migration
`migrate-skill-files.cjs` → **23 agent · 19 ไฟล์** (7 ตัวชี้ zip ร่วมกัน 3 ไฟล์ + 16 Figma)
- **Figma 16 ตัวถูก zip ทั้งโฟลเดอร์** เพราะ endpoint เดิมชี้ที่ `SKILL.md` ไฟล์เดียวทั้งที่ข้างใน
  มี `references/` + `scripts/` (figma-generate-library 16 ไฟล์, figma-use 21 ไฟล์)
  → **ของเดิมพังอยู่แล้วเงียบๆ** คนโหลดไปได้ SKILL.md ที่อ้างถึงไฟล์ที่ไม่มี · zip แก้ให้ด้วยในตัว
- ⚠️ **ต้อง deploy hosting ก่อนแล้วค่อยรัน migrate** — `/f/` ใช้ได้ต่อเมื่อ SPA ที่ deploy แล้วรู้จัก route นี้
- ⚠️ **ยังไม่ลบ `public/skills/*`** — ตรวจของจริงให้ผ่านก่อน แล้วลบใน commit แยก (ครึ่งนี้ย้อนไม่ได้)

### ⚠️ ข้อควรรู้ที่ยังค้าง
ข้อ 10 ระบุว่าทีม security ขอให้ `wolfy-481609` เป็น **sandbox เท่านั้น** (เหตุผลที่ GitLab integration
โดนพัก) · งานนี้เริ่มเก็บ artifact ของงานจริงไว้ในโปรเจกต์นั้นตอน runtime และ**ต่างจากไฟล์เดิมที่อยู่ใน
git** (มี version, diff, คนรีวิวตอน deploy) — ไฟล์ที่อัปโหลด**ไม่มีสามอย่างนั้นเลย**
ผู้ใช้ตัดสินใจเดินหน้าแล้ว แต่ควรแจ้งทีม security ให้รู้

---

## 25. Ready-to-Use gate + Rename approval (2026-08-19)

### กฎใหม่: จะปรับเป็น 100% ต้องมี endpoint หรือไฟล์แนบก่อน
`markAgentReady` (callable) เป็นทางเดียวที่ทำให้ `devProgress = 100` ได้
- **ต้อง `deploymentStatus === 'approved'` ก่อน** (เดิม rules ก็บังคับ >95 อยู่แล้ว)
- **ต้องมีอย่างใดอย่างหนึ่ง:** `endpoint` เดิม, `endpointFile` ที่อัปไว้, หรือ URL ที่ส่งมาใน call นี้
- ตั้ง `launchDate` ให้อัตโนมัติถ้ายังไม่มี = เวลาที่กดปรับเป็น 100% (เป็นเวลาจริง ไม่ใช่ค่าประมาณ)
- **ไม่ย้อนหลัง** — ทำงานเฉพาะตอน *เปลี่ยนเป็น* 100% ของเดิม 15 ตัวที่ 100% แล้วแต่ไม่มี endpoint
  ถูก grandfather ไว้ และไปโผล่ใน Data Quality Watchlist แทน

### ⚠️ ข้อยกเว้น: Non-reusable ไม่ต้องมี endpoint/ไฟล์ (2026-09-16)
> **อัปเดต 2026-09-24: T4 (Agent + External) ได้รับยกเว้นด้วย** — ทั้ง `AgentDetailModal` (`linkExempt`) และ
> `checkMarkReady()` (server คำนวณ T4 เองให้ตรง `getTier()`) · การ์ด Data Quality บน Dashboard ไม่นับ 2 กลุ่มนี้
Agent/Skill ที่ `reusable === 'Non-reusable'` = เครื่องมือเฉพาะทาง สร้างมาให้ใช้เองคนเดียว
ไม่มีใครอื่นจะ "นำไปใช้ต่อ" ดังนั้นเหตุผลทั้งหมดที่ gate นี้มีอยู่ (ให้คนถัดไปมีทางเข้าถึง) ไม่ใช้กับกรณีนี้
เช็คทั้ง 2 ฝั่ง — ต้องคู่กันเสมอ เพราะ callable เรียกตรงได้โดยไม่ผ่าน UI:
- **client** — `AgentDetailModal.jsx`: `isNonReusable` ซ่อน field Endpoint/Upload ทิ้งไปเลย
  (ไม่ใช่แค่ทำ optional) และข้าม validation ก่อน submit
- **server** — `agentReadyRules.js` `checkMarkReady()`: ข้าม `!endpoint && !hasFile` check
  เมื่อ `agent.reusable === 'Non-reusable'` เท่านั้น (ค่าอื่น เช่น "Reusable with Conditions"
  ยังบังคับเหมือนเดิม)

**วัดจริงตอนแก้:** live agent Non-reusable มี 6 ตัว, 4 ตัวไม่มี endpoint/file แต่**ไม่มีตัวไหน
ค้างที่ 100% อยู่แล้ว** (deploymentStatus approved = 0) → เป็นการปลดล็อกไปข้างหน้าล้วนๆ
ไม่ต้อง backfill/watchlist เพิ่ม

### สิทธิ์ — `functions/agentReadyRules.js` เป็น single source of truth
`checkAgentActor()` = **Creator · Approver/Staff ประจำ Area · Admin**
ใช้ร่วมกันทั้ง `markAgentReady` และ `attachEndpointFile` (ตามโจทย์ที่ว่าแก้ endpoint/ไฟล์
ต้องใช้สิทธิ์ชุดเดียวกับการปรับ 100%)

⚠️ **`createdBy` ใช้ระบุ creator ไม่ได้** — 157/239 ตัวมีค่าที่ไม่ตรงกับ user จริง
เห็นชัดจากค่า `…Z11kTt2`, `…Z11kTt3`, `…Z11kTt162` (uid จริงตัวเดียวต่อเลขจาก CSV import)
→ **ต้องใช้ `creatorEmails` เป็นหลัก** วัดจริงแล้ว: creator grant มาจาก email **548** ครั้ง
จาก uid แค่ **2** ครั้ง · `createdBy` เก็บไว้เป็น fallback ของ doc ที่สร้างผ่านฟอร์มจริง

⚠️ **rules เช็ค area ไม่ได้** — `agentApproveAreas()` เป็น resolver 7 ชั้นใน `src/lib`
เลยต้องใช้ Cloud Function (เหตุผลเดียวกับ `attachEndpointFile`) · ฝั่ง server อ่าน
**stored `approveArea` เท่านั้น** (layer 1 ที่ชนะทุกชั้นอยู่แล้ว) ส่วน client resolve เต็ม —
ถ้าต่างกัน client จะหลวมกว่า ซึ่งปลอดภัย เพราะ server ยังปฏิเสธอยู่ดี

### 🔴 Rename หลังเผยแพร่ — และกับดักที่ต้องรู้
Creator ขอเปลี่ยนชื่อได้หลัง deploy approved โดยเขียนลง `/renameRequests` แล้ว
**Approver ประจำ Area หรือ Admin** ตัดสินผ่าน `decideRenameRequest` (staff ตัดสินไม่ได้,
creator อนุมัติของตัวเองไม่ได้)

**ทำไมต้องเป็น Cloud Function ไม่ใช่ rules** — 3 เหตุผลพร้อมกัน:
1. เช็ค area ไม่ได้ (ข้างบน)
2. `agentName` ถูก **freeze ทุก tier** เมื่อ deploymentStatus เป็น requested/approved
   (เดิมมีแต่ admin ที่ rename ได้ — นี่คือข้อจำกัดที่กำลังปลด)
3. ⚠️ **ต้องแก้ `matchingAgent` ของ sub-skill ลูกใน batch เดียวกัน**

**กับดัก:** `pairedSubSkills()` จับคู่ด้วย **ชื่อ** และ sub-skill เก็บชื่อ parent ไว้ใน
`matchingAgent` · วัดจริง: **20 agent มีลูก, 51 agent เป็นลูก** (VA Agent 7, Guardrail Agent 6)
เปลี่ยนชื่อเฉยๆ โดยไม่แก้ลูก → **ลูกหลุดทั้งหมดทันที** พัง cascade ของ progress/launch,
deploy request, deploy decision, queue de-dup และ lock ของ sub-skill
พิสูจน์แล้วด้วย `functions/verify-rename-cascade.cjs`: มี fix = 51 pairing อยู่ครบ,
ไม่มี fix = **20/20 parent เสียลูกหมด**

### ตัดช่อง endpoint ออกจากฟอร์มแล้ว
ไม่มีใน PreRegModal (ทั้ง agent และ sub-skill) และ EditAgentModal อีกต่อไป
`endpoint` ถูกถอดออกจาก **Tier A / Tier B / RTU branch** ใน `firestore.rules` ด้วย —
เขียนได้ทางเดียวคือผ่าน callable (admin SDK ข้าม rules)

### Key files
| ไฟล์ | หน้าที่ |
|---|---|
| `functions/agentReadyRules.js` | ⭐ **สิทธิ์ + กฎ 100% ที่เดียว** — `checkAgentActor`, `checkMarkReady`, `checkRenameDecider` |
| `functions/verify-agent-ready.cjs` | **รันก่อน deploy** — 29 เคสกับ user/agent จริง (read-only) |
| `functions/verify-rename-cascade.cjs` | **รันก่อน deploy** — พิสูจน์ parity + ว่าลูกไม่หลุด |
| `functions/backfill-launch-date.cjs` | เติม launchDate 17 ตัวจาก `createdAt` (one-off, ทำไปแล้ว) |

### ⚠️ launchDate 17 ตัวเป็นค่าประมาณ ไม่ใช่วันเปิดใช้จริง
ตั้งใจจะใช้ `deployDecidedAt` แต่ **0/17 มีค่านั้น** (เป็น Figma skill ที่ `deploymentStatus: 'none'`
ไม่เคยขอ deploy) ผู้ใช้เลือกใช้ `createdAt` แทนหลังจากได้รับคำเตือนแล้ว
→ ทุกแถวติดธง **`launchDateEstimated: true`** และขึ้น Watchlist เพื่อไม่ให้ค่าประมาณ
ถูกอ่านเป็นข้อเท็จจริง (SYSTEM-OVERVIEW:353) · **ของใหม่ที่ผ่าน `markAgentReady` ไม่ติดธงนี้**
เพราะเป็นเวลาจริง


---

## 26. Email Notifications (2026-08-20)

### 🔴 ก่อนอื่น: มี zombie function ยิงทุก write อยู่
`send-approval-email` **ยัง deploy อยู่และทำงานอยู่ตอนนี้** — เป็น Eventarc Firestore trigger
บน `/agents/{id}` ยิง **2 instance ทุกครั้งที่มีการเขียน** log บอกว่า:
```
Status is not pending, skipping. status=undefined
```
มันเช็ค field `.status` ซึ่งเป็น**ข้อมูลตายแล้ว** (`"active"` 224 doc, ไม่มี 22 doc, `"pending"` **0 doc**)
ระบบจริงใช้ `approvalStatus` → **ไม่เคยส่งอีเมลได้เลย และไปไม่ถึง SMTP ด้วยซ้ำ**

**source ไม่มีอยู่ที่ไหนเลย** — `git log --all -S"nodemailer"` / `-S"sendApprovalEmail"` เจอแต่
commit เอกสาร ไม่เคยมีโค้ดใน repo นี้ (hand-deploy จาก Cloud Shell ยุคก่อน baseline)
→ **เหตุผลใน §9 ที่ว่า "SMTP AUTH ถูก org policy บล็อก" ยืนยันจากสถานะปัจจุบันไม่ได้**
ผู้ใช้เลือกเก็บไว้ก่อน · ระบบใหม่ไม่เกี่ยวข้องกับมันเลย

### สถาปัตยกรรม: callable ไม่ใช่ Firestore trigger
ข้อมูลจริง 2 ตัวเป็นคนตัดสิน:
- **78 agent ใหม่ใน 30 วัน แต่มาจาก UI แค่ 7** (อีก 71 เป็น script/bulk import)
  → callable ถูกเรียกจาก UI เท่านั้น **bulk import ไม่ส่งอีเมลเลยโดยธรรมชาติ** · trigger จะยิงครบ 78
- **cascade**: deploy request บน parent ที่มีลูก 7 = เขียน 8 doc → trigger ส่ง 8 ฉบับต่อ 1 การตัดสินใจ

**ความปลอดภัย 3 ชั้น** (ดู `functions/notifyRules.js`):
1. client ส่งแค่ `{type, agentId}` — **ไม่ได้ระบุผู้รับ** server เป็นคนหา
2. **ทุก event ถูก verify กับ doc จริงก่อนส่ง** — event ปลอมอธิบายสถานะที่ไม่จริง จึงได้ผู้รับ 0 คนแล้วตายไป
3. **1 การกระทำ = 1 อีเมล** — doc ที่มี `matchingAgent` (sub-skill) ถูกข้ามทิ้งเสมอ

### Transport สลับได้ที่ `/config/mail`
`{ enabled, provider, from, replyTo, allowRecipients[] }` — เปลี่ยน provider = แก้ Firestore ไม่ต้อง deploy
- `none` — **ค่าเริ่มต้น** render + log ลง `/mailLog` แต่ไม่ส่งจริง → ตรวจได้ครบก่อนส่งจริงสักฉบับ
- `gmail-oauth` — Gmail API + refresh token ของ `tinnapat.p@arise.tech` (อนาคตเปลี่ยนเป็นกล่องกลาง)
- `smtp-relay` / `resend` — stub ไว้

⚠️ **refresh token อยู่ใน Secret Manager ไม่ใช่ Firestore** — `/config/mail` เก็บแค่สวิตช์ที่ไม่ลับ
env: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`

⚠️ **`allowRecipients` คือเบรกมือตอน rollout** — ถ้าไม่ว่าง จะส่งเฉพาะรายชื่อในนั้นเท่านั้น
ไม่ว่าการ routing จะคำนวณได้ใครก็ตาม · ส่งจริงครั้งแรกให้ใส่แค่อีเมลตัวเอง

### ทำไมใช้บัญชีตัวเองส่งได้โดยไม่ต้องขอ IT
OAuth2 refresh token ของบัญชีตัวเอง = ให้สิทธิ์ตัวเอง ไม่ต้องมี Workspace admin
**หลักฐานว่า consent screen เป็น Internal:** แอปขอ scope `directory.readonly` (sensitive) อยู่แล้ว
และใช้งานได้จริง — `/config/directory` มี **1,936 คน** sync ล่าสุด 2026-08-19 · ถ้าเป็น External+Testing
จะติดเพดาน 100 test user แต่ระบบมี user 195 คนที่ login ได้ปกติ
⚠️ `gmail.send` เป็น **restricted** (เข้มกว่า sensitive) — ควรยืนยัน consent screen ใน Console อีกครั้ง

### 8 จุดเตือน (11 event type)
`agent.pending` · `agent.approved` · `agent.rejected` · `deploy.requested` · `deploy.approved` ·
`deploy.rejected` · `agent.archived` · `agent.ready` · `rename.requested` · `rename.decided` ·
`user.roleChanged`

**ไม่รวม rating** — กันไม่ให้หลุดว่าใครรีวิว (ระบบตั้งใจให้ anonymous)
**`user.roleChanged` ไม่บอกว่าใครเปลี่ยน** — `UserManagementModal` ไม่มี audit field และผู้ใช้เลือกไม่เพิ่ม

### Key files
| ไฟล์ | หน้าที่ |
|---|---|
| `functions/notifyRules.js` | ⭐ **catalog + verify + routing + render ที่เดียว** — pure ทดสอบ offline ได้ |
| `functions/mailer.js` | transport adapter + `allowRecipients` guard |
| `functions/verify-notify.cjs` | **รันก่อน deploy** — 14 เคสกับข้อมูลจริง · `--preview` ดูเนื้อหาอีเมลทุกฉบับ |
| `src/lib/notify.js` | client wrapper fire-and-forget (แบบเดียวกับ `agentEvents.js`) |
| `/mailLog` | audit ทุกครั้งที่พยายามส่ง (sent / dry-run / held / error) — rules: read admin, write false |

⚠️ **เรียก `notifyEvent` ครั้งเดียวต่อ 1 การกระทำ นอก loop cascade เสมอ**

---

## 27. Type = Agent+Skill แก้ได้ + ผูก Skill เดิมจากไลบรารี (2026-08-20)

### "Agent+Skill" เคยแปลได้ 2 อย่างพร้อมกัน — เคาะแล้วว่าอันไหน
| โมเดล | เก็บยังไง | จำนวนจริง |
|---|---|---|
| A — ธงคู่ `aiAgent=true, skillMd=true` ใน doc เดียว | 1 doc | **22** (มาจาก CSV import) |
| B — parent + child skill คนละ doc | หลาย doc | **20** |

**ไม่ทับกันเลยสักตัว** และ `typeToFlags()` ในฟอร์มสร้างได้แต่โมเดล B เท่านั้น (parent ถูกเขียน
`skillMd: false`) → **โมเดล A สร้างจากฟอร์มไม่ได้มาตั้งแต่แรก** ซ้ำร้าย `getType()` อ่านโมเดล A
เป็น `'agent'` ทำให้ 22 ตัวนั้นขึ้นการ์ดว่า **AGENT** แต่ในคิวอนุมัติเขียนว่า **"Agent + Skill"**
(เพราะอ่านธงดิบ) — **ป้ายชื่อขัดกันเองอยู่ก่อนแล้ว**

**เคาะ: Agent+Skill = Agent ที่เรียก skill ทำงาน (parent→child) โดย skill บางตัวใช้เดี่ยวก็ได้**
= โมเดล B → **Type เป็นค่า derived จากการมีลูก ไม่เก็บลง Firestore** · **ไม่แตะ `aiAgent`/`skillMd` เลย**
→ ไม่ต้องแก้ rules เรื่องธง (ทั้งสอง field ไม่อยู่ใน `hasOnly()` ไหนเลย) และ **tier ไม่ขยับ**
`agentTypeLabel(agent, allAgents)` ใน `agentUtils.js` เป็นที่เดียวที่ตอบว่า "นี่ type อะไร"

### 🔴 ผูก skill ของทีมอื่นเคยล้มเหลวเงียบ ~98%
`pairedSubSkills()` บังคับ `sameSubmitter()` (`createdBy` ตรง **หรือ** ชื่อ `creator` ตรง) วัดจริง:
`Writing & Language Craft` จับคู่ได้ 1 จาก 53 agent · `DailySync.md` ได้ **0**
ผูกข้ามทีมแล้ว **หน้าตาเหมือนผูกติด** (`relationshipLabel`/`skillsOfAgent` ไม่เช็ค submitter)
แต่ cascade ทุกตัวไม่ทำงาน — progress/launch, deploy request, deploy decision, queue de-dup, lock

**แก้ด้วย link ตรงด้วย doc ID: `parent.childSkillIds: string[]`**
- `pairedSubSkills()`/`isPairedSubSkill()` เป็น **union** ของ link ใหม่ **หรือ** heuristic เดิม
  ⛔ **ต้องเป็น union ห้ามแทนที่** — 51 pairing ที่มีอยู่ไม่มี `childSkillIds` สักตัว
- **link อยู่บน parent ไม่ใช่ child** เพราะ Tier B ต้องการ `isOwnerCreatorOrApprover(resource.data)`
  ของ **doc ที่กำลังเขียน** → ทีม A เขียนลง skill ของทีม B ไม่ได้ และ child ที่ deploy approved
  ถูก freeze ไปแล้ว · ผลพลอยได้: **multi-parent ได้ฟรี** (มี 4 skill ที่มี 2 parent อยู่แล้ว)
- **ทนการเปลี่ยนชื่อ** ต่างจาก `matchingAgent` ที่เก็บ *ชื่อ* (ดูข้อ 25)

### `cascadeTargets(parent, all)` — กันลากของที่เสร็จแล้วถอยหลัง
เดิมพันจริงในกลุ่ม skill เดี่ยว 129 ตัวที่ผูกได้: **18 ตัวอยู่ที่ 100%**, **55 ตัวมี endpoint ของตัวเอง**
ถ้าผูกเข้ากับ parent ที่เพิ่งเริ่ม (0%) แล้ว cascade ตรงๆ = **ลบงานที่เสร็จแล้วทิ้ง**
กฎ: ข้าม child ที่ progress สูงกว่า parent และข้าม child ที่ deploy approved แล้วแต่ parent ยังไม่
**ใช้แทน `pairedSubSkills` ที่จุด cascade ทุกจุด** (progress save, deploy request, markAgentReady loop)
— จุดแสดงผล/รายการ archive ยังใช้ `pairedSubSkills` ตามเดิมเพราะต้องเห็นลูกครบ

### สลับกลับเป็น Agent = **แค่ยกเลิกการผูก**
`childSkillIds: []` · **doc ของ skill ไม่ถูกแตะเลย** ยังอยู่ในไลบรารีตามปกติ
(เป็น entry อิสระที่ agent ตัวอื่นอาจพึ่งอยู่ด้วย)

### Skill Name field ผูกของเดิมได้ (ทั้ง New และ Edit form)
`src/components/SkillNameInput.jsx` — pattern เดียวกับช่อง Team/Owner แต่**คืนค่าว่าเลือกทางไหน**
`{mode:'existing', id}` vs `{mode:'new', name}` เพราะสองทางนี้แยกกันคนละเรื่องหลังจากนั้น
- ผูกด้วย **doc ID เท่านั้น ห้ามผูกด้วยชื่อ**
- เลือกได้เฉพาะ skill ที่ `approved` + ไม่ archived + ยังไม่ถูกผูกในแถวอื่น
- พิมพ์ทับเมื่อไหร่ = กลับเป็น `mode:'new'` ทันที (กันไม่ให้โชว์ชื่อหนึ่งแต่ถือ id อีกอันข้างใต้)
- **เลือกของเดิม → ข้อมูลทั้งหมด read-only** ดึงจาก `allAgents` ที่โหลดอยู่แล้ว ไม่ยิง query เพิ่ม

### Key files
| ไฟล์ | หน้าที่ |
|---|---|
| `src/components/SkillRow.jsx` | ⭐ **แถว sub-skill ที่ New form กับ Edit form ใช้ร่วมกัน** + `emptySkillRow()` + `validateSkillRows()` — ห้ามเขียนแยกสองที่ |
| `src/components/SkillNameInput.jsx` | combobox ผูก existing / สร้างใหม่ |
| `functions/verify-child-links.cjs` | **รันก่อน deploy** — 15 เคส พิสูจน์ว่าเป็น superset (53 agent resolve เหมือนเดิมเป๊ะ, 51 pairing ครบ) + cascade guard + multi-parent + ป้าย type |

### firestore.rules
`childSkillIds` เป็น **branch ของตัวเอง** (`hasOnly(['childSkillIds','updatedAt'])`, Tier B identity,
freeze เมื่อ deploy requested/approved) เพราะ EditAgentModal เขียนเป็น **Write 4** แยก updateDoc
— เหตุผลเดียวกับ Write 2b/2c ⚠️ **ต้อง publish ผ่าน Console (named DB `ai-agent-lib`)**

⚠️ **Skill ที่สร้างจาก Edit form เข้าคิวอนุมัติเสมอ** — rules `allow create` ไม่มีข้อยกเว้นให้ admin
และบังคับ `approvalStatus == 'pending'`

### วิธีเปลี่ยนชื่อ category (ทำจริงแล้ว 2026-08-20: `CLIX` → `CLICX`)
1. แก้ชื่อใน `VERTICAL_CATEGORIES` (`src/lib/approveAreas.js`) — **ที่เดียว** `CATEGORY_AREA` spread ตาม
2. แก้ `FALLBACK_CATEGORY` + fallback product list ใน `functions/index.js` ให้ตรง
3. **เช็คก่อนเสมอว่ามี agent ตัวไหนติดชื่อเก่าอยู่ไหม** — ถ้ามีต้อง migrate ก่อน ไม่งั้นเหลือ label ค้าง
4. `node functions/seed-approve-area-schema.cjs` (dry run) → ต้องเห็น `+ ชื่อใหม่` กับ `- ชื่อเก่า (RETIRED)`
   อย่างละ 1 บรรทัด **ไม่มีบรรทัดอื่นขยับ** แล้วค่อย `--apply`
   (สคริปต์นี้คือทางเดียวที่ retire category ได้ เพราะ rules บังคับ grow-only)
5. ⚠️ `realign-categories.cjs` / `backfill-product-category.cjs` มีสำเนาชื่อเก่าแบบ **freeze**
   ไว้เป็นประวัติ — **ห้ามแก้และห้ามรันซ้ำ**

---

## 28. Card Sort control (2026-08-20, grilling session)

### เคาะแล้ว 4 ข้อ
| คำถาม | คำตอบ |
|---|---|
| Sort กับ VIEW (group) ทำงานร่วมกันยังไง | **Sort ภายในแต่ละกลุ่ม** — VIEW ยังจัดกลุ่มเหมือนเดิม |
| Agent ไม่มี Launch Date (56/241 = 23%) | **ไว้ท้ายสุดเสมอ** ไม่ว่าทิศทางไหน |
| ทิศทาง Create/Launch Date | **ใหม่สุดก่อน** (ไม่มีปุ่ม asc/desc แยก) |
| จำค่าที่เลือกไว้ข้ามการเปิดเว็บใหม่ไหม | **ไม่จำ** เหมือน VIEW dropdown ที่มีอยู่แล้ว |

### ทำไม launchDate ต้องมี parser กลาง
`launchDate` มี **3 รูปแบบจริงพร้อมกัน**: Firestore Timestamp (134), null/missing (56),
**legacy string `"M/D/YYYY"`** (51 — มาจากยุคก่อน `markAgentReady`) `toJsDate()` ใน
`src/lib/agentUtils.js` เป็นที่เดียวที่แปลงทั้ง 3 แบบ — `fmtDate()` ก็รีแฟกเตอร์ให้ใช้ตัวเดียวกัน
⚠️ **ไม่ได้ import จาก `timeline.js`** แม้จะมี `toDate()` เหมือนกันอยู่แล้ว เพราะ `timeline.js`
import **จาก** `agentUtils.js` อยู่แล้ว (circular) — เป็น debt ที่รู้ตัว มี date-parser ซ้ำอยู่
อย่างน้อย 6 จุดในโค้ด (`toDateInputValue` ×2, `toDateInput`, `toDateStr`, `timeline.toDate`,
`agentUtils.toJsDate`) ยังไม่ได้รวมให้เป็นที่เดียวในรอบนี้ — ถ้าจะแก้ทีหลังต้องยกเครื่องพร้อมกันหมด

### Popularity view ปิด Sort dropdown (ตัดสินใจเองระหว่าง implement ไม่ได้ถาม)
`by-popularity` เป็น flat list ที่จัดอันดับด้วย `demandScore()` อยู่แล้ว ไม่มี "กลุ่ม" ให้ sort ข้างใน
ให้ Sort control แสดงแต่กด `disabled` แทนการซ่อน (เห็นว่ามีอยู่ แต่ใช้ไม่ได้ตอนนี้ เข้าใจง่ายกว่าเมนู
หาย) — เพิ่ม `disabled` prop จริงให้ `Dropdown.jsx` (เดิมไม่มี)

### Key files


### อัปเดต 2026-08-20 (รอบที่สอง) — Default View/Sort + Category grouping
- **VIEW default เปลี่ยนจาก By Owner → By Category** และเพิ่ม **By Category** เป็นตัวเลือกใหม่
  (เดิมมีแค่ Owner/Role/Ability/Popularity) — `groupAgents(agents, 'category')` ใช้
  `agentCategories(agent)` ตัวเดิม (multi-value เหมือน role/ability, §23) ไม่ต้องเขียน logic ใหม่
- **SORT default เปลี่ยนจาก Name → Create Date**
- **ตัดคำว่า "(Default)" ออกจาก label ทุกจุด** — ทั้ง VIEW และ SORT dropdown ไม่มีวงเล็บบอก default
  อีกต่อไป (ค่า default บอกด้วยพฤติกรรม ไม่ใช่ข้อความในตัวเลือก)
- **"ยอดนิยม" → "Popularity"** (ภาษาอังกฤษ ตามกฎข้อ 6 ล่าสุด)
- Category ที่ live agent 0 ตัวไม่มี ณ ตอนนี้ (243/243 มี category ครบ) แต่ยังเผื่อ `(unassigned)`
  bucket ไว้เหมือน Owner — ป้องกันข้อมูลหลุดหายจาก grid เงียบๆ ถ้า category ว่างในอนาคต

| ไฟล์ | หน้าที่ |
|---|---|
| `src/lib/agentUtils.js` | `toJsDate()`, `SORT_OPTIONS`, `sortAgents()`, `groupAgents()` (+ key `'category'`) |
| `src/components/CardGrid.jsx` | เรียก `sortAgents()` ต่อกลุ่ม (`byGroup`) และ unassigned bucket (owner + category) |
| `src/components/ControlBar.jsx` | VIEW/SORT dropdown, `disabled` เมื่อ view = by-popularity |
| `src/components/Dropdown.jsx` | เพิ่ม `disabled` prop จริง (คลิก/keyboard ถูกปิด + opacity ใน theme.css) |
| `functions/rename-team-amp-cin.cjs` | one-off: เปลี่ยนชื่อทีม "AMP&CIN" → "Project Committee" (ทำไปแล้ว 2026-08-20) |

---

## 29. Batch 2026-08-20 (รอบเย็น) — queue badge, chat gap-matching, cascade picker

### 🔴 Rename queue ที่สาม แต่ badge นับแค่ 2 คิว
`pendingBadgeCount()` นับแค่ `pending + deployRequests` ส่วน rename request **ถูก fetch อยู่ใน
`PendingApprovalModal` เอง** ทำให้ badge มองไม่เห็นเลย → มีคำขอค้างอยู่โดยไม่มีตัวเลขชี้ไปหา
**นี่คือบั๊กชนิดเดียวกับที่ `pendingQueue.js` ถูกสร้างขึ้นมาแก้ (2026-08-12) แต่เกิดซ้ำกับคิวที่ 3**
→ ย้าย filter มาเป็น `visibleRenameRequests()` ใน `pendingQueue.js` · App.jsx subscribe
`/renameRequests` แล้วส่งเป็น prop ลงมา (listener เดียว ป้อนทั้ง badge และ modal)

⚠️ **rename ใช้เกณฑ์แคบกว่าอีก 2 คิว** — `canDecideRename` = admin **หรือ** approver ประจำ area
เท่านั้น (committee และ staff ตัดสินไม่ได้) ตรงกับ `RENAME_DECIDER_ROLES` ฝั่ง server เป๊ะ
เพราะฉะนั้น `queueViewer()` ต้องพก `role` + `isAdmin` + `areaList` ดิบมาด้วย จะยุบเป็น
`fullAccess` (admin||committee) อย่างเดียวไม่ได้ · request ที่หา agent ไม่เจอถูกตัดทิ้งทั้ง 2 ที่
(ไม่งั้น badge จะสัญญาแถวที่ modal วาดไม่ได้)

### Layout ของ Rename row ที่เพี้ยน
ใช้ `.btn-row` ขณะที่อีก 2 คิวใช้ `.queue-actions` — `.btn-row` ตั้ง `.btn-sm { flex: 1 }`
(ปุ่มยืดเต็มความกว้าง สำหรับ footer ของ modal) และ **ไม่มี `flex-shrink: 0`** พอไปอยู่ใน
`.queue-row` ที่เป็น flex เลยโดนบีบ → เปลี่ยนเป็น `.queue-actions` + ทำให้ section
แสดง empty-state เหมือนอีก 2 คิว (เดิมซ่อนทั้ง section ตอนว่าง)

### 🔴 Chat ตอบ "ของที่มีอยู่เอาไปปิด gap ไหนได้" ไม่ได้ เพราะ tool ไม่มีแกนนั้น
ผู้ใช้ถาม "Agent/Skill ที่ไม่ได้ผูก SDLC process มีตัวไหนช่วยปิด gaps ได้บ้าง" → ALPHA ตอบว่า
"ไม่มีฟังก์ชันสำหรับกรอง" **ซึ่งถูกต้องตามความจริงตอนนั้น** — `query_library` กรองได้แค่
"ผูกกับ process ไหน" ไม่มีทางถาม "ยังไม่ผูกกับอะไรเลย"
**วัดจริง: 116 จาก 243 ตัว (48%) ไม่มี process mapping · 29 จาก 58 process ไม่มี agent เลย**
→ เพิ่ม `sdlcMapped: 'mapped' | 'unmapped'` ใน `query_library` (ทั้ง `skills.js` และ
tool declaration ใน `chatPrompt.js`) + เขียน workflow 4 ขั้นลง system prompt:
gap list → unmapped list → `capability_search` ต่อ gap → **จับคู่และให้ความเห็นเอง**
กฎที่คุมไว้: ชื่อ agent/process ทุกตัวต้องมาจากผลลัพธ์ tool จริง · ห้ามพูดว่า agent
"ถูกผูกกับ" process ที่ยังไม่ผูก (ให้พูดว่า "น่าจะเอาไปใช้กับ...ได้") · กฎห้าม force-fit ใช้ที่นี่ด้วย

⚠️ **`regression.cjs` แกว่ง 16/17 เป็นปกติ** — รัน baseline (ยังไม่แก้ prompt) 2 ครั้งได้ 16/17
ทั้งคู่แต่ **ตกคนละเคสกัน** เป็น non-determinism ของโมเดล ไม่ใช่ regression
เวลาเช็คว่าการแก้ prompt ทำอะไรพัง **ต้องรัน baseline เทียบด้วยเสมอ อย่าดูรอบเดียวแล้วสรุป**

### Cascade progress: จากเงียบและบังคับ → เห็นและเลือกได้
เดิม save progress ที่ parent = เขียนทับลูกทุกตัวเงียบๆ · ตอนนี้มี checkbox list
"Share Progress With" ในฟอร์ม update progress **ติ๊กครบทุกตัวเป็นค่าเริ่มต้น**
(พฤติกรรมเดิมไม่เปลี่ยนถ้าผู้ใช้ไม่แตะ) แล้ว filter ด้วย `cascadePick` ที่ **ทั้ง 2 จุด**
(branch 100% ที่เรียก `markAgentReady` และ branch updateDoc ปกติ)
⚠️ list มาจาก `cascadeTargets()` ไม่ใช่ `pairedSubSkills()` — ลูกที่ล้ำหน้า parent อยู่แล้ว
ถูกกันออกตั้งแต่ต้นทาง ถ้าเอามาโชว์แล้วให้ติ๊กจะเป็นการสัญญา write ที่ guard จะปฏิเสธอยู่ดี

### View ตามฟิลเตอร์
เลือก filter Owner / Role หรือกด Category ใน sidebar → สลับ VIEW เป็น **By Owner** ทันที
(เหตุผล: กรอง category เดียวแล้วจัดกลุ่มตาม category = ได้ header เดียวไร้ประโยชน์ ·
กรอง owner แล้ว owner ที่เลือกไม่โผล่ใน heading เลย) ทำที่ **setter** ไม่ใช่ `useEffect`
เพื่อให้ยิงเฉพาะตอนผู้ใช้กดจริง และไม่ไปสู้กับการเปลี่ยน VIEW ด้วยมือทีหลัง
— pattern เดียวกับ group-exclusivity ของ sidebar ที่มีอยู่แล้ว

### ตัดป้าย "ไฟล์ในระบบ · <ชื่อไฟล์>" ออก
เหลือป้าย **"ลิงก์ภายนอก"** อย่างเดียว · ข้อกำหนด §24/§25 ที่ว่า "ต้องบอกว่าเป็น URL หรือไฟล์"
ยังอยู่ แต่ตอนนี้สื่อด้วย **การมี/ไม่มีป้าย** แทน — และครึ่งที่ต้องใช้คำเตือนจริงๆ คือฝั่ง
"กำลังจะออกไปนอกระบบ" ไม่ใช่ฝั่งไฟล์ของเราเอง


---

## 30. ⚠️ TEMPLATE_TOOLS = กับดักที่ทำให้ workflow หลายขั้นทำงานไม่ได้ (2026-08-20)

### อาการที่ผู้ใช้เจอ
ถามให้ ALPHA จับคู่ Agent/Skill กับ SDLC gap → ตอบว่า "กำลังตรวจสอบ… โปรดรอสักครู่" แล้วหยุด ·
ถามซ้ำ → ได้ **card list 116 รายการดิบๆ + ปุ่มโหลด CSV** ไม่มีการวิเคราะห์ · ถามซ้ำอีก → เริ่มใหม่
เหมือนลืมคำถาม **สามอาการนี้มาจากสาเหตุเชิงโครงสร้าง 3 อย่าง ไม่ใช่ prompt เขียนไม่ดี**

### 🔴 สาเหตุที่ 1 — `TEMPLATE_TOOLS` ตัดจบเทิร์นทันที
`ChatAssistant.jsx` มี `TEMPLATE_TOOLS = { query_library, query_sdlc, get_agent_detail,
connection_suggest }` — ผลของ tool กลุ่มนี้ถูก **render เป็นการ์ดที่ client แล้ว `break` ออกจาก loop
ทันที ไม่ส่งกลับให้โมเดล** (ออกแบบไว้เพื่อประหยัด cost)

**แต่ workflow จับคู่ gap ขั้นที่ 2 คือ `query_library({sdlcMapped:'unmapped'})` พอดี**
→ โมเดลขอรายชื่อมาเพื่อวิเคราะห์ แต่ client พิมพ์เป็นการ์ด 8 ใบแล้วจบเทิร์น
**โมเดลไม่เคยเห็นผลลัพธ์เลย จับคู่ไม่ได้ตั้งแต่แรกโดยโครงสร้าง**

→ แก้ด้วย `isAnalysisCall(name, args)` — **เกณฑ์อยู่ที่ ARGUMENT ไม่ใช่ชื่อ tool**
`query_library({owner})` = browse (render การ์ด) · `query_library({sdlcMapped})` = analysis
(ส่งกลับให้โมเดล) · เป็นการ generalize ข้อยกเว้น `query_sdlc({withAgentCounts})` ที่มีอยู่เดิม
⛔ **เพิ่ม argument วิเคราะห์ใหม่ให้ tool ที่อยู่ใน TEMPLATE_TOOLS เมื่อไหร่ ต้องเพิ่มใน
`isAnalysisCall()` ด้วยเสมอ ไม่งั้นจะเจอบั๊กเดิมซ้ำ**

### 🔴 สาเหตุที่ 2 — `MAX_LOOP = 3` ไม่พอ
workflow ต้องใช้ query_sdlc → query_library → capability_search → **compose** = 4-5 รอบ
พอเกิน loop จะตกไปที่ `finalText === null` → ตอบ "ขอโทษครับ ลองถามใหม่อีกครั้งนะครับ"
→ **ขึ้นเป็น 6** · ถ้าจะเพิ่ม workflow หลายขั้นอีกในอนาคต ต้องเช็คเพดานนี้ก่อนเสมอ

### 🔴 สาเหตุที่ 3 — โมเดลตอบว่า "กำลังตรวจสอบ" แล้วจบเทิร์น
**นี่คือบั๊กเดียวกับที่ §15 บันทึกไว้ว่าแก้แล้วด้วยกฎใน prompt — และมันกลับมาอีก 2 ครั้ง**
บทเรียน: **กฎใน prompt บังคับพฤติกรรมนี้ไม่ได้จริง ต้องดักที่ client**
→ `isStallAnswer(text)` ใน `ChatAssistant.jsx`: ถ้าคำตอบเข้า `STALL_RE`
(กำลังตรวจสอบ/โปรดรอ/เดี๋ยวผม/จะดำเนินการ…) **และ** ไม่มี `@@` **และ** ยาว < 500 ตัวอักษร
→ ไม่รับเป็นคำตอบสุดท้าย วน loop ต่อพร้อม nudge (สูงสุด 2 ครั้ง)

⚠️ **สาเหตุที่ 3 คือคำอธิบายของอาการ "เหมือนมันลืมคำถาม" ด้วย** — `toolResults` เป็น per-turn
พอ stall แล้วจบเทิร์น ผลลัพธ์ tool ที่หามาได้ทั้งหมด**หายทิ้งหมด** เทิร์นถัดไปเริ่มจากศูนย์

### บทเรียนรวม
เพิ่ม "ความสามารถ" ให้แชทด้วยการแก้ prompt + เพิ่ม tool parameter อย่างเดียว **ไม่พอ**
ต้องไล่ดู control flow ของ `ChatAssistant.jsx` ด้วยว่า workflow ที่เขียนไว้ใน prompt
**รันจนจบได้จริงไหม** (template short-circuit / เพดาน loop / เงื่อนไขจบเทิร์น)


---

## 31. 🔴 แชทกุชื่อ Agent ขึ้นมาเอง — และวิธีที่แก้ (2026-08-20)

### สิ่งที่เกิดขึ้นจริง
หลังเปิดให้ ALPHA "จับคู่ Agent/Skill กับ SDLC gap เอง" มันเสนอชื่อพวกนี้ให้ผู้ใช้:
`Vendor Proposal Compliance Validator` · `Contract Validator Assistant` ·
`Contract Monitoring Assistant` · `Vendor Screening & Qualification Assistant` ·
`Self-service test data creation` · `Test Data`
**ตรวจกับ Firestore แล้ว: ไม่มีสักตัวเดียวจาก 251 doc — กุขึ้นมาทั้งหมด 6/6**
ผู้ใช้อ่านแล้วเชื่อว่าองค์กรมีเครื่องมือพวกนี้อยู่จริง — นี่คือความเสียหายที่ร้ายแรงที่สุดของ
เครื่องมือประเภท catalog

### ทำไมถึงกุ (ไม่ใช่เพราะ prompt เขียนไม่แรงพอ)
prompt เขียนห้ามไว้ชัดเจนแล้วว่า "ชื่อทุกตัวต้องมาจากผลลัพธ์ tool" **แต่มันกุอยู่ดี**
เพราะถูกสั่งให้ทำงานที่ทำไม่ได้: `query_library({sdlcMapped:'unmapped'})` คืน
**ชื่อ + owner + tier เท่านั้น ไม่มี description** → จับคู่กับ process จากชื่อล้วนๆ ไม่ได้
พอทำงานที่สั่งไม่ได้ โมเดลก็เติมช่องว่างด้วยชื่อที่ "ฟังดูน่าจะใช่"

> **บทเรียน: ถ้าให้โมเดลทำงานที่ข้อมูลในมือทำไม่ได้ มันจะกุ ไม่ใช่ยอมแพ้
> การเพิ่มคำสั่ง "ห้ามกุ" ในprompt แก้ไม่ได้ ต้องแก้ที่ว่ามันมีข้อมูลพอไหม**

### วิธีแก้: ย้ายการจับคู่ออกจากโมเดล ไปคำนวณใน `skills.js`
tool ใหม่ **`sdlc_gap_match`** — ระบบจับคู่ให้เสร็จแล้วส่งให้โมเดล **โมเดลมีหน้าที่แค่
"อธิบาย + จัดลำดับ"** ชื่อที่มันไม่ได้รับมา จะพิมพ์ออกมาไม่ได้เชิงโครงสร้าง
(หลักการเดียวกับ @@ card protocol ข้อ 18 — ไม่ให้โมเดลผลิตข้อเท็จจริงที่ต้องอาศัยความจำ)

### ⚠️ เกือบพลาดซ้ำรอยข้อ 18: อย่าจัดอันดับด้วย trigram
เวอร์ชันแรกของ tool นี้จัดอันดับด้วย `scoreText()` (keyword/trigram) — **วัดผลจริงแล้วได้ขยะ**:
`Proposal and TOR` → "AI Agent Library Chat Assistant" (score 60) ·
`Legal & Compliance` → "TDG – Test-Driven Generation"
คือการสร้าง lexical matcher ที่ข้อ 18 อุตส่าห์รื้อทิ้งไปแล้วขึ้นมาใหม่ · shortlist ที่เต็มไปด้วย
ขยะไม่ได้ดีกว่าการกุชื่อเท่าไหร่ — มันแค่ย้ายความสับสน

**สัญญาณที่ใช้จริง = Approve Area (ข้อ 20)** ซึ่งเป็น mapping ที่คนคัดไว้แล้ว:
- `PROCESS_AREA[processId]` ครอบคลุม **29/29 gap process**
- candidate = unmapped agent ที่ `agentApproveAreas()` มี area เดียวกัน
- ผลจริง: จาก 116 ตัว เหลือ pool ละ 0-16 ตัวที่สมเหตุสมผลตามสายงาน
- `scoreText` เหลือหน้าที่แค่ **จัดลำดับภายใน pool** ไม่ได้ตัดสินว่าใครเข้า/ไม่เข้า

**ผลลัพธ์จริง: matched 17 · noCandidate 12 · candidate 41 ตัว มีจริงทุกตัว 100%**
⭐ **`noCandidate` คือฟีเจอร์ ไม่ใช่ข้อบกพร่อง** — process กลุ่ม SIT ได้ pool=0 เพราะไลบรารี
ไม่มีอะไรรองรับจริงๆ **การตอบว่า "ไม่มี ต้องสร้างใหม่" คือคำตอบที่ถูก** เวอร์ชัน trigram
เคยยัดเยียด candidate ให้ทุก gap จนไม่เหลือคำว่า "ไม่มี" เลย

### กฎถาวร
⛔ **ห้ามให้โมเดลเป็นคนผลิตชื่อ entity จากไลบรารีเด็ดขาด** ไม่ว่าจะเป็น agent/skill/process
ชื่อต้องมาจาก tool result เสมอ · ถ้าจะเพิ่มความสามารถ "วิเคราะห์/จับคู่/แนะนำ" อะไรก็ตาม
ให้ถามก่อนว่า **"ข้อมูลที่ส่งให้โมเดลพอให้ทำงานนี้จริงไหม"** ถ้าไม่พอ → เขียนเป็น tool ที่คำนวณ
ให้เสร็จ อย่าสั่งให้โมเดลเดา


---

## 32. Batch 2026-09-23 — Owner edit / Virtual Assistant / ลบ Process Owner filter / merge ทีมนก

> 📄 **รายละเอียดเต็มอยู่ที่ [`docs/CHANGELOG-2026-09-23.md`](docs/CHANGELOG-2026-09-23.md)**
> (เหตุผลเบื้องหลังทุกข้อ + ตัวเลขที่ตรวจกับ Firestore จริง + verification ที่รัน)

สรุปสั้น — **ขึ้น production ครบแล้ว** commit `5ce006c` + `a786a31`:

1. **Tech Innovation 15 ตัว → `reusable: 'Non-reusable'`** (`functions/backfill-ti-reusable.cjs`)
   ต้องใช้ Admin SDK เพราะทั้ง 15 อยู่ 100%/approved → `isReadyToUseLocked` ซ่อน field
2. **Admin แก้ Owner ได้ในฟอร์ม Edit** เมื่อ `normalizeProgress(devProgress) < 100`
   — `canEditOwner()` ใน `agentUtils.js` · `ComboInput` (owner เป็น free text ไม่ใช่ enum)
   · **Write 2d = updateDoc แยก** (เหตุผลเดียวกับ Write 2b/2c/4 §27)
   · **ไม่ต้องแก้ rules** เพราะ branch `isAdmin()` อนุญาตทุก field อยู่แล้ว
3. **Category `Virtual Assistant`** — คีย์**แรกสุด**ของ `CATEGORY_AREA` = กลไกปักบนสุด sidebar
   (⛔ ย้ายบรรทัดนั้น = ย้ายตำแหน่ง) · แท็ก **28 doc แบบ append** (`tag-virtual-assistant.cjs`)
   · ⚠️ map ไป `Platform, DevOps & Operations` เพราะ **"Conversational AI / NLP" ไม่มีใน
   `AREA_ORDER` 16 ค่า** — มีผลกับของใหม่เท่านั้น (28 doc มี stored area = layer 1 ชนะ)
4. **ลบ filter Process Owner** ออกจาก `SDLCTab.jsx` — ⛔ **เก็บข้อความ display-only ไว้**
5. **merge `นกต่อ`/`นกรู้`/`นกคุ้ม` → `นกลงทุน`** (13 doc, แก้ทั้ง `owner` และ `team`) +
   retire 3 ชื่อจาก `/config/schema.team` (65→62, ต้องใช้ Admin SDK เพราะ rules เป็น grow-only)
   · ⛔ **ไม่แตะ `agentName`** — §25: ลูกเก็บชื่อ parent ใน `matchingAgent` rename เงียบๆ = ลูกหลุด
   · ⏸️ ยังค้าง: 11 ชื่อที่มี prefix นก รอเคาะรูปแบบ (`agent_0132/0133` ใช้ `Nok -` อังกฤษ)

**ไม่ได้ deploy functions และไม่ได้ publish rules ในรอบนี้** · ไม่ต้อง rebuild vector เพราะ
`buildEmbedText()` ไม่ได้ embed `reusable`/`owner`/`team` · **ไม่แตะไฟล์ Workshop เลย**

---

## 33. Role Group = Primary ที่ AI จำแนก + เก็บใน DB · Blueprint สี Human/AI (2026-09-24)

### ที่มา
การ์ด Role Coverage เดิมนับ **ทุก role** (1 รายการนับได้หลายการ์ด ยอดรวม ~326) · ผู้ใช้ต้องการ
**1 รายการ = 1 กลุ่ม (Primary)** · pilot Gemini read-only 5 รอบ เทียบกับ sheet ที่คนจัดเอง:
v5 = **Name → Description (TBC → name+role) → Related Role (ยืนยัน) → Output (ยืนยัน)** ตรงกับคน
**88% (166/189)** ดีที่สุด · ใส่ relatedRole ก่อน description = ถอยกลับไปจัดตาม "คนสร้าง" (เช่น
banking chatbot ติด AI Engineer → Software Engineer)

### Field บน `agents` (เขียนด้วย Admin SDK)
`roleGroup` (1 ใน 15 key ของ `ROLE_GROUP_ORDER`) · `roleGroupSecondary` (≤2) · `roleGroupReason` ·
`roleGroupSource` (`'ai'` | `'admin'`) · `roleGroupAt`
- **ไม่ต้องแก้ rules**: ไม่อยู่ใน `hasOnly()` ไหน → user ทั่วไปเขียนไม่ได้ · admin แก้ผ่าน branch `isAdmin()` (Write 2e)
- ไม่ embed → ไม่ต้อง rebuild vector

### ⛔ กฎเหล็ก: AI ไม่เขียนทับ
`needsRoleGroup()` = approved + ไม่ archived + **ยังไม่มี `roleGroup`** เท่านั้น · ตัวเลขที่เคยวิเคราะห์แล้ว
ต้องไม่ขยับเอง (ผู้ใช้สั่ง) · แก้ได้ทางเดียวคือ admin เลือกใน Edit form (`roleGroupSource:'admin'`)
· รายการที่จัดแล้วถูกส่งให้ AI ดูเป็นตัวอย่าง (`pickExamples`: role/category ทับกัน ≤20) ให้ของใหม่สอดคล้อง

### เส้นทาง
- **approve** → `PendingApprovalModal.handleApprove` เรียก `classifyRoleGroups([parent, ...siblings])`
  **ครั้งเดียวนอก loop** fire-and-forget (`src/lib/roleGroupClassify.js`) → callable `classifyRoleGroup`
- **เก็บตก** → แถบ "Classify Missing Items" ในหน้า Role Group Management (โผล่เฉพาะเมื่อมีรายการยังไม่จำแนก, admin เท่านั้น, `missingOnly`)
- **ยังไม่ถูกจำแนก** → การ์ดใช้ alias ตัวแรก (`roleGroupsOf()[0]`) + header บอก "N awaiting classification"
- ⚠️ bulk import/สคริปต์ไม่ผ่านปุ่ม approve → ต้องกดเก็บตกหรือรัน `backfill-role-group.cjs`

### Blueprint (เฉพาะกล่องนี้ — ส่วนอื่นของ Dashboard ยังใช้ ST_DEF)
`hitlLevel(progress, hml)` ใน `status.js`: To Do → **Human** `#004E85` · In Progress/Pilot/Ready+`hml` →
**Gen AI + Human** `#FF761E` · Ready + `!hml` → **Gen AI** `#0EB678` (สีวัดจาก pixel รูปที่ผู้ใช้ให้)
· tile = level ที่ **มีมากที่สุด** ใน process (เสมอ → เอียงไปทาง AI) · ผลจริงวันแรก: Gen AI 0 tile
เพราะใน process ส่วนใหญ่ ของที่ Ready+ไม่มี HML ยังเป็นเสียงข้างน้อย — ถูกต้องตามกฎ ไม่ใช่บั๊ก

### Key files
| ไฟล์ | หน้าที่ |
|---|---|
| `functions/roleGroupRules.js` | ⭐ prompt v5 + schema enum + `needsRoleGroup` + `pickExamples` + `classifyWithAi` ที่เดียว |
| `functions/verify-role-group.cjs` | **รันก่อน deploy** — 14 เคส offline รวม key ตรงกับ `src/lib/roleGroups.js` |
| `functions/backfill-role-group.cjs` | เติมครั้งแรก (dry-run default) · เขียนเฉพาะที่ยังไม่มี |
| `src/components/DashboardRoleView.jsx` | การ์ด Primary + Blueprint 3 สี |
| deploy | `npx firebase-tools deploy --only functions:classifyRoleGroup,manageRoleGroups` (scoped เสมอ §11) |

### Role Group Management (2026-09-24, รอบ 2)
- ⭐ **`/config/roleGroups` = source of truth ของกลุ่ม** `{groups:[{key,label,roles,definition}], history[]}`
  ลำดับ array = ลำดับการ์ด · **`key` ห้ามเปลี่ยน** (เป็นค่าใน `agent.roleGroup`) แก้ได้แค่ `label`
  · ⛔ **ห้าม hardcode กลุ่มในโค้ดอีก** — `ROLE_GROUP_ORDER`/`RAW` ใน `roleGroups.js` และ
  `DEFAULT_ROLE_GROUPS` ใน `functions/roleGroupAdminRules.js` เหลือเป็น fallback + seed เท่านั้น
- เมนู ☰ **Role Group Management** (admin + committee) → `RoleGroupManagerModal.jsx`
  → callable **`manageRoleGroups`** (ไม่แก้ rules; `/config/{id}` client เขียนได้แค่ admin อยู่แล้ว)
  action: `upsertGroup` · `reorder` · `deleteGroup {key, moveTo}` (บังคับเลือกปลายทาง) ·
  `moveItem` (แก้รายตัว → `roleGroupSource:'admin'`) · `reclassifyGroup` (AI จัดใหม่ **เฉพาะ AI-set**)
- แก้ role/definition ของกลุ่ม = มีผลกับการจำแนก **ของใหม่** (prompt สร้างจาก config) · ของเดิมไม่ขยับ
- ช่อง Role Group ใน Edit form **ถูกเอาออกแล้ว** — แก้รายตัวผ่านหน้า Management เท่านั้น
- `useRoleGroups()` (`src/hooks`) อ่าน config สด · `seed-role-groups.cjs` สร้าง doc ครั้งแรก (ไม่ทับของเดิม)

---

## Portfolio task links = Adoption (2026-09-25)

- Portfolio task `agents[]`/`skills[]` (these hold **names**, not ids) are counted as adoption: **1 task + 1 agent = 1**, added into `agentStats.endpointClicks`. Removing the link or deleting the task subtracts it. **`task.contribute` does not count.**
- Trigger `syncPortfolioAdoption` (Library `functions/index.js`) watches the `portfolio` DB and reads only. Markers are stored in `agentEvents/{agentId}__task__{projectId}__{taskId}` (`kind:'task'`). The counter moves only when a marker is created or deleted, inside the same transaction.
- Rules: `functions/portfolioAdoptionRules.js` (checked by `verify-portfolio-adoption.cjs`). Reconcile: `portfolioAdoption.js`. Backfill: `backfill-portfolio-adoption.cjs` (dry-run by default, `--apply`).
- Name matching: only approved agents, case/space folded. A name shared by 2 or more agents is skipped. Renames approved after 2026-09-25 store `previousName` so the old name still matches; older renames have no alias.
- Usage Report shows these rows with Source = Portfolio, Adopter = the task PIC, and the project/task name.

---

## Microsoft Teams notifications (2026-09-28)

- Provider `teams-flow` (`functions/mailer.js`) **replaces email**. It is switched in `/config/mail.provider`, so no redeploy is needed. Rollback: set `provider: 'none'`.
- Path: `notifyEvent` → `buildNotification` (same routing as email) → one POST per recipient to a Teams Workflow ("When a Teams webhook request is received" → "Post card in a chat or channel", Flow bot, Chat with Flow bot, Recipient = `triggerBody()?['recipient']`, Card = `triggerBody()?['card']`).
- The webhook URL is stored **only** in Secret Manager `TEAMS_FLOW_URL`. Never put it in Firestore, git or chat.
- `/config/mail.teamsDomains`: only these domains are sent to (the Flow bot can DM only people in the flow owner's tenant). Everyone else is logged in mailLog as `skippedDomain`. `allowRecipients` is the rollout guard.
- ⛔ **Approver notifications go only to `tinnapat.p@arise.tech` — user order 2026-09-28. Keep it this way until the user says to change it.**
  - This is set in `/config/mail.approverOverride: ['tinnapat.p@arise.tech']`. It replaces the approver side of every event: `agent.pending`, `deploy.requested`, `rename.requested`, and the approver half of `agent.ready`.
  - Creator/requester notifications go to the **real** people.
  - `teamsDomains` = `arise.tech`, `infinitaskt.com` (krungthai.com not tested yet, so it is not included). `allowRecipients` is empty.
  - Do not remove `approverOverride` or change `teamsDomains` yourself.
- **Email via the same Flow (2026-09-28):** `/config/mail.emailEnabled: true`. Every recipient (any domain, including krungthai.com) gets an email; Teams is sent only within `teamsDomains`. The payload carries `teams`/`email`/`html` for each recipient.
  - The flow checks each flag with `string(triggerBody()?['email'])` compared to the text `true`. Comparing against a boolean ends up false.
  - Email is sent with "Send an email (V2)", From (Send as) = `ai.agent.library.group@infinitaskt.com`. This is a **Microsoft 365 Group, not a shared mailbox**: "Send from a shared mailbox" fails with `ErrorGroupIsUsedInNonGroupURI`.
  - The Teams branch has run-after set to success/failed/skipped, so if email fails Teams still sends.
  - To stop only email: `emailEnabled: false`.
- The card gets a deep link: approver events → `/?view=pending`, other events → `/?agent=<id>`. `App.jsx` opens it after login, then strips the params. Ready to Use with an http endpoint also gets an "Open Endpoint" button. Test: `node functions/verify-teams.cjs`.

---

## Skill → Agent link requests (2026-09-30)

- **Cause of wrong links:** `PreRegModal` used to write the AI's `suggested_matching_agent` straight into `matchingAgent` at submit, and **nobody confirmed it** (e.g. Deck Builder → JO Deck Generator, another team's agent).
- **Now:**
  - Only a Skill whose submitter ticks "Request link to …" gets `linkSuggestion: {agentId, agentName, status:'pending', source:'ai'}`. `matchingAgent` stays empty.
  - The request waits in the Pending queue, section **Link Request**.
  - Accept = callable `decideLinkSuggestion` → adds the skill to `target.childSkillIds` (a doc-ID link, §27).
  - While it waits, the skill stays an independent item.
- **Who may decide:** admin · staff · approver of the **target agent's** area (stored `approveArea`) · creator of **either side**. Committee is not included.
  - Server: `functions/linkRules.js` (`verify-link-rules.cjs` 10/10). Client mirror: `canDecideLink()` in `pendingQueue.js`. Counts toward the badge.
- **Notifications:** `link.requested` → creators of the target agent + approvers (approverOverride applies). `link.decided` → creators of the skill.
- **Display:** the "Agent" row on a skill = `agentsOfSkill(skill, allAgents)` = union of `matchingAgent` (only names that still exist) + parents that link by `childSkillIds`.
- **Data cleaned 2026-09-30:**
  - 7 parent names that no longer existed: `CA: Fraud Detection` → `Fraud Detection`, `Nok - Compliance` → `นกลงทุน - Compliance`, `CA: Income reconcile` → cleared.
  - 3 Tech Innovation `.md` files: Guardrail Agent → `VA Agent (Orchestrator Agent)`.

---

## Users reset to role "user" by themselves (incident 2026-10-01)

- **Symptom:** tanyarat.r@infinitaskt.com went from Committee to user and lost all 16 Approve Areas. An admin restored her at 08:39.
- **Cause (two bugs together):**
  1. `useAuth.js` provisioned whenever the `/users/{uid}` snapshot said the doc was missing. A **cache-only** snapshot during a network blip says exactly that.
  2. `claimPendingRoleGrant` then ran `userRef.set({role:'user'...})` **without merge**. The Admin SDK bypasses rules, so it overwrote the real doc.
  - Evidence: Auth account since 2026-07-01, but users `createdAt` = 2026-10-01 06:39, which matches a claim call at 06:39 in Cloud Logging.
- **Others affected:** these docs were recreated by the same bug: jaruwat.w (09-28), titiphong.t (09-29), supitchaya.w (09-22). They were already `user`, so the user confirmed nothing needs changing. Detection = users `createdAt` much later than the Auth `creationTime`. PITR is off (retention 1h), so previous roles cannot be read back.
- **Fix:**
  - The server is create-only: `functions/userProvision.js` `createUserDocOnce()` uses `.create()` and does nothing if the doc exists.
  - The client ignores a `fromCache` missing doc (`includeMetadataChanges`).
  - New trigger `auditUserRole` writes every role/approveAreas change to `/userRoleAudit`. `source` is admin-ui / provision / delete / other. UserManagementModal stamps `updatedBy`.
  - No alert and no PITR (user decision).
- Test: `node functions/verify-user-provision.cjs` (9 cases).

---

## Approve Area / Category update (2026-10-01)

- **Approve Area is now 20:**
  - "Governance, Risk & Procurement" was split into **Governance & Compliance** + **Procurement**. Process 1.3 → Procurement; 1.4/1.6, the category Compliance & Governance, and the roles Compliance Officer/CIO → Governance & Compliance. The 10 people who held the old area got both new ones.
  - Added **People**, **Resource Management** and **Financial**. Nobody holds them yet; the user will assign them.
- **New categories:**

  | Category | Area |
  |---|---|
  | People Development | People |
  | Resource Planning | Resource Management + Delivery Management |
  | Financial | Financial |
  | Procurement | Procurement |

  - Resource Planning is the first category that maps to **2 areas**. A `CATEGORY_AREA` value may now be an array, and layer 5 plus `seed-approve-area-schema.cjs` support it.
- **Sidebar order** = the key order of `CATEGORY_AREA`, grouped Management / Design / Engineering / Quality / Operations / Products. Virtual Assistant stays first.
- **Retagged (append):**
  - Resource Planning: Skill Matching and Resource Allocation, tshirt-sizing, demand-request-generator, Timeline Estimation
  - People Development: Security People Intelligence Agent, fast-onboard
  - Financial: AI Governance, AI Governance Cost Estimation, AI Governance Proposal Deck Builder
  - Procurement: nothing yet
- **Rename:** "AI Governance Cost Planner" → **AI Governance** (`previousName` kept). Similarity Check moved from Copilot to AI Governance.
- **Recheck results:**
  - The resolver has 0 orphans; every item resolves to an area.
  - Live AI check: 4 test drafts each got the matching new category/area, and a draft with no fitting category got `proposed_new_category`.
- ⚠️ **Known gaps (not fixed):**
  - The AI picks only 1 area for Resource Planning work and that value is stored (layer 1 wins), so Delivery Management is not added automatically.
  - The old category proposal "Orchestration & Automation" (approved 2026-08-07) is no longer in the schema and no item uses it.
  - `verify-notify.cjs` (11 cases for 13 events) and `verify-agent-ready.cjs` (hard-coded 26 Platform agents, real count is 40) were already failing before this change.
