
---

## 32. Endpoint File Versioning + Agent/Skill Usage report (2026-08-26)

### A. File versioning — เก็บ latest + previous, ที่เหลือลบ

**⚠️ path เดิมทำ versioning ไม่ได้เลย** `endpointFiles/{agentId}/{safeName}` ไม่มี version token
และ `save()` **เขียนทับ bytes ทันที** → re-upload ชื่อไฟล์เดิม = ทำลายเวอร์ชันก่อนหน้าก่อนที่จะ
ก๊อปเก็บได้ · path ใหม่ **`endpointFiles/{agentId}/v{n}/{safeName}`** แก้ตรงนี้เชิงโครงสร้าง

**ไฟล์เก่า 28 ตัวไม่ย้าย** — อยู่ path เดิม ถือเป็น v1 (ตรวจแล้วว่าไม่มี reader ไหน parse path เลย
ทุกที่เช็คแค่ truthiness หรืออ่าน `.name`/`.size`)

#### 🔴 lazy v1 backfill = หัวใจที่ทำให้ retention ทำงานจริง
agent เก่าไม่มี version row เลย → `max(version)+1` ได้ **1** → เขียน `v1/` ทั้งที่ **version 1 ตัวจริง
คือไฟล์เก่าที่ path ไม่มี version** และไม่มี row ชี้ถึง → prune ไล่ไม่ถึงตลอดกาล ไฟล์เก่าอยู่ยงคงกระพัน
**กฎ "เก็บแค่ 2 เวอร์ชัน" พังถาวร** → transaction จอง version ต้อง `.create()` row `v1` จาก
`endpointFile` เดิมก่อนเสมอ (24/28 จะได้ `uploadedBy: 'migration'` — **นี่คือเคสส่วนใหญ่ ไม่ใช่ edge case**
UI ต้อง render เป็น label ตรงๆ ห้ามเอาไป resolve เป็น uid)

#### prune = sweep ไม่ใช่ "ลบ v(n-2)"
ลบ **ทุก row ที่ `storagePath != null && version < n-1`** · แบบเจาะจง v(n-2) ถ้าพลาดครั้งเดียว
จะไม่มีใครกลับไปลบอีกเลย = orphan ถาวร (เสีย property "zero orphan" ที่มีอยู่ตอนนี้)
**guard 3 ชั้นก่อนลบทุกครั้ง:**
1. **ห้ามลบ path ที่ตรงกับ `endpointFile.storagePath`** (บั๊กเลข version ต้องทำลายไฟล์ที่ใช้อยู่ไม่ได้)
2. path ต้องขึ้นต้นด้วย `endpointFiles/{agentId}/`
3. custom metadata `agentId` ของ object ต้องตรง
· error ต้อง `console.error` **ห้าม `.catch(()=>{})`** (ของเดิมเป็นแบบนั้น = sweep พังก็ไม่มีใครรู้)

⚠️ **ตรวจแล้ว: bucket มี soft-delete 7 วัน** (`retentionDurationSeconds: 604800`) ไม่มี object
versioning ไม่มี lifecycle → กู้ได้แค่ 7 วัน **guard คือตัวป้องกันจริง ไม่ใช่ bucket**

#### ลำดับเขียน (ทนล้มกลางทาง)
1. txn บน agent doc: backfill v1 → เพิ่ม `endpointFileVersion` → `.create()` row `v{n}` state `pending`
   (**docId = `v{n}` ไม่ใช่ autoId** → `.create()` ชน = ALREADY_EXISTS เป็น fencing token ฟรี)
2. เขียน bytes · 3. txn: set `endpointFile` + flip เป็น `complete` · 4. prune (best-effort)
ล้มที่ 2 → เหลือ row `pending` ไม่มี bytes แต่ `endpointFile` ยังชี้ของเดิม **ทุก reader + `checkMarkReady` ปกติ**
· `listEndpointVersions` กรอง `pending` ทิ้ง ไม่งั้น upload ที่ล้มจะโผล่ในประวัติเหมือนเคยมีจริง
**ห้าม prune ก่อน step 3 commit**

#### sha256 กัน double-submit
ไม่มีอะไรกันมาก่อน (`UploadEndpointFileModal` มี busy flag แต่ `AgentDetailModal` อัปคนละทาง
และ 2 tab ข้ามได้ทั้งคู่) · upload ที่ hash ตรงกับเวอร์ชันปัจจุบัน = **no-op** ไม่งั้นดับเบิลคลิกครั้งเดียว
กินสล็อต "previous" ด้วยไฟล์ซ้ำ แล้วเบียดไฟล์ที่อยากเก็บทิ้ง — **กู้ไม่ได้หลังพ้น 7 วัน**

#### 🔴 สิทธิ์: predicate ใหม่ 2 ตัว ห้ามยัดเข้า `checkAgentActor`
| ใคร | ดูประวัติ | โหลดเวอร์ชันเก่า |
|---|---|---|
| admin | ✅ | ✅ |
| creator (by **email**) | ✅ | ✅ |
| approver/staff ประจำ area | ✅ | ❌ |
| committee | ✅ | ❌ |
| user | ❌ | ❌ |

⛔ **การ "เพิ่ม committee เข้า `checkAgentActor`" ให้ครบ audience = ให้สิทธิ์ upload ทั้งไลบรารี**
(`checkAgentActor` คุม upload + mark-ready ด้วย) · **วัดแล้ว: committee 1 คนถือครบ 16 area**
และ `verify-endpoint-files.cjs:61` assert ไว้ว่า committee ต้องอัปไม่ได้
→ แยกเป็น `checkVersionHistoryViewer` / `checkVersionDownload` ใน `agentReadyRules.js`
⚠️ **ห้ามใช้ `endpointFile.uploadedBy` ตัดสิน creator** — 24/28 เป็น `'migration'` ใช้ `isAgentCreator`

### B. Agent/Skill Usage — รายงาน adoption

**ข้อมูลมีอยู่แล้ว ไม่ต้องเก็บใหม่** — `recordAgentEvent` เขียน marker `kind:'endpoint'` มาตั้งแต่
2026-08-18 · วัดตอนทำ: **42 event · 23 คน · 41 คู่ (agent, คน) · uid resolve เป็นชื่อ+email ครบ 23/23**

#### 🔴 ทำ client-side ไม่ได้เลย — 3 ข้อบังคับพร้อมกัน
1. `/agentEvents` = `allow read, write: if false` client อ่านไม่ได้เลย
2. `/users` `list` = **admin เท่านั้น** → committee/staff/approver resolve uid→ชื่อ ฝั่ง browser ไม่ได้
3. rules ประเมิน Approve Area ไม่ได้ (resolver 7 ชั้นอยู่ `src/lib`)
→ **callable `usageReport` เป็นทางเดียว** (เหตุผลเดียวกับ `markAgentReady`/`attachEndpointFile`)

#### 1 แถว = 1 คนที่เริ่มใช้
group ตาม `(agentId, uid)` เอา `min(createdAt)` = **วันที่ใช้ครั้งแรกจริง** (ไม่ใช่ตัวนับคลิก)
⚠️ **ผลข้างเคียงที่ต้องรู้:** filter Period กรองที่ **วันเริ่มใช้** — คนที่เริ่มใช้เดือน ก.ค. แล้วใช้อีกที ก.ย.
**จะไม่โผล่**ในช่วง ก.ย. · ถ้าอยากได้ "ใช้ในช่วงนี้" ต้องเพิ่ม `lastUsed` (ได้ฟรีจาก event ชุดเดิม ยังไม่ทำ)

#### 🔴 ตัด `expireAt` ออกจาก endpoint marker
ทุก event เคยติด `expireAt = +90 วัน` · TTL policy ยังไม่เปิด ข้อมูลเลยยังไม่หาย **แต่เป็นระเบิดเวลา**
บน column ที่ชื่อ "Adopted date" ตรงๆ → `recordAgentEvent` ไม่เขียน field นี้ให้ `endpoint` แล้ว
(`detail`/`search` ยังคงไว้ — เป็น telemetry ไม่ใช่ record) + backfill ลบของเก่า **42 ตัว**

#### ปิดรูที่ `/f/` ไม่เคยนับ
`FileDownloadPage` ไม่เคยยิง event → คนที่เปิดลิงก์ที่แชร์ใน Teams **มองไม่เห็นเลย** ทั้งที่ใช้จริง
→ ยิง `recordAgentEvent(agentId,'endpoint')` (weekly dedup ทำให้ idempotent กับคลิกในไลบรารี)

#### scope
admin + committee เห็นหมด · staff/approver เห็นเฉพาะ **stored `approveArea`** ที่ตรงกับตัวเอง
(server อ่าน stored อย่างเดียว — resolver ไม่ได้ deploy ไปกับ functions, กฎเดียวกับข้อ 24)
· วัดแล้ว staff 7/7 และ approver 13/13 มี area ครบ **แต่ 2/20 จะเห็นรายงานว่างเพราะไม่มี usage
ใน area ตัวเอง** (คนละเรื่องกับไม่มีสิทธิ์) · agent ที่ไม่มี stored area (1 ตัว) เห็นได้เฉพาะ admin/committee — fail safe

### Key files
| ไฟล์ | หน้าที่ |
|---|---|
| `functions/agentReadyRules.js` | + `checkVersionHistoryViewer`, `checkVersionDownload` |
| `functions/verify-endpoint-versions.cjs` | **รันก่อน deploy** — 23 เคส: invariant ของ storage + permission matrix จริง + guard ว่า committee ยังอัปไม่ได้ |
| `functions/verify-usage-report.cjs` | **รันก่อน deploy** — 17 เคส: row model, scoping, ไม่มี `expireAt` |
| `functions/backfill-endpoint-event-ttl.cjs` | one-off ลบ `expireAt` (ทำไปแล้ว 42 ตัว) |
| `src/lib/csv.js` | ⭐ `csvCell` + `downloadCsv` **ที่เดียว** (BOM `﻿` สำหรับ Excel ภาษาไทย) — sort เป็นหน้าที่ของ caller |
| `src/components/UsageReportPage.jsx` | หน้า `/usage` |

⚠️ **firestore.rules เพิ่ม block `endpointVersions`** → ต้อง publish ผ่าน Console (named DB `ai-agent-lib`)
· rules **ไม่ cascade เข้า subcollection** และไฟล์นี้ไม่มี `{document=**}` เลย → path นี้ default-deny
อยู่แล้ว block ที่เพิ่มเป็น documentation + กันคนเผลอเพิ่ม recursive match ทีหลัง

### บทเรียน: verify script ที่ freeze "ยังไม่มีใครใช้ฟีเจอร์" เป็น invariant
`verify-child-links.cjs` + `verify-rename-cascade.cjs` **แดงขึ้นมาเอง**โดยไม่มีใครแก้โค้ด เพราะมีคน
ผูก `childSkillIds` จริงใน production เป็นครั้งแรก · assertion เดิมเขียนว่า "resolve **เหมือนเดิมเป๊ะ**"
ซึ่งแปลว่า "ยังไม่มีใครใช้ฟีเจอร์นี้" → แก้เป็น assert **พฤติกรรม**: superset (ห้าม *เสีย* pairing แต่
*ได้เพิ่ม* ถือว่าถูก) และ rename parity นับเฉพาะลูกที่จับคู่ด้วย **ชื่อ** (ลูกที่ผูกด้วย doc ID ทน
rename อยู่แล้วโดยออกแบบ) — **เคสเดียวกับที่เคยเกิดกับ `verify-endpoint-files.cjs` มาแล้ว**
