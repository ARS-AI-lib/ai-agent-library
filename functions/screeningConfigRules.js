// Validation of the editable screening questionnaire (/config/screening), 2026-11-26.
// Pure, CommonJS — shared by the manageScreeningConfig callable and verify-screening-config.cjs.
const STAGES = ['pre', 'deploy'];
const FIXES = ['none', 'should', 'must'];
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

// Returns an error message (Thai) or null.
function validateScreeningConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return 'config ไม่ถูกต้อง';
  const t = cfg.thresholds;
  if (!t || !Number.isFinite(t.md) || !Number.isFinite(t.hi) || !(t.md > 0 && t.md < t.hi)) {
    return 'เกณฑ์ระดับต้องเป็นตัวเลข และ Medium ต้องน้อยกว่า High';
  }
  const qs = cfg.questions;
  if (!Array.isArray(qs) || qs.length === 0) return 'ต้องมีอย่างน้อย 1 คำถาม';
  if (!qs.some((q) => q?.stage === 'pre')) return 'ต้องมีคำถามขั้นลงทะเบียน (pre) อย่างน้อย 1 ข้อ';
  const qids = new Set();
  const oids = new Set();
  for (const q of qs) {
    if (!q || !nonEmpty(q.id) || !nonEmpty(q.code)) return 'คำถามต้องมี id และ code';
    if (qids.has(q.id)) return `id คำถามซ้ำ: ${q.id}`;
    qids.add(q.id);
    if (!nonEmpty(q.th)) return `คำถาม ${q.code} ต้องมีข้อความภาษาไทย`;
    if (!STAGES.includes(q.stage)) return `คำถาม ${q.code}: stage ต้องเป็น pre หรือ deploy`;
    if (!Array.isArray(q.options) || q.options.length === 0) return `คำถาม ${q.code} ต้องมีตัวเลือกอย่างน้อย 1 ตัว`;
    for (const o of q.options) {
      if (!o || !nonEmpty(o.id)) return `คำถาม ${q.code}: ตัวเลือกต้องมี id`;
      if (oids.has(o.id)) return `id ตัวเลือกซ้ำ: ${o.id}`;
      oids.add(o.id);
      if (!nonEmpty(o.th)) return `คำถาม ${q.code}: ตัวเลือกต้องมีข้อความภาษาไทย`;
      if (!Number.isInteger(o.score) || o.score < 0 || o.score > 100) return `คำถาม ${q.code}: คะแนนต้องเป็นจำนวนเต็ม 0–100`;
      if (!FIXES.includes(o.fix)) return `คำถาม ${q.code}: fix ต้องเป็น none / should / must`;
      if (typeof o.blocksPre !== 'boolean' || typeof o.blocksDeploy !== 'boolean') return `คำถาม ${q.code}: ค่าบล็อกต้องเป็น true/false`;
    }
  }
  return null;
}

module.exports = { validateScreeningConfig };
