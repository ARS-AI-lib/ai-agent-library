// Creator's declaration (the bank questionnaire's D1–D6), kept as agent fields (2026-11-26):
//   D1 purpose → description (existing)      D4 tools  → tool (existing)
//   D2 domains → permittedDomains (new)       D5 needs  → requiredSkills (new)
//   D3 limits  → prohibitedUses (new)         D6 models → llm (existing)
// ⛔ Single source of the new fields' labels/hints and of "what is missing on a doc".
export const DECL_FIELDS = [
  { key: 'permittedDomains', label: 'Permitted Domains', hint: 'Domain ที่ใช้ได้ เช่น ใช้เฉพาะ DGL', placeholder: 'เช่น ใช้เฉพาะ DGL, งาน SDLC ภายใน' },
  { key: 'prohibitedUses', label: 'Prohibited Uses', hint: 'ข้อห้าม: ห้ามนำ Agent/Skill นี้ไปใช้ทำอะไร', placeholder: 'เช่น ห้ามใช้ตอบคำถามลูกค้า ห้ามใช้ตัดสินใจแทนคน' },
  { key: 'tool', label: 'Permitted Tools', hint: 'ประเภท tool ที่อนุญาตให้เรียกใช้ เช่น ค้นหาข้อมูลจาก internet, เขียน/อ่านไฟล์', placeholder: 'เช่น JIRA API, n8n' },
  { key: 'requiredSkills', label: 'Required Skills', hint: 'ต้องใช้ร่วมกับ skill อื่นหรือไม่ ถ้าใช่ระบุชื่อ (ถ้าไม่ต้อง ให้พิมพ์ว่า "ไม่ต้อง")', placeholder: 'เช่น ไม่ต้อง หรือ Skill A, Skill B' },
  { key: 'llm', label: 'Models Tested', hint: 'โมเดลที่ทดสอบแล้ว เช่น Gemini-3.8-flash-lite, Claude Opus 5.5', placeholder: 'เช่น Gemini 3 Flash' },
];

const filled = (v) => String(v ?? '').trim() !== '';

// Declaration fields that are empty on an agent doc (existing items predate the new ones).
export function missingDeclaration(agent) {
  return DECL_FIELDS.filter((f) => !filled(agent?.[f.key])).map((f) => f.key);
}
