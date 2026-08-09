import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, where, updateDoc, arrayUnion, arrayRemove, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import useEscapeKey from '../hooks/useEscapeKey';

// Admin-only approve/reject queue for AI-proposed Category shortcuts
// (2026-08). A proposal is created by analyzeDuplicate (or the backfill
// script) whenever a draft/agent looks new enough that no existing
// /config/schema.category value fits well — see PreRegModal.jsx handleSubmit.
//
// The agent that triggered a proposal already carries its fallback category
// the moment it's submitted (never uncategorized), so Approve/Reject here
// only decide whether a NEW shortcut appears in the sidebar — never whether
// the agent itself is findable.
export default function CategoryApprovalPanel({ onClose, user }) {
  const [proposals, setProposals] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  useEscapeKey(onClose);

  useEffect(() => {
    const q = query(collection(db, 'categoryProposals'), where('status', '==', 'pending'));
    const unsub = onSnapshot(q, (snap) => {
      setProposals(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);

  async function approve(p) {
    setBusyId(p.id);
    setError('');
    try {
      // 1. Add the new name to the official, approved list — it can now show
      //    up as a sidebar shortcut for everyone.
      await updateDoc(doc(db, 'config', 'schema'), { category: arrayUnion(p.name) });
      // 2. Move the agent that triggered this proposal off its fallback
      //    category onto the newly-approved one. Two sequential writes
      //    (remove then add) rather than a transaction — this is a rare,
      //    single-admin action, not a high-concurrency path.
      if (p.agentId) {
        const agentRef = doc(db, 'agents', p.agentId);
        if (p.fallbackCategory) {
          await updateDoc(agentRef, { category: arrayRemove(p.fallbackCategory), updatedAt: serverTimestamp() });
        }
        await updateDoc(agentRef, { category: arrayUnion(p.name), updatedAt: serverTimestamp() });
      }
      await updateDoc(doc(db, 'categoryProposals', p.id), {
        status: 'approved', decidedBy: user?.uid || '', decidedAt: serverTimestamp(),
      });
    } catch (e) {
      setError(e.message || 'อนุมัติไม่สำเร็จ');
    } finally {
      setBusyId(null);
    }
  }

  async function reject(p) {
    setBusyId(p.id);
    setError('');
    try {
      // Agent stays on its fallback category — nothing to undo there.
      await updateDoc(doc(db, 'categoryProposals', p.id), {
        status: 'rejected', decidedBy: user?.uid || '', decidedAt: serverTimestamp(),
      });
    } catch (e) {
      setError(e.message || 'ปฏิเสธไม่สำเร็จ');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && onClose()}>
      <div className="mbox" style={{ padding: 0, maxWidth: 620 }}>
        <button className="mclose" onClick={onClose} style={{ zIndex: 1 }}>✕</button>
        <div className="tab-panel">
          <div className="m-head">
            <div className="m-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
            </div>
            <div>
              <h2 className="mtitle">Category Proposals</h2>
              <p>หมวดใหม่รออนุมัติ</p>
            </div>
          </div>

          {error && <div className="msg error"><span className="dot" style={{ background: '#ea4335' }} />{error}</div>}

          {proposals.length === 0 && (
            <div className="msg success"><span className="dot" style={{ background: '#34a853' }} />ไม่มีหมวดใหม่ค้างอนุมัติ</div>
          )}

          {proposals.map((p) => (
            <div key={p.id} className="catprop-row">
              <div className="catprop-name">{p.name}</div>
              <div className="catprop-meta">
                เสนอจาก <strong>{p.agentName}</strong> · หมวดสำรองตอนนี้: {p.fallbackCategory || '—'}
              </div>
              {p.reason && <div className="catprop-reason">{p.reason}</div>}
              <div className="btn-group" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn-sm appr"
                  disabled={busyId === p.id}
                  onClick={() => approve(p)}
                >
                  {busyId === p.id ? 'กำลังทำงาน…' : 'อนุมัติ'}
                </button>
                <button
                  type="button"
                  className="btn-sm rej"
                  disabled={busyId === p.id}
                  onClick={() => reject(p)}
                >
                  ปฏิเสธ
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
