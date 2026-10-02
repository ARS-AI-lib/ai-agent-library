import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { isMyAgent, normalizeProgress, fmtDate, toJsDate } from '../lib/agentUtils';
import { agentStatus, ST_DEF } from '../lib/status';
import { getType, getTier, TIER_DEF } from '../lib/tier';
import { nextStep } from '../lib/mySubmissions';
import useEscapeKey from '../hooks/useEscapeKey';

// V7 board 11 · My submissions. Read-only: every button opens the normal
// Agent Detail modal, where the real actions (and their permission checks)
// live. Nothing on this page writes.
//
// Sources, all already loaded or already allowed by the rules:
//  - approved (incl. archived) → allAgents, filtered by isMyAgent (creatorEmails)
//  - pending                   → pending, same filter
//  - rejected                  → the same createdBy==uid query PendingApprovalModal uses

const TABS = [
  ['all', 'All'],
  ['needs', 'Needs you'],
  ['review', 'Waiting for review'],
  ['progress', 'In progress'],
  ['ready', 'Ready'],
];

function bucket(a, step) {
  if (step.tone === 'act' || step.tone === 'bad') return 'needs';
  if (a.approvalStatus === 'pending' || step.tone === 'wait') return 'review';
  if (step.tone === 'ok') return 'ready';
  return 'progress';
}

// Status pill: review / not-approved states are not library statuses, so they
// get their own label; everything else uses the shared ST_DEF bucket.
function statusOf(a) {
  if (a.approvalStatus === 'rejected') return { lb: 'Not approved', cls: 'rej' };
  if (a.approvalStatus === 'pending') return { lb: 'Waiting for review', cls: 'wait' };
  const sd = ST_DEF[agentStatus(a)];
  return { lb: sd.lb, sd };
}

function metaOf(a) {
  if (a.approvalStatus === 'rejected') return a.rejectedAt ? `Decided ${fmtDate(a.rejectedAt)}` : 'Not approved';
  if (a.approvalStatus === 'pending') return a.createdAt ? `Submitted ${fmtDate(a.createdAt)}` : 'Submitted';
  const d = toJsDate(a.updatedAt) || toJsDate(a.createdAt);
  if (!d) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 864e5);
  return days <= 0 ? 'Updated today' : `Updated ${days} day${days === 1 ? '' : 's'} ago`;
}

export default function MySubmissionsModal({ user, allAgents = [], pending = [], onOpenAgent, onClose, onNew }) {
  useEscapeKey(onClose);
  const [tab, setTab] = useState('all');
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
      .map((a) => { const step = nextStep(a); return { a, step, b: bucket(a, step) }; })
      .sort((x, y) => rank[x.step.tone] - rank[y.step.tone] || String(x.a.agentName).localeCompare(String(y.a.agentName)));
  }, [allAgents, pending, rejected, user]);

  const count = (k) => (k === 'all' ? items.length : items.filter((i) => i.b === k).length);
  const shown = tab === 'all' ? items : items.filter((i) => i.b === tab);
  const needs = count('needs');

  return (
    <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && onClose()}>
      <div className="mbox wide v7-subs-box">
        <button className="mclose" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="mtitle">My submissions</h2>
        <div className="msub">
          {needs > 0 ? <><strong style={{ color: 'var(--tx)' }}>{needs} {needs === 1 ? 'item needs' : 'items need'} you</strong> · รายการอื่นยังไม่ต้องดำเนินการ</> : 'ไม่มีรายการที่ต้องดำเนินการ'}
        </div>

        <div className="v7-subs-bar">
          <div className="v7-inbox-filter" role="tablist" aria-label="Filter submissions">
            {TABS.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
                {label}<span>{count(k)}</span>
              </button>
            ))}
          </div>
          {onNew && (
            <button type="button" className="btn-new" onClick={onNew}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              New
            </button>
          )}
        </div>

        {shown.length === 0 ? (
          <div className="v7-inbox-empty">{items.length === 0 ? 'ยังไม่มีรายการที่คุณเป็น Creator' : 'ไม่มีรายการในหมวดนี้'}</div>
        ) : (
          <div className="v7-subs-grid">
            {shown.map(({ a, step, b }) => {
              const st = statusOf(a);
              const tier = getTier(a);
              const td = TIER_DEF[tier];
              const urgent = b === 'needs';
              const openable = a.approvalStatus === 'approved' || a.approvalStatus === 'pending';
              const btnLabel = a.approvalStatus === 'rejected' ? null
                : step.tone === 'act' ? step.text
                : step.tone === 'ok' ? 'See reviews'
                : 'View';
              return (
                <article key={a.id} className={`v7-sub-card ${urgent ? 'urgent' : ''}`}>
                  <div className="v7-ac-top">
                    <span className="tier-badge" style={{ color: td.color, background: td.bg }} title={td.label}>{tier} {getType(a) === 'agent' ? 'Agent' : 'Skill'}</span>
                    <span className="v7-ac-scope">{a.owner || '—'}</span>
                    <span
                      className={`status-pill v7-ac-status ${st.cls || ''}`}
                      style={st.sd ? { color: st.sd.color, background: st.sd.bg, borderColor: st.sd.bd } : undefined}
                    >
                      <span className="status-dot" style={st.sd ? { background: st.sd.dot || st.sd.color } : undefined} />
                      {st.lb}
                    </span>
                  </div>
                  <h3>{a.agentName}</h3>
                  <div className={`v7-next-box ${urgent ? 'urgent' : ''}`}>
                    <span>Next step</span>
                    <p>{step.tone === 'act' || step.tone === 'bad' ? `${step.text} — ${step.hint}` : step.hint}</p>
                  </div>
                  <div className="v7-ac-foot">
                    <span>{metaOf(a)}{a.approvalStatus !== 'rejected' && ` · ${normalizeProgress(a.devProgress)}%`}</span>
                    {btnLabel && openable && (
                      <button type="button" className={`v7-sub-btn ${step.tone === 'act' ? 'pri' : ''}`} onClick={() => onOpenAgent?.(a)}>
                        {btnLabel}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
