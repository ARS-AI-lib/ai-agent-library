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

---

## 7. AI Pre-Registration Feature (Locked Design)

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

**⚠️ กฎเหล็ก — โปรเจกต์ `wolfy-481609` แชร์กับแอป Portfolio:** ทั้ง 2 แอปอยู่ GCP project เดียวกัน
- **ห้ามรัน `firebase deploy` เปล่าๆ หรือ `--only functions` เปล่าๆ เด็ดขาด** — functions ที่ deploy จริงมี 6 ตัว (ของ AI Lib: `analyzeDuplicate`, `chatLibrary`, `send-approval-email` · ของ Portfolio: `files`, `logProjectActivity`, `logTaskActivity`) แต่ `functions/index.js` ใน local มีแค่ 2 ตัว → unscoped deploy จะเสนอ **ลบ** functions ที่เหลือ (รวมของ Portfolio). เวลาต้องแก้ functions ให้ scope เสมอ: `--only functions:analyzeDuplicate,chatLibrary`
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
