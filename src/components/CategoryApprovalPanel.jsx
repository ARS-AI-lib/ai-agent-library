import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, where, updateDoc, arrayUnion, arrayRemove, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import useEscapeKey from '../hooks/useEscapeKey';
import Dropdown from './Dropdown';
import { AREA_ORDER, categoryAreas } from '../lib/approveAreas';

const AREA_OPTIONS = [['', 'เลือก Approve Area…'], ...AREA_ORDER.map((a) => [a, a])];

// Admin-only approve/reject queue for AI-proposed Category shortcuts
// (2026-08). A proposal is created by analyzeDuplicate (or the backfill
// script) whenever a draft/agent looks new enough that no existing
// /config/schema.category value fits well — see PreRegModal.jsx handleSubmit.
//
// The agent that triggered a proposal already carries its fallback category
// the moment it's submitted (never uncategorized), so Approve/Reject here
// only decide whether a NEW shortcut appears in the sidebar — never whether
// the agent itself is findable.
//
// 2026-08-10: Approve now ALSO requires picking an Approve Area for the new
// category, written to /config/schema.categoryAreaMap. Without this, a brand
// new category has no entry in approveAreas.js's CATEGORY_AREA table (which
// is baked into code, not editable here) — every future agent that gets this
// category would silently fall through the resolver's category layer to the
// role layer or, worse, resolve to nothing. That was exactly the 79-agent bug
// this whole approver-area rework existed to fix, so it must not be possible
// to reopen it one category at a time. Existing pre-2026-08-10 categories are
// unaffected — they're already covered by the code-level CATEGORY_AREA table.
// 2026-10-01: both decisions now also fix the proposing agent itself.
// Approve adds the chosen area to its approveArea (a stored area always wins
// in the resolver, so the category map alone never re-routed it). Reject
// makes the admin confirm a real category instead of leaving the AI's
// fallback guess in place, and adds that category's area(s).
export default function CategoryApprovalPanel({ onClose, user, schema = {} }) {
  const [proposals, setProposals] = useState([]);
  const [areaPick, setAreaPick] = useState({}); // { proposalId: areaName }
  const [catPick, setCatPick] = useState({});   // { proposalId: category used on reject }
  const categoryOptions = (schema.category || []).map((c) => [c, c]);
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
    const area = areaPick[p.id];
    if (!area) { setError(`เลือก Approve Area ให้ "${p.name}" ก่อนอนุมัติ`); return; }
    setBusyId(p.id);
    setError('');
    try {
      // 1. Add the new name to the official, approved list — it can now show
      //    up as a sidebar shortcut for everyone. Same write also seeds its
      //    approver-area mapping (dot-path field so this can't touch any
      //    other key in the doc) — see the file header for why this is
      //    required, not optional, on every new category.
      await updateDoc(doc(db, 'config', 'schema'), {
        category: arrayUnion(p.name),
        [`categoryAreaMap.${p.name}`]: area,
      });
      // 2. Move the agent that triggered this proposal off its fallback
      //    category onto the newly-approved one. Two sequential writes
      //    (remove then add) rather than a transaction — this is a rare,
      //    single-admin action, not a high-concurrency path.
      if (p.agentId) {
        const agentRef = doc(db, 'agents', p.agentId);
        if (p.fallbackCategory) {
          await updateDoc(agentRef, { category: arrayRemove(p.fallbackCategory), updatedAt: serverTimestamp() });
        }
        await updateDoc(agentRef, { category: arrayUnion(p.name), approveArea: arrayUnion(area), updatedAt: serverTimestamp() });
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
    const pick = catPick[p.id] || p.fallbackCategory || '';
    if (!pick) { setError(`Choose a category for "${p.agentName}" before rejecting`); setBusyId(null); return; }
    try {
      // The agent keeps a real category: the admin's pick (default = the AI's
      // fallback guess), plus the area(s) that category routes to.
      if (p.agentId) {
        const agentRef = doc(db, 'agents', p.agentId);
        if (p.fallbackCategory && pick !== p.fallbackCategory) {
          await updateDoc(agentRef, { category: arrayRemove(p.fallbackCategory), updatedAt: serverTimestamp() });
        }
        const areas = categoryAreas(pick, schema.categoryAreaMap);
        await updateDoc(agentRef, {
          category: arrayUnion(pick),
          ...(areas.length ? { approveArea: arrayUnion(...areas) } : {}),
          updatedAt: serverTimestamp(),
        });
      }
      await updateDoc(doc(db, 'categoryProposals', p.id), {
        status: 'rejected', resolvedCategory: pick, decidedBy: user?.uid || '', decidedAt: serverTimestamp(),
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
            <div className="msg success"><span className="dot" style={{ background: 'var(--ok)' }} />ไม่มีหมวดใหม่ค้างอนุมัติ</div>
          )}

          {proposals.map((p) => (
            <div key={p.id} className="catprop-row">
              <div className="catprop-name">{p.name}</div>
              <div className="catprop-meta">
                เสนอจาก <strong>{p.agentName}</strong> · หมวดสำรองตอนนี้: {p.fallbackCategory || '—'}
              </div>
              {p.reason && <div className="catprop-reason">{p.reason}</div>}
              <div style={{ marginTop: 8, maxWidth: 260 }}>
                <Dropdown
                  options={AREA_OPTIONS}
                  value={areaPick[p.id] || ''}
                  onChange={(v) => setAreaPick((prev) => ({ ...prev, [p.id]: v }))}
                  ariaLabel={`Approve Area สำหรับหมวด ${p.name}`}
                />
                {/* D1 (2026-08-10): the requirement used to be visible only via
                    the Approve button's title tooltip — invisible until hover,
                    so a reviewer scanning several proposals had no on-screen
                    cue why a button was greyed out. Always-on instead. */}
                {!areaPick[p.id] && (
                  <div style={{ fontSize: 10.5, color: 'var(--mu)', marginTop: 4 }}>เลือก Approve Area ก่อนอนุมัติ</div>
                )}
              </div>
              <div style={{ marginTop: 8, maxWidth: 260 }}>
                <div style={{ fontSize: 10.5, color: 'var(--mu)', marginBottom: 4 }}>Assign Category (used if rejected)</div>
                <Dropdown
                  options={categoryOptions}
                  value={catPick[p.id] || p.fallbackCategory || ''}
                  onChange={(v) => setCatPick((prev) => ({ ...prev, [p.id]: v }))}
                  ariaLabel={`Category for ${p.agentName} if the proposal is rejected`}
                />
              </div>
              <div className="queue-actions" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn-sm rej"
                  disabled={busyId === p.id}
                  onClick={() => reject(p)}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="btn-sm appr"
                  disabled={busyId === p.id || !areaPick[p.id]}
                  title={!areaPick[p.id] ? 'เลือก Approve Area ก่อน' : undefined}
                  onClick={() => approve(p)}
                >
                  {busyId === p.id ? 'Working…' : 'Approve'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
