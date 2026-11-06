# Category Grouping — Named, Collapsible Groups (Design)

> Status: รอ approval · 2026-11-06 · scope เคาะแล้วกับผู้ใช้: **ทำจุด 1–2 เท่านั้น**

## Intent & Why

Categories 26 ค่าใน Sidebar ตอนนี้เป็นลิสต์แบนที่มีแค่เส้นคั่นบางๆ (ฝังความหมายไว้แล้ว
แต่ไม่มีชื่อกลุ่ม กดซ่อนไม่ได้) ผู้ใช้ต้องการ **กลุ่มที่มีชื่อ** โดยเฉพาะกลุ่ม Business
(products ที่ขายลูกค้า) ให้เห็นชัดเจนที่สุด และ**กดชื่อกลุ่มเพื่อ hide/show ได้**

## Goals / Non-goals

**ทำ (จุด 1–2):**
1. Sidebar ฝั่ง Category → แสดงเป็นกลุ่มชื่อ + หัวกลุ่มกด collapse/expand ได้
2. Category filter ใน FilterSheet (มือถือ) → ได้ grouping เดียวกัน **ฟรีเชิงโครงสร้าง**
   เพราะ `App.jsx` ส่ง `sidebarEl` เป็น `categoryPanel` — คือ Sidebar component ตัวเดียวกัน

**ไม่ทำ (จุด 3–5 — สั่งตัดแล้ว):** header ของ CardGrid view-by-category · category bar
ใน Dashboard · ตัวเลือกใน EditAgentModal — ไม่แตะ 3 ไฟล์นี้เลย

## Constraints

- **Single source of truth = ตารางใหม่ใน `src/lib/approveAreas.js`** —
  กลุ่มของ Business ต้อง derive จาก `VERTICAL_CATEGORIES` (spread เหมือน `CATEGORY_AREA` ทำ)
  เพื่อให้ "category ไหนคือ product" มีนิยามที่เดียว ถ้าแก้ `VERTICAL_CATEGORIES` กลุ่มตามอัตโนมัติ
- **Fallback bucket บังคับ** — `/config/schema.category` เป็น grow-only มีหมวดใหม่เข้ามาได้
  ผ่าน CategoryApprovalPanel โดยไม่ต้อง deploy โค้ด หมวดที่ไม่รู้จักห้ามหายจาก UI
- Label ภาษาอังกฤษทั้งหมด (กฎข้อ 6) · ค่า category เองเป็นข้อมูลจริงไม่แปล
- ไม่สร้าง collection ใหม่ · ไม่แตะ Firestore rules · ไม่ deploy functions
- Collapse state = session-only ไม่ persist (สอดคล้องกับ VIEW/SORT ที่ไม่จำค่าข้ามเปิดเว็บ)
- เริ่มต้น **ทุกกลุ่ม expand** — ไม่มีข้อมูลถูกซ่อนจนกว่าผู้ใช้กดเอง

## Approaches

| # | วิธี | ผล |
|---|---|---|
| A ✅ | ตาราง `CATEGORY_GROUPS` ใน `approveAreas.js` → Sidebar อ่าน | ที่เดียว, ได้ fallback ง่าย, ตามแพทเทิร์น SSOT เดิม |
| B | เก็บกลุ่มใน Firestore `/config` | ได้แก่ไขสดไม่ต้อง deploy แต่ต้องเขียน admin UI + rules สำหรับแก้กลุ่ม — เกิน scope งานเล็กนี้ |
| C | hardcode ใน Sidebar | ผูกกับ component เดียว, ทำซ้ำ logic ข้าม surface — ขัดกฎ "ที่เดียว" ของ repo |

**เลือก A**

## Final Mapping (7 กลุ่ม + fallback — เคาะกับผู้ใช้แล้ว)

| ลำดับ | กลุ่ม | Categories |
|---|---|---|
| 1 | **Business & Product** | derived จาก `VERTICAL_CATEGORIES`: Investment · Lending & Credit · NEXT · เป๋าตัง, เป๋าตุง, ถุงเงิน · CLICX · Core bank |
| 2 | **Support Functions** | Requirements & Product · Project & Delivery · Compliance & Governance · Resource Planning · People Development · Financial · Procurement |
| 3 | **Design & Content** | UX Research · Design & UI · Writing & Content |
| 4 | **Engineering** | Architecture · Software Development · Data & Analytics |
| 5 | **Quality** | SIT · QA · Security |
| 6 | **Operations** | DevOps & Platform · SRE & Reliability · Incident Management |
| 7 | **Assistants** | Virtual Assistant |
| + | **Unassigned** (fallback) | ชื่อหมวดใน schema ที่ไม่อยู่ในตาราง (หมวดใหม่ในอนาคต) |

## My Calls (user ยังไม่ตอบ — โปรดแก้ได้เลยตอน review)

1. **Virtual Assistant ย้ายจาก "ปักบนสุด" ลงมาเป็นกลุ่มสุดท้ายชื่อ "Assistants"**
   — ใน mockup แสดงแบบนี้ ผู้ใช้ไม่คัดค้าน · ไม่ตั้งชื่อกลุ่มว่า "Platform Tools" เพราะ
   sidebar มี filter ชื่อเดียวกันอยู่แล้วในส่วน Other (`internalTool`) จะซ้ำซ้อนกัน
   · กลุ่มนี้มี 1 ตัว — ยอมรับได้เพราะยังได้หมวดหลัก 6 กลุ่มครบ
2. **Fallback ชื่อ "Unassigned"** ไว้ท้ายสุด — เหตุผลเดียวกับ bucket
   `(unassigned)` ของ Owner/Category ใน CardGrid (§28)
3. **หัวกลุ่มไม่มี total count** — แค่ลูกศร + ชื่อ (count ต่อรายการยังอยู่ครบ)
   เพิ่มทีหลังได้ถ้าเห็นว่ามีประโยชน์

## Side Effects (ต้องทำใน change เดียวกัน)

- `CATEGORY_GROUP_STARTS` ไม่จำเป็นแล้ว → **ลบออก** (consumer เดียวคือ Sidebar ซึ่งถูกเขียนใหม่)
- comment "first key here = pinned to top" ใน `CATEGORY_AREA` ต้องเขียนใหม่ —
  key order จะไม่ผูกกับลำดับ sidebar อีกต่อไป (`seed-approve-area-schema.cjs` เขียน
  `/config/schema.category` จาก key order — grouping match ด้วย**ชื่อ** ไม่ใช่ index จึงไม่กระทบ)
- `.v7-sb-sep` (เส้นคั่น) ถูกแทนด้วยหัวกลุ่มจริง → CSS เดิมหลุดออกจาก markup
- Class ใหม่ตั้งชื่อไม่ชน `.sb`/`.sh`/`.sbar`/`.sname`/`.ttag` (กฎข้อ 6)

## Verification (ตอนทำ จะกำกับใน plan)

- `node --check` ทั้งไฟล์ที่แตะ · mock-DOM smoke test ของ Sidebar
  (group เรียงตามตาราง, หมวดไม่รู้จักลง Unassigned, กดหัวกลุ่มซ่อน/แสดง, count ไม่ขยับ)
- Visual: `npm run build` แล้วเปิด dev server ดู sidebar + มือถือ (viewport ≤760) sheet Category