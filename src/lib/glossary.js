// V7 glossary (2026-10-01) — the ONE place term explanations live. Used by the
// hover <Term> and by the "Glossary" panel, so the two can never disagree.
// Headings English, explanations Thai (CLAUDE.md §6).
export const GLOSSARY = [
  { k: 'Agent', v: 'ทำงานได้ทั้งกระบวนการด้วยตัวเอง และอาจเรียกใช้ Skill อื่น' },
  { k: 'Skill', v: 'ความสามารถย่อยหนึ่งอย่าง ใช้เดี่ยวหรือให้ Agent เรียกใช้' },
  { k: 'Agent+Skill', v: 'Agent ที่มี Skill ผูกอยู่ (parent → child) — Skill บางตัวใช้เดี่ยวได้ด้วย' },
  { k: 'T1', v: 'Skill ใช้ภายในองค์กร' },
  { k: 'T2', v: 'Agent ใช้ภายในองค์กร' },
  { k: 'T3', v: 'Skill ที่ลูกค้าโต้ตอบด้วยโดยตรง' },
  { k: 'T4', v: 'Agent ที่ลูกค้าโต้ตอบด้วยโดยตรง ต้องผ่านการตรวจเข้มกว่าเครื่องมือภายใน' },
  { k: 'Internal / Customer Facing', v: 'Customer Facing = ลูกค้าโต้ตอบกับ agent เองตอนใช้งาน โดยไม่มีคนในองค์กรรีวิวก่อน' },
  { k: 'Reusable', v: 'ทีมอื่นนำไปใช้ต่อได้ทันที · with Conditions = ใช้ได้ถ้าตรงเงื่อนไข · Non-reusable = ทำมาใช้เฉพาะทีม' },
  { k: 'Human in the loop', v: 'มีคนตรวจหรือยืนยันผลก่อนนำไปใช้จริง' },
  { k: 'Approve Area', v: 'สายงานที่รับผิดชอบอนุมัติ เช่น Security, QA, Financial — ตัดสินว่าใครเป็นผู้อนุมัติรายการนี้' },
  { k: 'To Do', v: 'ยังไม่เริ่มพัฒนา (0%)' },
  { k: 'In Progress', v: 'กำลังพัฒนา' },
  { k: 'Pilot', v: 'ทดลองใช้กับกลุ่มเล็กก่อนเปิดให้ทุกคน' },
  { k: 'Ready to Use', v: 'เปิดใช้ได้แล้ว และมีลิงก์หรือไฟล์ให้เข้าถึง' },
  { k: 'Request deploy', v: 'ขออนุมัติเปิดใช้งานเมื่อ progress ถึง 95% เมื่อได้รับอนุมัติจึงปรับเป็น Ready to use ได้' },
];

const BY_KEY = new Map(GLOSSARY.map((t) => [t.k.toLowerCase(), t]));
export function glossaryTerm(key) {
  return BY_KEY.get(String(key || '').toLowerCase()) || null;
}
