import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, query, updateDoc, where, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { agentApproveAreas, getTier, TIER_DEF } from '../lib/tier';
import { matchingAgentNames, pairedSubSkills, isPairedSubSkill, fmtDate } from '../lib/agentUtils';
import AgentDetailModal from './AgentDetailModal';
import useEscapeKey from '../hooks/useEscapeKey';

const VERDICT_LABEL = {
  clear_duplicate: 'Clear Duplicate',
  likely_overlap: 'Likely Overlap',
  distinct_but_related: 'Related, Not Duplicate',
  unrelated: 'Unrelated',
};
const VERDICT_COLOR = {
  clear_duplicate: '#c5221f',
  likely_overlap: '#c96a00',
  distinct_but_related: '#2f6bff',
  unrelated: '#137333',
};

// Attach the reviewer's decision to the stored analysis (knowledge base) so a
// future learning pass can weight the AI's past calls by real human outcomes.
// updateDoc (not setDoc-merge) on purpose: it no-ops when there's no
// analysisRuns doc — many agents legitimately have none (dedup-skipped,
// Agent+Skill sub-skills, or pre-KB submissions) and we must NOT create a stub
// for them. A KB write must never break the approve/reject action itself.
async function recordOutcome(agentId, outcome, uid) {
  try {
    await updateDoc(doc(db, 'analysisRuns', agentId), {
      outcome, outcomeBy: uid || '', outcomeAt: serverTimestamp(),
    });
  } catch { /* no KB doc for this agent, or transient — non-fatal */ }
}

const RISK_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
const RISK_COLOR = { high: '#c5221f', medium: '#c96a00', low: '#137333' };

// Visibility + action rights per tier:
//   admin/committee — see & approve/reject every pending item, any area.
//   approver        — see & approve/reject only items whose computed area
//                     overlaps their own approveAreas.
//   user (base)     — see only their own submissions, and may only reject
//                     (withdraw) them — never approve their own idea.
export default function PendingApprovalModal({ pending, deployRequests = [], onClose, user, isAdmin, isCommittee, approveAreas = [], agents = [] }) {
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [rejectModal, setRejectModal] = useState(null); // { agent, reason } | null — approver reject-with-reason
  const [myRejected, setMyRejected] = useState([]);      // creator's own items rejected WITH a reason (feature B)
  useEscapeKey(onClose);

  // Feature B (2026-07-xx): let a creator see their OWN submissions that were
  // rejected by a reviewer, together with the reason — rejected docs are hidden
  // from both the dashboard and the pending queue, so without this the reason
  // has nowhere to surface. Single-field equality query (no composite index);
  // filter to reason-bearing rejects client-side, which also excludes the
  // creator's own self-withdrawals (those carry no rejectionReason).
  useEffect(() => {
    if (!user?.uid) return;
    const q = query(collection(db, 'agents'), where('createdBy', '==', user.uid));
    const unsub = onSnapshot(
      q,
      (snap) => setMyRejected(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((a) => a.approvalStatus === 'rejected' && a.rejectionReason)
      ),
      () => setMyRejected([]),
    );
    return unsub;
  }, [user?.uid]);
  const fullAccess = isAdmin || isCommittee;
  const mine = useMemo(() => new Set(approveAreas), [approveAreas]);

  // Overlap-list popup (7th grill-me follow-up): shows which existing agents a
  // pending draft was flagged against. Sourced from the analysisRuns knowledge
  // base (doc id === agentId, 1:1) rather than duplicating candidates onto the
  // agent doc — that KB entry already exists from submit time.
  const [overlapFor, setOverlapFor] = useState(null);   // the pending agent whose popup is open
  const [overlapCandidates, setOverlapCandidates] = useState(null); // null=loading, []=none/not-found
  const [detailAgent, setDetailAgent] = useState(null); // nested click-through (own AgentDetailModal — see z-index note below)
  const agentByName = (name) => agents.find((a) => a.agentName === name) || null;

  async function openOverlapPopup(agent) {
    setOverlapFor(agent);
    setOverlapCandidates(null);
    try {
      const snap = await getDoc(doc(db, 'analysisRuns', agent.id));
      const candidates = snap.exists() ? (snap.data()?.result?.candidates || []) : [];
      setOverlapCandidates(
        candidates
          .filter((c) => c.verdict === 'clear_duplicate' || c.verdict === 'likely_overlap')
          .sort((a, b) => b.confidence - a.confidence)
      );
    } catch {
      setOverlapCandidates([]); // best-effort — a fetch failure just shows "no data" rather than breaking the queue
    }
  }

  const visible = useMemo(() => {
    if (fullAccess) return pending;
    const areaMatches = pending.filter((a) => agentApproveAreas(a).some((area) => mine.has(area)));
    if (areaMatches.length > 0) {
      // Has approveAreas assigned → acting as an approver: area-scoped view.
      return areaMatches;
    }
    // Base "user" tier (or an approver with no matching area right now):
    // only their own submissions, so they can at least track/withdraw them.
    return pending.filter((a) => a.createdBy === user?.uid);
  }, [pending, fullAccess, mine, user]);

  function canApprove(agent) {
    if (fullAccess) return true;
    return mine.size > 0 && agentApproveAreas(agent).some((area) => mine.has(area));
  }
  function canReject(agent) {
    if (fullAccess) return true;
    if (canApprove(agent)) return true;
    return agent.createdBy === user?.uid;   // self-withdraw own pending idea
  }

  // Deployment requests use the same visibility/rights policy as new-entry
  // approval (user's explicit choice, 7th grill-me follow-up) — reuse
  // agentApproveAreas/canApprove as-is, just against a different query.
  const visibleDeploy = useMemo(() => {
    // Paired sub-skills ride along with their parent Agent's deploy request —
    // they're cascaded to 'requested' but must NOT appear as separate line
    // items in the approver's queue (the parent represents them). Filter them
    // out here (2026-07-06); handleApproveDeploy/RejectDeploy cascade the
    // decision back onto them.
    const parentsOnly = deployRequests.filter((a) => !isPairedSubSkill(a, agents));
    if (fullAccess) return parentsOnly;
    return parentsOnly.filter((a) => agentApproveAreas(a).some((area) => mine.has(area)));
  }, [deployRequests, fullAccess, mine, agents]);

  // Deploy decision cascades onto the paired sub-skills too (2026-07-06) — the
  // approver acts once on the parent Agent and the whole package flips. The
  // sub-skills are already in 'requested' state (cascaded at request time), so
  // the deploy-decision firestore rule permits this write.
  async function decideDeploy(agent, verdict, failMsg) {
    setBusyId(agent.id);
    setError('');
    try {
      const patch = {
        deploymentStatus: verdict,
        deployDecidedBy: user?.uid || '',
        deployDecidedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await updateDoc(doc(db, 'agents', agent.id), patch);
      for (const sk of pairedSubSkills(agent, agents)) {
        if ((sk.deploymentStatus || 'none') === 'requested') {
          await updateDoc(doc(db, 'agents', sk.id), patch);
        }
      }
    } catch (e) {
      setError(e.message || failMsg);
    } finally {
      setBusyId(null);
    }
  }

  function handleApproveDeploy(agent) { return decideDeploy(agent, 'approved', 'Approve deploy failed'); }
  function handleRejectDeploy(agent) { return decideDeploy(agent, 'rejected', 'Reject deploy failed'); }

  // Cascade auto-approve (2026-07-03): a paired sub-skill (Agent+Skill flow,
  // at registration or later via "+ เพิ่ม Skill" in the edit form) was
  // reviewed as a package with its parent Agent at submit time — a separate
  // approve click on it would just rubber-stamp the same decision twice. We
  // scope the match to matchingAgent === this agent's name AND same
  // createdBy — matchingAgent alone isn't a reliable "same submission batch"
  // signal, since a plain standalone submission can also carry an
  // AI-suggested matchingAgent pointing at an unrelated approved agent by
  // name; requiring the same submitter rules that false-positive out.
  function findCascadeSiblings(agent) {
    return pending.filter((p) =>
      p.id !== agent.id
      && p.createdBy === agent.createdBy
      && matchingAgentNames(p).includes(agent.agentName)
    );
  }

  async function handleApprove(agent) {
    setBusyId(agent.id);
    setError('');
    try {
      await updateDoc(doc(db, 'agents', agent.id), {
        approvalStatus: 'approved',
        approvedBy: user?.uid || '',
        updatedAt: serverTimestamp(),
      });
      await recordOutcome(agent.id, 'approved', user?.uid);

      for (const sib of findCascadeSiblings(agent)) {
        await updateDoc(doc(db, 'agents', sib.id), {
          approvalStatus: 'approved',
          approvedBy: user?.uid || '',
          updatedAt: serverTimestamp(),
        });
        await recordOutcome(sib.id, 'approved', user?.uid);
      }
    } catch (e) {
      setError(e.message || 'Approve failed');
    } finally {
      setBusyId(null);
    }
  }

  // reason: required when an approver/admin rejects someone else's idea (so the
  // creator knows why); empty for a base user's self-withdraw of their OWN
  // idea (no explanation owed, and the self-withdraw firestore rule only allows
  // approvalStatus+updatedAt — so we deliberately DON'T write reason fields
  // there).
  async function handleReject(agent, reason = '') {
    setBusyId(agent.id);
    setError('');
    try {
      const rejectFields = reason.trim()
        ? { rejectionReason: reason.trim(), rejectedBy: user?.uid || '', rejectedAt: serverTimestamp() }
        : {};
      // Soft reject — keep the record for audit trail, hide it from the dashboard.
      await updateDoc(doc(db, 'agents', agent.id), {
        approvalStatus: 'rejected',
        updatedAt: serverTimestamp(),
        ...rejectFields,
      });
      await recordOutcome(agent.id, 'rejected', user?.uid);

      // Same cascade principle as approve — a rejected/withdrawn parent
      // shouldn't leave its paired sub-skills orphaned pending forever.
      for (const sib of findCascadeSiblings(agent)) {
        await updateDoc(doc(db, 'agents', sib.id), {
          approvalStatus: 'rejected',
          updatedAt: serverTimestamp(),
          ...rejectFields,
        });
        await recordOutcome(sib.id, 'rejected', user?.uid);
      }
      setRejectModal(null);
    } catch (e) {
      setError(e.message || 'Reject failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && onClose()}>
      <div className="mbox wide">
        <button className="mclose" onClick={onClose}>✕</button>
        <div className="m-head">
          <div className="m-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          </div>
          <div>
            <h2 className="mtitle">Pending Approval</h2>
          </div>
        </div>

        {error && <div className="msg error"><span className="dot" style={{ background: '#ea4335' }} />{error}</div>}

        <div className="sec-title" style={{ marginTop: 4 }}>New Entry</div>
        <div className="msub">
          {visible.length} รายการ
          {!fullAccess && pending.length > visible.length && ` (อีก ${pending.length - visible.length} รายการอยู่นอกสิทธิ์ของคุณ)`}
        </div>

        {visible.length === 0 ? (
          <div className="empty-state">ไม่มีรายการรออนุมัติ</div>
        ) : (
          visible.map((agent) => {
            const tier = getTier(agent);
            const tierDef = TIER_DEF[tier];
            const risk = agent.analysisResult?.overallRisk;
            const breadthFlag = agent.analysisResult?.breadthFlag;
            const overlapAgents = agent.analysisResult?.overlapAgents;
            return (
            <div className="queue-row" key={agent.id}>
              <div>
                <div className="dup-name">{agent.agentName}</div>
                <div className="queue-meta">
                  {agent.aiAgent ? 'Agent' : ''}{agent.aiAgent && agent.skillMd ? ' + ' : ''}{agent.skillMd ? 'Skill' : ''}
                  {' · '}โดย {agent.creator || '—'}
                  {' · '}<span style={{ color: 'var(--uc)' }}>{agentApproveAreas(agent).join(', ') || 'ไม่ระบุ area'}</span>
                  {' · '}<span style={{ color: tierDef.color, fontWeight: 700 }}>{tierDef.label}</span>
                  {risk && (
                    <>{' · '}เสี่ยงทับซ้อน/คล้าย: <span style={{ color: RISK_COLOR[risk] || 'var(--mu)', fontWeight: 700 }}>{RISK_LABEL[risk] || risk}</span></>
                  )}
                  {breadthFlag && (
                    <>{' · '}
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={() => openOverlapPopup(agent)}
                        style={{ color: '#c96a00', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                        title="กดเพื่อดูรายชื่อ Agent ที่ทับซ้อน"
                      >
                        ทับซ้อนหลายตัว{overlapAgents ? ` (${overlapAgents})` : ''}
                      </span>
                    </>
                  )}
                </div>
                {agent.description && (
                  <div style={{ fontSize: 11.5, color: 'var(--tx2)', marginTop: 4, maxWidth: 480 }}>{agent.description}</div>
                )}
                {agent.output && (
                  <div style={{ fontSize: 11, color: 'var(--mu)', marginTop: 3, maxWidth: 480 }}>
                    <strong>Output:</strong> {agent.output}
                  </div>
                )}
                {agent.analysisResult?.summary && (
                  <div style={{ fontSize: 11, color: 'var(--tx2)', marginTop: 3, maxWidth: 480, fontStyle: 'italic' }}>
                    "{agent.analysisResult.summary}"
                  </div>
                )}
              </div>
              <div className="queue-actions">
                {canReject(agent) && (
                  <button
                    className="btn-sm rej"
                    disabled={busyId === agent.id}
                    onClick={() => (canApprove(agent) ? setRejectModal({ agent, reason: '' }) : handleReject(agent))}
                  >
                    {canApprove(agent) ? 'Reject' : 'Withdraw'}
                  </button>
                )}
                {canApprove(agent) && (
                  <button className="btn-sm appr" disabled={busyId === agent.id} onClick={() => handleApprove(agent)}>
                    Approve
                  </button>
                )}
              </div>
            </div>
            );
          })
        )}

        <div className="sec-title" style={{ marginTop: 16 }}>Deployment Request</div>
        <div className="msub">
          {visibleDeploy.length} รายการ
          {!fullAccess && deployRequests.length > visibleDeploy.length && ` (อีก ${deployRequests.length - visibleDeploy.length} รายการอยู่นอกสิทธิ์ของคุณ)`}
        </div>

        {visibleDeploy.length === 0 ? (
          <div className="empty-state">ไม่มีคำขอ Deploy รออนุมัติ</div>
        ) : (
          visibleDeploy.map((agent) => {
            const tier = getTier(agent);
            const tierDef = TIER_DEF[tier];
            return (
              <div className="queue-row" key={agent.id}>
                <div>
                  <div
                    className="dup-name"
                    style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                    onClick={() => setDetailAgent(agent)}
                    title="คลิกเพื่อดูรายละเอียด"
                  >
                    {agent.agentName}
                  </div>
                  <div className="queue-meta">
                    {' '}โดย {agent.creator || '—'}
                    {' · '}<span style={{ color: 'var(--uc)' }}>{agentApproveAreas(agent).join(', ') || 'ไม่ระบุ area'}</span>
                    {' · '}<span style={{ color: tierDef.color, fontWeight: 700 }}>{tierDef.label}</span>
                    {' · '}Progress: <strong style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{agent.devProgress}%</strong>
                    {agent.launchDate && (
                      <>{' · '}Launch: <strong>{fmtDate(agent.launchDate)}</strong></>
                    )}
                  </div>
                </div>
                <div className="queue-actions">
                  {(fullAccess || (mine.size > 0 && agentApproveAreas(agent).some((area) => mine.has(area)))) && (
                    <>
                      <button className="btn-sm rej" disabled={busyId === agent.id} onClick={() => handleRejectDeploy(agent)}>
                        Reject
                      </button>
                      <button className="btn-sm appr" disabled={busyId === agent.id} onClick={() => handleApproveDeploy(agent)}>
                        Approve
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}

        {myRejected.length > 0 && (
          <>
            <div className="sec-title" style={{ marginTop: 16 }}>ถูก Reject (ของฉัน)</div>
            <div className="msub">{myRejected.length} รายการ · เหตุผลจากผู้ตรวจ</div>
            {myRejected.map((agent) => (
              <div className="queue-row" key={agent.id}>
                <div>
                  <div className="dup-name">{agent.agentName}</div>
                  <div className="queue-meta">
                    {agent.aiAgent ? 'Agent' : ''}{agent.aiAgent && agent.skillMd ? ' + ' : ''}{agent.skillMd ? 'Skill' : ''}
                    {agent.rejectedAt && <>{' · '}{fmtDate(agent.rejectedAt)}</>}
                  </div>
                  <div
                    style={{ fontSize: 11.5, color: 'var(--gap-fg)', marginTop: 5, maxWidth: 520, background: 'var(--gap-bg)', border: '1px solid var(--gap-bd)', borderRadius: 6, padding: '6px 10px' }}
                  >
                    <strong>เหตุผล:</strong> {agent.rejectionReason}
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {rejectModal && (
        <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && setRejectModal(null)}>
          <div className="mbox" style={{ padding: 18, maxWidth: 440 }}>
            <button className="mclose" onClick={() => setRejectModal(null)}>✕</button>
            <h3 style={{ fontSize: 15, marginBottom: 4 }}>เหตุผลในการ Reject</h3>
            <div style={{ fontSize: 12, color: 'var(--mu)', marginBottom: 10 }}>{rejectModal.agent.agentName}</div>
            <textarea
              rows={4}
              autoFocus
              value={rejectModal.reason}
              onChange={(e) => setRejectModal((m) => ({ ...m, reason: e.target.value }))}
              placeholder="ระบุเหตุผลให้ creator ทราบ เช่น ทับซ้อนกับ Agent เดิม / ขอบเขตยังไม่ชัด…"
              style={{ width: '100%', resize: 'vertical' }}
            />
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button className="btn-sm rej" disabled={busyId === rejectModal.agent.id} onClick={() => setRejectModal(null)}>Cancel</button>
              <button
                className="btn-sm appr"
                style={{ background: 'var(--clr-fg)', borderColor: 'var(--clr-fg)' }}
                disabled={busyId === rejectModal.agent.id || !rejectModal.reason.trim()}
                onClick={() => handleReject(rejectModal.agent, rejectModal.reason)}
              >
                {busyId === rejectModal.agent.id ? 'กำลังบันทึก…' : 'Confirm Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      {overlapFor && (
        <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && setOverlapFor(null)}>
          <div className="mbox" style={{ padding: 18, maxWidth: 480 }}>
            <button className="mclose" onClick={() => setOverlapFor(null)}>✕</button>
            <h3 style={{ fontSize: 15, marginBottom: 4 }}>ทับซ้อนกับ Agent เดิม</h3>
            <div style={{ fontSize: 12, color: 'var(--mu)', marginBottom: 12 }}>{overlapFor.agentName}</div>

            {overlapCandidates === null && (
              <div className="msg info"><span className="spin" style={{ width: 14, height: 14, borderWidth: 2 }} />กำลังโหลด…</div>
            )}
            {overlapCandidates?.length === 0 && (
              <div className="msg warn"><span className="dot" style={{ background: '#fbbc04' }} />ไม่พบข้อมูลรายละเอียด (อาจถูกข้ามตอนบันทึกเนื่องจากซ้ำกับ analysis อื่นที่มีอยู่แล้ว)</div>
            )}
            {overlapCandidates?.map((c, i) => {
              const vColor = VERDICT_COLOR[c.verdict] || 'var(--mu)';
              const target = agentByName(c.agentName);
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '8px 0', borderBottom: i < overlapCandidates.length - 1 ? '1px solid var(--bd)' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 700, color: vColor, fontFamily: "'IBM Plex Mono',monospace", minWidth: 36 }}>{c.confidence}%</span>
                    <span
                      role="button"
                      tabIndex={0}
                      style={{ fontWeight: 600, fontSize: 13, cursor: target ? 'pointer' : 'default', textDecoration: target ? 'underline' : 'none', textDecorationStyle: 'dotted' }}
                      onClick={() => target && setDetailAgent(target)}
                    >
                      {c.agentName}
                    </span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: vColor, background: `${vColor}15`, border: 'none', padding: '2px 8px', borderRadius: 6 }}>
                      {VERDICT_LABEL[c.verdict] || c.verdict}
                    </span>
                  </div>
                  {c.reason && <div style={{ fontSize: 11, color: 'var(--tx2)' }}>{c.reason}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {detailAgent && (
        <AgentDetailModal
          agent={detailAgent}
          allAgents={agents}
          onClose={() => setDetailAgent(null)}
          user={user}
          isAdmin={fullAccess}
        />
      )}
    </div>
  );
}
