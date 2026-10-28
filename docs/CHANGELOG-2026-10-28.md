# Changelog — 2026-10-14 ถึง 2026-10-28 (AI Agent Library)

> สรุปงานทั้งหมดของ session นี้ · ทุกข้อ **ขึ้น production แล้ว** ยกเว้นที่ระบุไว้ชัดเจนว่าเป็นไฟล์ที่ส่งมอบนอกระบบ
> ประวัติโปรเจกต์ทั้งหมดยังอยู่ที่ `CLAUDE.md` และภาพรวมระบบอยู่ที่ `docs/SYSTEM-OVERVIEW.md`
> ไฟล์นี้เก็บเฉพาะรอบวันที่ 14–28 ต.ค. เพื่อไม่ให้เหตุผลเบื้องหลังหายไปกับ session

**Commits:** `7f666e6` (mobile UI tweaks) · `ce71935` (External Source flag) — push เข้า `origin/main` แล้ว
**Deploy:** hosting เท่านั้นทุกรอบ (`--only hosting`) · ไม่มีรอบไหนแตะ functions
**Data-only (ไม่มี commit เพราะไม่ใช่โค้ด):** BiB rename + reusable fix, DailySync.md rename

---

## สารบัญ

| # | งาน | ประเภท |
|---|---|---|
| 1 | Library mobile UI: legend row, Category sheet, quieter Open icon | โค้ด |
| 2 | Notification copy: English subjects, body เดิม | โค้ด |
| 3 | External Source flag สำหรับ Skill + "External Skills" sidebar filter | โค้ด + ข้อมูล |
| 4 | "BiB Frontend React Code Generator" → Reusable with Conditions + rename | ข้อมูล |
| 5 | ส่งออก 15 skill เป็น zip + rename "DailySync.md" → "Daily-Scrum" | ข้อมูล |

---

## 1. Library mobile UI tweaks (commit `7f666e6`)

**ทำอะไร:** ปรับ 4 จุดบน V7 Library ตามที่ผู้ใช้ชี้เฉพาะจุด (ไม่ใช่ redesign — เคยมี redesign
mockup ที่ถูกยกเลิกไปก่อนหน้านี้ในรอบ session)

1. **Mobile:** ปุ่ม Cards/List เหลือแค่ไอคอน ย้ายมาอยู่แถวเดียวกับ legend ถ้าที่พอ
2. **Mobile:** ตัวอักษร legend เล็กลง (36px/11.5px → 30px/11px)
3. **Mobile:** เอาแถบ Category แนวนอนออก แทนด้วยปุ่ม "Category" ข้างปุ่ม Filters กดแล้วเปิด
   sheet แนวตั้ง (มี SDLC Stage + Platform Tools อยู่ในนั้นด้วย เพราะเดิมอยู่แถบเดียวกัน)
4. **ทุกขนาดจอ:** ปุ่ม "Open ↗" บนการ์ดเหลือแค่ไอคอนลูกศรสีเทาอ่อน ย้ายไปต่อท้าย status pill
   "Ready to Use" แทนที่จะเป็นปุ่มสีฟ้าเด่นแยกบรรทัด

**ไฟล์ที่แก้:** `src/components/LibraryTitle.jsx`, `src/components/ControlBar.jsx`,
`src/components/FilterSheet.jsx` (เพิ่ม `title` prop ให้ reuse เป็น Category sheet ได้),
`src/components/AgentCard.jsx`, `src/App.jsx` (ย้าย `<Sidebar>` element ไปอยู่ก่อน `return`
เพื่อแชร์ element เดียวกันระหว่าง desktop กับ mobile sheet), `src/styles/v7.css`

**ไม่แตะ:** desktop sidebar, filters, list view, สี/tokens, หน้าอื่น

---

## 2. Notification copy — ภาษาอังกฤษใน subject (commit `42306d4`, ก่อนหน้ารอบนี้)

**ทำอะไร:** audit ข้อความแจ้งเตือนทั้งหมดใน Email/Teams (`functions/notifyRules.js` +
`functions/delayAlertRules.js`) หา subject ที่เป็นทับศัพท์ไทย (เช่น "ขอให้", "อัปเดต") แล้ว
เปลี่ยนเป็นภาษาอังกฤษตามกฎ CLAUDE.md §6 (label/header ต้องอังกฤษ)

**สิ่งที่ผู้ใช้ปฏิเสธ:** เสนอแก้ body ให้ใช้คำว่า "ปรับ Progress" เพิ่มความชัดเจน — ผู้ใช้ไม่เอา
("ของเดิมดูดีกว่า ใช้ศัพท์ภาษาอังกฤษแทนการทับศัพท์อยู่แล้ว") → **ของเดิม body text ไม่เปลี่ยน**
มีแค่ subject และปุ่ม ("Update {name}" → "Update Progress") ที่เปลี่ยน

---

## 3. External Source flag + "External Skills" filter (commit `ce71935`)

**ทำอะไร:** เพิ่มช่องติ๊ก "External Source" สำหรับ Skill ที่นำมาจากภายนอกองค์กร (ไม่ได้พัฒนาเอง)
เช่น Figma skill ต่างๆ, TDG – Test-Driven Generation

**การตัดสินใจสำคัญ (grilling):** flag นี้เป็น field จริง `externalSource: true` แยกออกจาก
`category` เด็ดขาด — เพราะ `category` เป็น admin-only และป้อนเข้า layer 5 ของ
`agentApproveAreas()` (CLAUDE.md §20/§23) ถ้าให้ user ทั่วไปติ๊กแล้วไปแก้ category = user
ตั้งเองได้ว่า agent ไปอยู่คิว approver ไหน ซึ่งผิดหลักการเดิม

**UI:** sidebar เพิ่มรายการ "External Skills" คู่กับ Platform Tools (เปลี่ยนหัวข้อกลุ่มเป็น "Other")
นับจาก `externalSource === true` เหมือน pattern เดียวกับ `internalTool` → "Platform Tools"
ช่องติ๊กแสดงเฉพาะตอนเลือก type Skill ใน New form + Edit form วางไว้ **ก่อน** Compatible Agents
และถ้าติ๊กแล้ว Compatible Agents จะถูกซ่อนไปเลย (ปรับตามคำขอเพิ่มเติมของผู้ใช้หลัง deploy รอบแรก)

**Backfill:** `functions/backfill-external-source.cjs` ติดธงให้ 17 รายการที่มีอยู่แล้ว
(Figma 16 ตัว + TDG 1 ตัว) ตรวจด้วย regex `/^figma/i` และ `/^TDG\b/i` บน `agentName`

**rules:** เพิ่ม `externalSource` เข้า Tier A/B `hasOnly` ใน `firestore.rules` — publish ผ่าน
Console (named DB `ai-agent-lib`) แล้ว

**ไฟล์ที่แก้:** `src/lib/agentUtils.js` (`buildAgentFilter`), `src/App.jsx`,
`src/components/Sidebar.jsx`, `src/components/PreRegModal.jsx`,
`src/components/EditAgentModal.jsx`, `src/components/SkillRow.jsx` (ไม่มี Compatible Agents
เลยไม่ต้องแก้ส่วนนั้น แต่เพิ่ม default field), `firestore.rules`,
`functions/backfill-external-source.cjs`

**ไม่แตะ:** `category`, `/config/schema`, Approve Area resolver, tier logic, embeddings
(flag นี้ไม่ได้อยู่ใน embedded text)

---

## 4. "BiB Frontend React Code Generator" — reusable + rename (data-only, ไม่มี commit)

**ทำอะไร:** ทำผ่าน Admin SDK script ตรงบน production Firestore (ไม่ใช่ deploy โค้ด)

1. ตั้ง `reusable: 'Reusable with Conditions'` + `reuseCondition: "Specific structured.
   Compatible with miniapp, Bank in Bank. Another might need more review."`
   ให้ agent หลัก + skill ลูกทั้ง **16 ตัว** (รวม 17 doc) ที่ผูกกันไว้ผ่าน `childSkillIds`
2. เปลี่ยนชื่อ agent หลัก **"BiB Frontend React Code Generator" → "Frontend React Code Generator"**
   แล้ว cascade `matchingAgent` ของ skill ลูกทั้ง 16 ตัวให้ตรงชื่อใหม่ (เลียนแบบ logic เดียวกับ
   `exports.decideRenameRequest` ใน `functions/index.js` เป๊ะ — เช็คด้วย `createdBy`/`creator`
   เดียวกัน, ตั้ง `previousName` ไว้ให้ Portfolio adoption link ยังจับคู่ได้)

**ตรวจก่อนรัน:** dry-run เจอครบ 17 doc ตรงกับที่คาด → ผู้ใช้ยืนยัน → รัน `--apply`

**หลังรัน:** รัน `functions/bootstrap-vectors.cjs --apply` เพื่อให้ search index ของแชท ALPHA
รู้จักชื่อใหม่ (hash-skip ทำให้ embed เฉพาะ doc ที่เปลี่ยนจริง)

**สคริปต์เก็บไว้:** `functions/fix-bib-frontend-reusable-rename.cjs` (dry-run default, `--apply`
เพื่อเขียนจริง) — ยังไม่ถูก commit เพราะเป็น data fix ไม่ใช่โค้ดที่ deploy

---

## 5. ส่งออก 15 Skill เป็น zip + rename "DailySync.md" (data + deliverable, ไม่มี commit)

**ทำอะไร:**
1. ค้นหา 15 skill ตามชื่อที่ผู้ใช้ส่งมา — เจอครบทุกตัวแบบ exact match ไม่มีของหาย
2. ดาวน์โหลดไฟล์ zip ของแต่ละตัวตรงจาก Cloud Storage bucket ผ่าน Admin SDK
   (`endpointFiles/{agentId}/v{n}/{filename}` — ขนาดไฟล์ตรงกับ metadata ใน Firestore ทุกตัว)
3. แตกแต่ละ zip เป็นโฟลเดอร์แยกชื่อ skill แล้วมัดรวมเป็น `Skills-Export.zip` ไฟล์เดียว
   (2,609 ไฟล์ ~4 MB) ส่งให้ผู้ใช้ผ่าน SendUserFile
4. เปลี่ยนชื่อ skill **"DailySync.md" → "Daily-Scrum"** ใน production ด้วย (ตรวจก่อนว่าไม่มี
   `childSkillIds` และไม่มี skill อื่นอ้างถึงผ่าน `matchingAgent` — เป็น standalone rename
   ไม่ต้อง cascade อะไร) โฟลเดอร์ใน zip ใช้ชื่อใหม่ "Daily-Scrum" ด้วย

**skill ที่ส่งออก:** requirement-gathering, compare-user-story, resolving-user-story,
HLD for Existing Project, system-impact-analysis, [Talent-Capybara] impact-analysis,
drawio-solution-design, Daily-Scrum (เดิมชื่อ DailySync.md), Daily Scrum Detail,
Sprint Planner Skill, Doc Keeper, AutoSpec, tech-advisor-skills,
Cross-Platform Feature Parity Review (iOS / Android), ConfigRadar

**หลังรัน:** รัน `bootstrap-vectors.cjs --apply` ให้ search index รู้จักชื่อ "Daily-Scrum"

**สคริปต์เก็บไว้:** `functions/fix-dailysync-rename.cjs` — scratch script ที่ใช้ query/download
(`_q_*.cjs`) ถูกลบทิ้งหลังใช้งานเสร็จ เพราะเป็นงาน one-off ไม่ใช่เครื่องมือที่ต้องเก็บไว้ใช้ซ้ำ

**ข้อสังเกตด้านความปลอดภัย:** งานนี้ข้ามเส้นทาง SSO-gate ปกติของไฟล์แนบ (`/f/{agentId}` +
callable `getEndpointFile`, ดู CLAUDE.md §24) โดยอ่านตรงจาก Cloud Storage ด้วย Admin SDK —
ทำในฐานะ dev/admin ที่ดูแลระบบเองตามคำขอของเจ้าของระบบ ไม่ใช่ flow ที่ user ทั่วไปเข้าถึงได้

---

## ยังไม่ได้ทำ / ต้องรู้

- ไฟล์ `functions/fix-bib-frontend-reusable-rename.cjs` และ `functions/fix-dailysync-rename.cjs`
  ยังไม่ถูก commit เข้า git — เป็น data-fix script ที่รันเสร็จแล้วครั้งเดียว ถ้าต้องการเก็บเป็น
  ประวัติใน repo ให้แจ้ง
- `Skills-Export.zip` และโฟลเดอร์ `_skills_export/` อยู่นอก git (ไฟล์ส่งมอบ ไม่ใช่ source) —
  โฟลเดอร์ scratch ถูกลบตามหลังมัด zip เสร็จแล้ว เหลือแค่ `Skills-Export.zip` ที่ root
