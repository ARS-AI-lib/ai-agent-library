import { useEffect, useMemo, useState } from 'react';
import { toast } from '../lib/toast';
import { collection, doc, getDoc, onSnapshot, query, updateDoc, where, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { getTier, TIER_DEF } from '../lib/tier';
import { agentApproveAreas } from '../lib/approveAreas';
import { matchingAgentNames, pairedSubSkills, agentTypeLabel, fmtDate, categoryColor } from '../lib/agentUtils';
import { queueViewer, visiblePending, visibleDeployRequests, visibleRenameRequests, visibleLinkRequests, queueAreaEmptyForApprover } from '../lib/pendingQueue';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { decideRenameRequest } from '../lib/endpointFiles';
import { notifyEvent } from '../lib/notify';
import { classifyRoleGroups } from '../lib/roleGroupClassify';
import AgentDetailModal from './AgentDetailModal';
import useEscapeKey from '../hooks/useEscapeKey';
import { failMsg } from '../lib/copy';
import Hint from './Hint';

// One .tier-badge-styled chip per area (2026-08-10) — replaces a single
// comma-joined text span. Area is the field a reviewer actually decides
// visibility/action from, so it gets the same chip treatment Tier already
// has rather than being the plainest thing on the line. Colour comes from
// categoryColor() (agentUtils.js) — the same deterministic --c1..--c6 hash
// already used for sidebar category dots — so no separate area→colour table
// has to be hand-maintained as areas are added/renamed.
function AreaChips({ areas }) {
  if (!areas.length) return <span style={{ color: 'var(--mu)' }}>ไม่ระบุ area</span>;
  return areas.map((a) => {
    const c = categoryColor(a);
    return (
      <span
        key={a}
        className="tier-badge"
        style={{
          color: c,
          background: `color-mix(in srgb, ${c} 16%, var(--sf2))`,
          borderColor: `color-mix(in srgb, ${c} 40%, transparent)`,
          border: '1px solid',
          marginRight: 4,
        }}
      >
        {a}
      </span>
    );
  });
}

// The full comma-joined creatorPicks list (up to 9+ names on a team
// submission) reads terribly in a compact queue row — that's what caused the
// wrap/overlap bug this whole section was rewritten for (2026-08-11). Owner
// (the accountable team/individual, already shown this way on AgentCard) +
// a single "Created by" name (the first submitter in the list) replaces it.
function primaryCreatorName(agent) {
  const first = (agent.creator || '').split(',')[0].trim();
  return first || '—';
}

const VERDICT_LABEL = {
  clear_duplicate: 'Clear Duplicate',
  likely_overlap: 'Likely Overlap',
  distinct_but_related: 'Related, Not Duplicate',
  unrelated: 'Unrelated',
};
const VERDICT_COLOR = {
  clear_duplicate: 'var(--late)',
  likely_overlap: 'var(--warn)',
  distinct_but_related: '#2f6bff',
  unrelated: 'var(--ok)',
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

// The candidate popup splits on this: a hard overlap is a reason to reject or
// merge, a merely-related one is context for the reviewer. 'unrelated' is
// deliberately not shown — it is the AI saying it checked and found nothing.
const CANDIDATE_GROUPS = [
  { key: 'overlap', label: 'ทับซ้อน', verdicts: ['clear_duplicate', 'likely_overlap'] },
  { key: 'related', label: 'คล้าย / เกี่ยวข้อง', verdicts: ['distinct_but_related'] },
];
const CANDIDATE_VERDICTS = CANDIDATE_GROUPS.flatMap((g) => g.verdicts);

const RISK_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
const RISK_COLOR = { high: 'var(--late)', medium: 'var(--warn)', low: 'var(--ok)' };

// Visibility + action rights per tier:
//   admin/committee — see & approve/reject every pending item, any area.
//   approver        — see & approve/reject only items whose computed area
//                     overlaps their own approveAreas.
//   user (base)     — see only their own submissions, and may only reject
//                     (withdraw) them — never approve their own idea.
export default function PendingApprovalModal({ pending, deployRequests = [], renameReqs = [], onClose, user, userRole, isAdmin, isCommittee, approveAreas = [], agents = [], schema = {} }) {
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  // Rename requests (2026-08-19) — a third queue beside New Entry and Deploy
  // Request. Now passed in from App rather than self-fetched (2026-08-20):
  // while this modal owned the subscription, the Pending BADGE could not see
  // the queue at all, so a rename request sat here with no counter pointing
  // at it. One listener in App feeds both.
  // Wraps agentApproveAreas with the live category->area overrides an admin
  // may have set via CategoryApprovalPanel, so a brand-new category doesn't
  // silently misroute here even before approveAreas.js's code-level table is
  // ever updated. Falls back to the code-level table alone if schema hasn't
  // loaded yet — same as calling resolveAreas() with no overrides.
  const resolveAreas = (a) => agentApproveAreas(a, schema.categoryAreaMap);
  const [kind, setKind] = useState('all'); // V7 Inbox type filter — presentation only
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

  // Loads EVERY candidate the AI compared against, not just the overlapping
  // ones (2026-08-20). The badge this opens reads "ทับซ้อน/คล้าย" — showing
  // only clear_duplicate/likely_overlap answered the "ทับซ้อน" half and left
  // "คล้าย" unanswered, which is exactly what an approver is asking when they
  // click a Medium risk that has few hard overlaps. Grouped at render time.
  async function openOverlapPopup(agent) {
    setOverlapFor(agent);
    setOverlapCandidates(null);
    try {
      const snap = await getDoc(doc(db, 'analysisRuns', agent.id));
      const candidates = snap.exists() ? (snap.data()?.result?.candidates || []) : [];
      setOverlapCandidates([...candidates].sort((a, b) => (b.confidence || 0) - (a.confidence || 0)));
    } catch {
      setOverlapCandidates([]); // best-effort — a fetch failure just shows "no data" rather than breaking the queue
    }
  }

  // One row of the candidate popup. A helper rather than an inline map so the
  // two verdict groups render identically by construction.
  function renderCandidate(c, i, total) {
    const vColor = VERDICT_COLOR[c.verdict] || 'var(--mu)';
    const target = agentByName(c.agentName);
    return (
      <div key={`${c.agentName}-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '8px 0', borderBottom: i < total - 1 ? '1px solid var(--bd)' : 'none' }}>
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
          <span style={{ fontSize: 10.5, fontWeight: 700, color: vColor, background: `color-mix(in srgb, ${vColor} 9%, transparent)`, border: 'none', padding: '2px 8px', borderRadius: 6 }}>
            {VERDICT_LABEL[c.verdict] || c.verdict}
          </span>
        </div>
        {c.reason && <div style={{ fontSize: 11, color: 'var(--tx2)' }}>{c.reason}</div>}
      </div>
    );
  }

  // Visibility now comes from src/lib/pendingQueue.js so the badge counter in
  // App.jsx counts EXACTLY what this list renders (2026-08-12 — they had
  // drifted: badge counted every pending item regardless of area).
  const viewer = useMemo(
    () => queueViewer({ isAdmin, isCommittee, role: userRole, approveAreas, uid: user?.uid, email: user?.email, categoryAreaMap: schema.categoryAreaMap }),
    [isAdmin, isCommittee, userRole, approveAreas, user?.uid, user?.email, schema.categoryAreaMap],
  );

  const visible = useMemo(() => visiblePending(pending, viewer), [pending, viewer]);

  // D2 (2026-08-10): an approver whose areas simply have nothing pending
  // right now used to collapse into the EXACT same view as a base "user" tier
  // with no approver rights at all — own-submissions-only, no explanation.
  // That reads as "you lost your approver access" when it's really just
  // "your queue is empty today". Distinguished here so a message can say so.
  // Only requests whose agent this person may actually decide — same area
  // model as the other two queues, via canDecideRename (approver-of-area or
  // admin; deliberately NOT staff, and never the creator who filed it).
  // Shared with the badge via pendingQueue.js — the inline copy that used to
  // live here is exactly why the badge and this list could disagree.
  const visibleRenames = useMemo(
    () => visibleRenameRequests(renameReqs, agents, viewer),
    [renameReqs, agents, viewer],
  );

  // Link requests (2026-09-30): AI-suggested Skill → Agent pairings wait here
  // for a creator of either side / area approver / staff / admin.
  const visibleLinks = useMemo(
    () => visibleLinkRequests([...agents, ...pending], viewer),
    [agents, pending, viewer],
  );
  async function decideLink(skillId, verdict) {
    setBusyId(skillId);
    setError('');
    try {
      await httpsCallable(getFunctions(undefined, 'asia-southeast1'), 'decideLinkSuggestion')({ skillId, verdict });
      notifyEvent('link.decided', { agentId: skillId });
    } catch (e) {
      setError(failMsg('ตัดสินคำขอผูก', e));
    } finally {
      setBusyId(null);
    }
  }

  async function decideRename(reqId, verdict) {
    setBusyId(reqId);
    setError('');
    try {
      await decideRenameRequest({ requestId: reqId, verdict });
      notifyEvent('rename.decided', { requestId: reqId });
    } catch (e) {
      setError(failMsg('ตัดสินคำขอเปลี่ยนชื่อ', e));
    } finally {
      setBusyId(null);
    }
  }

  const areaEmptyForApprover = queueAreaEmptyForApprover(pending, viewer);

  function canApprove(agent) {
    if (fullAccess) return true;
    return mine.size > 0 && resolveAreas(agent).some((area) => mine.has(area));
  }
  // V7 "Why you" chip — explains which existing rule put this row in YOUR
  // queue. It reads the same inputs canApprove uses; it grants nothing.
  function whyYou(agent) {
    if (isAdmin) return 'Admin';
    if (isCommittee) return 'Committee';
    const hit = resolveAreas(agent).find((area) => mine.has(area));
    if (hit) return `Your area: ${hit}`;
    if (agent.createdBy === user?.uid) return 'Your submission';
    return '';
  }
  const WhyChip = ({ agent }) => {
    const w = whyYou(agent);
    return w ? <span className="v7-why">Why you: {w}</span> : null;
  };

  function canReject(agent) {
    if (fullAccess) return true;
    if (canApprove(agent)) return true;
    return agent.createdBy === user?.uid;   // self-withdraw own pending idea
  }

  // Deployment requests use the same visibility/rights policy as new-entry
  // approval (user's explicit choice, 7th grill-me follow-up) — reuse
  // agentApproveAreas/canApprove as-is, just against a different query.
  // Paired sub-skills are dropped inside visibleDeployRequests() — they ride
  // along with their parent Agent's request (cascaded to 'requested') and must
  // never appear as separate line items; handleApproveDeploy/RejectDeploy
  // cascade the decision back onto them (2026-07-06).
  const visibleDeploy = useMemo(
    () => visibleDeployRequests(deployRequests, agents, viewer),
    [deployRequests, agents, viewer],
  );

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
      notifyEvent(verdict === 'approved' ? 'deploy.approved' : 'deploy.rejected', { agentId: agent.id });
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
      // Parent only — the cascade below moves siblings, but this is one
      // decision and must be one email.
      notifyEvent('agent.approved', { agentId: agent.id });

      // Captured once: `pending` is live state and the siblings leave it as
      // soon as they are approved, so re-deriving later would come back empty.
      const siblings = findCascadeSiblings(agent);
      for (const sib of siblings) {
        await updateDoc(doc(db, 'agents', sib.id), {
          approvalStatus: 'approved',
          approvedBy: user?.uid || '',
          updatedAt: serverTimestamp(),
        });
        await recordOutcome(sib.id, 'approved', user?.uid);
      }
      // Once, after the whole cascade is approved: give the parent and its
      // siblings a primary Role Group. Fire-and-forget — never blocks approval.
      classifyRoleGroups([agent.id, ...siblings.map((s) => s.id)]);
      toast(`Approved · ${agent.agentName}`);
    } catch (e) {
      setError(e.message || 'Approve failed');
    } finally {
      setBusyId(null);
    }
  }

  // reason: required when an approver/admin rejects someone else's idea (so the
  // creator knows why); empty for a base user's self-withdraw of their OWN
  // idea (no explanation owed; the self-withdraw firestore rule allows
  // approvalStatus/updatedAt/rejectedBy/rejectedAt — no reason field).
  async function handleReject(agent, reason = '') {
    setBusyId(agent.id);
    setError('');
    try {
      // Always stamp who/when; only an approver's reject carries a reason
      // (a creator's self-withdraw has none — that is how the UI tells them apart).
      const rejectFields = {
        rejectedBy: user?.uid || '',
        rejectedAt: serverTimestamp(),
        ...(reason.trim() ? { rejectionReason: reason.trim() } : {}),
      };
      // Soft reject — keep the record for audit trail, hide it from the dashboard.
      await updateDoc(doc(db, 'agents', agent.id), {
        approvalStatus: 'rejected',
        updatedAt: serverTimestamp(),
        ...rejectFields,
      });
      await recordOutcome(agent.id, 'rejected', user?.uid);
      notifyEvent('agent.rejected', { agentId: agent.id });

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
      toast(`Rejected · ${agent.agentName}`);
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
            <h2 className="mtitle">Inbox</h2>
            <div className="msub" style={{ margin: 0 }}>
              <strong style={{ color: 'var(--tx)' }}>{visible.length + visibleDeploy.length + visibleRenames.length + visibleLinks.length} requests</strong> รอคุณ
              {fullAccess ? ' · คุณเห็นทุก Area' : mine.size > 0 ? ` · คุณอนุมัติ ${[...mine].join(', ')}` : ''}
            </div>
          </div>
        </div>

        <div className="v7-inbox-filter" role="tablist" aria-label="Request type">
          {[
            ['all', 'All', visible.length + visibleDeploy.length + visibleRenames.length + visibleLinks.length],
            ['new', 'New Entry', visible.length],
            ['deploy', 'Deploy', visibleDeploy.length],
            ['rename', 'Rename', visibleRenames.length],
            ['link', 'Link', visibleLinks.length],
          ].map(([k, label, n]) => (
            <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
              {label}<span>{n}</span>
            </button>
          ))}
        </div>

        {error && <div className="msg error"><span className="dot" style={{ background: '#ea4335' }} />{error}</div>}

        {areaEmptyForApprover && (
          <div className="msg info">
            ขณะนี้ไม่มีรายการใหม่ใน area ของคุณ ({[...mine].join(', ')}) — แสดงเฉพาะรายการที่คุณส่ง
          </div>
        )}

        {(kind === 'all' || kind === 'new') && (<>
        {/* V7 board 12: one queue. Each request type still renders with its
            own rule set (visiblePending / visibleDeployRequests / …); the
            section headings became a type badge on each row. */}
        {visible.length === 0 ? null : (
          visible.map((agent) => {
            const tier = getTier(agent);
            const tierDef = TIER_DEF[tier];
            const risk = agent.analysisResult?.overallRisk;
            const breadthFlag = agent.analysisResult?.breadthFlag;
            const overlapAgents = agent.analysisResult?.overlapAgents;
            return (
            <div className="queue-row v7-qrow" key={agent.id}>
              <div className="queue-content">
                <div className="dup-name"><span className="v7-kind new">New</span><span className="v7-qname" role="button" tabIndex={0} onClick={() => setDetailAgent(agent)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setDetailAgent(agent)}>{agent.agentName}</span></div>
                <div className="queue-meta">
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '3px 10px' }}>
                    <span>{agentTypeLabel(agent, agents)}</span>
                    <span>Owner: <strong style={{ color: 'var(--tx2)', fontWeight: 600 }}>{agent.owner || '—'}</strong></span>
                    <span>Created by: <strong style={{ color: 'var(--tx2)', fontWeight: 600 }}>{primaryCreatorName(agent)}</strong></span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 5 }}>
                    <WhyChip agent={agent} />
                    <AreaChips areas={resolveAreas(agent)} />
                    <span style={{ color: tierDef.color, fontWeight: 700 }}>{tierDef.label}</span>
                    {/* Clickable since 2026-08-20: the risk level alone told an
                        approver there was a problem without telling them WHICH
                        agents it overlapped — the candidate list was already
                        stored in /analysisRuns, just never reachable from here
                        unless the separate breadthFlag happened to be set. */}
                    {risk && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={() => openOverlapPopup(agent)}
                        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && openOverlapPopup(agent)}
                        style={{ cursor: 'pointer' }}
                        title="กดเพื่อดูว่าคล้ายกับ Agent ตัวไหนบ้าง"
                      >
                        AI check · overlap:{' '}
                        <span style={{ color: RISK_COLOR[risk] || 'var(--mu)', fontWeight: 700, textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
                          {RISK_LABEL[risk] || risk}
                        </span>
                      </span>
                    )}
                    {breadthFlag && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={() => openOverlapPopup(agent)}
                        style={{ color: 'var(--warn)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                        title="กดเพื่อดูรายชื่อ Agent ที่ทับซ้อน"
                      >
                        ทับซ้อนหลายตัว{overlapAgents ? ` (${overlapAgents})` : ''}
                      </span>
                    )}
                  </div>
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
                {/* V7: reject reason is written inline under the row (was a
                    second modal). Same rejectModal state, same handleReject. */}
                {rejectModal?.agent.id === agent.id && (
                  <div className="v7-inline-reject">
                    <label htmlFor={`rej-${agent.id}`}>Reject “{agent.agentName}”</label>
                    <textarea
                      id={`rej-${agent.id}`}
                      rows={3}
                      autoFocus
                      value={rejectModal.reason}
                      onChange={(e) => setRejectModal((m) => ({ ...m, reason: e.target.value }))}
                      placeholder="ระบุเหตุผลเพื่อให้ Creator ปรับแก้และส่งใหม่ได้ เช่น ซ้ำกับ Agent เดิม / ขอบเขตยังไม่ชัดเจน"
                    />
                    <div className="queue-actions">
                      <span className="v7-rej-note"><Hint text="ผู้ส่งจะได้รับเหตุผลนี้ผ่านการแจ้งเตือน" /></span>
                      <button className="btn-sm rej" disabled={busyId === agent.id} onClick={() => setRejectModal(null)}>Cancel</button>
                      <button
                        className="btn-sm v7-danger-sm"
                        disabled={busyId === agent.id || !rejectModal.reason.trim()}
                        onClick={() => handleReject(rejectModal.agent, rejectModal.reason)}
                      >
                        {busyId === agent.id ? 'Saving…' : 'Confirm Reject'}
                      </button>
                    </div>
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

        </>)}

        {(kind === 'all' || kind === 'deploy') && (<>
        {visibleDeploy.length === 0 ? null : (
          visibleDeploy.map((agent) => {
            const tier = getTier(agent);
            const tierDef = TIER_DEF[tier];
            return (
              <div className="queue-row v7-qrow" key={agent.id}>
                <div className="queue-content">
                  <div className="dup-name"><span className="v7-kind deploy">Deploy</span><span className="v7-qname" role="button" tabIndex={0} onClick={() => setDetailAgent(agent)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setDetailAgent(agent)} title="คลิกเพื่อดูรายละเอียด">{agent.agentName}</span></div>
                  <div className="queue-meta">
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '3px 10px' }}>
                      <span>Owner: <strong style={{ color: 'var(--tx2)', fontWeight: 600 }}>{agent.owner || '—'}</strong></span>
                      <span>Created by: <strong style={{ color: 'var(--tx2)', fontWeight: 600 }}>{primaryCreatorName(agent)}</strong></span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 5 }}>
                      <WhyChip agent={agent} />
                      <AreaChips areas={resolveAreas(agent)} />
                      <span style={{ color: tierDef.color, fontWeight: 700 }}>{tierDef.label}</span>
                      <span>Progress: <strong style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{agent.devProgress}%</strong></span>
                      {agent.launchDate && (
                        <span>Launch: <strong>{fmtDate(agent.launchDate)}</strong></span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="queue-actions">
                  {(fullAccess || (mine.size > 0 && resolveAreas(agent).some((area) => mine.has(area)))) && (
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

        </>)}

        {(kind === 'all' || kind === 'rename') && (<>
        {/* Rename requests (2026-08-19) — third queue. Approving one is not a
            field edit: decideRenameRequest also rewrites matchingAgent on every
            paired sub-skill in the same batch, because pairing is by NAME and a
            bare rename would detach all of them. */}
        {visibleRenames.length === 0 ? null : (
          visibleRenames.map(({ r, agent }) => {
            const tier = getTier(agent);
            const tierDef = TIER_DEF[tier];
            const kids = pairedSubSkills(agent, agents);
            return (
              <div className="queue-row v7-qrow" key={r.id}>
                <div className="queue-content">
                  <div
                    className="dup-name"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setDetailAgent(agent)}
                    title="คลิกเพื่อดูรายละเอียด"
                  >
                    <span className="v7-kind rename">Rename</span>
                    <span style={{ color: 'var(--mu)', textDecoration: 'line-through' }}>{r.currentName || agent.agentName}</span>
                    {' → '}
                    <span style={{ textDecoration: 'underline', textDecorationStyle: 'dotted' }}>{r.requestedName}</span>
                  </div>
                  <div className="queue-meta">
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '3px 10px' }}>
                      <span>Owner: <strong style={{ color: 'var(--tx2)', fontWeight: 600 }}>{agent.owner || '—'}</strong></span>
                      <span>Requested by: <strong style={{ color: 'var(--tx2)', fontWeight: 600 }}>{r.createdByEmail || '—'}</strong></span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 5 }}>
                      <AreaChips areas={resolveAreas(agent)} />
                      <span style={{ color: tierDef.color, fontWeight: 700 }}>{tierDef.label}</span>
                      {kids.length > 0 && (
                        <span style={{ color: 'var(--msg-warn-fg)' }}>
                          Skill ที่ผูกอยู่ {kids.length} รายการจะอัปเดตโดยอัตโนมัติ
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {/* .queue-actions, not .btn-row — the other two queues use it and
                    it is the one with flex-shrink:0. .btn-row stretches its
                    buttons to fill (flex:1) and has no shrink guard, which is
                    why this row rendered cramped and misaligned next to them. */}
                <div className="queue-actions">
                  <button className="btn-sm rej" disabled={busyId === r.id} onClick={() => decideRename(r.id, 'rejected')}>Reject</button>
                  <button className="btn-sm appr" disabled={busyId === r.id} onClick={() => decideRename(r.id, 'approved')}>
                    {busyId === r.id ? '…' : 'Approve'}
                  </button>
                </div>
              </div>
            );
          })
        )}

        </>)}

        {(kind === 'all' || kind === 'link') && (<>
        {visibleLinks.length === 0 ? null : (
          visibleLinks.map(({ skill, target }) => (
            <div className="queue-row v7-qrow" key={skill.id}>
              <div className="queue-content">
                <div className="dup-name">
                  <span className="v7-kind link">Link</span>
                  <span style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }} onClick={() => setDetailAgent(skill)} title="คลิกเพื่อดูรายละเอียด">{skill.agentName}</span>
                  {' → '}
                  <span style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }} onClick={() => setDetailAgent(target)} title="คลิกเพื่อดูรายละเอียด">{target.agentName}</span>
                </div>
                <div className="queue-meta">
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '3px 10px' }}>
                    <span>Skill team: <strong style={{ color: 'var(--tx2)', fontWeight: 600 }}>{skill.owner || '—'}</strong></span>
                    <span>Agent team: <strong style={{ color: 'var(--tx2)', fontWeight: 600 }}>{target.owner || '—'}</strong></span>
                    {skill.approvalStatus === 'pending' && <span style={{ color: 'var(--msg-warn-fg)' }}>Skill ยังรออนุมัติ</span>}
                    {(skill.owner || '') !== (target.owner || '') && <span style={{ color: 'var(--msg-warn-fg)' }}>⚠ ต่างทีม</span>}
                  </div>
                </div>
              </div>
              <div className="queue-actions">
                <button className="btn-sm rej" disabled={busyId === skill.id} onClick={() => decideLink(skill.id, 'rejected')}>Reject</button>
                <button className="btn-sm appr" disabled={busyId === skill.id} onClick={() => decideLink(skill.id, 'accepted')}>
                  {busyId === skill.id ? '…' : 'Link'}
                </button>
              </div>
            </div>
          ))
        )}

        </>)}

        {(kind === 'all' ? visible.length + visibleDeploy.length + visibleRenames.length + visibleLinks.length
          : kind === 'new' ? visible.length : kind === 'deploy' ? visibleDeploy.length
          : kind === 'rename' ? visibleRenames.length : visibleLinks.length) === 0 && (
          <div className="v7-inbox-empty">ไม่มีคำขอที่รอการพิจารณา</div>
        )}

        {kind === 'all' && myRejected.length > 0 && (
          <>
            <div className="sec-title" style={{ marginTop: 16 }}>My rejected items</div>
            <div className="msub">{myRejected.length} รายการ <Hint text="รายการของคุณที่ไม่ผ่านการอนุมัติ พร้อมเหตุผลจาก Approver" /></div>
            {myRejected.map((agent) => (
              <div className="queue-row" key={agent.id}>
                <div className="queue-content">
                  <div className="dup-name">{agent.agentName}</div>
                  <div className="queue-meta">
                    {agentTypeLabel(agent, agents)}
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

      {overlapFor && (
        <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && setOverlapFor(null)}>
          <div className="mbox" style={{ padding: 18, maxWidth: 480 }}>
            <button className="mclose" onClick={() => setOverlapFor(null)}>✕</button>
            <h3 style={{ fontSize: 15, marginBottom: 4 }}>Agent เดิมที่ทับซ้อน / คล้ายกัน</h3>
            <div style={{ fontSize: 12, color: 'var(--mu)', marginBottom: 12 }}>{overlapFor.agentName}</div>

            {overlapCandidates === null && (
              <div className="msg info"><span className="spin" style={{ width: 14, height: 14, borderWidth: 2 }} />กำลังโหลด…</div>
            )}
            {overlapCandidates?.length === 0 && (
              <div className="msg warn"><span className="dot" style={{ background: 'var(--warn)' }} />ไม่พบข้อมูลรายละเอียด (อาจถูกข้ามตอนบันทึกเนื่องจากซ้ำกับ analysis อื่นที่มีอยู่แล้ว)</div>
            )}
            {/* Two groups, not one list: an approver reads "ทับซ้อน" and "คล้าย"
                as different decisions — the first is a reason to reject or
                merge, the second is context. Flattening them would make the
                AI look like it flagged 9 duplicates when it found 2. */}
            {CANDIDATE_GROUPS.map(({ key, label, verdicts }) => {
              const rows = (overlapCandidates || []).filter((c) => verdicts.includes(c.verdict));
              if (!rows.length) return null;
              return (
                <div key={key}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--mu)', letterSpacing: '.04em', textTransform: 'uppercase', marginTop: 12, marginBottom: 2 }}>
                    {label} ({rows.length})
                  </div>
                  {rows.map((c, i) => renderCandidate(c, i, rows.length))}
                </div>
              );
            })}
            {overlapCandidates?.length > 0
              && overlapCandidates.every((c) => !CANDIDATE_VERDICTS.includes(c.verdict)) && (
              <div className="msg info" style={{ marginTop: 10 }}>
                <span className="dot" style={{ background: '#4a6fa5' }} />
                AI เทียบกับ {overlapCandidates.length} ตัวแล้วไม่พบตัวที่ทับซ้อนหรือคล้ายกัน
              </div>
            )}
          </div>
        </div>
      )}

      {detailAgent && (
        <AgentDetailModal
          agent={detailAgent}
          allAgents={agents}
          onClose={() => setDetailAgent(null)}
          user={user}
          userRole={userRole}
          isAdmin={fullAccess}
          approveAreas={approveAreas}
          schema={schema}
        />
      )}
    </div>
  );
}
