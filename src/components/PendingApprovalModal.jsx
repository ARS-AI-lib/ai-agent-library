import { useMemo, useState } from 'react';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { agentApproveAreas, getTier, TIER_DEF } from '../lib/tier';
import { matchingAgentNames } from '../lib/agentUtils';
import AgentDetailModal from './AgentDetailModal';

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
    if (fullAccess) return deployRequests;
    return deployRequests.filter((a) => agentApproveAreas(a).some((area) => mine.has(area)));
  }, [deployRequests, fullAccess, mine]);

  async function handleApproveDeploy(agent) {
    setBusyId(agent.id);
    setError('');
    try {
      await updateDoc(doc(db, 'agents', agent.id), {
        deploymentStatus: 'approved',
        deployDecidedBy: user?.uid || '',
        deployDecidedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      setError(e.message || 'Approve deploy failed');
    } finally {
      setBusyId(null);
    }
  }

  async function handleRejectDeploy(agent) {
    setBusyId(agent.id);
    setError('');
    try {
      await updateDoc(doc(db, 'agents', agent.id), {
        deploymentStatus: 'rejected',
        deployDecidedBy: user?.uid || '',
        deployDecidedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      setError(e.message || 'Reject deploy failed');
    } finally {
      setBusyId(null);
    }
  }

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

  async function handleReject(agent) {
    setBusyId(agent.id);
    setError('');
    try {
      // Soft reject — keep the record for audit trail, hide it from the dashboard.
      await updateDoc(doc(db, 'agents', agent.id), {
        approvalStatus: 'rejected',
        updatedAt: serverTimestamp(),
      });
      await recordOutcome(agent.id, 'rejected', user?.uid);

      // Same cascade principle as approve — a rejected/withdrawn parent
      // shouldn't leave its paired sub-skills orphaned pending forever.
      for (const sib of findCascadeSiblings(agent)) {
        await updateDoc(doc(db, 'agents', sib.id), {
          approvalStatus: 'rejected',
          updatedAt: serverTimestamp(),
        });
        await recordOutcome(sib.id, 'rejected', user?.uid);
      }
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
        <div className="mtitle">Pending Approval</div>

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
                    <>{' · '}ความเสี่ยง: <span style={{ color: RISK_COLOR[risk] || 'var(--mu)', fontWeight: 700 }}>{RISK_LABEL[risk] || risk}</span></>
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
                  <button className="btn btn-danger" disabled={busyId === agent.id} onClick={() => handleReject(agent)}>
                    {canApprove(agent) ? 'Reject' : 'Withdraw'}
                  </button>
                )}
                {canApprove(agent) && (
                  <button className="btn btn-success" disabled={busyId === agent.id} onClick={() => handleApprove(agent)}>
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
                  <div className="dup-name">{agent.agentName}</div>
                  <div className="queue-meta">
                    {' '}โดย {agent.creator || '—'}
                    {' · '}<span style={{ color: 'var(--uc)' }}>{agentApproveAreas(agent).join(', ') || 'ไม่ระบุ area'}</span>
                    {' · '}<span style={{ color: tierDef.color, fontWeight: 700 }}>{tierDef.label}</span>
                    {' · '}Progress: <strong style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{agent.devProgress}%</strong>
                  </div>
                </div>
                <div className="queue-actions">
                  {(fullAccess || (mine.size > 0 && agentApproveAreas(agent).some((area) => mine.has(area)))) && (
                    <>
                      <button className="btn btn-danger" disabled={busyId === agent.id} onClick={() => handleRejectDeploy(agent)}>
                        Reject
                      </button>
                      <button className="btn btn-success" disabled={busyId === agent.id} onClick={() => handleApproveDeploy(agent)}>
                        Approve
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

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
