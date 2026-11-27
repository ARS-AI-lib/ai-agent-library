// Creator's declaration (the bank questionnaire's D1–D6), kept as agent fields (2026-11-26):
//   D1 purpose → description (existing)      D4 tools  → tool (existing)
//   D2 domains → permittedDomains (new)       D5 needs  → requiredSkills (new)
//   D3 limits  → prohibitedUses (new)         D6 models → llm (existing)
// ⛔ Single source of the new fields' labels/hints and of "what is missing on a doc".
export const DECL_FIELDS = [
  { key: 'permittedDomains', required: true, none: 'ไม่จำกัด domain', label: 'Permitted Domains', hint: 'Domain ที่ใช้ได้ เช่น ใช้เฉพาะ DGL', placeholder: 'เช่น ใช้เฉพาะ DGL, งาน SDLC ภายใน' },
  { key: 'prohibitedUses', required: true, none: 'ไม่มีข้อห้าม', label: 'Prohibited Uses', hint: 'ข้อห้าม: ห้ามนำ Agent/Skill นี้ไปใช้ทำอะไร', placeholder: 'เช่น ห้ามใช้ตอบคำถามลูกค้า ห้ามใช้ตัดสินใจแทนคน' },
  { key: 'tool', required: true, none: 'ไม่ใช้ tool', label: 'Permitted Tools', hint: 'ประเภท tool ที่อนุญาตให้เรียกใช้ เช่น ค้นหาข้อมูลจาก internet, เขียน/อ่านไฟล์', placeholder: 'เช่น JIRA API, n8n' },
  { key: 'requiredSkills', required: true, none: 'ไม่ต้อง', label: 'Required Skills', hint: 'ต้องใช้ร่วมกับ skill อื่นหรือไม่ ถ้าใช่ระบุชื่อ (ถ้าไม่ต้อง ให้ติ๊กช่อง "ไม่ต้อง")', placeholder: 'เช่น ไม่ต้อง หรือ Skill A, Skill B' },
  { key: 'llm', required: true, none: 'ยังไม่ได้ทดสอบ', label: 'Models Tested', hint: 'โมเดลที่ทดสอบแล้ว เช่น Gemini-3.8-flash-lite, Claude Opus 5.5', placeholder: 'เช่น Gemini 3 Flash' },
];

const filled = (v) => String(v ?? '').trim() !== '';

// True when `value` is exactly the field's "none" phrase (the checkbox on the form). 2026-11-27.
export function isNoneValue(key, value) {
  const f = DECL_FIELDS.find((x) => x.key === key);
  return !!f && String(value ?? '').trim() === f.none;
}

// DeclField checkbox (F6): initial state comes from the stored value once; afterwards only an
// explicit tick changes it, so typing "ไม่ต้องใช้…" never hides the input mid-typing.
export const initialNoneChecked = (key, value) => isNoneValue(key, value);
// New field value after the user ticks/unticks. Unticking clears only an exact none phrase.
export function valueAfterToggle(key, checked, value) {
  const f = DECL_FIELDS.find((x) => x.key === key);
  if (!f) return value;
  if (checked) return f.none;
  return isNoneValue(key, value) ? '' : value;
}

// Declaration fields that are empty on an agent doc (older items predate them). All five are
// required since 2026-11-27 (text, or the field's "none" phrase); older items are forced to fill them
// at the next step they touch (deploy request, backfill assessment, Edit Save).
export function missingDeclaration(agent) {
  return DECL_FIELDS.filter((f) => f.required && !filled(agent?.[f.key])).map((f) => f.key);
}

// Patch that fills ONLY the declaration fields an agent doc still lacks, from `values`.
// Never overwrites a field the doc already has (a paired sub-skill keeps its own tool/llm).
export function declarationPatch(agent, values) {
  return Object.fromEntries(missingDeclaration(agent).map((k) => [k, String(values?.[k] ?? '').trim()]));
}
