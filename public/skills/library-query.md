# Skill: AI Library Query & Analysis

> ค้น/กรอง/นับ/จัดกลุ่ม และวิเคราะห์ catalog ของ AI agent/skill จากไฟล์ export —
> รวม data dictionary และกติกาการจัดประเภท (Tier/Status) ให้ AI ตัวไหนก็ตีความข้อมูลตรงกับระบบต้นทาง

---

## เงื่อนไขการใช้งาน (Requirements)

1. **ต้องมีไฟล์ export จากระบบ AI Agent Library** (CSV จากปุ่ม Export ในเว็บ) แนบมาด้วย —
   skill นี้ไม่มีข้อมูลในตัว และข้อมูลใน export คือ snapshot ณ วันที่ export เท่านั้น
2. คำตอบทุกครั้งต้องมาจากข้อมูลในไฟล์จริง **ห้ามเดา/แต่งชื่อ agent ที่ไม่มีในไฟล์**
3. ถ้าไฟล์มีคอลัมน์ `archived` ให้ตัดรายการ `archived = TRUE` ออกจากทุกคำตอบเชิงแนะนำ
   (ใช้อ้างอิงเชิงประวัติได้ แต่ต้องบอกชัดว่าถูก archive แล้ว)

## วิธีเรียกใช้

```
ใช้ skill library-query กับไฟล์ export ที่แนบ:
- "ทีม X มี agent กี่ตัว อะไรบ้าง"
- "Skill ที่ Reusable และพร้อมใช้แล้ว มีอะไรบ้าง"
- "ใครเป็น creator ของ Y / Z ควรคุยกับใคร"
- "จัดกลุ่มตาม status ให้ดูหน่อย"
```

---

## Data Dictionary (ความหมายของคอลัมน์)

| คอลัมน์ | ความหมาย |
|---|---|
| `agentName` | ชื่อ Agent/Skill |
| `aiAgent`, `skillMd` | boolean สองตัวที่ใช้จัดประเภท (ดูกติกา Type ด้านล่าง) |
| `owner` | ทีมเจ้าของ (accountability) |
| `creator`, `creatorEmails` | รายชื่อ/อีเมลผู้สร้างทั้งทีม (comma-separated — คนเดียวอาจอยู่หลายตัว) |
| `description`, `input`, `output`, `businessValue` | สาระของตัว agent |
| `coreAbility`, `relatedRole` | ความสามารถหลัก / บทบาทผู้ใช้ที่เกี่ยวข้อง (multi-value) |
| `customerFacing`, `internalUse` | boolean ระบุขอบเขตการใช้ (ดูกติกา Scope) |
| `reusable` | `Reusable` / `Reusable with Conditions` (ดู `reuseCondition`) / `Non-reusable` |
| `devProgress` | ความคืบหน้า 0–100 (ดูกติกา Status) |
| `deploymentStatus` | `approved` = ผ่านการอนุมัติ deploy แล้ว |
| `launchDate` | วันเปิดใช้ (แผนหรือจริง) |
| `sdlcStage`, `sdlcProcessMapping`, `useCase` | ตำแหน่งใน SDLC (multi-value; process id คือเลขนำหน้า เช่น "2.2") |
| `endpoint` | ลิงก์เข้าใช้งาน/ดาวน์โหลด (ถ้ามี) |
| `archived`, `archiveReason` | ถูกปลดจาก library แล้ว + เหตุผล |

## กติกาการจัดประเภท (ต้องใช้ชุดนี้เท่านั้น — ห้ามตีความเอง)

**Type:** `Skill` ก็ต่อเมื่อ `aiAgent = FALSE` **และ** `skillMd = TRUE` — นอกนั้นเป็น `Agent` ทั้งหมด

**Scope (เช็คตามลำดับ หยุดที่ข้อแรกที่จริง):**
1. `customerFacing = TRUE` → External
2. `internalUse = TRUE` → Internal
3. ทั้งคู่ว่าง/false แต่มี `sdlcStage` → Internal
4. นอกนั้น → External

**Tier:** Skill+Internal = T1 · Agent+Internal = T2 · Skill+External = T3 · Agent+External = T4

**Status (จาก devProgress):** 0–10 = To Do · 11–89 = In Progress · 90–99 = Pilot · 100 = Ready to Use

## กติกาการตอบ (สำคัญ)

1. **จัดอันดับตามความพร้อมเสมอ** เมื่อผู้ใช้ถามหา "ตัวไหนใช้ได้": Ready to Use มาก่อน → Pilot →
   ส่วน In Progress / To Do เอ่ยถึงได้เป็นข้อมูลประกอบ แต่**ต้องบอกชัดว่ายังใช้ไม่ได้ เพราะยังพัฒนาไม่เสร็จ**
2. ถามหาตามคน (creator) ให้ match แบบ substring กับทั้ง `creator` และ `creatorEmails`
   (ชื่อเป็น comma-separated — คนหนึ่งอยู่ได้หลายรายการ)
3. คำถามเชิงความหมาย ("มีตัวไหนช่วยเรื่อง X") — ค้นจาก description/input/output/businessValue
   ด้วยความเข้าใจความหมายจริง **ถ้าไม่มีตัวที่ตรงจริงให้ตอบว่าไม่พบ ห้าม force-fit** ของที่เกี่ยวแค่ผิวเผิน
4. มี `endpoint` → แนบลิงก์ไปในคำตอบด้วย (นี่คือทางไปใช้งานจริง)
5. คำตอบเชิงจำนวน (นับ/จัดกลุ่ม) ให้แสดงเลขรวมและรายชื่อ (ถ้า ≤ ~15 รายการ) เพื่อให้ตรวจกลับได้
