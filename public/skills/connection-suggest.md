# Skill: Agent Connection Suggest

> หาว่า agent/skill ตัวใหม่ (หรือตัวที่เลือก) "ต่อ" กับตัวไหนใน catalog ได้บ้าง —
> ส่งข้อมูลต่อ (Data Handoff), Trigger ตามลำดับงาน, หรือใช้ Context/Tool ร่วมกัน
> พร้อมทิศทางและเหตุผล — ใช้ได้กับ AI assistant ทุกตัว

---

## เงื่อนไขการใช้งาน (Requirements)

1. **ต้องมีข้อมูล catalog แนบ** — คอลัมน์ที่ใช้: `agentName, input, output, tool, owner, sdlcProcessMapping`
   (ไม่มี `sdlcProcessMapping` ก็ใช้ได้ แต่จะเสียสัญญาณ "ลำดับขั้นตอนงาน" ไป)
2. **ต้องมี draft/ตัวตั้งต้น** ในโครงเดียวกัน
3. ผลลัพธ์เป็น "ข้อเสนอ" ให้มนุษย์พิจารณา — **ห้ามกุ endpoint จริง, ชื่อ API, หรือ technical spec**
   ของตัวใดตัวหนึ่ง แนะนำได้แค่ระดับสถาปัตยกรรมทั่วไป (REST/webhook/message queue)

## วิธีเรียกใช้

```
ใช้ skill connection-suggest หาว่า agent นี้ต่อกับตัวไหนใน catalog ได้บ้าง:
ชื่อ: <agentName> / Input: <input> / Output: <output>
Tool: <tool> / Team: <owner> / Process: <sdlcProcessMapping ถ้ามี>
```

---

## ขั้นตอน (Instructions สำหรับ AI)

### 1) Normalize
เหมือน duplicate-check: lowercase, ตัด "tbc", แทนเครื่องหมายวรรคตอนด้วยช่องว่าง

### 2) สัญญาณ 4 ตัว + น้ำหนัก (ต่อคู่ draft × candidate)

| สัญญาณ | น้ำหนัก | วิธีคิด |
|---|---|---|
| **Data Handoff** | 0.50 | เทียบ `draft.output ↔ candidate.input` และ `candidate.output ↔ draft.input` (token overlap หรือ string similarity เอาค่ามากกว่า, 0–100) — **ทิศทางที่คะแนนสูงกว่าคือทิศของ connection** |
| **Stage adjacency** | 0.20 | ระยะห่างของขั้นตอน process ในลำดับงาน: ห่าง 1 ขั้น = 100 (ต่อกันพอดี), 2 ขั้น = 60, ขั้นเดียวกัน = 50, 3 ขั้น = 30, เกินนั้น = 0 |
| **Shared tool** | 0.15 | token overlap ของรายการเครื่องมือ × 100 |
| **Same team** | 0.15 | owner ตรงกัน = 100, ไม่ตรง = 0 |

`confidence = handoff×0.50 + stage×0.20 + tool×0.15 + team×0.15` (เพดาน 100)

### 3) กติกากันผลหลอก (สำคัญ)
- **ค่า generic ต้องถูกกดคะแนน:** ถ้า input/output ที่จับคู่กันเป็นค่าที่โผล่ใน catalog บ่อยมาก (ปรากฏ ≥ 5 รายการ เช่น "document", "report") แสดงว่าจับคู่กับใครก็ได้ ไม่ใช่สัญญาณจริง → หารคะแนน handoff ด้วย `1 + log2(จำนวนรายการที่ใช้ค่านั้น)`
- **ชื่อ platform/เครื่องมือดังๆ ไม่นับเป็นสัญญาณ handoff:** jira, gitlab, github, docker, slack, teams, claude, gemini, gpt, python ฯลฯ — คำพวกนี้เจอทั่วไป ให้ตัดออกจากการเทียบ input/output (ยังนับใน Shared tool ได้)
- **ข้อมูลไม่ครบ = ห้ามมั่นใจ:** ถ้า output หรือ input ฝั่งที่จับคู่ว่าง/เป็น TBC ให้ capped confidence ไว้ไม่เกิน 20 และติดป้าย "ข้อมูลยังไม่ครบ"

### 4) ประเภท connection
ตั้งตามสัญญาณที่มีน้ำหนักคะแนนสูงสุด:
- dataHandoff เด่น → **Data Handoff** (ส่งผลลัพธ์ต่อเป็น input)
- stage เด่น → **Trigger** (จบขั้นนี้แล้วปลุกตัวถัดไป)
- tool/team เด่น → **Shared Context/Tool**

### 5) รายงานผล
คืนเฉพาะคู่ที่ confidence ≥ 40 (สูงสุด 6 อันดับ):
```
## ข้อเสนอการเชื่อมต่อ: <ชื่อ draft>
1. → <ชื่อ candidate> (<ทิศทาง: draft→existing หรือ existing→draft>)
   ประเภท: <Data Handoff/Trigger/Shared Context> — <confidence>%
   เหตุผล: Output "<...>" ≈ Input "<...>" (<xx>%) · ห่าง <n> ขั้นตอน · ทีมเดียวกัน
   แนวทาง integrate (ระดับสถาปัตยกรรมเท่านั้น): <REST/webhook/queue + เหตุผลสั้นๆ>
...
```
ถ้าไม่มีคู่ไหนถึงเกณฑ์ ให้ตอบตรงๆ ว่าไม่พบ — ห้าม force-fit
