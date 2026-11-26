# System Overview — AI Agent Library Suite v2

> **อ่านไฟล์นี้ก่อนเริ่มงานทุกครั้ง** แล้วค่อยดู `CLAUDE.md` สำหรับกฎปฏิบัติและประวัติรายฟีเจอร์
> ตรวจกับโค้ด + production จริงล่าสุด **2026-11-26** (HEAD `776f0dd`) — ถ้าขัดกับเอกสารอื่น **ให้ยึดไฟล์นี้**
> ตัวเลขที่เปลี่ยนเร็ว (จำนวน agent/function) วัดจาก Firestore + `functions:list` ตอนนั้น — **รันเช็คใหม่ก่อนอ้างอิง**
> และไปแก้ที่อื่นให้ตรง

---

## 0. สรุป 60 วินาที

เว็บแอปภายในองค์กรสำหรับ **ลงทะเบียน · ค้นหา · ติดตาม AI agents/skills** แทนระบบเดิมที่ใช้ Google Sheets
ปัจจุบัน approved + ไม่ถูก archive = **361 รายการ** (รวมทุกสถานะ 379 doc: archived 10 · rejected 8 · pending 0) · มีผู้ใช้ 552 คน

จุดที่ทำให้ระบบนี้ไม่ใช่ CRUD ธรรมดา คือ **AI 3 ส่วน**:
1. **ตรวจซ้ำตอนลงทะเบียน** — กันคนสร้าง agent ที่มีอยู่แล้ว
2. **แชท ALPHA** — ถามภาษาคนว่า "มีตัวไหนช่วยเรื่อง X" แล้วได้คำตอบจากข้อมูลจริง
3. **Semantic search** — เบื้องหลังของทั้งสองอัน (embeddings)

นอกจากนั้นมีงานรอบ ก.ย.–พ.ย. ที่ใหญ่พอจะรู้จักไว้: **การแจ้งเตือน Teams/อีเมล** (รวม delay alert ทุกจันทร์) ·
**ไฟล์แนบ + versioning** · **Role Group (AI จำแนก)** · **Usage report** · **Workshop** · **Inbox + ประกาศ**

**สถานะ:** ทุกอย่าง deploy แล้วและใช้งานจริง (ล่าสุด Inbox + announcements 2026-11-17) อยู่ในโหมด **เฝ้าดู + บำรุงรักษา** ไม่มีงานสร้างใหญ่ค้าง

---

## 1. ระบบนี้แก้ปัญหาอะไร

องค์กรมีคนสร้าง AI agent/skill กระจายหลายทีม เกิดปัญหา:
- **ไม่รู้ว่ามีอะไรอยู่แล้ว** → สร้างซ้ำ
- **ไม่รู้ว่าตัวไหนใช้ได้จริง** → หยิบของที่ยังไม่เสร็จไปใช้
- **ไม่รู้ว่า SDLC ตรงไหนยังไม่มี AI ช่วย** → ลงทุนผิดจุด

ระบบตอบ 3 ข้อนี้ด้วย: ทะเบียนกลาง + สถานะความพร้อมใช้ + การ map เข้า SDLC process จริง

**ผู้ใช้:** ทีม Dev/Product/QA/Design ทั่วองค์กร (ผู้ลงทะเบียนและผู้ค้นหา) + ผู้บริหาร (ดู Dashboard)

---

## 2. สถาปัตยกรรมจริง (as-built — ตรวจกับโค้ดแล้ว)

### ⚠️ แก้ความเข้าใจผิดที่เอกสารเก่าเคยเขียนไว้
`CLAUDE.md` §2 เคยเขียนว่า *"3 React apps แยกกัน: `/`, `/sdlc/`, `/portfolio/`"* — **ไม่ตรงกับของจริง**

ของจริงคือ:

```
repo นี้ = SPA เดียว (Vite + React, ไม่ใช้ router library — เลือก component จาก pathname ใน main.jsx)
│
├── /              → App.jsx          ← มี 3 แท็บข้างใน: Agent Library · SDLC AI Adoption · Dashboard
├── /timeline      → TimelinePage.jsx ← access-gated ผ่าน /config/timeline
├── /usage         → UsageReportPage.jsx   ← รายงาน adoption (callable usageReport)
├── /workshop      → WorkshopPage.jsx      ← บอร์ด workshop แยกขาดจาก library (ดู docs/WORKSHOP.md)
└── /f/{agentId}   → FileDownloadPage.jsx  ← ประตู SSO ก่อนโหลดไฟล์แนบ (ดู CLAUDE.md §24)
```

**Portfolio เป็นคนละแอป คนละ repo คนละ hosting site** (`wolfy-portfolio`) — อยู่แค่ GCP project เดียวกัน
เท่านั้น **นี่คือเหตุผลของกฎเหล็กเรื่อง scoped functions deploy ในข้อ 8**

### Hosting (จาก `.firebaserc` + `firebase.json`)
| target | site | หมายเหตุ |
|---|---|---|
| `main` | `wolfy-481609.web.app` | โดเมนหลักตาม project id |
| `pretty` | `wolfy-ai-library.web.app` | ตัวที่ใช้จริง/แชร์ให้คนอื่น |

ทั้งสอง deploy จาก `dist/` ชุดเดียวกัน มี rewrite `**` → `/index.html` (SPA)

### Cloud Functions (asia-southeast1, Node 22)
`functions/index.js` ของ repo นี้ export **21 ตัว** (นับ 2026-11-26) แต่บน production project `wolfy-481609` มี **~76 ตัว**
เพราะแชร์กับแอปอื่น — **รัน `firebase functions:list --project wolfy-481609` ก่อนแตะ functions ทุกครั้ง**

| กลุ่ม | function | หมายเหตุ |
|---|---|---|
| AI | `analyzeDuplicate` · `chatLibrary` · `classifyRoleGroup` | **`gemini-3.5-flash`** จาก `functions/modelConfig.js` (`GEN_MODEL`) — ใช้ `thinkingLevel` ไม่ใช่ `thinkingBudget` · chat = LOW |
| Search | `embedQuery` (rate limit 20/นาที/คน) · `reindexAgentVectors` (`full:true` เช็ค admin ฝั่ง server) | `text-multilingual-embedding-002` @256 |
| Workflow | `markAgentReady` · `decideRenameRequest` · `decideLinkSuggestion` · `manageRoleGroups` | สิทธิ์เช็คฝั่ง server ทั้งหมด |
| ไฟล์ | `attachEndpointFile` · `getEndpointFile` · `listEndpointVersions` | เก็บ latest + previous · bucket ปิด ไม่มี public |
| รายงาน/ตัวนับ | `recordAgentEvent` · `submitRating` · `usageReport` | `/agentEvents` client อ่านไม่ได้ |
| แจ้งเตือน | `notifyEvent` · `delayAlertsMon` (scheduler จันทร์ 13:00 Bangkok) · `sendDelayDigest` (Cloud Tasks) | ส่ง Teams + อีเมลผ่าน Flow (`/config/mail`) |
| Trigger/ความปลอดภัย | `claimPendingRoleGrant` · `auditUserRole` (เขียน `/userRoleAudit`) · `syncPortfolioAdoption` | ทุก onCall ต้องผ่าน `requireCompanyUser()` |

> ⚠️ **ของแอปอื่นในโปรเจกต์เดียวกัน (ไม่ใช่ repo นี้):** Portfolio (`files`, `logProjectActivity`, `logTaskActivity`,
> `pullLibraryToTask`, `pushTaskProgressToLibrary`, `requestDeployFromPortfolio`, `syncTaskCommentSummary`, `*Contribute*`),
> VoteCup (`votecup*` ~50 ตัว), Governance (`governance*`) · และ **`send-approval-email`** ที่ยัง deploy อยู่แต่ **ไม่มี source เลย**
> (zombie ยิงทุก write บน `/agents` แล้วข้ามเพราะเช็ค field `.status` ที่ตายแล้ว — ดู CLAUDE.md §26)
> → unscoped deploy จะเสนอ **ลบทั้งหมดนี้** · **ดูข้อ 8 ก่อน deploy functions ทุกครั้ง**

### Firestore — named database `ai-agent-lib` (ไม่ใช่ `(default)`)
| collection | เนื้อหา | เขียนโดย |
|---|---|---|
| `agents` | ตัวหลัก — agent/skill ทุกตัว (379 doc · live 361) | client (ตาม rules) + function |
| `agentVectors` | embedding 256 มิติ ต่อ 1 agent | **function เท่านั้น** |
| `agentStats` · `agentEvents` · `endpointFiles/…/endpointVersions` | ตัวนับ used/rating · event marker · ประวัติไฟล์แนบ | **function เท่านั้น** (client อ่านไม่ได้/เขียนไม่ได้) |
| `sdlcProcesses` | 58 process | script |
| `sdlcUseCases` | 82 use case (เดิม 106 — ลบชื่อซ้ำ ดู CLAUDE.md §21) | script |
| `users` · `userRoleAudit` | role + approveAreas · log การเปลี่ยน role | self-create ตอน login แรก (create-only) / admin / trigger |
| `config` | `schema` (category 26 · team 70) · `timeline` · `dashboard` · `directory` · `roleGroups` · `mail` · `alerts` | admin (ยกเว้น schema grow-only) |
| `renameRequests` · `categoryProposals` · `alertRuns` · `mailLog` | คิวคำขอ + audit การส่งแจ้งเตือน | ตามแต่ละฟีเจอร์ |
| `announcements` · `users/{uid}/inbox` | ประกาศ (audience 3 ระดับ) · read state | committee/admin (ประกาศ) · เจ้าของ (inbox) |
| `analysisRuns` · `metrics` · `rateLimits` | KB ตรวจซ้ำ · ตัวนับแชทไม่เก็บข้อความ · rate limit | client(submit) / **function เท่านั้น** |
| `workshopTeams` · `workshopIdeas` · `ideationStickers` | หน้า /workshop — **แยกขาด ห้ามแตะ `/agents`** | ตาม rules ของ workshop |

> ⚠️ **ต้องระบุชื่อ DB เสมอ** — `getFirestore(app, 'ai-agent-lib')` ถ้าเรียก `getFirestore(app)`
> เปล่าๆ จะไปชี้ default DB ที่ว่างเปล่า

---

## 3. Data model

### สถานะความพร้อมใช้ (`devProgress` → bucket)
คำนวณจากตัวเลขล้วน ไม่ได้อ่านจาก `developmentPhase` (field นั้นเป็นแค่ข้อความสะท้อนผล):

| devProgress | bucket | ป้าย | ความหมาย |
|---|---|---|---|
| 100 | `ru` | Ready to Use | ใช้ได้เต็มที่ |
| 90-99 | `pilot` | Pilot | ใช้ได้แต่ยังทดสอบอยู่ |
| 11-89 | `ip` | In Progress | ยังใช้ไม่ได้ |
| 0-10 | `td` | To Do | ยังใช้ไม่ได้ |

- ⚠️ `devProgress` **อาจเป็น string `"90%"` หรือ number `90`** — **ห้าม normalize เอง**
  ใช้ `normalizeProgress()` จาก `agentUtils.js` เท่านั้น
- bucket `ns` (Not Start) **ถูกยกเลิกแล้ว** ตั้งแต่ 2026-07-06 — 0% ตกลงมาที่ `td`
- โค้ดที่ใช้: `src/lib/status.js` (`ST_DEF`, `ST_ORDER`, `phaseForProgress`, `agentStatus`)

### Tier (คำนวณสด ไม่เก็บใน DB)
```
isSkill = (aiAgent === false && skillMd === true)   // อย่างอื่น = Agent

Internal/External (เรียงตามลำดับ — แก้ 2026-08-07):
  customerFacing === TRUE → External
  internalUse === TRUE    → Internal
  ทั้งคู่ว่าง              → Internal (default)
  // เดิม step 3/4 เดาจาก sdlcStage แล้ว fallback External — พิสูจน์แล้วว่าผิดกับข้อมูลจริง 24 ตัว

T1 = Skill+Internal · T2 = Agent+Internal · T3 = Skill+External · T4 = Agent+External
```
ใช้ `getType()` / `getTier()` จาก `src/lib/tier.js` — **ห้ามเขียน logic เดาเอง**
(ส่วน "Agent+Skill" = Agent ที่มี skill ลูก — derived จาก `childSkillIds`/`matchingAgent` ผ่าน `agentTypeLabel()` ไม่เก็บใน DB, CLAUDE.md §27)

### สถานะเชิงกระบวนการ (คนละแกนกับ devProgress)
- `approvalStatus`: `pending` → `approved` | `rejected` (ผ่านคิวอนุมัติ)
- `deploymentStatus`: `none` → `requested` → `approved` | `rejected`
  (ประตูกั้นไม่ให้ดัน progress เกิน 95% เองโดยไม่มีคนอนุมัติ)
- `archived`: `true` = ซ่อนจากไลบรารี/แชท **แต่ยังใช้ตรวจซ้ำ** (ดูข้อ 5)

### Field ที่พลาดง่าย
- `sdlcProcessMapping` — เก็บเป็น **string** เช่น `"1.2 Deep Research & Benchmark"`
  ดึง id ด้วย `agentProcessIds()` / `extractProcessId()` (regex `^(\d+\.\d+[A-Za-z]?)\b`)
- `useCase` — เดิม string ตอนนี้เป็น array ใช้ `agentUseCaseNames()`
- `sdlcUseCases` **ไม่มี field `stage`** — ต้อง join ผ่าน `processId` ไป `sdlcProcesses`
- `endpoint` — optional, ต้องผ่าน `safeEndpointUrl()` เสมอ (กัน `javascript:` / `data:`)
- `internalTool: true` — ไฟล์ prompt ภายใน + tool ของ ALPHA เอง (กดอันดับตอนค้นหา)

---

## 4. สิทธิ์ (6 ระดับ)

`ROLES = ['user', 'workshop', 'staff', 'approver', 'committee', 'admin']` (`workshop` = เหมือน `user` ใน library แต่เข้า `/workshop` ได้)
เก็บที่ `/users/{uid}.role` · คนใหม่ที่ login ด้วยโดเมนที่อนุญาต **auto-provision เป็น `user`**

> **`approveAreas` = Approve Area 20 ค่า (ไม่ใช่ SDLC stage แล้ว ตั้งแต่ 2026-08-10 · 16→20 เมื่อ 2026-10-01)**
> single source of truth: `src/lib/approveAreas.js` → `AREA_ORDER` + `agentApproveAreas()`
> รายละเอียดเต็ม (fallback chain 7 ชั้น, สิทธิ์แก้ field, กฎห้าม inline) อยู่ใน **CLAUDE.md ข้อ 20** · category (26 ค่า) แก้ได้เฉพาะ admin (§23) · sidebar จัดกลุ่มเป็น 7 หมวดยุบได้ (§34)

| ทำอะไรได้ | user | staff | approver | committee | admin |
|---|:-:|:-:|:-:|:-:|:-:|
| ดูไลบรารี / ใช้แชท | ✅ | ✅ | ✅ | ✅ | ✅ |
| ลงทะเบียน idea ใหม่ | ✅ | ✅ | ✅ | ✅ | ✅ |
| อัปเดต progress ของตัวเอง | ✅ | ✅ | ✅ | ✅ | ✅ |
| Export All Data | — | ✅ | — | ✅ | ✅ |
| อนุมัติ (ตาม approveAreas) | — | — | ✅ | ✅ | ✅ |
| Archive / Unarchive | — | ✅ เฉพาะ area ตัวเอง | ✅ | ✅ | ✅ |
| แก้ field `approveArea` | — | ✅ | — | — | ✅ |
| แก้ทุก field | — | — | — | ✅ | ✅ |
| โพสต์ประกาศ (Inbox) | — | — | — | ✅ | ✅ |
| จัดการ user | — | — | — | — | ✅ |
| Rebuild Search Index | — | — | — | — | ✅ |

- **Login จำกัดโดเมน:** `@arise.tech`, `@infinitaskt.com` (สะกดนี้ถูกแล้ว — ยืนยันหลายรอบ)
- **`isAdmin` = `role === 'admin'` เท่านั้น** ส่วน `isCommittee` รวม admin ด้วย (คนละความหมาย ระวังสับสน)
- ⚠️ **การซ่อนปุ่มใน UI ไม่ใช่การป้องกัน** — callable เรียกตรงได้ ต้องเช็คสิทธิ์ฝั่ง server ด้วย
  (บทเรียนจริง: `reindexAgentVectors` เคยซ่อนแค่ปุ่ม)

---

## 5. Archive — ทำไมไม่ใช่ delete

Archive = ซ่อนจากการ**แนะนำ** แต่ยังอยู่ในระบบเพื่อใช้**วิเคราะห์**

```
recommendLib(ctx)  → ตัด archived ออก   → query_library, capability_search, get_agent_detail
analysisLib(ctx)   → รวม archived ด้วย  → search_library, duplicate_check, connection_suggest
```

เหตุผล: *"เคยมีคนทำแล้วเลิกไปเพราะ X"* คือข้อมูลที่คนกำลังจะลงทะเบียนใหม่**ต้องรู้** — ถ้าลบทิ้งจะมีคน
สร้างซ้ำทางตัน ตัว `analyzeDuplicate` ได้รับ `archived` + `archiveReason` ไปด้วยเพื่อเตือนแทนที่จะแนะนำ

---

## 6. AI ทั้ง 3 ส่วน (สำคัญที่สุดของระบบ)

### 6.1 Semantic Index — รากฐานของอีกสองส่วน

```
agent doc ─→ buildEmbedText() ─→ Vertex embedding ─→ /agentVectors/{id}
             (name+desc+input+output+ability+role+useCase+businessValue)
```

- **Model: `text-multilingual-embedding-002` @ 256 มิติ** — ตัวเลือกนี้**วัดมาแล้ว ไม่ใช่ค่า default**
  `gemini-embedding-001` แย่กว่าเพราะ native 3072 มิติ ย่อเหลือ 256 แล้วคะแนนกระจุก แยกของดี/ของมั่วไม่ออก
- **ปัดทศนิยม 4 ตำแหน่ง** → payload 1.26MB → 0.45MB โดยอันดับไม่เปลี่ยนเลย (3 ตำแหน่งเริ่มเพี้ยน)
- `EMBED_PRECISION` ถูกใส่ใน `contentHash` → เปลี่ยนค่าเมื่อไหร่ index rebuild อัตโนมัติ
- **`functions/embedText.js` เป็น single source of truth** — function, bootstrap script, calibration
  script require ไฟล์เดียวกัน **ห้ามก๊อป logic ไปเขียนซ้ำ** (ถ้า index กับ query คนละสเปซ cosine
  จะคืนค่ามั่วโดยไม่มี error ให้เห็น)
- **อัปเดตเอง**: `reindexAgent()` ยิงแบบ fire-and-forget หลัง save (PreReg/Edit)
- **อัปเดตมือ**: เมนู admin → *Rebuild Search Index* (เทียบ hash ข้ามของที่ไม่เปลี่ยน กดซ้ำได้ไม่มีผลเสีย)
- ⛔ **ห้ามใช้ Eventarc trigger** — บน project นี้เคยโชว์ ACTIVE แต่ไม่ยิงจริง (ดู `CLAUDE.md` §9)

### 6.2 แชท ALPHA

**สถาปัตยกรรม: client-mediated function calling** — server ตัดสินใจว่าจะเรียก tool ไหน แต่ **client เป็น
คนรัน tool จริง** จาก `src/lib/skills.js` แล้วส่งผลกลับ (วนได้สูงสุด **6 รอบ** — `MAX_LOOP`)

```
ผู้ใช้พิมพ์
  → chatGuardrails.js (บล็อกฝั่ง client ก่อนถึง Vertex)
  → "แสดงทั้งหมด"? → ตอบจาก CSV เดิมทันที ไม่ยิง server
  → chatLibrary (Gemini) ตัดสินใจ
       ├── tool_call → client รัน skill → ส่งผลกลับ (วน)
       └── answer    → แสดงผล
```

**Tools:** `query_library` · `query_sdlc` · `capability_search` · `get_agent_detail` · `connection_suggest` · `sdlc_gap_match`
(จับคู่ agent กับ SDLC gap คำนวณใน `skills.js` **ไม่ให้โมเดลผลิตชื่อเอง** — CLAUDE.md §30–31)

**การแสดงผล — กฎที่สำคัญที่สุด:**
> **Layout ไม่อยู่ใน prompt** LLM ส่งมาแค่ `@@ ชื่อ | เหตุผล` (agent) หรือ `## หัวข้อ | รายละเอียด` (SDLC)
> แล้ว **client วาดเอง** จากข้อมูลจริงใน Firestore (status pill, ไอคอนลิงก์, การจัดกลุ่ม)

เหตุผล: โมเดลจัดรูปแบบไม่เหมือนเดิมทุกครั้งโดยธรรมชาติ — เคยเกิดหัวข้อ "Ready to Use:" แต่ข้างในติดดาว
(pilot) ขัดกันเอง **การวาดจาก data ทำให้บั๊กประเภทนี้เกิดไม่ได้เชิงโครงสร้าง** และสถานะที่แสดงจะไม่มีวัน
ขัดกับ Firestore

**Guardrails:** read-only เสมอ · ปฏิเสธ PII/การเงิน/กฎหมาย/การแพทย์ · ไม่เก็บ transcript
(session-only, ปิดหน้าต่าง = ล้าง) · ห้ามเอ่ยชื่อองค์กร

### 6.3 ตรวจซ้ำตอน Pre-Registration

```
draft → rankCandidates() (rule-based)  ─┐
      → cosine similarity (embeddings) ─┴→ union → analyzeDuplicate (Gemini) → verdict
```

**Hybrid เสมอ ไม่ใช่แทนที่** — union ทำให้ recall **แย่ลงไม่ได้ในเชิงคณิตศาสตร์**

ทำไมต้องเพิ่ม semantic: วัดกับไลบรารีจริง 244 รายการ ตัวซ้ำที่เขียนคนละคำอยู่อันดับ **#89 / #135 / #43**
→ หลุดหน้าต่าง top-15 ทั้งหมด → **AI ไม่เคยเห็น → อนุมัติของซ้ำโดยไม่มีใครรู้**

**verdict 4 ระดับ** (confidence ต้องอยู่ในช่วงของ verdict เสมอ):
`clear_duplicate` 75-100 · `likely_overlap` 45-85 · `distinct_but_related` 15-45 · `unrelated` 0-15
- **hard-block เฉพาะ `clear_duplicate` ≥70** — อย่างอื่นแค่เตือน (คนเป็นประตูจริง ไม่ใช่ LLM)
- ผลถูกเก็บที่ `/analysisRuns/{agentId}` เป็น knowledge base (dedup ที่ 80% similarity)

---

## 7. บทเรียนที่แลกมาด้วยเวลา — ห้ามรื้อซ้ำ

### เกี่ยวกับ search
- ⛔ **ห้ามตั้ง score floor เพื่อบอกว่า "ไม่พบ"** — วัดแล้ว คำถามหลอกได้ **0.687** ขณะที่คำถามจริงได้
  **0.621** → cosine แยกไม่ออก **การตัดสินว่าไม่พบเป็นหน้าที่ของ LLM เท่านั้น**
- **`capability_search` ต้องส่ง query แบบขยายความ ไม่ใช่ keyword สั้น** — วัดแล้ว query ยาวดัน `fe-dev`
  จาก #72 → #11
- **`type` filter ของ `query_library` ต้องระวัง** — คำว่า "Agent" ในภาษาพูดแปลว่า "เครื่องมือ AI"
  ไม่ใช่หมวด เคยทำให้ *"process 1.2 มี Agent 2 ตัวอะไรบ้าง"* ตอบ "ไม่พบ" ทั้งที่มีจริง (ของจริงเป็น Skill)
- **`internalTool` ต้องใช้ allowlist ชื่อตรงๆ** — `owner === 'Wolfy'` ใช้เป็นกฎ**ไม่ได้** เพราะโดน
  agent จริงด้วย (Epic Writer, ALPHA - Summarizer)

### เกี่ยวกับวิธีทำงาน
- **recall ที่พังกู้ด้วย prompt ไม่ได้** — ถ้า retrieval ไม่ส่งของถูกมาให้ LLM ต่อให้ prompt ดีแค่ไหน
  ก็ช่วยไม่ได้ ที่ผ่านมาเสียเวลาไล่แก้ *precision* หลายรอบขณะที่ *recall* พังเงียบอยู่
- **วัดกับข้อมูลจริงก่อนสรุปสาเหตุ** — ตัวอย่างที่เคยพลาด: รายงานขนาด payload เป็น 250KB จากการคำนวณ
  binary ทั้งที่ของจริงเป็น JSON 1.26MB · และเคยโทษบั๊กผิดตัว (คิดว่าคำถามหาย แต่จริงๆ retrieval แย่)
- **ตัวอย่างเล็กหลอกได้** — เคยสรุปจาก 15 รายการว่า embeddings แย่กว่า lexical ในเคสหนึ่ง
  พอวัดกับ 244 รายการจริงกลับกันหมด

### เกี่ยวกับข้อมูล
- **ปัญหาบางอย่างไม่ใช่บั๊กโค้ด แต่เป็นคุณภาพข้อมูล** — มีคนลงทะเบียนไฟล์ prompt ภายใน (`*.md`)
  เป็น agent ทำให้มันชนะ agent จริงในผลค้นหา แก้ปลายเหตุด้วย `internalTool` แล้ว
  **แต่ถ้ามีคนลงเพิ่มอาการจะกลับมา**

---

## 8. Deploy — กฎเหล็ก

### ⛔ ห้ามรัน `firebase deploy` เปล่าๆ หรือ `--only functions` เปล่าๆ เด็ดขาด
GCP project `wolfy-481609` **แชร์กับแอปอื่น (Portfolio, VoteCup, Governance)** — `functions/index.js` ใน repo นี้มี 21 ตัว แต่
บน production มี ~76 ตัว → deploy แบบไม่ระบุชื่อจะ**เสนอลบ functions ของแอปอื่นทิ้ง**

```bash
# hosting — ปลอดภัยโดยธรรมชาติ (target-isolated ตาม .firebaserc)
npm run build && npx firebase-tools deploy --only hosting --project wolfy-481609

# functions — ต้องระบุชื่อเสมอ (ใน session ของ Claude ใช้ binary `firebase` แทน `npx firebase-tools`)
firebase deploy --only functions:chatLibrary --project wolfy-481609

# ทดสอบก่อนขึ้นจริง (ไม่แตะ live)
npx firebase-tools hosting:channel:deploy <ชื่อ> --project wolfy-481609
```

### ต้องรันก่อน deploy แชททุกครั้ง
```bash
node functions/regression.cjs     # ~17 เคส รวมโหมด B (Agile/SDLC/ขอไอเดีย) — แกว่ง 16/17 เป็นปกติ ต้อง baseline เทียบ
```
ใช้ prompt จริงจาก `functions/chatPrompt.js` **ไม่ใช่สำเนา** → prompt เปลี่ยนแล้วพังจะรู้ทันที

### Firestore rules — publish ผ่าน Console เท่านั้น
เลือก **named DB `ai-agent-lib`** จาก dropdown · ถ้า publish ที่ `(default)` จะไม่มีผลใดๆ
`firebase.json` **จงใจไม่มี** firestore block

### Deploy = production เสมอ → ขอ confirm ก่อนทุกครั้ง
Firebase เก็บ release เดิมให้ rollback ได้ (Console → Hosting → release history)

---

## 9. สถานะล่าสุด (2026-11-26)

**deploy แล้วและใช้งานจริง** · bundle ที่เปิดอยู่ทั้ง 2 โดเมน = `index-CWWlaZK5.js` (Inbox + announcements, 2026-11-17) ·
ไลบรารี 361 รายการ (live) · เครื่องทำงานคือเครื่องบริษัท

### ไทม์ไลน์ตั้งแต่ ส.ค. (ละเอียดอยู่ใน CLAUDE.md ตามหมายเลข §)
| ช่วง | สิ่งที่ขึ้น production |
|---|---|
| ส.ค. | semantic search ทั้งระบบ (§18) · Approve Area (§20) · ไฟล์แนบ + SSO gate (§24) · Ready-to-Use gate + rename (§25) · แจ้งเตือน (§26) · ผูก skill ข้ามทีม (§27) · sort/view (§28) |
| ก.ย. | Teams/อีเมลผ่าน Flow (§26+) · Role Group AI (§33) · Library star ใน Workshop · link request · gemini-3.5-flash · หน้า `/workshop` |
| ต.ค. | company-account gate 3 ชั้น (rules/functions/client) · delay alerts · redesign V7 · External Source · Attach file สำหรับ creator · endpoint versioning + Usage report (`functions/CLAUDE.md` §32) · Library star ใน Workshop |
| พ.ย. | category group sidebar (§34, 6 พ.ย.) · Usage page ปรับ (§35, 10 พ.ย.) · **Inbox + announcements (§36, 17 พ.ย.)** |

### อยู่ระหว่าง release (2026-11-26, branch `feat/screening-assessment`)
Screening assessment + deploy package checklist (CLAUDE.md §37): ฟอร์มลงทะเบียนมีขั้น Assessment (C7 บล็อก) ก่อน AI duplicate check · ช่อง declaration ใหม่ 3 ช่อง · ขอ Deploy ต้องติ๊ก package ตาม Tier แล้วตอบ C10–C11. ⚠️ ต้อง publish `firestore.rules` ผ่าน Console ก่อน deploy hosting

### เฝ้าดู (ไม่ใช่งานสร้าง)
1. **`/metrics/chat-YYYY-MM-DD`** — สัญญาณ 2 ตัว **คนละสาเหตุ**
   - `answer_notFound` พุ่ง → ปัญหา **retrieval** หรือไลบรารีขาดของ → `node functions/calibrate.cjs`
   - `tool_query_library` ชนะคำถามความสามารถ → ปัญหา **tool routing** ❗ไม่ใช่ embedding
     → ไปดูคำอธิบาย tool ใน `chatPrompt.js` แล้วรัน `regression.cjs`
2. **Inbox:** console เคยเจอ `ERR_CONNECTION_REFUSED`/400 ตอนทดสอบบน emulator (ยังไม่ได้ตามหาสาเหตุ) — ดู console ตอนใช้งานจริง
3. **`/mailLog` + `/alertRuns`** — เช็คว่า Teams/อีเมล/delay digest ส่งผ่านจริง ไม่ติด `held`/`error`

### ยังไม่ตัดสินใจ
4. **กติกาว่าอะไรควร/ไม่ควรอยู่ในไลบรารี** ← ถ้าจะต่อยอด อันนี้คุ้มที่สุด (แก้ต้นเหตุ) · รวม 3 ไฟล์ `.md` ที่ `internalTool` แต่ `customerFacing` (CLAUDE.md §22)
5. Rename Firebase web app `test-auth` → `ai-agent-library` (แค่ชื่อ ไม่กระทบ App ID)
6. Setup backup admin account (deferred, accepted risk)
7. **ช่องที่ยังไม่ปิด (จาก security fix 9 ต.ค.):** `/config/timeline` — viewer ใน `viewers[]` เขียนทับทั้ง doc ได้ · และ `/users` doc ของบัญชีนอกโดเมนที่สร้างก่อน fix ยังค้างอยู่ (เข้าอะไรไม่ได้แล้ว)
8. **ไอเดียวัดผลหลังใช้งาน (B+A+C)** — ทิศทางผ่านแล้ว (2026-11-11) แต่ **ยังไม่ได้เขียน spec / ไม่ได้ build** (memory `project_adoption_value_measurement`)
9. dependencies ของ functions ที่ patch ไว้แต่ยัง **ไม่ได้ deploy** → รวมกับการอัป firebase-admin 14 / firebase-functions 7 (memory `project_functions_deps_upgrade`)

### 📅 วันที่ต้องจำ
- **5 ม.ค. 2027** — GitHub PAT `ai-lib` หมดอายุ (push จะ fail) · **28 มี.ค. 2027** — Cloud Build เปลี่ยน default channel → เฝ้า functions deploy ครั้งแรกหลังวันนั้น

### ⏸️ พักไว้ — **ยังไม่จบ ต้องกลับมาคุย (ไม่ใช่ cut)**
- **GitLab skill integration** + ข้อกำหนดทีม security ว่า `wolfy-481609` ควรเป็น sandbox เท่านั้น
  ผู้ใช้สั่งเอง *"พักเรื่องนี้ไว้ก่อน จนกว่าจะได้ข้อสรุปเพิ่มเติม"* (2026-07-30)
  ⚠️ ตั้งแต่ไฟล์แนบ (§24) ระบบเก็บ artifact ของงานจริงไว้ในโปรเจกต์นี้ตอน runtime แล้ว — ผู้ใช้ตัดสินใจเดินหน้า แต่ควรแจ้งทีม security

### ❌ Cut แล้ว — ปิดถาวร อย่าเสนอซ้ำ
Connections 129 คู่ · UID backfill ที่เหลือ · Owner auto-fill จาก credential
(ดู memory `backlog_decisions_20260704`)

---

## 10. Integration — ที่มีอยู่แล้ว และที่วางแผนไว้

### ✅ ต่ออยู่แล้ววันนี้
| ระบบ | ใช้ทำอะไร |
|---|---|
| **Vertex AI** | `gemini-3.5-flash` (ตรวจซ้ำ + แชท + Role Group) · `text-multilingual-embedding-002` (search) |
| **Firebase Auth** | Google SSO จำกัดโดเมนองค์กร |
| **Google People API** | ดึงรายชื่อคนในองค์กรมาทำ directory cache (`src/lib/directory.js`) — scope `directory.readonly` เป็น sensitive scope ขอเฉพาะตอนจำเป็น ไม่ใช่ตอน login ปกติ |
| **ไฟล์แนบ (endpoint file)** | เก็บใน GCS bucket ปิดสนิท เสิร์ฟผ่าน `/f/{agentId}` (SSO) + callable — แทน `public/skills/*.zip` เดิมที่เปิดสาธารณะ (CLAUDE.md §24) |
| **Microsoft Teams + อีเมล** | Teams Workflow (`TEAMS_FLOW_URL` ใน Secret Manager) ส่งการ์ด + อีเมลต่อผู้รับหนึ่งคน · สลับที่ `/config/mail` · approver ทุก event ถูก override ไปที่ `tinnapat.p@arise.tech` จนกว่าผู้ใช้จะสั่งเปลี่ยน |
| **Portfolio app** | `syncPortfolioAdoption` นับ task ที่ลิงก์ agent/skill เป็น adoption (อ่านอย่างเดียว) |
| **`endpoint` field** | ทางที่ agent ตัวอื่น/คนอื่นเข้าถึงของในไลบรารีได้ |

### ⏸️ วางแผนไว้แต่พักอยู่ — GitLab
ตั้งใจให้ skill ขององค์กรอยู่บน **GitLab ภายใน** แล้วไลบรารีนี้เป็น **สารบัญ** ชี้ไป (ต้องต่อ VPN เพื่อโหลด)
**ติดที่ข้อกำหนดของทีม security** ว่า `wolfy-481609` ควรเป็น sandbox เท่านั้น → ยังไม่มีข้อสรุป
**ห้ามเริ่มทำจนกว่าผู้ใช้จะบอกว่าได้ข้อสรุปแล้ว**

### 🔮 ต่อยอดที่ระบบเปิดทางไว้ให้แล้ว (ยังไม่ทำ)
1. **Adoption metrics** — ตอนนี้มีข้อมูลจริงแล้ว (used count จาก `agentEvents`, ดาวจาก `agentStats`, Usage report) แต่ยัง **ไม่มีการวัด business value หลังใช้งาน** (ดู §9 ข้อ 8) · **อย่าใส่ตัวเลขปลอมหรือประมาณเอาเด็ดขาด**
2. **Learning loop จาก `/analysisRuns`** — ทุกผลตรวจซ้ำถูกเก็บพร้อม outcome (approved/rejected) แล้ว
   ตั้งใจให้เอาไปทำ RAG/feedback ในอนาคต **ยังไม่ได้สร้าง** และเคยเตือนไว้ว่า *"เก็บข้อมูล ≠ ฉลาดขึ้น"*
   ต้องมี design pass ของตัวเองก่อน
3. **ขยายไฟล์แนบ** — โครง upload/versioning/SSO มีแล้ว (เพดาน 5 MB ต่อไฟล์ ถ้าใหญ่กว่านี้เปลี่ยนเป็น signed URL)

---

## 11. หนี้ทางเทคนิค / ความเสี่ยงที่รู้ตัว

| เรื่อง | ผลกระทบ | สถานะ |
|---|---|---|
| ไฟล์ prompt ภายในถูกลงเป็น agent | ทำให้ผลค้นหาเพี้ยน | แก้ปลายเหตุด้วย `internalTool` · ต้นเหตุยังอยู่ |
| ไม่มีเกณฑ์ตอนอนุมัติว่าอะไรควรอยู่ในไลบรารี | ปัญหาข้างบนจะกลับมา | ยังไม่ตัดสินใจ (ข้อ 9.3) |
| `firestore.rules` ต้อง publish มือทุกครั้ง | ลืมแล้วฟีเจอร์ใหม่พังเงียบ | ตั้งใจให้เป็นแบบนี้ · ต้องจำเอง |
| bundle ใหญ่กว่า 500KB warning (วัดล่าสุด ~985KB เมื่อ ส.ค. — โตขึ้นแล้ว) | โหลดครั้งแรกช้า | รับได้ · ยังไม่ทำ code-splitting |
| `analysisRuns` dedup อ่านทั้ง collection ต่อ 1 submit | O(n) | ยังเล็กอยู่ · ทบทวนถ้าโตขึ้น |
| ไม่มี test framework — มีแต่ `functions/regression.cjs` (แชท) + `verify-*.cjs` ~21 ไฟล์ รายฟีเจอร์ | ต้องจำรันเองก่อน deploy | verify script โหลดโมดูลจริงผ่าน `loadEsm()` ไม่ก๊อปตาราง · ไม่ผูก CI |
| web app registration ชื่อ `test-auth` แต่รัน production | ชวนเข้าใจผิด | ข้อ 9.4 |

---

## 12. เริ่มงานยังไง

```bash
cd ~/ai-agent-library
git pull
npm install                      # ถ้า package.json เปลี่ยน
npm run build                    # ต้องผ่านก่อนเสมอ
```

### ⚠️ ตั้งค่าครั้งเดียวบนเครื่องใหม่ — ต้องทำก่อน commit แรก

**git identity ไม่ติดไปกับ `git clone`** (มันอยู่ใน `.git/config` ซึ่งไม่ถูก clone)
ถ้าไม่ตั้ง git จะเดาเอาเป็น `<user>@<hostname>.local` แล้ว commit ด้วยชื่อนั้น **โดยไม่เตือน**

```bash
cd ~/ai-agent-library
git config user.name  "Tinnapat Pongtongmuang"
git config user.email "tinnapat.p@arise.tech"
git config user.email      # ยืนยันว่าตั้งแล้ว
```

- ใช้ `git config` **ไม่ใส่ `--global`** → ผูกกับ repo นี้เท่านั้น ปลอดภัยกว่าบนเครื่องบริษัท
- ประวัติเก่าบางส่วน commit ด้วยอีเมลส่วนตัว (`tinnapat.ptm@gmail.com`) จากเครื่องเดิม
  ถ้าอยากให้ author ต่อเนื่องกับของเก่าให้ใช้อีเมลนั้นแทน — **เป็นการตัดสินใจของผู้ใช้ ไม่ใช่ของ AI**

### 🔑 GitHub authentication

GitHub **ไม่รองรับ password แล้ว** — `git clone/push` ต้องใช้ Personal Access Token
(การ login เว็บผ่าน Google SSO เป็นคนละกลไก ใช้กับ command line ไม่ได้)

- token ถูกเก็บอัตโนมัติใน macOS keychain (`credential.helper = osxkeychain` มาจาก Xcode
  Command Line Tools → มีทุกเครื่อง Mac) **ใส่ครั้งเดียวพอ ไม่ต้องพิมพ์ซ้ำทุกครั้ง**
- **⏰ token ปัจจุบันชื่อ `ai-lib`** — สร้าง **2026-08-05** · **หมดอายุ Tue 5 Jan 2027**
  ⚠️ เอกสารเดิมเขียน "หมดอายุราว 2026-11-03 อายุ 90 วัน" — **ผิดทั้งคู่** แก้จากหน้า GitHub จริงเมื่อ 2026-10-29
  พอหมดอายุ `git push` จะ fail ด้วย auth error — สร้างใหม่ที่
  https://github.com/settings/tokens?type=beta
  · **Repository access — token ตัวนี้ให้สิทธิ์ 5 repo ของ `ARS-AI-lib` ไม่ใช่ repo เดียว:**
  `AI_Agent_lib` · `AI_Portfolio` · `ai-agent-library` · `ai-governance` · `vote`
  · permission = **Read and write access to code** + Read access to metadata · ไม่มี user permission (ถูกต้อง)
  · กด **Regenerate token** บนหน้าเดิมได้ แต่ **ค่าจะเปลี่ยน → ต้องอัปเดต keychain ใหม่** ไม่งั้น push ยังใช้ค่าเก่าแล้ว fail
  · ถ้า keychain ยังจำ token เก่าอยู่ ให้ลบด้วย
  `git credential-osxkeychain erase` (พิมพ์ `host=github.com` แล้ว `protocol=https` แล้ว Enter 2 ครั้ง)

- ⚠️ **push บนเครื่องนี้ (พบ 2026-11-17):** Keychain หยิบบัญชี `tinnapatptm-ship-it` (ไม่มีสิทธิ์) →
  ใช้ `git -c credential.helper= -c credential.helper="!gh auth git-credential" push origin main` กับ gh account `ARS-AI-lib`
  (`gh auth switch -u ARS-AI-lib`) หรือลบ credential เก่าของ github.com ใน Keychain Access
- 🔒 **deploy production ต้องหยุดถามผู้ใช้ก่อนทุกครั้ง** แม้อยู่ในโหมด auto/bypass (กฎถาวร 2026-10-29 — `docs/SETUP-AUTONOMY.md` §6)

### สิ่งที่ **ไม่ต้อง**ย้ายมา (ตรวจแล้ว)
⚠️ **แก้ 2026-10-29:** `~/.claude/settings.json` **ไม่ว่างแล้ว** — มี `env` (proxy/โมเดลภายในองค์กร), `model`, `effortLevel`, `theme`, `enableWorkflows` และ **`sandbox.network.allowedDomains`** ที่เพิ่มเข้าไปเพื่อให้ autonomous deploy ทำงานได้ (ดู `docs/SETUP-AUTONOMY.md`) → **ย้ายเครื่องต้องตั้งไฟล์นี้ใหม่** ไม่ใช่ปล่อยว่าง
ไม่มี custom command/agent/output-style · โลโก้และ skill package อยู่ใน `public/` ใน git แล้ว ·
permission allowlist อยู่ที่ `.claude/settings.json` ใน repo (จงใจ**ไม่ใส่ deploy** — ดูข้อ 8) +
`.claude/settings.local.json` (เครื่องนี้เท่านั้น, gitignore แล้ว)

**ก่อนแก้อะไรที่เกี่ยวกับ search/prompt** → อ่าน `CLAUDE.md` §18 + memory
`project_chat_retrieval_rearchitecture.md` ให้จบก่อน มีเหตุผลที่วัดมาแล้วของทุกการตัดสินใจ

**ก่อน deploy** → `node functions/regression.cjs` (ผ่านราว 16–17/17 · ดู memory `feedback_regression_flaky`) + `node functions/verify-*.cjs` ของฟีเจอร์ที่แตะ

**ถ้าผู้ใช้ถามว่ามีอะไรค้าง** → ต้องรวม **GitLab (พักไว้)** ด้วยเสมอ ห้ามรายงานว่าถูก cut

---

## 13. แผนที่เอกสาร

| ไฟล์ | ใช้ตอนไหน |
|---|---|
| **`docs/SYSTEM-OVERVIEW.md`** (ไฟล์นี้) | อ่านก่อนเริ่มงาน — ภาพรวมระบบ + สถานะ |
| `CLAUDE.md` | กฎปฏิบัติ + ประวัติรายฟีเจอร์ (§18 search, §19 ย้ายเครื่อง) |
| `docs/memory/MEMORY.md` | สารบัญ memory ทั้งหมด |
| `docs/memory/project_work_queue.md` | ประวัติว่าทำอะไรไปบ้างและ**ทำไม** (STATUS block บนสุด) |
| `docs/memory/project_chat_retrieval_rearchitecture.md` | หลักฐานเชิงตัวเลขของทุกการตัดสินใจเรื่อง search |
| `docs/memory/feedback_*.md` | กฎที่ผู้ใช้เคยสั่งไว้ — **อย่าถามซ้ำ** |
| `functions/CLAUDE.md` | §32 endpoint versioning + Usage report (อยู่ใน functions/ ไม่ใช่ root) |
| `docs/WORKSHOP.md` | หน้า `/workshop` ทั้งหมด + กฎ isolation |
| `docs/CHANGELOG-2026-09-23.md` · `docs/CHANGELOG-2026-10-28.md` | สรุปรอบงานพร้อมเหตุผล |
| `docs/SETUP-AUTONOMY.md` · `docs/MOVE-TO-NEW-MACHINE.md` | ตั้ง Claude Code ให้ทำงานเอง · ย้ายเครื่อง |
| `docs/superpowers/specs/` · `plans/` | design + implementation plan รายฟีเจอร์ (Workshop star, category group, usage page, inbox) |
| `docs/presentation/` | สไลด์แนะนำระบบ 5-6 นาที (self-contained เปิด offline ได้) + ข้อควรระวังถ้าจะแก้วิดีโอ |
