# AI Library Skill Pack

ชุด skill (.md) ที่สกัดมาจาก logic จริงเบื้องหลังเว็บ **AI Agent Library** —
เอาไปใช้กับ AI assistant ตัวไหนก็ได้ (Claude, ChatGPT, Gemini, Copilot ฯลฯ) โดยไม่ต้องพึ่งระบบของเรา

| ไฟล์ | ทำอะไร | ต้องใช้ข้อมูลอะไร |
|---|---|---|
| `duplicate-check.md` | ตรวจไอเดีย agent/skill ใหม่ว่าซ้ำกับของเดิมไหม พร้อมคะแนน + ระดับความเสี่ยง | catalog CSV |
| `connection-suggest.md` | หาว่า agent ต่อกับตัวไหนได้ (Data Handoff / Trigger / Shared Context) | catalog CSV |
| `library-query.md` | ค้น/กรอง/นับ/วิเคราะห์ catalog + data dictionary และกติกา Tier/Status ของระบบ | ไฟล์ Export จากเว็บ |

> หมายเหตุ: tool ภายในบางตัวของระบบ (เช่น capability_search, get_agent_detail) ไม่แยกเป็นไฟล์
> เพราะเป็นแค่การค้น/lookup ที่ AI ทุกตัวทำเองได้อยู่แล้ว — กติกาที่จำเป็นถูกยุบรวมไว้ใน `library-query.md`

---

## เงื่อนไขการใช้งาน (อ่านก่อนแจกต่อ)

1. **skill เหล่านี้ไม่มีข้อมูลในตัว** — ทุกตัวต้องใช้คู่กับไฟล์ข้อมูล catalog (export จากเว็บ AI Agent Library
   หรือ catalog ของทีมคุณเองที่มีคอลัมน์ตามที่แต่ละไฟล์ระบุ) ผลลัพธ์ดีเท่าข้อมูลที่ป้อนเท่านั้น
2. **ข้อมูล export คือ snapshot** — ไม่ sync อัตโนมัติ ใช้ไปนานแล้วควร export ใหม่
3. **ระวังข้อมูลภายใน:** ไฟล์ export มีชื่อคน/อีเมล/รายละเอียดระบบภายใน —
   แชร์เฉพาะช่องทางภายในองค์กร และอย่าอัปโหลดเข้า AI สาธารณะที่นำข้อมูลไป train ต่อ
   (ใช้ enterprise/workspace tier ที่ปิด training เท่านั้น)
4. ผลวิเคราะห์เป็น "ข้อเสนอ" — การตัดสินใจจริง (อนุมัติ, สร้าง, เชื่อมระบบ) เป็นของมนุษย์เสมอ
5. skill เป็น read-only ทั้งหมด — ไม่มีตัวไหนสั่งแก้ข้อมูลในระบบได้

## วิธีติดตั้ง/ใช้งานตามแต่ละ AI

**Claude (claude.ai หรือ Claude Code)**
- แนบไฟล์ .md ที่ต้องการ + ไฟล์ catalog เข้าไปในแชต แล้วสั่งตามตัวอย่างในไฟล์นั้น
- Claude Code: วางไว้ที่ `.claude/skills/<ชื่อ>/SKILL.md` ในโปรเจกต์ จะเรียกใช้เป็น skill ได้เลย

**ChatGPT**
- แนบ .md + catalog ในแชต หรือสร้าง Custom GPT แล้ววางเนื้อหา .md ใน Instructions
  และอัปโหลด catalog เป็น Knowledge

**Gemini**
- แนบทั้งสองไฟล์ในแชต หรือใส่เนื้อหา .md เป็น system instruction ใน Gem

**อื่นๆ (Copilot ฯลฯ)**
- หลักเดียวกัน: ให้ AI เห็น (1) เนื้อหา .md เป็น instructions และ (2) ไฟล์ catalog เป็นข้อมูล
  แล้วอ้างชื่อ skill ตอนสั่งงาน

## วิธีได้ไฟล์ catalog

1. เข้าเว็บ AI Agent Library → ปุ่ม **Export**
2. สิทธิ์ทั่วไป export รายการ Approved ได้ / staff ขึ้นไป export All Data ได้ (มีคอลัมน์ครบกว่า
   รวม `archived`, `endpoint`)
3. ได้ไฟล์ CSV มาใช้คู่กับ skill ได้ทันที

## ที่มา

Logic ทั้งหมดสกัดจากโค้ดจริงของระบบ (มิใช่การคาดเดา):
- `duplicate-check.md` ← `src/lib/similarity.js` (weights, thresholds, กติกา multi-overlap จากบทเรียนใช้งานจริง)
- `connection-suggest.md` ← `src/lib/connections.js` (สัญญาณ 4 ตัว, การกดคะแนนค่า generic, stage adjacency)
- `library-query.md` ← `src/lib/skills.js`, `src/lib/tier.js`, `src/lib/status.js` (data dictionary, Tier/Status rules)

อัปเดตล่าสุด: 2026-07-30
