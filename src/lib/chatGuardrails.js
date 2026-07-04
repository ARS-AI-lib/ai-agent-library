// Client-side pre-filter for the Chat Assistant (2026-07-02) — catches the
// most obvious out-of-scope/abusive/jailbreak inputs BEFORE spending a Vertex
// call. Deliberately a short, representative list, not an exhaustive
// profanity dictionary — subtler cases (indirect political/religious framing,
// borderline requests) are left to the LLM's own guardrail instructions in
// the Cloud Function system prompt, per the design decision to split
// "obvious → free" from "subtle → LLM judges".

const BLOCKED_PATTERNS = [
  // Jailbreak / prompt injection attempts.
  /ลืม\s*(คำสั่ง|prompt|instructions?)/i,
  /system\s*prompt/i,
  /ignore\s+(previous|all)\s+instructions?/i,
  /(สมมติ|pretend|act)\s*(ว่า)?\s*(คุณ|นาย|คุณเป็น|you\s+are)/i,
  /jailbreak/i,
  /developer\s*mode/i,

  // Fake authority claims.
  /ฉัน(คือ|เป็น)\s*(แอดมิน|admin|ผู้ดูแลระบบ)/i,
  /i\s*am\s*(the\s*)?admin/i,

  // Write-action requests the assistant has no authority to perform.
  /(approve|reject|อนุมัติ|ปฏิเสธ)\s*(ให้|เลย|หน่อย)/i,
  /(ลบ|delete)\s*(agent|skill|ตัวนี้)/i,
  /(เปลี่ยน|set)\s*progress\s*(เป็น|to)?\s*100/i,

  // A short representative set of explicit/profane markers — not
  // exhaustive; the LLM's own guardrail instructions cover indirect cases.
  /\b(fuck|shit|bitch|asshole)\b/i,
  /เหี้ย|สัส|ควย|เย็ด/,
];

export function isBlockedInput(text) {
  if (!text || !text.trim()) return false;
  return BLOCKED_PATTERNS.some((re) => re.test(text));
}

export const BLOCKED_REPLY = 'ขอโทษนะครับ ผมตอบได้เฉพาะเรื่องที่เกี่ยวกับ AI Agent Library เท่านั้น ลองถามใหม่ในหัวข้อนี้ได้เลยครับ';
