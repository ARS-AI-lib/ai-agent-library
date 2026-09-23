# Changelog — 2026-09-23 (AI Agent Library)

> สรุปงานทั้งหมดของรอบนี้ · ทุกข้อ **ขึ้น production แล้ว** และตรวจกับข้อมูลจริงใน Firestore
> (`wolfy-481609` / named DB `ai-agent-lib`) แล้ว
> ประวัติโปรเจกต์ทั้งหมดยังอยู่ที่ `CLAUDE.md` §1–31 และภาพรวมระบบอยู่ที่ `docs/SYSTEM-OVERVIEW.md`
> ไฟล์นี้เก็บเฉพาะรอบวันที่ 23 ก.ย. เพื่อไม่ให้เหตุผลเบื้องหลังหายไปกับ session

**Commits:** `5ce006c` (batch 4 ข้อ) · `a786a31` (merge ทีมนก) — push เข้า `origin/main` แล้ว
**Deploy:** hosting เท่านั้น (`--only hosting`) · **ไม่ได้แตะ functions และไม่ได้ publish rules**

---

## สารบัญ

| # | งาน | ประเภท |
|---|---|---|
| 1 | Tech Innovation 15 ตัว → `reusable: Non-reusable` | ข้อมูล |
| 2 | Admin แก้ Owner ได้ในฟอร์ม Edit (ถ้ายังไม่ Ready to Use) | โค้ด |
| 3 | Category ใหม่ `Virtual Assistant` + ปักบนสุด sidebar + แท็ก 28 ตัว | โค้ด + ข้อมูล |
| 4 | ลบ filter Process Owner ออกจากแท็บ AI Adoption | โค้ด |
| 5 | รวม 3 ทีมนก → `นกลงทุน` + retire ชื่อเก่าจาก schema | ข้อมูล |

---

## 1. Tech Innovation → `reusable: 'Non-reusable'`

**ทำอะไร:** agent/skill ทั้ง 15 ตัวที่ `owner === 'Tech Innovation'` ถูกตั้ง
`reusable: 'Non-reusable'` (ค่าเดิมเป็น `""` ทั้ง 15 ตัว — ไม่มีค่าที่มีความหมายถูกทับ)

**ทำไมต้องใช้สคริปต์ ไม่ใช่ฟอร์ม:** ทั้ง 15 ตัวอยู่ที่ `devProgress: 100` +
`deploymentStatus: 'approved'` → `isReadyToUseLocked` ซ่อนช่อง Reusable ใน `EditAgentModal`
→ **Admin SDK เป็นทางเดียวที่เหลือ**

**ทำไมไม่ใช่เรื่องความสวยงาม:** `'Non-reusable'` คือข้อยกเว้นตาม `CLAUDE.md` §25 ที่ทำให้
agent ขึ้น 100% ได้**โดยไม่ต้องมี endpoint หรือไฟล์แนบ** (เช็คทั้งฝั่ง client และ
`agentReadyRules.js`) — ปล่อยให้เป็น `""` ไว้คือติดเกณฑ์ที่ไม่ได้ออกแบบมาเพื่อเครื่องมือใช้ในทีมเดียว

**ขอบเขต:** `owner == 'Tech Innovation'` **union** `pairedSubSkills()` ของชุดนั้น
(โหลด `src/lib/agentUtils.js` จริงผ่าน `loadEsm()` ไม่ก๊อป logic ตาม §20/§27) —
ผลจริง union ไม่เพิ่ม doc เลยเพราะลูกทุกตัวก็ owner เดียวกัน แต่เขียนเป็น union ไว้เพื่อให้
สคริปต์ยังถูกถ้าวันหนึ่งไม่เป็นอย่างนั้น

**ไฟล์:** `functions/backfill-ti-reusable.cjs` (dry-run default) · ไม่ต้อง rebuild vector
เพราะ `buildEmbedText()` ใน `functions/embedText.js` ไม่ได้ embed `reusable`

---

## 2. Admin แก้ Owner ได้ในฟอร์ม Edit

**เงื่อนไข:** `canEditOwner(isAdmin, agent)` = **admin เท่านั้น** และ
**`normalizeProgress(devProgress) < 100`**

⚠️ นิยาม "ยังไม่ Ready to Use" ที่ใช้คือ **badge ที่เห็นบนการ์ด** (bucket `ru` = 100%)
**ไม่ใช่** `deploymentStatus === 'approved'` (Tier A freeze) — สองอย่างนี้ไม่ตรงกัน และกฎที่ขอ
คือกฎที่เขียนอยู่บนการ์ด

**ทำไมเป็น `ComboInput` ไม่ใช่ `MultiSelect`:** `owner` เป็น free text ไม่เคยอยู่ใน
`/config/schema` (ต่างจาก `category` ที่ admin ย้ายได้แต่สร้างใหม่ไม่ได้ §23) ·
options มาจาก owner ที่มีอยู่จริงใน `allAgents` ที่โหลดอยู่แล้ว — **ไม่ยิง query เพิ่ม**
(pattern เดียวกับ `SkillNameInput`) และยังพิมพ์ชื่อทีมใหม่ได้

**Write 2d — แยก `updateDoc` ของตัวเอง:** `owner` ไม่อยู่ใน `hasOnly()` branch ไหนเลยใน
`firestore.rules` ถ้าเอาไปรวมกับ write อื่นจะ**ทำลาย `affectedKeys()` ของ write นั้น**
แล้ว save พังทั้งก้อน (เหตุผลเดียวกับ Write 2b/2c/4) → มันไปอาศัย branch `isAdmin()`
ที่อนุญาตทุก field อยู่แล้ว **จึงไม่ต้องแก้ rules และไม่ต้อง publish Console**
· ยิงเฉพาะตอนค่าเปลี่ยนจริง ไม่งั้น `updatedAt` จะขยับทุกครั้งที่ Save

**Blast radius:** `owner` **ไม่มีผลกับ pairing/cascade** — `sameSubmitter()` อ่าน
`createdBy`/`creator` เท่านั้น · ที่กระทบคือการจัดกลุ่ม By Owner, Dashboard owner workload
→ **ไม่ต้อง cascade owner ไปลูก**

**ไฟล์:** `src/lib/agentUtils.js` (`canEditOwner`) · `src/components/EditAgentModal.jsx`
(gate `canSeeOwner`, `ownerOptions`, ช่อง Owner, Write 2d)

---

## 3. Category `Virtual Assistant`

### ปักบนสุดของ sidebar ได้อย่างไร
`seed-approve-area-schema.cjs` เขียน `/config/schema.category` จาก **`Object.keys(CATEGORY_AREA)`**
และ `Sidebar.jsx` render array นั้น**ตามลำดับดิบ ไม่ sort** → การใส่ `'Virtual Assistant'`
เป็น **คีย์แรกสุด** ของ `CATEGORY_AREA` คือกลไกการปักบนสุดทั้งหมด
⛔ **ย้ายบรรทัดนั้น = ย้ายตำแหน่งใน sidebar** (เขียนเตือนไว้ในโค้ดแล้ว)
· `categoryColor()` เป็น hash → ได้สีเองอัตโนมัติ ไม่ต้องแก้ CSS

### 🔴 approve area ที่เลือกไว้ไม่มีอยู่จริง — และแก้ยังไง
ตอนเคาะ design เลือก `categoryAreaMap` = **"Conversational AI / NLP"** แต่ตรวจ
`src/lib/approveAreas.js` แล้ว **`AREA_ORDER` มี 16 ค่าและไม่มีค่านี้** · การเพิ่ม area ที่ 17
กระทบ routing ผู้อนุมัติทั้งระบบและต้อง assign คนใหม่
→ map ไป **`Platform, DevOps & Operations`** ซึ่งเป็นค่าที่ **22 จาก 28 doc ถืออยู่แล้วจริง**
→ ผลกระทบเกือบศูนย์ เพราะทั้ง 28 doc มี stored `approveArea` = **layer 1 ชนะ layer 5 เสมอ**
map นี้จึงมีผลกับ **agent ที่เกิดใหม่ในอนาคตเท่านั้น**
· ไม่ใส่ใน `VERTICAL_CATEGORIES` เพราะเป็น discipline ไม่ใช่ product (§23)

### แท็ก 28 doc (append ไม่ replace)
| กลุ่ม | จำนวน | ids |
|---|---|---|
| VA stack (Tech Innovation) | 15 | `agent_0079`, `agent_0080`, `agent_0102`–`agent_0114` |
| ALPHA chat ของไลบรารีเอง + tool ที่มันเรียก | 8 | `pYrXYO5EJZAbrQGPm4jT`, `tM9BRb0ZGbGrqVpqO39b`, `3Nc5yiCg1vOzXwXf2eZr`, `Kyry4e5iWOweGlV4WvIt`, `cmGiDbd0ZtM58mnd8Fi1`, `1kFtOck4Abf67MO3NvXC`, `TugZODmjFodpCOZ0WYXd`, `fSuc9H8StRP0Yw8nNm0W` |
| conversational product อื่น | 5 | `agent_0004`, `agent_0141`, `agent_0085`, `agent_0087`, `agent_0088` |

- **id hardcode ในสคริปต์ ไม่ใช้ regex** — regex sweep รอบแรกได้ 48 ตัวและผิดทั้งสองทาง
  (ติด UX Writer ที่มีคำว่า "ผู้ช่วย", Survey Design, Figma · แยก conversational product
  จาก prompt ตอบคำถามเอกสารไม่ออก) → คัดด้วยสายตาทีละตัวแล้ว **ห้าม re-derive ด้วย regex**
- **append + dedupe เท่านั้น** category เดิมอยู่ครบทุกแถว
  ⛔ นี่คือจุดที่ `backfill-categories.cjs` ทำผิด (มัน **replace**) — **ห้ามรันไฟล์นั้นซ้ำตลอดไป**
- สคริปต์ **assert เองก่อนเขียน** ว่า `agentApproveAreas()` ก่อน/หลังไม่ขยับ →
  ผลจริง **shift = 0/28** (ถ้าขยับจะ abort ไม่เขียนอะไรเลย)

**ไฟล์:** `src/lib/approveAreas.js` · `functions/tag-virtual-assistant.cjs` ·
`functions/index.js` (`FALLBACK_CATEGORY` เพิ่มให้ตรงกัน — เป็น dead path ใช้เฉพาะตอนอ่าน
`/config/schema` ไม่สำเร็จ **จึงไม่ต้อง deploy functions**)
**ผลใน schema:** `/config/schema.category` 21 → 22 ค่า · `Virtual Assistant` อยู่ลำดับที่ 1

---

## 4. ลบ filter Process Owner ออกจากแท็บ AI Adoption

ลบทุกจุดที่เป็น **ตัวกรอง** ใน `src/components/SDLCTab.jsx`: state, ปุ่ม reset,
`procOwnerOptions`, `procOwnerOk()`, `showNonSdlc`, `legendAgents` useMemo,
guard ใน `ProcessCard`, filter ฝั่ง use-case, และ `MultiSelect` ใน control bar

⛔ **เก็บข้อความ display-only "Process Owner: …" ไว้ทั้งหมด** (การ์ด UC + modal)
— เป็นการแสดงข้อมูล ไม่ใช่ตัวกรอง

**ผลพลอยได้ที่ทำให้โค้ดง่ายลง:** เมื่อไม่มี filter ระดับ process เหลืออยู่แล้ว
`legendAgents` = `visAgents` ตรงๆ และกลุ่ม **Non-SDLC ไม่ต้องถูกซ่อนอีกต่อไป**
(เดิมต้องซ่อนตอน filter ทำงานเพื่อให้ตัวเลข counter ตรงกับที่เห็นบนจอ)

---

## 5. รวม 3 ทีมนก → `นกลงทุน`

**ทำอะไร:** `นกต่อ` (3) · `นกรู้` (9) · `นกคุ้ม` (1) → **`นกลงทุน`** (6 → **19** ตัว)
และลบ 3 ชื่อออกจาก `/config/schema.team` (65 → 62) → ดรอปดาวน์ไม่มีให้เลือกอีก

**แก้ทั้ง `owner` และ `team`:** ทั้ง 13 doc ถือชื่อเดียวกันไว้ใน **2 field**
(`team` เป็นของแฝดยุค CSV import · UI อ่าน `owner` ทุกจุด) — แก้แต่ `owner`
จะเหลือชื่อที่ retire แล้วคาใน DB ซึ่งสวนทางกับโจทย์

**⛔ ไม่แตะ `agentName`:** 11 จาก 13 ตัวมีชื่อทีมเป็น prefix ของชื่อตัวเอง
(`นกรู้ - Fund information`, `นกต่อ - Flash news`, `นกคุ้ม - SEC & KTB internal compliance`)
นั่นเป็น**ชื่อผลิตภัณฑ์ ไม่ใช่ความเป็นเจ้าของ** และการ rename มีเส้นทางของตัวเอง
(`decideRenameRequest`) เพราะ §25: **ลูกเก็บชื่อ parent ไว้ใน `matchingAgent`**
→ rename เงียบๆ ด้วยสคริปต์ = ลูกหลุดทั้งหมด
สคริปต์ assert ไว้แล้วว่าไม่มี doc ไหนอ้างชื่อที่ retire ใน `matchingAgent` (ตอนนี้ไม่มี)

⏸️ **ค้างไว้รอเคาะ:** ถ้าจะให้ชื่อ agent เปลี่ยนตามด้วย ต้องเลือกรูปแบบก่อน เพราะ
`agent_0132`/`agent_0133` ใช้ prefix **`Nok -`** ภาษาอังกฤษ ไม่ตรงกับอีก 11 ตัวที่เป็นไทย

**เหตุผลที่ต้องใช้ Admin SDK:** `firestore.rules` บังคับ `/config/schema` เป็น **grow-only**
สำหรับ client (มาจากกฎ free-add `relatedRole`) → ลบค่าออกได้ทางนี้ทางเดียว
เหมือนการ retire category ผ่าน `seed-approve-area-schema.cjs` (§27)

**ไฟล์:** `functions/merge-nok-teams.cjs` · ไม่ต้อง deploy และไม่ต้อง rebuild vector
(`buildEmbedText()` ไม่ได้ embed `owner`/`team`)

---

## Verification ที่รันจริงในรอบนี้

| อะไร | ผล |
|---|---|
| `npx esbuild --jsx=automatic` ทุกไฟล์ `.jsx` ที่แก้ | ผ่าน (⚠️ `node --check` ใช้กับ `.jsx` ไม่ได้) |
| `npm run build` | ผ่าน |
| `node functions/verify-agent-ready.cjs` | **32/32** |
| `node functions/verify-child-links.cjs` | **16/16** |
| dry-run ทั้ง 3 สคริปต์ก่อน `--apply` | 15 แถว / 28 แถว (shift 0) / 13 แถว ตรงกับที่วางแผนทุกตัว |
| อ่านข้อมูลกลับหลังเขียน | TI non-reusable 15/15 · VA 28 ตัว category เดิมไม่หาย · owner นกเก่าเหลือ 0 |
| preview channel ก่อน promote | `va-category` (แล้วจึง deploy production หลังได้ confirm) |

---

## สิ่งที่ **ไม่ได้** ทำในรอบนี้ (โดยตั้งใจ)

- **ไม่ publish `firestore.rules`** — ไม่มีการแก้ rules เลย · `owner` เขียนผ่าน branch
  `isAdmin()` ที่อนุญาตทุก field อยู่ก่อนแล้ว
- **ไม่ deploy functions** — ที่แก้ใน `functions/index.js` คือ `FALLBACK_CATEGORY`
  ซึ่งเป็น path ที่ใช้เฉพาะตอนอ่าน `/config/schema` ไม่สำเร็จ (ค่า live ถูก seed แล้ว)
  ⚠️ ถ้าจะ deploy functions ในอนาคต **ต้อง scope เสมอ** — project แชร์กับแอป Portfolio (§11)
- **ไม่ rebuild vector** — ไม่มี field ที่แก้อยู่ใน `buildEmbedText()`
- **ไม่แตะไฟล์ Workshop เลยสักไฟล์** ตามข้อห้ามที่ตกลงกันไว้ว่า
  **การกระทำใดๆ ใน page workshop ต้องไม่กระทบ feature หลักและข้อมูลใน library**

## ค้างอยู่ (ยกมาจากรอบก่อน ยังไม่ทำ)

- ⏸️ ชื่อ agent ตระกูลนก (ดูข้อ 5) — รอเคาะรูปแบบ prefix
- ⏸️ `workshopTeams` `allow create` ยังเปิดถึง role workshop+ — เคยคุยว่าจะบีบเป็น admin-only
- ⏸️ `docs/WORKSHOP.md` ยังไม่ tracked ใน git (เหมือน `functions/backfill-process-descriptions.cjs`
  + `functions/process-descriptions.json`) — ตั้งใจปล่อยไว้ ยังไม่ commit
