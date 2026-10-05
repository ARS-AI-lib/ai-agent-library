import { useEffect, useRef, useState } from 'react';
import { toast } from '../lib/toast';
import { addDoc, collection, doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { getType, getTier, TIER_DEF, isInternalOrExternal } from '../lib/tier';
import { agentStatus, ST_DEF, progressBucket, developmentPhaseLabel, phaseChanged } from '../lib/status';
import { fmtDate, skillsOfAgent, agentsOfSkill, canUpdateProgress, canEditDetails, canEditSDLC, canEditReadyToUseFields, canMarkAgentReady, isMyAgent, pairedSubSkills, cascadeTargets, isPairedSubSkill, normalizeProgress, safeEndpointUrl, endpointLabel, agentUseCaseNames } from '../lib/agentUtils';
import { agentApproveAreas } from '../lib/approveAreas';
import useEscapeKey from '../hooks/useEscapeKey';
import { recordAgentEvent, submitRating } from '../lib/agentEvents';
import { handleEndpointClick, isLibraryFileUrl, markAgentReady, attachEndpointFile, validateUploadFile, formatBytes, listEndpointVersions, downloadEndpointFile, ACCEPT_ATTR, ALLOWED_EXT, MAX_UPLOAD_BYTES } from '../lib/endpointFiles';
import { notifyEvent } from '../lib/notify';
import { readStats, ratingDisplay, canRateAgent, STAR_LEVELS } from '../lib/agentStats';
import { failMsg } from '../lib/copy';
import Hint from './Hint';

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

const DEPLOY_STATUS_LABEL = { requested: 'Deploy requested', approved: 'Deploy approved', rejected: 'Deploy rejected' };
const DEPLOY_STATUS_COLOR = { requested: 'var(--warn)', approved: 'var(--ok)', rejected: 'var(--late)' };

export default function AgentDetailModal({ agent, allAgents, onClose, user, userRole, isAdmin, onEditAgent, approveAreas = [], schema = {} }) {
  const [editing, setEditing] = useState(false);
  const [editProgress, setEditProgress] = useState(0);
  const [editLaunch, setEditLaunch] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [confirmingDeploy, setConfirmingDeploy] = useState(false);
  const [editEndpoint, setEditEndpoint] = useState('');
  const [editFile, setEditFile] = useState(null);
  // Which linked sub-skills this progress update should be shared with
  // (2026-08-20). Holds ids; seeded to every eligible target on each open, so
  // the default behaviour is exactly the previous cascade-everything and a
  // user who ignores the picker sees no change.
  const [cascadePick, setCascadePick] = useState(() => new Set());
  // Endpoint-file version history (2026-08-26). Loaded lazily on open and only
  // when a file actually exists — the callable enforces the viewer set
  // (admin/committee/area-staff/area-approver/creator), so a permission-denied
  // here simply means "not for you" and renders nothing rather than an error.
  const [versions, setVersions] = useState(null);   // null = not loaded / not permitted
  const [versionBusy, setVersionBusy] = useState('');
  const readyFileRef = useRef(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  useEffect(() => {
    if (!moreOpen) return undefined;
    const onDoc = (e) => { if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [moreOpen]);
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

  // File version history. Only fetched when a file exists at all, and a
  // rejection is swallowed on purpose: the callable is the permission
  // boundary, so "not permitted" must render as an absent section rather than
  // an error the viewer can do nothing about.
  const hasFileForHistory = !!agent?.endpointFile?.storagePath;
  useEffect(() => {
    if (!viewedId || !hasFileForHistory) { setVersions(null); return undefined; }
    let alive = true;
    listEndpointVersions(viewedId)
      .then((d) => { if (alive) setVersions(d?.rows || []); })
      .catch(() => { if (alive) setVersions(null); });
    return () => { alive = false; };
  }, [viewedId, hasFileForHistory]);

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
      setSaveError(failMsg('ส่งคะแนน', e));
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

  const related = type === 'skill' ? agentsOfSkill(agent, allAgents) : skillsOfAgent(agent, allAgents);
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
  // Non-reusable = built for one specific purpose, never handed to anyone
  // else — so the Ready-to-Use gate's whole reason (give the next user a way
  // to reach it) does not apply. Locked 2026-09-16: skip the requirement
  // entirely for this reusable tier, both here and in markAgentReady's own
  // check (functions/agentReadyRules.js) — the server must not trust a value
  // it did not itself verify.
  const isNonReusable = agent.reusable === 'Non-reusable';
  // T4 (Enterprise Agent = Agent + External) is exempt too (2026-09-24): the
  // same rule markAgentReady applies server-side in agentReadyRules.js.
  const linkExempt = isNonReusable || tier === 'T4';
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
  // Eligible cascade targets for the progress picker below — same helper the
  // save path uses, so the list shown and the list written can never diverge.
  const cascadeShareTargets = cascadeTargets(agent, allAgents || []);

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
    setEditFile(null);
    setCascadePick(new Set(cascadeTargets(agent, allAgents || []).map((sk) => sk.id)));
    if (readyFileRef.current) readyFileRef.current.value = '';
    setSaveError('');
    setEditing(true);
  }

  async function handleSave() {
    const clamped = Math.max(0, Math.min(100, Math.round(Number(editProgress) || 0)));
    if (clamped > 95 && deploymentStatus !== 'approved') {
      setSaveError('ตั้งค่าเกิน 95% ได้หลัง Deploy ได้รับอนุมัติ (ปุ่ม Request deploy อยู่ใต้แถบ Progress)');
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
      // Either/or, and exactly one of them: a URL typed here, a file picked
      // here, or something already attached from an earlier session.
      // Non-reusable agents/skills are exempt (see isNonReusable above) — a
      // tool built for one specific purpose has no "next user" to hand a
      // location to.
      if (!linkExempt && !hasEndpoint && !editEndpoint.trim() && !editFile) {
        setSaveError('ต้องระบุ Endpoint URL หรืออัปโหลดไฟล์อย่างใดอย่างหนึ่งก่อน จึงจะปรับเป็น 100% ได้');
        return;
      }
      if (editFile) {
        const fileErr = validateUploadFile(editFile);
        if (fileErr) { setSaveError(fileErr); return; }
      }
      setSaving(true);
      setSaveError('');
      try {
        // Upload FIRST when a file was picked. attachEndpointFile writes both
        // `endpoint` and `endpointFile` server-side, so by the time
        // markAgentReady runs its gate the agent already has a location and
        // the transition passes. Both callables share one permission test
        // (checkAgentActor), so anyone allowed to do the second is allowed the
        // first — there is no half-authorised state between them.
        if (editFile) {
          await attachEndpointFile({ agentId: agent.id, file: editFile });
        }
        const parentRes = await markAgentReady({
          agentId: agent.id,
          endpointUrl: editEndpoint.trim() || undefined,
          launchDate: editLaunch || undefined,
        });
        notifyEvent('agent.ready', { agentId: agent.id });

        // Cascade stays here rather than inside the callable so the one correct
        // pairing helper (pairedSubSkills) remains the only implementation —
        // re-deriving it server-side is exactly the drift CLAUDE.md §20 forbids.
        // Each call is independently authorised.
        //
        // The endpoint each sub-skill gets is decided PER SUB-SKILL, and that
        // matters in both directions (2026-08-20):
        //   · checkMarkReady() resolves `supplied || existing`, so passing the
        //     parent's URL blindly would OVERWRITE a sub-skill that has its own
        //     location. Only lend the parent's to one that has nothing.
        //   · When the parent was satisfied by an uploaded FILE there is no URL
        //     to pass at all, so an endpoint-less sub-skill would be rejected by
        //     the gate and silently stall at 95% behind the .catch(). Falling
        //     back to the parent's resolved endpoint keeps the pair in lock-step,
        //     which is exactly what the sub-skill lock promises.
        const parentEndpoint = editEndpoint.trim() || parentRes?.endpoint || '';
        for (const sk of cascadeTargets(agent, allAgents || []).filter((x) => cascadePick.has(x.id))) {
          const skHasOwn = !!String(sk.endpoint || '').trim() || !!sk.endpointFile?.storagePath;
          await markAgentReady({
            agentId: sk.id,
            endpointUrl: skHasOwn ? undefined : (parentEndpoint || undefined),
            launchDate: editLaunch || undefined,
          }).catch(() => {});
        }
        setEditing(false);
        toast(`Saved · ${agent.agentName}`);
      } catch (e) {
        setSaveError(failMsg('ปรับเป็น 100%', e));
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
      // phaseSince per doc: parent and each child can sit in different buckets.
      const withPhase = (d) => (phaseChanged(d.devProgress, clamped) ? { ...patch, phaseSince: serverTimestamp() } : patch);
      await updateDoc(doc(db, 'agents', agent.id), withPhase(agent));
      // Live cascade (2026-07-06): keep paired sub-skills in lock-step with the
      // parent Agent's progress/launch. Only an Agent has sub-skills; a skill
      // never reaches this branch because its own edit button is hidden.
      // cascadeTargets, not pairedSubSkills: a child that is further along
      // than its parent (its own 100%, its own deploy approval) must not be
      // dragged backwards — 18 standalone skills sit at 100% today.
      // ...and then only the ones the user ticked in the picker above.
      for (const sk of cascadeTargets(agent, allAgents || []).filter((x) => cascadePick.has(x.id))) {
        await updateDoc(doc(db, 'agents', sk.id), withPhase(sk));
      }
      setEditing(false);
      toast(`Saved · ${agent.agentName}`);
    } catch (e) {
      setSaveError(failMsg('บันทึก', e));
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
      setSaveError(failMsg('Archive', e));
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
      setSaveError(failMsg('ยกเลิก Archive', e));
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
    if (!next) { setRenameMsg('ระบุชื่อใหม่'); return; }
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
      setRenameMsg(failMsg('ส่งคำขอ', e));
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
      const withPhase = (d) => (phaseChanged(d.devProgress, 95) ? { ...patch, phaseSince: serverTimestamp() } : patch);
      await updateDoc(doc(db, 'agents', agent.id), withPhase(agent));
      // Parent only: the cascade below writes one doc per sub-skill, and a
      // 7-child parent would otherwise produce 8 emails for one request.
      notifyEvent('deploy.requested', { agentId: agent.id });
      // Cascade the deploy request onto the paired sub-skills too, so the
      // approver's single decision on the parent flips the whole package
      // (the skills are filtered out of the approver's deploy queue — the
      // parent represents them). Same createdBy ⇒ the deploy-request rule
      // permits this write.
      // cascadeTargets, not pairedSubSkills: a child that is further along
      // than its parent (its own 100%, its own deploy approval) must not be
      // dragged backwards — 18 standalone skills sit at 100% today.
      for (const sk of cascadeTargets(agent, allAgents || [])) {
        await updateDoc(doc(db, 'agents', sk.id), withPhase(sk));
      }
    } catch (e) {
      setSaveError(failMsg('ขออนุมัติ', e));
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
        {/* V7 board 3 header: what it is (tier · scope · reusable) and the
            actions on one line, the name below. Actions keep their pre-V7
            conditions (mayEditDetails / mayRequestRename / mayArchive). */}
        <div className="v7-dhead">
          <div className="v7-dhead-meta">
            <span className="tier-badge" style={{ color: tierDef.color, background: tierDef.bg, borderColor: tierDef.bd }} title={tierDef.label}>
              {tier} {type === 'agent' ? 'Agent' : 'Skill'}
            </span>
            {agent.reusable && <span className="v7-dhead-scope">{agent.reusable}</span>}
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
          <div className="v7-mactions">
            {mayEditDetails && (
              <button type="button" className="v7-btn-tint" onClick={() => onEditAgent?.(agent)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />
                </svg>
                Edit Details
              </button>
            )}
            {(mayRequestRename || mayArchive || endpointHref) && (
              <div className="v7-more" ref={moreRef}>
                <button type="button" className="v7-btn-outline" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
                  More
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                </button>
                {moreOpen && (
                  <div className="menu v7-menu v7-more-menu" role="menu" aria-label="More actions">
                    {mayRequestRename && (
                      <button type="button" role="menuitem" onClick={() => { setRenameValue(agent.agentName || ''); setRenameMsg(''); setRenameOpen(true); setMoreOpen(false); }}>
                        <span className="v7-mi"><strong>Request Rename</strong><span>ต้องผ่านการอนุมัติ</span></span>
                      </button>
                    )}
                    {endpointHref && (
                      <button type="button" role="menuitem" onClick={() => { window.open(endpointHref, '_blank', 'noopener,noreferrer'); setMoreOpen(false); }}>
                        <span className="v7-mi"><strong>Open Endpoint</strong><span>เปิดในแท็บใหม่</span></span>
                      </button>
                    )}
                    {mayArchive && (
                      <button
                        type="button"
                        role="menuitem"
                        className={isArchived ? '' : 'danger'}
                        disabled={archiving}
                        onClick={() => { setMoreOpen(false); if (isArchived) handleUnarchive(); else setArchiveOpen(true); }}
                      >
                        <span className="v7-mi"><strong>{isArchived ? 'Unarchive' : 'Archive'}</strong><span>{isArchived ? 'นำกลับเข้า Library' : 'ซ่อนจาก Library กู้คืนได้'}</span></span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <h2 className="mtitle v7-dtitle">{agent.agentName}</h2>

        {/* V7 Delivery box — the same progress / deploy UI as before
            (startEdit, cascade picker, Ready-to-Use gate, Deployment Request);
            it just lives in its own box now. Phase + Launch moved in here. */}
        <section className="v7-delivery" aria-label="Delivery">
          <div className="v7-delivery-h">
            <span>Delivery</span>
            <span className="status-pill" style={{ color: sd.color, background: sd.bg }}>
              <span className="status-dot" style={{ background: sd.dot || sd.color }} />
              {sd.lb}
            </span>
            {!editing && <span className="v7-delivery-launch">Launch <strong>{fmtDate(agent.launchDate) || '—'}</strong></span>}
          </div>
          {editing ? (
            <div style={{ marginTop: 8, padding: 10, background: 'var(--sf)', border: '1px solid var(--bd-soft)', borderRadius: 'var(--r-sm)' }}>
              {saveError && <div className="msg error" style={{ marginBottom: 8 }}><span className="dot" style={{ background: '#ea4335' }} />{saveError}</div>}
              <div className="fg" style={{ marginBottom: 8 }}>
                <label>Dev Progress (%) <span className="hint">0-100</span></label>
                <input
                  type="number" min={0} max={100} value={editProgress}
                  onChange={(e) => setEditProgress(e.target.value)}
                />
              </div>
              <div className="fg" style={{ marginBottom: 0 }}>
                <label>
                  Launch Date
                  {Number(editProgress) === 100 && !editLaunch && (
                    <Hint text="หากไม่ระบุ ระบบจะใช้วันที่ปรับเป็น 100% เป็นวัน Launch" />
                  )}
                </label>
                <input type="date" value={editLaunch} onChange={(e) => setEditLaunch(e.target.value)} />
              </div>

              {/* Share-with picker (2026-08-20). The cascade used to be silent
                  and total: saving the parent rewrote every linked sub-skill's
                  progress with no way to see it, let alone opt out. It now
                  lists the eligible targets with everything pre-ticked, so the
                  default is unchanged and the choice is merely visible.
                  The list is cascadeTargets(), NOT pairedSubSkills() — a child
                  already further along than its parent is excluded upstream and
                  must not be offered here either, or ticking it would promise a
                  write the guard is going to refuse. */}
              {cascadeShareTargets.length > 0 && (
                <div className="fg" style={{ marginTop: 8, marginBottom: 0 }}>
                  <label>
                    Share Progress With
                    <Hint text="Skill ที่ผูกกับ Agent นี้ — เลือกเฉพาะรายการที่ต้องการให้ปรับ progress ตาม" />
                  </label>
                  <div style={{ border: '1px solid var(--bd-soft)', borderRadius: 'var(--r-sm)', padding: '4px 2px', maxHeight: 148, overflowY: 'auto' }}>
                    {cascadeShareTargets.map((sk) => (
                      <label
                        key={sk.id}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', fontSize: 11.5, cursor: 'pointer' }}
                      >
                        <input
                          type="checkbox"
                          checked={cascadePick.has(sk.id)}
                          onChange={(e) => setCascadePick((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(sk.id); else next.delete(sk.id);
                            return next;
                          })}
                        />
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {sk.agentName}
                        </span>
                        <span style={{ color: 'var(--mu)', fontFamily: "'IBM Plex Mono',monospace", flexShrink: 0 }}>
                          {normalizeProgress(sk.devProgress)}%
                        </span>
                      </label>
                    ))}
                  </div>
                  {cascadePick.size === 0 && (
                    <div style={{ fontSize: 10.5, color: 'var(--mu)', marginTop: 5 }}>
                      ไม่ได้เลือก Skill — จะปรับเฉพาะ Agent นี้
                    </div>
                  )}
                </div>
              )}

              {/* The Ready-to-Use gate. Only rendered while actually crossing to
                  100% — an agent moving 40% -> 60% has nothing to publish yet,
                  so demanding a location there would be noise. Hidden entirely
                  once one exists (URL or uploaded file): this is a requirement
                  to HAVE an endpoint, not to retype it every time. */}
              {Number(editProgress) === 100 && !hasEndpoint && linkExempt && (
                <div className="msg info" style={{ marginTop: 8, fontSize: 11 }}>
                  <span className="dot" style={{ background: '#4a6fa5' }} />
                  {isNonReusable ? 'Non-reusable' : 'T4 · Enterprise Agent'} — ไม่จำเป็นต้องมี Endpoint หรือไฟล์ก่อนปรับเป็น 100%
                </div>
              )}
              {Number(editProgress) === 100 && !hasEndpoint && !linkExempt && (
                <div className="fg" style={{ marginTop: 8, marginBottom: 0 }}>
                  <label>
                    Endpoint <span className="req">*</span>
                  </label>
                  {/* Either/or, made visible rather than explained: picking one
                      disables the other, so there is never a state where both
                      are filled and the user has to guess which one wins. */}
                  <input
                    value={editEndpoint}
                    onChange={(e) => setEditEndpoint(e.target.value)}
                    disabled={!!editFile}
                    placeholder="https://… link to use"
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0' }}>
                    <span style={{ flex: 1, height: 1, background: 'var(--bd-soft)' }} />
                    <span style={{ fontSize: 10.5, color: 'var(--mu2)' }}>หรือ</span>
                    <span style={{ flex: 1, height: 1, background: 'var(--bd-soft)' }} />
                  </div>
                  {editFile ? (
                    <div className="uef-drop has" style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {editFile.name} · {formatBytes(editFile.size)}
                      </span>
                      <button
                        type="button"
                        className="btn-sm rej"
                        onClick={() => { setEditFile(null); setSaveError(''); if (readyFileRef.current) readyFileRef.current.value = ''; }}
                      >
                        เอาออก
                      </button>
                    </div>
                  ) : (
                    <div
                      className="uef-drop"
                      role="button"
                      tabIndex={0}
                      style={editEndpoint.trim() ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                      onClick={() => !editEndpoint.trim() && readyFileRef.current?.click()}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !editEndpoint.trim() && readyFileRef.current?.click()}
                    >
                      Upload File
                    </div>
                  )}
                  <input
                    ref={readyFileRef}
                    type="file"
                    accept={ACCEPT_ATTR}
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      const err = f ? validateUploadFile(f) : '';
                      setSaveError(err);
                      setEditFile(err ? null : f);
                    }}
                  />
                  <div style={{ fontSize: 11, color: 'var(--mu)', marginTop: 6 }}>
                    File requirements <Hint text={`รองรับ ${ALLOWED_EXT.map((x) => `.${x}`).join(' ')} ขนาดไม่เกิน ${formatBytes(MAX_UPLOAD_BYTES)} — ผู้ดาวน์โหลดต้อง sign in ก่อน`} />
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
                  {saving ? (editFile ? 'Uploading…' : 'Saving…') : 'Save'}
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
              {((canEdit) || (mayEditThisAgent && !lockedSubSkill)) && (
                <div className="v7-delivery-actions">
                  {canEdit && (
                    <button type="button" className="v7-btn-primary-sm" onClick={startEdit}>Update Progress</button>
                  )}
                  {mayEditThisAgent && !lockedSubSkill && deploymentStatus !== 'none' && (
                    <span className="deploy-badge" style={{ color: DEPLOY_STATUS_COLOR[deploymentStatus], background: `color-mix(in srgb, ${DEPLOY_STATUS_COLOR[deploymentStatus]} 9%, transparent)` }}>
                      {DEPLOY_STATUS_LABEL[deploymentStatus]}
                    </span>
                  )}
                  {mayEditThisAgent && !lockedSubSkill && canRequestDeploy && (
                    <button
                      className="v7-btn-outline"
                      disabled={requesting}
                      onClick={() => setConfirmingDeploy(true)}
                    >
                      {requesting ? 'Sending…' : 'Request deploy'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

        </section>

        <div className="msec">Details</div>
        <div className="v7-fields">
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
              {/* "ลิงก์ภายนอก" tag removed entirely (2026-08-26, user
                  request) — the §24/§25 requirement to distinguish our own
                  files from external links stays met by File History existing
                  only on our own uploads; no inline tag needed here anymore. */}
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

        </div>
        {agent.description && <p className="v7-ddesc">{agent.description}</p>}
        <div>
          {/* ── Rating & usage (2026-08-18) ──
              A histogram plus raw counts, never a mean: with the library's
              current traffic most entries sit at 0-2 ratings, and `★5.0 (1)` is
              exactly the estimated-looking number SYSTEM-OVERVIEW:353 forbids.
              n=0 says so in words rather than drawing five empty stars.
              Comments are peer-ANONYMOUS by data shape — the /reviews docs
              carry no uid at all (the identified copy lives in /agentRatings,
              readable only by its author and admin). */}
          {/* ── File history (2026-08-26) ────────────────────────────────
              The log is COMPLETE even though only the newest two versions keep
              their bytes; an evicted row still says who replaced what and when.
              `canDownload` comes from the server per row and folds in the
              narrower admin-or-creator rule for anything that is not current —
              the UI never decides this for itself. */}
          {versions && versions.length > 0 && (
            <>
              <div className="msec">File History</div>
              {versions.map((v) => (
                <div className="mrow" key={v.version} style={{ alignItems: 'flex-start' }}>
                  <span className="mk">v{v.version}{v.isCurrent ? ' · current' : ''}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {/* Keyed on version + date + size, never filename: two
                        versions may legitimately share a name now that a
                        same-name re-upload no longer overwrites. */}
                    <span style={{ display: 'block', color: 'var(--tx2)', fontSize: 11 }}>
                      {v.name} · {formatBytes(v.size)}
                    </span>
                    {/* 2026-08-26: dropped the raw uid fallback here — a
                        Firestore Timestamp also does not survive the callable's
                        JSON transport as a Date, so this line was literally
                        rendering "[object Object] · <uid>" for every legacy
                        row. uploadedAt now arrives pre-converted to millis
                        (see toMillis() in listEndpointVersions); when a real
                        name/email exists it is shown, otherwise just the date. */}
                    <span style={{ display: 'block', color: 'var(--mu)', fontSize: 10.5, marginTop: 2 }}>
                      Uploaded {v.uploadedAt ? fmtDate(v.uploadedAt) : '—'}
                      {(v.uploadedByName || v.uploadedByEmail) && ` · ${v.uploadedByName || v.uploadedByEmail}`}
                      {v.fileDeleted && ' · ไฟล์ถูกลบแล้ว (เก็บเฉพาะ 2 เวอร์ชันล่าสุด)'}
                    </span>
                    {v.canDownload && !v.isCurrent && (
                      <button
                        type="button"
                        className="btn-sm"
                        style={{ marginTop: 5 }}
                        disabled={versionBusy === v.version}
                        onClick={async () => {
                          setVersionBusy(v.version);
                          try { await downloadEndpointFile(agent.id, v.version); } catch (e) {
                            setSaveError(failMsg('ดาวน์โหลด', e));
                          } finally { setVersionBusy(''); }
                        }}
                      >
                        {versionBusy === v.version ? 'Downloading…' : '↓ Download'}
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </>
          )}

          {/* V7 Feedback & Review: histogram (counts, never an average —
              src/lib/agentStats.js), usage line, rate control, review cards.
              Same data and handlers as before; classes instead of inline styles. */}
          <div className="v7-fb-h">
            <h3>Feedback &amp; Review</h3>
            <span>· {ratingView.kind === 'histogram' ? `${ratingView.total} reviews` : 'No reviews yet'}</span>
          </div>
          <div className="v7-fb">
            {ratingView.kind === 'histogram' && (
              <div className="v7-fb-bars">
                {ratingView.bars.slice().reverse().map((b) => (
                  <div key={b.star} className="v7-fb-bar">
                    <span>{b.star}★</span>
                    <span className="v7-fb-track"><span style={{ width: `${b.pct}%` }} /></span>
                    <span className="v7-fb-n">{b.count}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="v7-fb-usage">
              Opened <strong>{liveStats.detailOpens}</strong> · Used <strong>{liveStats.endpointClicks}</strong> · Found in search <strong>{liveStats.searchHits}</strong>
            </div>

            {mayRate && (
              <div className="v7-fb-rate">
                <span className="v7-fb-label">{myRating ? 'Your rating' : 'Rate this'}</span>
                <div className="v7-stars" role="radiogroup" aria-label="Rating">
                  {STAR_LEVELS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={n === myRating}
                      aria-label={`${n} stars`}
                      className={n <= myRating ? 'on' : ''}
                      onClick={() => { setMyRating(n); setRateOpen(true); }}
                    >★</button>
                  ))}
                </div>
                {rateOpen && (
                  <div className="v7-fb-form">
                    <textarea
                      rows={2}
                      value={myComment}
                      onChange={(e) => setMyComment(e.target.value)}
                      maxLength={1000}
                      placeholder="Add a comment (optional) — shown anonymously"
                      aria-label="Comment"
                    />
                    <div className="btn-row">
                      <button className="btn btn-secondary" disabled={rating} onClick={() => setRateOpen(false)}>Cancel</button>
                      <button className="btn btn-primary" disabled={rating || !myRating} onClick={handleSubmitRating}>
                        {rating ? 'Submitting…' : (myRating && reviews.length ? 'Update Rating' : 'Submit Rating')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {visibleReviews.length > 0 && (
              <div className="v7-reviews">
                {visibleReviews.map((r) => (
                  <div key={r.id} className="v7-review">
                    <span className="v7-review-stars" aria-label={`${r.rating || 0} stars`}>{'★'.repeat(r.rating || 0)}</span>
                    <p>{r.comment}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {renameOpen && (
        <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && setRenameOpen(false)}>
          <div className="mbox" style={{ padding: 18, maxWidth: 420 }}>
            <button className="mclose" onClick={() => setRenameOpen(false)}>✕</button>
            <h2 className="mtitle">Request Rename</h2>
            <div className="msub">Approval required <Hint text="Approver ของ area นี้หรือ Admin เป็นผู้อนุมัติชื่อใหม่" /></div>
            <p style={{ fontSize: 12, color: 'var(--tx2)', lineHeight: 1.6, marginBottom: 12 }}>
              Agent/Skill นี้เผยแพร่แล้ว การเปลี่ยนชื่อต้องได้รับอนุมัติจาก Approver ประจำ Area หรือ Admin ก่อน
              {subSkills.length > 0 && (
                <span style={{ display: 'block', marginTop: 6, color: 'var(--mu)', fontSize: 11 }}>
                  เมื่อได้รับอนุมัติ Skill ที่ผูกอยู่ {subSkills.length} รายการจะอัปเดตชื่อโดยอัตโนมัติ
                </span>
              )}
            </p>
            <div className="fg" style={{ marginBottom: 10 }}>
              <label>New Name</label>
              <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} maxLength={150} />
            </div>
            {renameMsg && (
              <div className="msg info" style={{ fontSize: 11.5, marginBottom: 10 }}>
                <span className="dot" style={{ background: '#4a6fa5' }} />{renameMsg}
              </div>
            )}
            <div className="btn-row">
              <button className="btn btn-secondary" disabled={renameBusy} onClick={() => setRenameOpen(false)}>Close</button>
              <button className="btn btn-primary" disabled={renameBusy || !renameValue.trim()} onClick={handleRequestRename}>
                {renameBusy ? 'Sending…' : 'Request Rename'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmingDeploy && (
        <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && setConfirmingDeploy(false)}>
          <div className="mbox" style={{ padding: 18, maxWidth: 380 }}>
            <button className="mclose" onClick={() => setConfirmingDeploy(false)}>✕</button>
            <h2 className="mtitle">Request deploy</h2>
            <div className="msub">Confirm</div>
            <p style={{ fontSize: 12.5, color: 'var(--tx2)', lineHeight: 1.6, marginBottom: 16 }}>
              ยืนยันว่าผ่านการทดสอบและพร้อมเปิดใช้งาน โปรดแนบหลักฐานการทดสอบให้ Approver พิจารณา
            </p>
            <div className="btn-row">
              <button className="btn btn-secondary" onClick={() => setConfirmingDeploy(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleRequestDeploy}>Request deploy</button>
            </div>
          </div>
        </div>
      )}

      {archiveOpen && (
        <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && setArchiveOpen(false)}>
          <div className="mbox" style={{ padding: 18, maxWidth: 460 }}>
            <button className="mclose" onClick={() => setArchiveOpen(false)}>✕</button>
            <h2 className="mtitle">Archive from Library</h2>
            <div className="msub">Hidden from the library, can be restored</div>
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
                  เลือก Skill ที่ต้องการ<strong>เก็บไว้ใน Library</strong> (เช่น skill ที่ยัง reusable) —
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
              <label>Reason</label>
              <input
                value={archiveReason}
                onChange={(e) => setArchiveReason(e.target.value)}
                placeholder="เช่น ซ้ำกับ X / เจ้าของย้ายทีม / เลิกใช้แล้ว"
              />
              <div style={{ fontSize: 11, color: 'var(--mu)', marginTop: 3 }}>
                AI จะใช้เหตุผลนี้แจ้งเตือนผู้ที่ลงทะเบียนรายการที่คล้ายกันในอนาคต
              </div>
            </div>

            {saveError && <div className="msg error" style={{ marginBottom: 10 }}>{saveError}</div>}

            <div className="btn-row">
              <button className="btn btn-secondary" disabled={archiving} onClick={() => setArchiveOpen(false)}>Cancel</button>
              <button className="btn btn-danger" disabled={archiving} onClick={handleArchive}>
                {archiving
                  ? 'Archiving…'
                  : `Archive${subSkills.length ? ` (${1 + subSkills.length - keepIds.size} items)` : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
