import { useMemo, useState } from 'react';
import { toJsDate, fmtDate } from '../lib/agentUtils';
import {
  activeAnnouncements, splitLinks, myRequestItems, inboxQueueCount, showToApprove, AUDIENCE_LABEL,
} from '../lib/inbox';
import useEscapeKey from '../hooks/useEscapeKey';
import useMyRejected from '../hooks/useMyRejected';

// Inbox (2026-11-17, spec docs/superpowers/specs/2026-11-17-inbox-announcements-design.md).
// Read-only view of three sources:
//  - Announcements  → `announcements` (already audience-filtered by the query
//                     + rules); expired ones dropped, pinned first.
//  - My requests    → my own items waiting for review / deploy approval, plus
//                     my rejected/withdrawn items from the last 14 days
//                     (myRequestItems). Listed, never counted in the badge.
//  - To approve     → only a count + a button to the existing approval queue.
// Opening an announcement is the only write (read state, via onMarkRead).
//
// canPost / onCompose / onEditAnnouncement are wired by the composer task and
// intentionally unused here.

const DAY = 864e5;

function ago(v, now) {
  const d = toJsDate(v);
  if (!d) return '';
  const days = Math.floor((now - d.getTime()) / DAY);
  if (days <= 0) return 'today';
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function requestTime(agent) {
  if (agent.approvalStatus === 'rejected') return agent.rejectedAt || agent.updatedAt;
  if (agent.approvalStatus === 'pending') return agent.createdAt;
  return agent.deployRequestedAt || agent.updatedAt;
}

// Plain text only: every segment is a React text node; only http(s) segments
// (splitLinks gives them an href) become links. Never dangerouslySetInnerHTML.
function AnnouncementBody({ text }) {
  return (
    <div className="v7-ann-body">
      {splitLinks(text).map((seg, i) => (seg.href
        ? <a key={i} href={seg.href} target="_blank" rel="noopener noreferrer">{seg.text}</a>
        : <span key={i}>{seg.text}</span>))}
    </div>
  );
}

function AnnouncementRow({ a, unread, open, onToggle }) {
  return (
    <div className={`v7-ann-row ${unread ? 'unread' : ''} ${open ? 'open' : ''}`}>
      <button type="button" className="v7-ann-head" aria-expanded={open} onClick={onToggle}>
        <span className="v7-ann-dot" aria-hidden="true" />
        {a.pinned && <span className="v7-ann-pin">Pinned</span>}
        <span className="v7-ann-title">{a.title}</span>
        {unread && <span className="v7-ann-sr">(unread)</span>}
        <span className="v7-ann-meta">
          {a.audience !== 'all' && <span className="v7-ann-aud">{AUDIENCE_LABEL[a.audience] || a.audience}</span>}
          {a.createdByName && <span>{a.createdByName}</span>}
          {a.createdAt && <span>{fmtDate(a.createdAt)}</span>}
        </span>
      </button>
      {open && <AnnouncementBody text={a.body} />}
    </div>
  );
}

function RequestRow({ agent, step, now, onOpenAgent }) {
  const rejected = agent.approvalStatus === 'rejected';
  const pill = (
    <span className={`status-pill ${rejected ? 'rej' : 'wait'}`}>
      <span className="status-dot" />
      {step.text}
    </span>
  );
  const body = (
    <>
      <span className="v7-inbox-req-name">{agent.agentName || '(untitled)'}</span>
      {pill}
      <span className="v7-inbox-req-age">{ago(requestTime(agent), now)}</span>
      {rejected && <span className="v7-inbox-req-hint">{step.hint}</span>}
    </>
  );
  // Rejected docs are outside the library listeners and have no actions left
  // (same as My Submissions): the row shows the reason instead of opening.
  if (rejected) return <div className="v7-inbox-req">{body}</div>;
  return (
    <button type="button" className="v7-inbox-req clickable" onClick={() => onOpenAgent?.(agent)}>
      {body}
    </button>
  );
}

export default function InboxModal({
  user,
  announcements = [],
  readIds,
  onMarkRead,
  onMarkAllRead,
  allAgents = [],
  pending = [],
  deployRequests = [],
  renameReqs = [],
  queueViewerCtx,
  queueCount: queueCountProp,
  onOpenAgent,
  onOpenQueue,
  onClose,
}) {
  useEscapeKey(onClose);
  const [tab, setTab] = useState('all');
  const [openId, setOpenId] = useState(null);
  // Ids opened while this modal is up. `All` lists unread announcements only,
  // so without this an announcement would vanish the moment its click marks
  // it read — before its body could be shown.
  const [openedHere, setOpenedHere] = useState(() => new Set());
  const rejected = useMyRejected(user?.uid);
  const now = Date.now();

  const active = useMemo(() => activeAnnouncements(announcements), [announcements]);
  const isUnread = (a) => !(readIds && readIds.has(a.id));
  const unreadList = active.filter(isUnread);
  const allAnnList = active.filter((a) => isUnread(a) || openedHere.has(a.id));
  const mine = useMemo(
    () => myRequestItems({ pending, allAgents, rejected, user }),
    [pending, allAgents, rejected, user],
  );
  // App passes the same number it shows on the badge, so the two cannot
  // disagree; the local computation is only a fallback.
  const queueCount = typeof queueCountProp === 'number'
    ? queueCountProp
    : inboxQueueCount(pending, deployRequests, renameReqs, allAgents, queueViewerCtx);
  const canApprove = !!queueViewerCtx && showToApprove(queueViewerCtx, queueCount);

  const tabs = [
    ['all', 'All', unreadList.length + mine.length + (canApprove ? queueCount : 0)],
    ['ann', 'Announcements', unreadList.length],
    ['mine', 'My requests', mine.length],
    ...(canApprove ? [['approve', 'To approve', queueCount]] : []),
  ];
  const current = tabs.some(([k]) => k === tab) ? tab : 'all';

  const toggle = (a) => {
    setOpenId((id) => (id === a.id ? null : a.id));
    setOpenedHere((prev) => (prev.has(a.id) ? prev : new Set(prev).add(a.id)));
    if (isUnread(a)) onMarkRead?.(a.id);
  };

  const annList = (list, emptyText) => (list.length === 0
    ? <div className="v7-inbox-empty">{emptyText}</div>
    : (
      <div className="v7-ann-list">
        {list.map((a) => (
          <AnnouncementRow key={a.id} a={a} unread={isUnread(a)} open={openId === a.id} onToggle={() => toggle(a)} />
        ))}
      </div>
    ));

  const mineList = (emptyText) => (mine.length === 0
    ? <div className="v7-inbox-empty">{emptyText}</div>
    : (
      <div className="v7-inbox-reqs">
        {mine.map(({ agent, step }) => (
          <RequestRow key={agent.id} agent={agent} step={step} now={now} onOpenAgent={onOpenAgent} />
        ))}
      </div>
    ));

  const queueLine = (
    <div className="v7-inbox-queue">
      <span>
        {queueCount > 0
          ? <><strong>{queueCount}</strong> {queueCount === 1 ? 'item' : 'items'} waiting for your approval</>
          : 'ไม่มีรายการที่รอการอนุมัติในขณะนี้'}
      </span>
      <button type="button" className="v7-sub-btn pri" onClick={() => onOpenQueue?.()}>Open approval queue</button>
    </div>
  );

  const showMarkAll = (current === 'all' || current === 'ann') && unreadList.length > 0;

  return (
    <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && onClose()}>
      <div className="mbox wide v7-inbox-box">
        <button className="mclose" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="mtitle">Inbox</h2>
        <div className="msub">ประกาศจากทีมดูแลระบบ และสถานะคำขอของคุณที่ยังรอการพิจารณา</div>

        <div className="v7-subs-bar">
          <div className="v7-inbox-filter" role="tablist" aria-label="Filter inbox">
            {tabs.map(([k, label, n]) => (
              <button key={k} role="tab" aria-selected={current === k} className={current === k ? 'active' : ''} onClick={() => setTab(k)}>
                {label}<span>{n}</span>
              </button>
            ))}
          </div>
          {showMarkAll && (
            <button type="button" className="v7-sub-btn v7-inbox-markall" onClick={() => onMarkAllRead?.()}>Mark all read</button>
          )}
        </div>

        {current === 'all' && (
          allAnnList.length === 0 && mine.length === 0 && !canApprove
            ? <div className="v7-inbox-empty">ไม่มีรายการใหม่ — ประกาศที่อ่านแล้วดูได้ในแท็บ Announcements</div>
            : (
              <>
                {allAnnList.length > 0 && annList(allAnnList, '')}
                {mine.length > 0 && (
                  <>
                    <h3 className="v7-inbox-sec">My requests</h3>
                    {mineList('')}
                  </>
                )}
                {canApprove && queueLine}
              </>
            )
        )}
        {current === 'ann' && annList(active, 'ยังไม่มีประกาศสำหรับคุณในขณะนี้')}
        {current === 'mine' && mineList('ไม่มีคำขอของคุณที่รอการพิจารณา — รายการที่ถูกปฏิเสธจะแสดงที่นี่ 14 วัน')}
        {current === 'approve' && queueLine}
      </div>
    </div>
  );
}
