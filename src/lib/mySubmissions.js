import { normalizeProgress, toJsDate, fmtDate } from './agentUtils';

// V7 My Submissions — the ONE rule for "what should the creator do next".
// Used by the My Submissions page and by the avatar dot in the header.
const DAY = 24 * 60 * 60 * 1000;
const STALE_DAYS = 30;

// V7 "My Submissions" (2026-10-01). Read-only: lists what I created and
// computes ONE next step per item from data that already exists. Clicking a
// row opens the normal Agent Detail modal, where the real actions live (with
// their real permission checks) — nothing here writes.
//
// Sources, all already loaded or already allowed by the rules:
//  - approved (incl. archived) → allAgents, filtered by isMyAgent (creatorEmails)
//  - pending                   → pending, same filter
//  - rejected                  → the same createdBy==uid query PendingApprovalModal uses
export function nextStep(a, now = Date.now()) {
  if (a.approvalStatus === 'rejected') return { tone: 'bad', text: 'Rejected', hint: a.rejectionReason ? `เหตุผล: ${a.rejectionReason}` : 'ถอนคำขอแล้ว' };
  if (a.approvalStatus === 'pending') return { tone: 'wait', text: 'Waiting for review', hint: 'รอ Approver ของ area นี้ตรวจ' };
  if (a.archived === true) return { tone: 'mute', text: 'Archived', hint: 'ไม่แสดงในไลบรารี' };
  const p = normalizeProgress(a.devProgress);
  if (p >= 100) return { tone: 'ok', text: 'Ready to use', hint: 'ใช้งานได้แล้ว ไม่มีอะไรต้องทำ' };
  if ((a.deploymentStatus || 'none') === 'requested') return { tone: 'wait', text: 'Deploy requested', hint: 'รอ Approver อนุมัติการเปิดใช้' };
  if (a.deploymentStatus === 'approved') return { tone: 'act', text: 'Mark ready to use', hint: 'เพิ่ม Endpoint หรือไฟล์ แล้วปรับเป็น 100%' };
  const launch = toJsDate(a.launchDate);
  if (launch && launch.getTime() < now) return { tone: 'act', text: 'Update progress', hint: `เลยวัน Launch แล้ว (${fmtDate(a.launchDate)})` };
  const updated = toJsDate(a.updatedAt) || toJsDate(a.createdAt);
  if (updated && now - updated.getTime() > STALE_DAYS * DAY) return { tone: 'act', text: 'Update progress', hint: `ไม่ได้อัปเดตเกิน ${STALE_DAYS} วัน` };
  if (p >= 95) return { tone: 'act', text: 'Request deploy', hint: 'Progress ถึง 95% แล้ว' };
  return { tone: 'mute', text: 'On track', hint: 'อัปเดต progress เมื่อมีความคืบหน้า' };
}

