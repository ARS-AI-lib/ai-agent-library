import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { isMyAgent, normalizeProgress, toJsDate, fmtDate, agentTypeLabel } from '../lib/agentUtils';
import { agentStatus, ST_DEF } from '../lib/status';
import useEscapeKey from '../hooks/useEscapeKey';

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
  if (a.approvalStatus === 'pending') return { tone: 'wait', text: 'Waiting for review', hint: 'รอ Approver ประจำ Area ตรวจ' };
  if (a.archived === true) return { tone: 'mute', text: 'Archived', hint: 'ไม่แสดงในไลบรารี' };
  const p = normalizeProgress(a.devProgress);
  if (p >= 100) return { tone: 'ok', text: 'Live', hint: 'ไม่มีอะไรต้องทำ' };
  if ((a.deploymentStatus || 'none') === 'requested') return { tone: 'wait', text: 'Waiting for deploy approval', hint: 'ส่งคำขอ Deploy แล้ว' };
  if (a.deploymentStatus === 'approved') return { tone: 'act', text: 'Mark Ready to Use', hint: 'เพิ่ม Endpoint หรือไฟล์ แล้วปรับเป็น 100%' };
  const launch = toJsDate(a.launchDate);
  if (launch && launch.getTime() < now) return { tone: 'act', text: 'Update progress', hint: `เลยวัน Launch แล้ว (${fmtDate(a.launchDate)})` };
  const updated = toJsDate(a.updatedAt) || toJsDate(a.createdAt);
  if (updated && now - updated.getTime() > STALE_DAYS * DAY) return { tone: 'act', text: 'Update progress', hint: `ไม่ได้อัปเดตเกิน ${STALE_DAYS} วัน` };
  if (p >= 95) return { tone: 'act', text: 'Request deploy', hint: 'Progress ถึง 95% แล้ว' };
  return { tone: 'mute', text: 'On track', hint: 'อัปเดต progress เมื่อมีความคืบหน้า' };
}

export default function MySubmissionsModal({ user, allAgents = [], pending = [], onOpenAgent, onClose }) {
  useEscapeKey(onClose);
  const [rejected, setRejected] = useState([]);
  useEffect(() => {
    if (!user?.uid) return undefined;
    const q = query(collection(db, 'agents'), where('createdBy', '==', user.uid));
    return onSnapshot(
      q,
      (snap) => setRejected(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((a) => a.approvalStatus === 'rejected')),
      () => setRejected([]),
    );
  }, [user?.uid]);

  const items = useMemo(() => {
    const byId = new Map();
    // Order matters: later sets win. The pending listener can briefly still
    // hold an item that was just approved, so the approved copy goes last.
    [...pending, ...allAgents].filter((a) => isMyAgent(a, user)).forEach((a) => byId.set(a.id, a));
    rejected.forEach((a) => byId.set(a.id, a));
    const rank = { act: 0, bad: 1, wait: 2, mute: 3, ok: 4 };
    return [...byId.values()]
      .map((a) => ({ a, step: nextStep(a) }))
      .sort((x, y) => rank[x.step.tone] - rank[y.step.tone] || String(x.a.agentName).localeCompare(String(y.a.agentName)));
  }, [allAgents, pending, rejected, user]);

  const needAction = items.filter((i) => i.step.tone === 'act').length;

  return (
    <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && onClose()}>
      <div className="mbox wide">
        <button className="mclose" onClick={onClose}>✕</button>
        <h2 className="mtitle">My Submissions</h2>
        <div className="msub">{items.length} items · {needAction} need your action · กดรายการเพื่อเปิดรายละเอียด</div>
        {items.length === 0 ? (
          <div className="empty-state">ยังไม่มีรายการที่คุณเป็น Creator</div>
        ) : (
          <div className="v7-subs">
            {items.map(({ a, step }) => {
              const sd = ST_DEF[agentStatus(a)];
              const openable = a.approvalStatus === 'approved' || a.approvalStatus === 'pending';
              return (
                <div
                  key={a.id}
                  className={`v7-sub-row ${openable ? '' : 'static'}`}
                  role={openable ? 'button' : undefined}
                  tabIndex={openable ? 0 : undefined}
                  onClick={() => openable && onOpenAgent?.(a)}
                  onKeyDown={(e) => { if (openable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpenAgent?.(a); } }}
                >
                  <div className="v7-sub-main">
                    <strong>{a.agentName}</strong>
                    <span>{agentTypeLabel(a, allAgents)} · {a.owner || '—'}</span>
                  </div>
                  <span className="status-pill" style={{ color: sd.color, background: sd.bg }}>
                    <span className="status-dot" style={{ background: sd.dot || sd.color }} />{normalizeProgress(a.devProgress)}%
                  </span>
                  <div className={`v7-next ${step.tone}`}>
                    <strong>{step.text}</strong>
                    <span>{step.hint}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
