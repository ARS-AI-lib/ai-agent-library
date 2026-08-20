import { useEffect, useState } from 'react';
import { addDoc, collection, doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { getType, getTier, TIER_DEF, isInternalOrExternal } from '../lib/tier';
import { agentStatus, ST_DEF, progressBucket, developmentPhaseLabel } from '../lib/status';
import { fmtDate, skillsOfAgent, agentsOfSkill, canUpdateProgress, canEditDetails, canEditSDLC, canEditReadyToUseFields, canMarkAgentReady, isMyAgent, pairedSubSkills, isPairedSubSkill, safeEndpointUrl, endpointLabel, agentUseCaseNames } from '../lib/agentUtils';
import { agentApproveAreas } from '../lib/approveAreas';
import useEscapeKey from '../hooks/useEscapeKey';
import { recordAgentEvent, submitRating } from '../lib/agentEvents';
import { handleEndpointClick, isLibraryFileUrl, markAgentReady } from '../lib/endpointFiles';
import { notifyEvent } from '../lib/notify';
import { readStats, ratingDisplay, canRateAgent, STAR_LEVELS } from '../lib/agentStats';

// Firestore Timestamp / Date / string → "YYYY-MM-DD" for <input type="date">.
function toDateInputValue(d) {
  if (!d) return '';
  try {
    const dt = d?.toDate ? d.toDate() : new Date(d);
    if (isNaN(dt)) return '';
    return dt.toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

const DEPLOY_STATUS_LABEL = { requested: 'Deploy Pending', approved: 'Deploy Approved', rejected: 'Deploy Rejected' };
const DEPLOY_STATUS_COLOR = { requested: '#c96a00', approved: '#137333', rejected: '#c5221f' };

export default function AgentDetailModal({ agent, allAgents, onClose, user, userRole, isAdmin, onEditAgent, approveAreas = [], schema = {} }) {
  const [editing, setEditing] = useState(false);
  const [editProgress, setEditProgress] = useState(0);
  const [editLaunch, setEditLaunch] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [confirmingDeploy, setConfirmingDeploy] = useState(false);
  const [editEndpoint, setEditEndpoint] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameMsg, setRenameMsg] = useState('');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  // Sub-skill ids the user ticked to KEEP live. Default empty = archive the
  // whole package, per the agreed "if nothing is picked, archive them all".
  const [keepIds, setKeepIds] = useState(() => new Set());
  // Rating (2026-08-18)
  const [stats, setStats] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [myRating, setMyRating] = useState(0);
  const [myComment, setMyComment] = useState('');
  const [rateOpen, setRateOpen] = useState(false);
  const [rating, setRating] = useState(false);
  useEscapeKey(onClose);

  // Usage telemetry (2026-08-18). Placed HERE rather than at the three call
  // sites (App.jsx, PendingApprovalModal, TimelinePage) so opening a detail is
  // counted once, from one place, no matter who opened it. Fire-and-forget and
  // de-duplicated server-side per user/day, so a re-render costs nothing.
  const viewedId = agent?.id;
  useEffect(() => {
    if (viewedId) recordAgentEvent(viewedId, 'detail');
  }, [viewedId]);

  // Live stats + the peer-visible (uid-free) reviews for THIS agent. Scoped to
  // the open modal rather than subscribed globally: reviews are a subcollection
  // nobody needs until they open the entry.
  useEffect(() => {
    if (!viewedId) return undefined;
    const unsubStats = onSnapshot(doc(db, 'agentStats', viewedId),
      (snap) => setStats(snap.exists() ? snap.data() : null),
      () => setStats(null));
    const unsubRev = onSnapshot(collection(db, 'agentStats', viewedId, 'reviews'),
      (snap) => setReviews(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setReviews([]));
    return () => { unsubStats(); unsubRev(); };
  }, [viewedId]);

  // The caller's OWN rating, so the control opens pre-filled and reads as
  // "change your rating" rather than silently creating a second one. Readable
  // only by its author and admin — see the /agentRatings rules block.
  useEffect(() => {
    if (!viewedId || !user?.uid) return undefined;
    const unsub = onSnapshot(doc(db, 'agentRatings', `${viewedId}__${user.uid}`),
      (snap) => {
        const d = snap.exists() ? snap.data() : null;
        setMyRating(d?.rating || 0);
        setMyComment(d?.comment || '');
      },
      () => { setMyRating(0); setMyComment(''); });
    return unsub;
  }, [viewedId, user?.uid]);

  async function handleSubmitRating() {
    if (!myRating) return;
    setRating(true);
    setSaveError('');
    try {
      await submitRating({ agentId: agent.id, rating: myRating, comment: myComment });
      setRateOpen(false);
    } catch (e) {
      setSaveError(e?.message || 'ส่งคะแนนไม่สำเร็จ');
    } finally {
      setRating(false);
    }
  }

  if (!agent) return null;
  const type = getType(agent);
  const tier = getTier(agent);
  const tierDef = TIER_DEF[tier];
  const st = agentStatus(agent);
  const sd = ST_DEF[st];
  const progress = typeof agent.devProgress === 'number' ? agent.devProgress : 0;
  const deploymentStatus = agent.deploymentStatus || 'none';

  const related = type === 'skill' ? agentsOfSkill(agent) : skillsOfAgent(agent, allAgents);
  const role = Array.isArray(agent.relatedRole) ? agent.relatedRole.join(', ') : agent.relatedRole;
  const ability = Array.isArray(agent.coreAbility) ? agent.coreAbility.join(', ') : agent.coreAbility;
  // Re-sanitised at render even though writes are already sanitised — docs
  // predating that write path (or touched by a script) must not be trusted.
  const endpointHref = safeEndpointUrl(agent.endpoint);
  const useCaseNames = agentUseCaseNames(agent);
  const process = Array.isArray(agent.sdlcProcessMapping) ? agent.sdlcProcessMapping.join(', ') : agent.sdlcProcessMapping;
  const scope = isInternalOrExternal(agent);

  // A paired sub-skill (registered as part of a parent Agent) is locked: no
  // own progress-update or deploy-request controls — everything cascades from
  // its parent Agent so the pair always moves together (2026-07-06).
  const lockedSubSkill = isPairedSubSkill(agent, allAgents || []);

  const canEdit = !lockedSubSkill && progress < 100 && canUpdateProgress(agent, user, isAdmin);
  // Deploy Approval gate (2026-07-02, revised): no disabled/greyed button —
  // clicking "Deployment Request" always opens a confirm dialog ("tested and
  // ready?"); on Yes the system bumps devProgress to 95 AND files the request
  // in one write (see handleRequestDeploy). The button itself is only hidden
  // once a request is already in flight or already approved — nothing left
  // to request in that state.
  const mayEditThisAgent = canUpdateProgress(agent, user, isAdmin);
  // Show the Edit button if the user may edit EITHER the Tier A detail set OR
  // the SDLC metadata fields (a pure approver-role has only the latter).
  const mayEditDetails = canEditDetails(agent, user, userRole, isAdmin) || canEditSDLC(agent, user, userRole, isAdmin) || canEditReadyToUseFields(agent, user, isAdmin);
  const canRequestDeploy = !lockedSubSkill && mayEditThisAgent && deploymentStatus !== 'requested' && deploymentStatus !== 'approved';

  // Archiving is a curation decision, not an authorship one — so it is NOT
  // tied to createdBy/creator like the edit rights above. Only the roles that
  // govern the library as a whole may retire an entry from it.
  // Staff joined 2026-08-11, but SCOPED — not a blanket grant like
  // approver/committee: a staff member may only archive an agent whose
  // resolved Approve Area overlaps their own /users.approveAreas (the same
  // field UserManagementModal already assigns to approvers). Mirrors the
  // Approve Area routing model, so "staff archive rights" reads as "curation
  // rights within your own discipline", not "any staff can retire anything".
  const agentAreas = agentApproveAreas(agent, schema.categoryAreaMap);
  const staffAreaMatch = userRole === 'staff' && approveAreas.length > 0
    && agentAreas.some((ar) => approveAreas.includes(ar));

  // ── Ready-to-Use gate (2026-08-19) ──
  // Who may flip this agent to 100% and set/replace its endpoint or uploaded
  // file: creator, an approver/staff of this agent's Approve Area, or admin.
  // Presentation only — markAgentReady re-checks all of it server-side.
  const mayMarkReady = canMarkAgentReady(agent, user, userRole, isAdmin, approveAreas, agentAreas);
  // The endpoint is required BEFORE 100%, so the dialog must know whether one
  // already exists — either a plain URL or a file uploaded to our repo.
  const hasUploadedFile = !!agent.endpointFile?.storagePath;
  const endpointIsOurFile = isLibraryFileUrl(agent.endpoint);
  const hasEndpoint = !!String(agent.endpoint || '').trim() || hasUploadedFile;
  // A creator may ask to rename only once the thing is actually live — before
  // that the ordinary Edit form still lets them rename outright, no approval
  // needed, so offering a request flow there would be pure friction.
  const mayRequestRename = deploymentStatus === 'approved'
    && !isAdmin
    && (isMyAgent(agent, user) || !!(agent.createdBy && agent.createdBy === user?.uid));
  const mayArchive = isAdmin || userRole === 'approver' || userRole === 'committee' || staffAreaMatch;
  const isArchived = agent.archived === true;
  // Paired sub-skills that would be dragged along by archiving this Agent —
  // the user gets to tick any worth keeping (e.g. a genuinely reusable skill).
  const subSkills = pairedSubSkills(agent, allAgents || []);

  // Rating/usage derived values. canRateAgent mirrors the server check in
  // submitRating so the control is never shown to someone it would reject —
  // the server stays authoritative, this only decides what to render.
  const liveStats = readStats(stats);
  const ratingView = ratingDisplay(stats);
  const mayRate = canRateAgent(agent, user);
  const visibleReviews = reviews
    .filter((r) => String(r.comment || '').trim())
    .sort((a2, b2) => (b2.createdAt?.seconds || 0) - (a2.createdAt?.seconds || 0));

  function startEdit() {
    setEditProgress(progress);
    setEditLaunch(toDateInputValue(agent.launchDate));
    setEditEndpoint('');
    setSaveError('');
    setEditing(true);
  }

  async function handleSave() {
    const clamped = Math.max(0, Math.min(100, Math.round(Number(editProgress) || 0)));
    if (clamped > 95 && deploymentStatus !== 'approved') {
      setSaveError('ไม่สามารถตั้งค่าเกิน 95% ได้จนกว่าจะได้รับอนุมัติ Deployment Request (ปุ่มขออนุมัติอยู่ใต้แถบ Progress ด้านล่าง)');
      return;
    }
    // ── The 100% transition is a different operation, not a bigger number ──
    // It publishes the agent, so it carries an endpoint requirement, a wider
    // permission set (creator / area approver / area staff / admin) and an
    // automatic launch date. None of that is expressible in security rules —
    // area membership needs the 7-layer agentApproveAreas() resolver — so it
    // runs through the markAgentReady callable instead of a client write.
    if (clamped === 100) {
      if (!mayMarkReady) {
        setSaveError('คุณไม่มีสิทธิ์ปรับเป็น 100% — ต้องเป็น Creator, Approver/Staff ประจำ Area นี้ หรือ Admin');
        return;
      }
      if (!hasEndpoint && !editEndpoint.trim()) {
        setSaveError('ต้องระบุ Endpoint URL หรืออัปโหลดไฟล์ก่อน จึงจะปรับเป็น 100% ได้');
        return;
      }
      setSaving(true);
      setSaveError('');
      try {
        const args = { endpointUrl: editEndpoint.trim() || undefined, launchDate: editLaunch || undefined };
        await markAgentReady({ agentId: agent.id, ...args });
        notifyEvent('agent.ready', { agentId: agent.id });
        // Cascade stays here rather than inside the callable so the one correct
        // pairing helper (pairedSubSkills) remains the only implementation —
        // re-deriving it server-side is exactly the drift CLAUDE.md §20 forbids.
        // Each call is independently authorised; sub-skills inherit the parent's
        // endpoint only if they have none of their own.
        for (const sk of pairedSubSkills(agent, allAgents || [])) {
          await markAgentReady({ agentId: sk.id, ...args }).catch(() => {});
        }
        setEditing(false);
      } catch (e) {
        setSaveError(e?.message || 'ปรับเป็น 100% ไม่สำเร็จ');
      } finally {
        setSaving(false);
      }
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const patch = {
        devProgress: clamped,
        developmentPhase: developmentPhaseLabel(clamped),
        launchDate: editLaunch ? new Date(editLaunch) : null,
        updatedAt: serverTimestamp(),
      };
      await updateDoc(doc(db, 'agents', agent.id), patch);
      // Live cascade (2026-07-06): keep paired sub-skills in lock-step with the
      // parent Agent's progress/launch. Only an Agent has sub-skills; a skill
      // never reaches this branch because its own edit button is hidden.
      for (const sk of pairedSubSkills(agent, allAgents || [])) {
        await updateDoc(doc(db, 'agents', sk.id), patch);
      }
      setEditing(false);
    } catch (e) {
      setSaveError(e.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  // Confirm-then-request flow (revised 2026-07-02): clicking the button opens
  // a Y/N confirm dialog instead of a disabled/greyed state. On Yes, one write
  // both bumps devProgress to 95 and files the request — no separate
  // "save to 95 first" step. See the matching firestore.rules branch, which
  // requires request.resource.data.devProgress == 95 for this exact write.
  // ── Archive (2026-07-22) ────────────────────────────────────────────
  // Retire an entry from the library WITHOUT deleting it: it disappears from
  // the grid, search, Dashboard and Timeline, but stays readable for audit,
  // duplicate-warning and AI-background purposes. `archived === true` is what
  // useApprovedAgents splits on.
  //
  // Note there is deliberately NO "unlock the kept sub-skills" write here: the
  // paired-sub-skill lock is *derived* (isPairedSubSkill searches the active
  // list for the parent), so once the parent leaves that list the kept skills
  // become independently editable on their own — a stored flag would only be a
  // second source of truth to keep in sync.
  async function handleArchive() {
    setArchiving(true);
    setSaveError('');
    try {
      const stamp = {
        archived: true,
        archivedAt: serverTimestamp(),
        archivedBy: user?.uid || '',
        archiveReason: archiveReason.trim(),
        updatedAt: serverTimestamp(),
      };
      await updateDoc(doc(db, 'agents', agent.id), stamp);
      notifyEvent('agent.archived', { agentId: agent.id });
      // Cascade to paired sub-skills EXCEPT the ones explicitly kept, so a
      // still-useful reusable skill can outlive its parent Agent.
      for (const sk of subSkills) {
        if (keepIds.has(sk.id)) continue;
        await updateDoc(doc(db, 'agents', sk.id), stamp);
      }
      setArchiveOpen(false);
      onClose?.();
    } catch (e) {
      setSaveError(e.message || 'Archive ไม่สำเร็จ');
    } finally {
      setArchiving(false);
    }
  }

  async function handleUnarchive() {
    setArchiving(true);
    setSaveError('');
    try {
      // Clears the stamp rather than leaving stale archivedAt/By behind, so a
      // re-archive later records who did it *that* time.
      await updateDoc(doc(db, 'agents', agent.id), {
        archived: false,
        archivedAt: null,
        archivedBy: '',
        archiveReason: '',
        updatedAt: serverTimestamp(),
      });
      onClose?.();
    } catch (e) {
      setSaveError(e.message || 'ยกเลิก Archive ไม่สำเร็จ');
    } finally {
      setArchiving(false);
    }
  }

  // Rename after go-live is a REQUEST, not an edit. Every detail tier freezes
  // `agentName` once deploymentStatus is requested/approved, and unfreezing it
  // for the creator alone would let a live entry be renamed with nobody
  // noticing — so the creator files a row here and an area approver (or admin)
  // decides via the decideRenameRequest callable, which also rewrites the
  // paired sub-skills' matchingAgent so the pairing survives.
  async function handleRequestRename() {
    const next = renameValue.trim();
    if (!next) { setRenameMsg('กรุณาระบุชื่อใหม่'); return; }
    if (next === String(agent.agentName || '').trim()) { setRenameMsg('ชื่อใหม่ซ้ำกับชื่อเดิม'); return; }
    setRenameBusy(true);
    setRenameMsg('');
    try {
      const reqRef = await addDoc(collection(db, 'renameRequests'), {
        agentId: agent.id,
        currentName: agent.agentName || '',
        requestedName: next,
        status: 'pending',
        createdBy: user?.uid || '',
        createdByEmail: user?.email || '',
        createdAt: serverTimestamp(),
      });
      notifyEvent('rename.requested', { requestId: reqRef.id });
      setRenameMsg('ส่งคำขอแล้ว — รอ Approver ประจำ Area หรือ Admin อนุมัติ');
      setRenameValue('');
    } catch (e) {
      setRenameMsg(e?.message || 'ส่งคำขอไม่สำเร็จ');
    } finally {
      setRenameBusy(false);
    }
  }

  async function handleRequestDeploy() {
    setConfirmingDeploy(false);
    setRequesting(true);
    setSaveError('');
    try {
      const patch = {
        devProgress: 95,
        deploymentStatus: 'requested',
        deployRequestedBy: user?.uid || '',
        deployRequestedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await updateDoc(doc(db, 'agents', agent.id), patch);
      // Parent only: the cascade below writes one doc per sub-skill, and a
      // 7-child parent would otherwise produce 8 emails for one request.
      notifyEvent('deploy.requested', { agentId: agent.id });
      // Cascade the deploy request onto the paired sub-skills too, so the
      // approver's single decision on the parent flips the whole package
      // (the skills are filtered out of the approver's deploy queue — the
      // parent represents them). Same createdBy ⇒ the deploy-request rule
      // permits this write.
      for (const sk of pairedSubSkills(agent, allAgents || [])) {
        await updateDoc(doc(db, 'agents', sk.id), patch);
      }
    } catch (e) {
      setSaveError(e.message || 'ขออนุมัติไม่สำเร็จ');
    } finally {
      setRequesting(false);
    }
  }

  return (
    <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && onClose()}>
      <div className="mbox">
        <button className="mclose" onClick={onClose}>✕</button>

        {/* Flattened (2026-08-08 redesign) — this used to wrap everything
            below in a nested .mac card whose header repeated the agent name
            already shown in .mtitle above. The mockup treats Agent Detail as
            one flat sheet: title row → type/tier/scope badges → progress →
            deploy status → a plain field list. No information was dropped,
            only the redundant inner card frame. */}
        <div className="mtitle-row">
          <h2 className="mtitle">{agent.agentName}</h2>
          {mayRequestRename && (
            <button className="mi-btn" title="ขอเปลี่ยนชื่อ (ต้องผ่านการอนุมัติ)" onClick={() => { setRenameValue(agent.agentName || ''); setRenameMsg(''); setRenameOpen(true); }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 20h16" /><path d="M14.5 3.5a2.12 2.12 0 0 1 3 3L7 17l-4 1 1-4z" />
              </svg>
            </button>
          )}
          {mayEditDetails && (
            <button className="mi-btn" title="Edit Details" onClick={() => onEditAgent?.(agent)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 21v-7" /><path d="M4 10V3" /><path d="M12 21v-9" /><path d="M12 8V3" /><path d="M20 21v-5" /><path d="M20 12V3" />
                <path d="M1 14h6" /><path d="M9 8h6" /><path d="M17 16h6" />
              </svg>
            </button>
          )}
          {mayArchive && (
            <button
              className="mi-btn"
              title={isArchived ? 'นำกลับเข้า Library' : 'Archive ออกจาก Library'}
              disabled={archiving}
              onClick={() => (isArchived ? handleUnarchive() : setArchiveOpen(true))}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="5" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
                {isArchived ? <path d="M12 18v-6M9 15l3-3 3 3" /> : <line x1="9" y1="13" x2="15" y2="13" />}
              </svg>
            </button>
          )}
        </div>

        <div className="mbadges">
          <span className={`tb ${type === 'agent' ? 'tbag' : 'tbsk'}`}>{type === 'agent' ? 'AGENT' : 'SKILL'}</span>
          <span className="tier-badge" style={{ color: tierDef.color, background: tierDef.bg, borderColor: tierDef.bd }} title={tierDef.label}>
            {tier} · {tierDef.label.split(' · ')[1] || tierDef.label}
          </span>
          <span className="ac-scope" style={{ margin: 0, color: scope === 'External' ? '#0ea5e9' : 'var(--ag)' }} title={scope === 'External' ? 'Customer Facing' : 'Internal Use'}>
            {scope === 'External' ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="2" width="16" height="20" rx="1" />
                <line x1="9" y1="10" x2="9" y2="10" /><line x1="15" y1="10" x2="15" y2="10" />
                <line x1="9" y1="14" x2="9" y2="14" /><line x1="15" y1="14" x2="15" y2="14" />
                <path d="M9 22v-4h6v4" />
              </svg>
            )}
          </span>
          {isArchived && (
            <span
              className="ttag"
              style={{ color: 'var(--msg-warn-fg)', background: 'var(--msg-warn-bg)', fontWeight: 700 }}
              title={agent.archiveReason ? `เหตุผล: ${agent.archiveReason}` : 'ถูก archive ออกจาก Library'}
            >
              ARCHIVED
            </span>
          )}
        </div>

        <div className="msec">Details</div>
        <div>
          {agent.description && (
            <div className="mrow" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 3 }}>
              <span className="mk">Description</span>
              <span style={{ color: 'var(--tx2)', fontSize: 11, lineHeight: 1.45 }}>{agent.description}</span>
            </div>
          )}
          {useCaseNames.length > 0 && (
            <div className="mrow"><span className="mk">Use case</span><span style={{ color: 'var(--tx2)', fontSize: 11 }}>{useCaseNames.join(', ')}</span></div>
          )}
          <div className="mrow"><span className="mk">Owner</span><span>{agent.owner || '—'}</span></div>
          <div className="mrow"><span className="mk">Creator</span><span>{agent.creator || '—'}</span></div>
          {endpointHref && (
            <div className="mrow">
              <span className="mk">Endpoint</span>
              <a
                href={endpointHref}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent)', fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5, wordBreak: 'break-all' }}
                title={endpointHref}
                onClick={(e) => {
                  recordAgentEvent(agent.id, 'endpoint');
                  handleEndpointClick(e, agent.endpoint);
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                {endpointLabel(agent.endpoint)}
              </a>
              {/* Requirement: the system must say WHICH of the two this is —
                  a plain external URL, or a file uploaded to our own repo
                  (which is SSO-gated on download). isLibraryFileUrl() is the
                  existing single source of that distinction, reused not
                  re-derived. */}
              <span style={{ fontSize: 10, color: 'var(--mu)', marginLeft: 6, whiteSpace: 'nowrap' }}>
                {endpointIsOurFile
                  ? `ไฟล์ในระบบ${agent.endpointFile?.name ? ` · ${agent.endpointFile.name}` : ''}`
                  : 'ลิงก์ภายนอก'}
              </span>
            </div>
          )}
          <div className="mrow"><span className="mk">Ability</span><span>{ability || '—'}</span></div>
          {related.length > 0 && (
            <div className="mrow">
              <span className="mk">{type === 'skill' ? 'Agent' : 'Skill'}</span>
              <span style={{ color: type === 'skill' ? 'var(--ag)' : 'var(--sk)', fontSize: 11, fontWeight: 600 }}>{related.join(', ')}</span>
            </div>
          )}
          {type === 'skill' && Array.isArray(agent.compatibleAgents) && agent.compatibleAgents.length > 0 && (
            <div className="mrow">
              <span className="mk">Compatible</span>
              <span style={{ color: 'var(--ag)', fontSize: 11, fontWeight: 600 }}>
                {agent.compatibleAgents
                  .map((id) => (allAgents || []).find((a) => a.id === id)?.agentName)
                  .filter(Boolean)
                  .join(', ')}
              </span>
            </div>
          )}
          <div className="mrow"><span className="mk">Role</span><span>{role || '—'}</span></div>
          <div className="mrow"><span className="mk">Process</span><span style={{ color: 'var(--mu)', fontSize: 11 }}>{process || '—'}</span></div>
          <div className="mrow"><span className="mk">Phase</span>
            <span className="status-pill" style={{ color: sd.color, background: sd.bg }}>
              <span className="status-dot" style={{ background: sd.dot || sd.color }} />
              {sd.lb}
            </span>
          </div>

          {!editing && (
            <div className="mrow"><span className="mk">Launch</span><span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5 }}>{fmtDate(agent.launchDate) || '—'}</span></div>
          )}

          {editing ? (
            <div style={{ marginTop: 8, padding: 10, background: 'var(--sf)', border: '1px solid var(--bd-soft)', borderRadius: 'var(--r-sm)' }}>
              {saveError && <div className="msg error" style={{ marginBottom: 8 }}><span className="dot" style={{ background: '#ea4335' }} />{saveError}</div>}
              <div className="fg" style={{ marginBottom: 8 }}>
                <label>Dev Progress (%) <span className="hint">0-100, สูงสุด 100</span></label>
                <input
                  type="number" min={0} max={100} value={editProgress}
                  onChange={(e) => setEditProgress(e.target.value)}
                />
              </div>
              <div className="fg" style={{ marginBottom: 0 }}>
                <label>
                  Launch Date
                  {Number(editProgress) === 100 && !editLaunch && (
                    <span className="hint">ไม่ระบุ = ใช้วันที่ปรับเป็น 100% อัตโนมัติ</span>
                  )}
                </label>
                <input type="date" value={editLaunch} onChange={(e) => setEditLaunch(e.target.value)} />
              </div>

              {/* The Ready-to-Use gate. Only rendered while actually crossing to
                  100% — an agent moving 40% -> 60% has nothing to publish yet,
                  so demanding a location there would be noise. Hidden entirely
                  once one exists (URL or uploaded file): this is a requirement
                  to HAVE an endpoint, not to retype it every time. */}
              {Number(editProgress) === 100 && !hasEndpoint && (
                <div className="fg" style={{ marginTop: 8, marginBottom: 0 }}>
                  <label>Endpoint <span className="req">*</span> <span className="hint">ต้องมีก่อนจึงจะปรับเป็น 100% ได้</span></label>
                  <input
                    value={editEndpoint}
                    onChange={(e) => setEditEndpoint(e.target.value)}
                    placeholder="https://… ลิงก์เข้าใช้งาน"
                  />
                  <div style={{ fontSize: 10.5, color: 'var(--mu)', marginTop: 4 }}>
                    หรืออัปโหลดไฟล์แทนได้ที่เมนู ☰ → Attach Endpoint File แล้วกลับมาปรับ 100% อีกครั้ง
                  </div>
                </div>
              )}
              {Number(editProgress) === 100 && hasEndpoint && (
                <div style={{ fontSize: 10.5, color: 'var(--mu)', marginTop: 8 }}>
                  {endpointIsOurFile || hasUploadedFile ? 'มีไฟล์แนบในระบบแล้ว' : 'มี Endpoint แล้ว'} — พร้อมปรับเป็น 100%
                </div>
              )}
              {Number(editProgress) === 100 && !mayMarkReady && (
                <div className="msg warn" style={{ marginTop: 8, fontSize: 11 }}>
                  <span className="dot" style={{ background: 'var(--msg-warn-fg)' }} />
                  ต้องเป็น Creator, Approver/Staff ประจำ Area นี้ หรือ Admin จึงจะปรับเป็น 100% ได้
                </div>
              )}

              <div className="btn-group" style={{ marginTop: 10 }}>
                <button className="btn btn-secondary" disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
                <button className="btn btn-success" disabled={saving} onClick={handleSave}>
                  {saving ? 'กำลังบันทึก…' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <div className="mpbw">
              {saveError && <div className="msg error" style={{ marginBottom: 8 }}><span className="dot" style={{ background: '#ea4335' }} />{saveError}</div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10.5, color: 'var(--mu)' }}>
                <span>Progress</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <strong style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{progress}%</strong>
                  {canEdit && (
                    <button className="mi-btn" style={{ width: 20, height: 20 }} title="Update progress" onClick={startEdit}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                  )}
                </span>
              </div>
              <div className="mpb">
                <div className={`mpf ${progressBucket(progress)}`} style={{ width: `${progress}%` }} />
              </div>
              {lockedSubSkill && (
                <div style={{ fontSize: 10.5, color: 'var(--mu)', marginTop: 6 }}>
                  Status และ Progress ของ Skill นี้จะปรับตาม Agent หลัก
                </div>
              )}
              {mayEditThisAgent && !lockedSubSkill && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  {deploymentStatus !== 'none' && (
                    <span className="deploy-badge" style={{ color: DEPLOY_STATUS_COLOR[deploymentStatus], background: `${DEPLOY_STATUS_COLOR[deploymentStatus]}15` }}>
                      {DEPLOY_STATUS_LABEL[deploymentStatus]}
                    </span>
                  )}
                  {canRequestDeploy && (
                    <button
                      className="btn-sm rej"
                      disabled={requesting}
                      onClick={() => setConfirmingDeploy(true)}
                    >
                      {requesting ? 'กำลังส่งคำขอ…' : 'Deployment Request'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Rating & usage (2026-08-18) ──
              A histogram plus raw counts, never a mean: with the library's
              current traffic most entries sit at 0-2 ratings, and `★5.0 (1)` is
              exactly the estimated-looking number SYSTEM-OVERVIEW:353 forbids.
              n=0 says so in words rather than drawing five empty stars.
              Comments are peer-ANONYMOUS by data shape — the /reviews docs
              carry no uid at all (the identified copy lives in /agentRatings,
              readable only by its author and admin). */}
          <div className="msec">Feedback</div>
          <div className="mrow" style={{ alignItems: 'flex-start' }}>
            <span className="mk">Rating</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              {ratingView.kind === 'histogram' ? (
                <span style={{ display: 'block' }}>
                  {ratingView.bars.slice().reverse().map((b) => (
                    <span key={b.star} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                      <span style={{ fontSize: 11, color: 'var(--mu)', width: 22, flexShrink: 0 }}>{b.star}★</span>
                      <span style={{ flex: 1, height: 6, background: 'var(--sf3)', borderRadius: 3, overflow: 'hidden', minWidth: 0 }}>
                        <span style={{ display: 'block', width: `${b.pct}%`, height: '100%', background: 'var(--accent)' }} />
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--mu)', width: 18, textAlign: 'right', flexShrink: 0, fontFamily: "'IBM Plex Mono',monospace" }}>{b.count}</span>
                    </span>
                  ))}
                  <span style={{ fontSize: 11, color: 'var(--mu)' }}>{ratingView.total} reviews</span>
                </span>
              ) : (
                <span style={{ fontSize: 11, color: 'var(--mu2)' }}>No reviews</span>
              )}
            </span>
          </div>
          <div className="mrow">
            <span className="mk">Usage</span>
            <span style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace" }}>
              Opened {liveStats.detailOpens} · Used {liveStats.endpointClicks} · Found in search {liveStats.searchHits}
            </span>
          </div>

          {mayRate && (
            <div className="mrow" style={{ alignItems: 'flex-start' }}>
              <span className="mk">{myRating ? 'Your Rating' : 'Rate'}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                  {STAR_LEVELS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => { setMyRating(n); setRateOpen(true); }}
                      title={`${n} stars`}
                      style={{
                        border: 'none', background: 'none', cursor: 'pointer', padding: 0,
                        fontSize: 19, lineHeight: 1,
                        color: n <= myRating ? 'var(--accent)' : 'var(--bd2)',
                      }}
                    >★</button>
                  ))}
                </span>
                {rateOpen && (
                  <>
                    <textarea
                      rows={2}
                      value={myComment}
                      onChange={(e) => setMyComment(e.target.value)}
                      maxLength={1000}
                      placeholder="Add a comment (optional) — shown anonymously"
                      style={{ width: '100%', fontSize: 11 }}
                    />
                    <span className="btn-row" style={{ marginTop: 6 }}>
                      <button className="btn-sm rej" disabled={rating} onClick={() => setRateOpen(false)}>Cancel</button>
                      <button className="btn-sm appr" disabled={rating || !myRating} onClick={handleSubmitRating}>
                        {rating ? 'Submitting…' : (myRating && reviews.length ? 'Update Rating' : 'Submit Rating')}
                      </button>
                    </span>
                  </>
                )}
              </span>
            </div>
          )}

          {visibleReviews.length > 0 && (
            <div className="mrow" style={{ alignItems: 'flex-start' }}>
              <span className="mk">Comments</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                {visibleReviews.map((r) => (
                  <span key={r.id} style={{ display: 'block', marginBottom: 7, paddingBottom: 7, borderBottom: '1px solid var(--bd-soft)' }}>
                    <span style={{ color: 'var(--accent)', fontSize: 11 }}>{'★'.repeat(r.rating || 0)}</span>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--tx2)', marginTop: 2, lineHeight: 1.55 }}>{r.comment}</span>
                  </span>
                ))}
              </span>
            </div>
          )}
        </div>
      </div>

      {renameOpen && (
        <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && setRenameOpen(false)}>
          <div className="mbox" style={{ padding: 18, maxWidth: 420 }}>
            <button className="mclose" onClick={() => setRenameOpen(false)}>✕</button>
            <h3 style={{ fontSize: 15, marginBottom: 6 }}>ขอเปลี่ยนชื่อ</h3>
            <p style={{ fontSize: 12, color: 'var(--tx2)', lineHeight: 1.6, marginBottom: 12 }}>
              Agent/Skill นี้เผยแพร่แล้ว การเปลี่ยนชื่อต้องได้รับอนุมัติจาก Approver ประจำ Area หรือ Admin ก่อน
              {subSkills.length > 0 && (
                <span style={{ display: 'block', marginTop: 6, color: 'var(--mu)', fontSize: 11 }}>
                  ระบบจะอัปเดตการผูกของ Skill ลูก {subSkills.length} ตัวให้อัตโนมัติเมื่อได้รับอนุมัติ
                </span>
              )}
            </p>
            <div className="fg" style={{ marginBottom: 10 }}>
              <label>ชื่อใหม่</label>
              <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} maxLength={150} />
            </div>
            {renameMsg && (
              <div className="msg info" style={{ fontSize: 11.5, marginBottom: 10 }}>
                <span className="dot" style={{ background: '#4a6fa5' }} />{renameMsg}
              </div>
            )}
            <div className="btn-row">
              <button className="btn-sm rej" disabled={renameBusy} onClick={() => setRenameOpen(false)}>ปิด</button>
              <button className="btn-sm appr" disabled={renameBusy || !renameValue.trim()} onClick={handleRequestRename}>
                {renameBusy ? 'กำลังส่ง…' : 'ส่งคำขอ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmingDeploy && (
        <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && setConfirmingDeploy(false)}>
          <div className="mbox" style={{ padding: 18, maxWidth: 380 }}>
            <button className="mclose" onClick={() => setConfirmingDeploy(false)}>✕</button>
            <h3 style={{ fontSize: 15, marginBottom: 10 }}>ยืนยัน Deployment Request</h3>
            <p style={{ fontSize: 12.5, color: 'var(--tx2)', lineHeight: 1.6, marginBottom: 16 }}>
              Agent/Skill ของท่านผ่านการทดสอบ (กรุณาส่งหลักฐานให้กับ Approver พิจารณา)
              และพร้อมที่จะ Deployment แล้วใช่หรือไม่?
            </p>
            <div className="btn-row">
              <button className="btn-sm rej" onClick={() => setConfirmingDeploy(false)}>No</button>
              <button className="btn-sm appr" onClick={handleRequestDeploy}>Yes</button>
            </div>
          </div>
        </div>
      )}

      {archiveOpen && (
        <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && setArchiveOpen(false)}>
          <div className="mbox" style={{ padding: 18, maxWidth: 460 }}>
            <button className="mclose" onClick={() => setArchiveOpen(false)}>✕</button>
            <h3 style={{ fontSize: 15, marginBottom: 10 }}>Archive ออกจาก Library</h3>
            <p style={{ fontSize: 12.5, color: 'var(--tx2)', lineHeight: 1.6, marginBottom: 14 }}>
              <strong>{agent.agentName}</strong> จะหายจากหน้า Library, การค้นหา, Dashboard และ Timeline
              โดย<strong>ไม่ถูกลบ</strong> — ข้อมูลยังอยู่สำหรับตรวจย้อนหลัง, เตือนความซ้ำซ้อน
              และให้ AI ใช้เป็นข้อมูลประกอบ (แต่จะไม่ถูกแนะนำให้ผู้ใช้)
            </p>

            {subSkills.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                  Skill ที่ผูกกับ Agent นี้ ({subSkills.length})
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--mu)', marginBottom: 8, lineHeight: 1.5 }}>
                  ติ๊กตัวที่ต้องการ<strong>เก็บไว้ใน Library</strong> (เช่น skill ที่ยัง reusable) —
                  ที่ไม่ติ๊กจะถูก archive ไปพร้อมกันทั้งหมด
                </div>
                {subSkills.map((sk) => (
                  <label
                    key={sk.id}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, padding: '5px 0', cursor: 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={keepIds.has(sk.id)}
                      onChange={(e) => setKeepIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(sk.id); else next.delete(sk.id);
                        return next;
                      })}
                      style={{ marginTop: 2 }}
                    />
                    <span>
                      {sk.agentName}
                      {sk.reusable && (
                        <span style={{ color: 'var(--mu)', fontSize: 11 }}> — {sk.reusable}</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}

            <div className="fg" style={{ marginBottom: 14 }}>
              <label>เหตุผล</label>
              <input
                value={archiveReason}
                onChange={(e) => setArchiveReason(e.target.value)}
                placeholder="เช่น ซ้ำกับ X / เจ้าของย้ายทีม / เลิกใช้แล้ว"
              />
              <div style={{ fontSize: 11, color: 'var(--mu)', marginTop: 3 }}>
                AI จะใช้เหตุผลนี้เตือนคนที่กำลังจะสร้างของคล้ายกันในอนาคต
              </div>
            </div>

            {saveError && <div className="msg error" style={{ marginBottom: 10 }}>{saveError}</div>}

            <div className="btn-row">
              <button className="btn-sm rej" disabled={archiving} onClick={() => setArchiveOpen(false)}>ยกเลิก</button>
              <button className="btn-sm appr" disabled={archiving} onClick={handleArchive}>
                {archiving
                  ? 'กำลัง Archive…'
                  : `Archive${subSkills.length ? ` (${1 + subSkills.length - keepIds.size} items)` : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
