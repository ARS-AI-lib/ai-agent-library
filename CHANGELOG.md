# AI Agent Library — Changelog (Cumulative)

> บันทึกการพัฒนาทั้งหมดตั้งแต่เริ่มต้นจนถึงปัจจุบัน  
> Project: Krungthai Group / Arise · Stack: React + Vite + Firestore + Firebase Auth · GCP: `wolfy-481609`

---

## Phase 1 — Foundation (Pre-Phase 4)

### Core App & Auth
- React + Vite app ตั้งต้น, Firebase Auth (Google SSO) จำกัด domain: `@arise.tech`, `@infinitaskt.com`, `@krungthai.com`
- Roles: `user` / `staff` / `approver` / `committee` / `admin`
- 3 React apps บน Firebase Hosting site เดียว: Agent Library (`/`), SDLC Tracker (`/sdlc/`), Portfolio (`/portfolio/`)

### Data & Migration
- Re-migration agent 144 ตัวเข้า Firestore (named database: `ai-agent-lib`)
- SDLC catalog migrate เข้า Firestore: 57 processes + 106 use cases
- Owner/Creator backfill รันแล้ว (`backfill-owner-creator.cjs`)
- CSV parsing: character-by-character พร้อม quote-state tracking

### Pre-Registration Feature (AI-Assisted)
- Cloud Function `analyzeDuplicate` (`functions/index.js`) → Vertex AI (Gemini 2.5 Flash, `thinkingBudget:0`)
- Features: duplicate/overlap detection, `integration_suggestions`, `tech_stack_hint`, `suggested_ability`, `overall_risk`
- Pre-reg field `compatibleAgents` (array of agent doc IDs, Type=Skill only)

---

## Phase 2 — SDLC Tracker (SDLCTab)

- `SDLCTab.jsx` + `SDLCTab.css` implement ครบ
- Board view: Stage/Process grid, Process card พร้อม status breakdown
- Use Case view: By Stage / By Process, coverage stats

---

## Phase 3 — UI Redesign + Sign-in Branding

- Fresh light theme, unified accent blue, card restructure
- **Sign-in screen:** พื้นหลัง network/circuit SVG (opacity 0.05), ปุ่ม Google sign-in, footer "Powered by Wolfy"
- **Wolfy logo:** `public/wolfy-logo.png` (Nav/sign-in) + `public/wolfy-chat.png` (chat button 250×250)
- **Nav bar:** subtitle "Powered by Wolfy", Timeline เปิด same tab

---

## Phase 4 — Feature Batch (2026-07-06) — Shipped

### Status Legend Overhaul
- ลบ "Not Start" ออก → `ST_ORDER = ['td', 'ip', 'pilot', 'ru']`
- **To Do** = grey (`#6b7280`), **Pilot** = blue (`#3d5a8e`) — สีใหม่สอดคล้องกันทุกจุด
- 0% agent → bucket `'td'` (ไม่ใช่ `'ns'` อีกต่อไป)
- มีผลทุกส่วน: Library cards, SDLC tab, Adoption, Timeline, StatusLegend

### SDLC Timeline Page
- Canvas-based Gantt, access-gated: `/config/timeline.viewers[]` (admin bypass)
- Multi-agent dot → list popup ก่อน → detail modal
- On track = olive green (`#8ea82a`), Pilot = blue — สีแยกชัดเจน
- "← Back to Library" ใช้ `window.location.href = '/'`

### Chat Assistant "ALPHA" (v1) — 2026-07-02
- **Persona:** ชื่อ ALPHA, พูดไทย ลงท้าย "ครับ", ไม่เอ่ยชื่อองค์กร
- **Architecture:** Client-mediated function-calling, Cloud Function `chatLibrary`, max 3 loops/question
- **Tools:** `query_library`, `query_sdlc`, `capability_search`, `get_agent_detail`, `connection_suggest`
- **Guardrails:** client-side blocklist (`chatGuardrails.js`), server-side system prompt, read-only เสมอ, session-only ไม่เก็บ transcript
- **Chat: Resize + Expansion (2026-07-06):** drag resize ซ้าย panel (340–640px), persist `localStorage`
- **Integration/tech-stack Q&A:** ALPHA ตอบ REST/webhook/MQ, `tech_stack_hint` ใน PreRegModal
- Chat button "Ask ALPHA": 38px pill, ยุบเป็น circle ✕ ตอน panel เปิด

### Staff Role
- `ROLES = ['user','staff','approver','committee','admin']`
- Staff export All Data ได้ (Approved + Pending + Rejected)
- Firestore rules: `isKnownUser()` รวม `'staff'`

### TagMultiSelect (Custom Related Role)
- `src/components/TagMultiSelect.jsx` — free-add role ใหม่ได้, persist ไป `/config/schema.relatedRole`
- Firestore rules: grow-only rule `/config/schema` — known user เพิ่ม relatedRole ได้

### Paired Sub-Skill Lock & Cascade
- **Pairing signal:** `sameSubmitter(a,b)` — `createdBy` ตรง OR `creator` ตรง
- Sub-skill lock: ซ่อนปุ่ม update-progress + deploy-request, แสดงข้อความ "Status และ Progress จะปรับตาม Agent หลัก"
- Cascade จาก parent: progress + launchDate + developmentPhase → `pairedSubSkills()` ทุก save
- Deploy request/decision cascade ไป sub-skills ด้วย

### Form UI Fixes
- `ComboInput` แทน `<select>` สำหรับ Reusable (readOnly) และ Use Case
- Placeholder color สม่ำเสมอ, `.fg .combo-wrap input { width:100%; height:36px }`

---

## Phase 5 — Permissions + Edit Enhancements (2026-07-xx)

### Compatible Agents Field
- Skill เลือก Agent ที่ทำงานร่วมกันได้ (Type=Skill เท่านั้น)
- `AgentMultiSelect.jsx` — closed-list multi-select, ไม่ free-add
- เก็บเป็น `compatibleAgents: []` (array of agent doc IDs)
- แสดงใน PreRegModal, EditAgentModal, AgentDetailModal
- Firestore rules: เพิ่ม `'compatibleAgents'` ใน detail-edit hasOnly()

### User Permissions Split (Tier A / Tier B)
- **Tier A (details, ไม่ sensitive):** staff, committee, owner, creator, admin — แก้ได้เมื่อยังไม่ขอ deploy
  - Fields: `agentName, description, input, output, compatibleAgents, customerFacing, internalUse, coreAbility, relatedRole, reusable, reuseCondition, hml, humanJob`
- **Tier B (sensitive):** admin, owner(`createdBy`), creator(`creatorEmails`), approver(`approvedBy`)
  - Fields: `creator, creatorEmails, launchDate, devProgress, developmentPhase`
- `canEditDetails(agent, user, userRole, isAdmin)` — helper ใน `agentUtils.js`
- `canEditSDLC(agent, user, userRole, isAdmin)` — เฉพาะ createdBy/staff/approver/admin
- Creator picker lock: ล็อกเป็น read-only chips เมื่อ `!canEditSensitive`
- **firestore.rules:** แยก branch Tier A + Tier B + SDLC + helper `isOwnerCreatorOrApprover()`
- Committee เสีย blanket write → ยังคง approve/reject/deploy-decision ผ่าน `isApproverOrAbove()`

### SDLC Fields in Edit Form
- EditAgentModal เพิ่ม SDLC Stage / Process Mapping / Use Case (Internal only, mirror New form)
- **Two-write save:** write Tier A/sensitive แยกจาก write SDLC → affectedKeys แต่ละ write ตรง rule branch เดียว
- Approver-role ล้วน → fieldset Tier A disabled, แก้ได้เฉพาะ SDLC
- `lookupDirectoryNames(emails)` ใน `directory.js` — resolve email → display name สำหรับ creator chips
- **Bug fix:** `catalogLoaded` flag ป้องกัน effect ล้าง sdlcProcessMapping ก่อน catalog โหลดเสร็จ

### Creator Display Fix
- **PreRegModal:** `creator` field เขียนชื่อครบทุกคนในทีม ไม่ใช่แค่ submitter
- **EditAgentModal:** save เขียน `creator` display คู่ `creatorEmails` → card/detail อัปเดตทันที
- **`backfill-creator-names.cjs`:** script ใหม่ resolve creatorEmails → ชื่อจาก `/config/directory` → เติม `creator` ให้ agent เดิมทั้งหมด

---

## Phase 6 — SDLC Tab & Adoption Improvements (2026-07-xx)

### Use Case Filter by Process Mapping
- Use Case dropdown (ทั้ง PreRegModal + EditAgentModal) กรองตาม Process ที่เลือกไว้
- Join: `sdlcUseCases.processId` ↔ process id prefix จาก `extractProcessId()`
- Fallback: ถ้าไม่เลือก process → แสดงทุก use case (permissive default)

### processLabel() Helper
- `processLabel(p)` ใน `agentUtils.js` — แสดง `"${id} ${name}"` แต่ถ้า id===name โชว์ครั้งเดียว
- แก้ bug 18/58 process docs ที่ `id` === `name` ทำให้ label ซ้ำสองรอบ (เช่น "Performance Test Scripting Performance Test Scripting")
- Data fix: `k6-performance` sdlcProcessMapping ถูกแก้ตรงใน Firestore แล้ว

### Non-SDLC Grouping Split
- UC view แยก 2 กลุ่ม:
  - **"Missing Use Case"** (สีน้ำตาล `#8c6b45`) — มี Stage/Process แต่ไม่มี Use Case
  - **"Non-SDLC"** (สีเทา `#7a85a3`) — ไม่มี Process mapping เลย
- `nonSdlcUC` ใช้ set เดียวกับ `nonSdlcBoard` (reconcile แล้ว ไม่ undercount)
- `noUseCaseOnly` — คนละ set กับ Non-SDLC จริงๆ

### Process Card Color — Plurality/Mode
- `dominantStatus(counts)` — เลือกสีตาม **status ที่มีจำนวนมากที่สุด** ไม่ใช่ status สูงสุดที่มีอยู่
- กรณีเสมอ: weighted average (td=1, ip=2, pilot=3, ru=4) → **round half down** (conservative)
- ตัวอย่าง: 3 To Do + 1 IP + 1 Pilot → สีเทา (ถูกต้อง); 2 RU + 1 Pilot + 1 IP → สีเขียว (ถูกต้อง); 4-way tie → In Progress
- ใช้ทั้ง ProcessCard และ NonSdlcBoardCard

### Non-SDLC Filter Pill
- Toggle pill **"Non-SDLC"** ข้างปุ่ม "Has agent"
- กดแล้วทั้ง Board view และ Use Case view เรียก `renderNonSdlcFilter()` เดียวกัน
- แสดงทั้ง 2 กลุ่ม (Missing Use Case + Non-SDLC) เสมอ ไม่ว่าจะอยู่มุมมองใด
- รวมใน `clearFilters()`

---

## Infrastructure & Dev Notes

### Firestore Rules (Named DB `ai-agent-lib`)
- ต้อง publish ผ่าน Console → named DB dropdown (ไม่ใช่ `(default)`)
- Helpers: `isAdmin()`, `isCommittee()`, `isApproverOrAbove()`, `isKnownUser()`, `isCreatorEmail()`, `isOwnerCreatorOrApprover()`, `userRole()`
- Rule branches ปัจจุบัน: new-entry, approve/reject, self-withdraw, deploy-request, progress-update, Tier A detail, Tier B detail, SDLC metadata, deployment decision, deploy cascade

### Deploy Workflow (เปลี่ยนวิธี 2026-07-22 — deploy ตรงจาก local, เลิกใช้ Cloud Shell)
- Source เดียว = **local + git** (`origin = github.com/ARS-AI-lib/ai-agent-library`, branch `main`). Cloud Shell retired (local diff-verified == deployed ก่อนสลับ)
- **Hosting:** `npm run build && npx firebase-tools deploy --only hosting --project wolfy-481609` (targets `main`=`wolfy-481609` + `pretty`=`wolfy-ai-library`)
- **Preview ก่อน promote (แนะนำ):** `npx firebase-tools hosting:channel:deploy <name> --project wolfy-481609` → URL ชั่วคราว ไม่แตะ live
- **⚠️ Functions — shared project กับ Portfolio:** ห้าม `deploy --only functions` เปล่าๆ (จะลบ functions ของ Portfolio) — scope เสมอ: `--only functions:analyzeDuplicate,chatLibrary`
- **Firestore rules:** ยัง publish ผ่าน Console (named DB `ai-agent-lib`) — `firebase.json` ไม่มี firestore block โดยตั้งใจ
- Rollback: Firebase เก็บ release เดิม → Console → Hosting → release history

### Key Files
| ไฟล์ | หน้าที่ |
|---|---|
| `src/lib/tier.js` | `getType()`, `isSkill()` |
| `src/lib/agentUtils.js` | `canEditDetails()`, `canEditSDLC()`, `canUpdateProgress()`, `processLabel()`, `dominantStatus()` (SDLCTab), `extractProcessId()`, `agentProcessIds()`, `pairedSubSkills()` |
| `src/lib/status.js` | `ST_DEF`, `ST_ORDER`, `progressBucket()`, `agentStatus()` |
| `src/lib/directory.js` | `lookupDirectoryNames()`, `warmDirectory()`, `syncDirectoryToFirestore()` |
| `src/components/EditAgentModal.jsx` | Edit form พร้อม Tier A/B/SDLC gating, two-write save |
| `src/components/AgentDetailModal.jsx` | Detail + inline progress edit, Compatible agents display |
| `src/components/SDLCTab.jsx` | Board + UC view, Non-SDLC split, Process card color |
| `src/components/AgentMultiSelect.jsx` | Closed-list multi-select สำหรับ compatibleAgents |
| `src/components/TagMultiSelect.jsx` | Free-add tag input สำหรับ Related Role |
| `src/components/ComboInput.jsx` | Text + dropdown, readOnly mode สำหรับ Reusable |
| `src/components/ChatAssistant.jsx` | Floating chat UI, drag-resize |
| `functions/index.js` | `analyzeDuplicate` + `chatLibrary` Cloud Functions |
| `firestore.rules` | Security rules |
| `backfill-creator-names.cjs` | Backfill creator display field |
| `backfill-owner-creator.cjs` | Backfill owner/creator จาก Sheet |

---

*Last updated: 2026-07-20*
