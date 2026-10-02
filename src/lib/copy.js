// UX copy helpers (V7 copy pass, 2026-10-02).
//
// failMsg('บันทึก', e) →
//   - with a server/browser message: "บันทึกไม่ได้: <message>"
//     (callable errors already explain themselves, e.g. a permission rule)
//   - without one:                   "บันทึกไม่ได้ — ลองอีกครั้ง"
// One place for the pattern so every error says what failed + what to do.
export function failMsg(action, e) {
  const msg = String(e?.message || '').trim();
  // "ปรับเป็น 100% ไม่ได้" reads better with a space after a non-Thai ending.
  const a = /[\u0E00-\u0E7F]$/.test(action) ? action : `${action} `;
  return msg ? `${a}ไม่ได้: ${msg}` : `${a}ไม่ได้ — ลองอีกครั้ง`;
}
