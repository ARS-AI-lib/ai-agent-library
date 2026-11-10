# Usage Page Adjustments — Design (2026-11-10)

## Intent
ปรับหน้า `https://wolfy-ai-library.web.app/usage` 3 ข้อตามคำขอผู้ใช้:
ตัดคอลัมน์ Source · เปลี่ยน header เป็น "Agent/Skill Name" · เพิ่มปุ่ม "Group by Agent/Skill"

## Goals
1. คอลัมน์ **Source** หายไปจากหน้าจอ **และ** จาก CSV — ข้อมูล `source` ในแถวยังคงถูกส่งมาจาก
   callable `usageReport` เหมือนเดิม (เก็บข้อมูล ไม่แสดงผล)
2. Header ของคอลัมน์แรกเปลี่ยนจาก "Agent Name" → **"Agent/Skill Name"** ทั้งหน้าจอและ CSV
3. ปุ่ม toggle **"Group by Agent/Skill"** — รวมแถวทั้งหมดของ agent ตัวเดียวกันใต้หัวชื่อ
   (เหมือน "Group by Owner" ที่มีอยู่): หัวกลุ่ม + badge จำนวนคน + แถวของแต่ละคนครบทุกคอลัมน์

## Non-goals
- ไม่แตะ callable `usageReport` / ไม่ deploy functions / ไม่แก้ firestore.rules — **hosting-only**
- ไม่เปลี่ยนโมเดลแถว (1 แถว = 1 คนที่เริ่มใช้ครั้งแรก) · ไม่เปลี่ยน filter ปัจจุบัน
- ไม่ทำ summary แบบเฉพาะยอดรวม (user เคาะแล้วว่าเห็นรายชื่อคนด้วย)

## Approaches (พิจารณาแล้ว)
- **A (เลือก):** Project · Task กลายเป็นคอลัมน์ใหม่ของตัวเอง + ตัด Source ทิ้ง —
  ⚠️ ข้อมูลรองรับแล้ว: CSV เดิมมีคอลัมน์ "Project / Task" แยกอยู่แล้ว หน้าจอกับ CSV จึงตรงกันเป๊ะ
- **B (ตกไป):** Project · Task ไปเป็น sub-line ใต้ cell Adopter — user ตอบ A

## Decisions (เคาะแล้ว)
1. คอลัมน์ใหม่ **"Project / Task"** อยู่ตำแหน่งคอลัมน์ Source เดิม (ก่อน Adopted Date):
   แถว Library ว่าง → แสดง `—`
2. Group by Agent/Skill = ปุ่ม toggle พี่น้องกับ Group by Owner — **กดตัวหนึ่ง อีกตัวปิด**
   (refactor state เป็น `groupBy: null | 'owner' | 'agent'` เพื่อกันกดติดพร้อมกัน 2 ชั้นโดยโครงสร้าง)
3. กลุ่มเรียงตามจำนวนแถวมาก→น้อย (เหมือน Group by Owner เดิม) · group บน `filtered`
   ไม่ใช่ `rows` · badge แสดงจำนวน · `colSpan` เหลือ 7 (คอลัมน์รวมเท่าเดิม)
4. Header CSV: 'Agent Name' → **'Agent/Skill Name'** · ลบคอลัมน์ `source` ออกจาก CSV
   · คง `project` + header 'Project / Task' · **การกด Group ไม่กระทบ CSV**
   (CSV ส่งออกตามแถวที่ filter อยู่เหมือนเดิม เรียงตาม adoptedAt desc จาก server)
5. ฟิลด์ `source` ยังอยู่ใน row ที่ server ส่งมา (เผื่อใช้ในอนาคต) — แค่ UI/CSV ไม่ render

## เหลือให้ builder (implementation detail)
- ชื่อตัวแปร/const ใน `UsageReportPage.jsx` (เช่น `groupKey` จาก `groupBy`)
- วิธีเขียนปุ่ม/หัวกลุ่มให้ reuse `.usage-toggle`/`.usage-group`/`.usage-badge` เดิม ไม่แตะ CSS ใหม่
  เว้นจำเป็น

## Verification
- `node --check` + `npm run build` · ดูตา desktop + mobile 375 (filter bar มีปุ่มเพิ่ม 1 ปุ่ม,
  flex-wrap เดิมรองรับ) · เทียบ CSV กับหน้าจอ: คอลัมน์ชุดเดียวกัน คือ
  Agent/Skill Name · Owner · Area · Category · Adopter · Project / Task · Adopted Date
- Deploy: hosting-only ตามกฎ §11 (confirm ก่อน deploy production)