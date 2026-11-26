// Archive guards for /assessments (2026-11-26). Pure, CommonJS — shared by the archive callables
// and verify-assessment-archive.cjs.
const MIN_YEAR = 2020;
const bangkokYearNow = () => new Date(Date.now() + 7 * 3600 * 1000).getUTCFullYear();

// null when `year` may be archived: an integer strictly before the current Asia/Bangkok year.
function checkArchiveYear(year, nowYear = bangkokYearNow()) {
  if (!Number.isInteger(year)) return 'ปีต้องเป็นจำนวนเต็ม';
  if (year < MIN_YEAR) return 'ปีไม่ถูกต้อง';
  if (year >= nowYear) return 'archive ได้เฉพาะปีที่ผ่านมาแล้ว (ปีปัจจุบัน archive ไม่ได้)';
  return null;
}
const archiveDocId = (year) => String(year);

module.exports = { checkArchiveYear, archiveDocId, bangkokYearNow };
