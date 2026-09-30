import { useEffect, useMemo, useRef, useState } from 'react';
import { doc, addDoc, updateDoc, collection, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { isInternalOrExternal, isSkill, getType } from '../lib/tier';
import { splitRoles, uniq, pairedSubSkills, childSkillIdList, extractProcessId, processLabel, canUpdateProgress, canEditDetails, canEditSDLC, canEditApproveArea, canEditCategory, canEditOwner, canEditReadyToUseFields, agentUseCaseNames } from '../lib/agentUtils';
import { lookupDirectoryNames } from '../lib/directory';
import { reindexAgent } from '../lib/reindex';
import { AREA_ORDER, agentApproveAreas } from '../lib/approveAreas';
import MultiSelect from './MultiSelect';
import TagMultiSelect from './TagMultiSelect';
import AgentMultiSelect from './AgentMultiSelect';
import ComboInput from './ComboInput';
import CreatorPicker from './CreatorPicker';
import SkillRow, { emptySkillRow, validateSkillRows } from './SkillRow';
import { isInternalToolName } from '../lib/internalTool';
import useCloseGuard from '../hooks/useCloseGuard';

const REUSABLE_OPTIONS = ['Reusable', 'Reusable with Conditions', 'Non-reusable'];
// <fieldset disabled> natively disables every form control inside it — used to
// lock a whole field group for a user who lacks that group's edit right, with
// zero per-component wiring. This resets the browser's default fieldset chrome.
const FS = { border: 0, padding: 0, margin: 0, minInlineSize: 'auto' };

function toDateInputValue(d) {
  if (!d) return '';
  try {
    const dt = d?.toDate ? d.toDate() : new Date(d);
    return isNaN(dt) ? '' : dt.toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

/**
 * Edit an already-approved agent/skill's details (2026-07-03). Three
 * independently-gated field groups (2026-07-xx):
 *   - Tier A details (name/description/scope/ability/role/reusable/hml/input/
 *     output/compatibleAgents): canEditDetails — staff/committee/owner/creator/admin
 *   - Sensitive (creator list, launch date, progress): canUpdateProgress —
 *     admin/owner(createdBy)/creator(email)/approver(approvedBy)
 *   - SDLC (stage/process/useCase): canEditSDLC — createdBy/staff/approver/admin
 * Each group is locked (fieldset disabled) when the user lacks its right, and
 * the save omits any group the user can't edit so the write's affectedKeys
 * matches exactly one firestore.rules branch. All groups also freeze once a
 * deployment request is filed. Type (Agent/Skill) is never editable here.
 */
export default function EditAgentModal({ agent, onClose, onSaved, user, userRole, isAdmin = false, schema = {}, abilityOptions, roleOptions, onAddRelatedRole, lockProgress = false, allAgents = [] }) {
  const canEditTierA = canEditDetails(agent, user, userRole, isAdmin);
  const canEditSensitive = canUpdateProgress(agent, user, isAdmin);
  const canEditSDLCFlag = canEditSDLC(agent, user, userRole, isAdmin);
  // Approve Area: admin/staff only, and only see it — see canEditApproveArea's
  // header comment for why it's narrower than the rest of the SDLC group.
  const canSeeApproveArea = canEditApproveArea(userRole, isAdmin);
  // Category: admin ONLY, and pick-from-list only — see canEditCategory.
  const canSeeCategory = canEditCategory(userRole, isAdmin);
  // Owner: admin ONLY, and only before the card reads "Ready to Use"
  // (devProgress >= 100) — see canEditOwner. Note this is a DIFFERENT gate
  // from isReadyToUseLocked below, which keys off deploymentStatus.
  const canSeeOwner = canEditOwner(isAdmin, agent);
  const lockTierA = !canEditTierA;
  const lockSensitive = lockProgress || !canEditSensitive;
  // Ready-to-Use exception (2026-07-22): only relevant when the general Tier A
  // right is ALREADY blocked (the freeze at deploymentStatus 'approved') — if
  // canEditTierA is true nothing extra is needed, Description/Endpoint are
  // already editable as part of that group.
  const canEditRTU = lockTierA && canEditReadyToUseFields(agent, user, isAdmin);
  // Description is the only field left in this block after Endpoint moved out
  // (2026-08-19), so the name now describes exactly what it gates.
  const descLocked = lockTierA && !canEditRTU;
  // Ready to Use (2026-07-22): once deploymentStatus is 'approved', canEditTierA
  // and canEditSDLCFlag are ALREADY false by construction (see canEditDetails/
  // canEditSDLC) — but canEditSensitive (Tier B: creator/progress/launchDate)
  // never checked deploymentStatus at all, so those stayed editable forever
  // for admin/owner/creator. That's the actual bug: the form kept showing a
  // full Creator picker + Progress + Launch Date after go-live. Rather than
  // patch canUpdateProgress (used elsewhere for the pre-approval 95%-cap rule
  // and by chat/other read paths — narrowing it risks side effects there too),
  // the fix lives here: once approved, collapse the ENTIRE form down to
  // Agent Name (read-only, for context) + Description + Endpoint and hide
  // every other section outright, matching the explicit ask.
  const isReadyToUseLocked = agent?.deploymentStatus === 'approved';

  const [form, setForm] = useState(() => ({
    agentName: agent.agentName || '',
    description: agent.description || '',
    input: agent.input || '',
    output: agent.output || '',
    scope: isInternalOrExternal(agent) === 'External' ? 'External' : 'Internal',
    coreAbility: new Set(Array.isArray(agent.coreAbility) ? agent.coreAbility : [agent.coreAbility].filter(Boolean)),
    relatedRole: new Set(splitRoles(agent.relatedRole)),
    creatorPicks: (Array.isArray(agent.creatorEmails) ? agent.creatorEmails : [])
      .filter(Boolean)
      .map((email) => ({ name: '', email })),
    owner: agent.owner || '',
    reusable: agent.reusable || '',
    reuseCondition: agent.reuseCondition || '',
    hml: !!agent.hml,
    humanJob: agent.humanJob || '',
    launchDate: toDateInputValue(agent.launchDate),
    compatibleAgents: Array.isArray(agent.compatibleAgents) ? agent.compatibleAgents : [],
    sdlcStage: new Set(Array.isArray(agent.sdlcStage) ? agent.sdlcStage : [agent.sdlcStage].filter(Boolean)),
    approveArea: new Set(Array.isArray(agent.approveArea) ? agent.approveArea.filter(Boolean) : []),
    category: new Set(Array.isArray(agent.category) ? agent.category.filter(Boolean) : []),
    sdlcProcessMapping: new Set(Array.isArray(agent.sdlcProcessMapping) ? agent.sdlcProcessMapping : [agent.sdlcProcessMapping].filter(Boolean)),
    useCase: new Set(agentUseCaseNames(agent)),
  }));
  // Did the user actually move Stage / Process in THIS session? The two
  // drop-if-stale effects below only run when they did — see their comments
  // for the saved-data corruption that firing on mount caused.
  const stageTouched = useRef(false);
  const processTouched = useRef(false);
  // ── Type: Agent ⇄ Agent+Skill (2026-08-20) ──
  // Type is DERIVED from having linked children, never stored — aiAgent/skillMd
  // are not touched, so tier cannot move. Skills-only docs have nothing to
  // attach, so the control is Agent-only.
  const canEditType = getType(agent) === 'agent' && canEditTierA;
  const existingChildren = useMemo(
    () => pairedSubSkills(agent, allAgents),
    [agent, allAgents],
  );
  const [skillRows, setSkillRows] = useState(() => existingChildren.map((c, i) => ({
    ...emptySkillRow(`ex-${i}`),
    link: { mode: 'existing', id: c.id },
  })));
  const [typePick, setTypePick] = useState(() => (existingChildren.length ? 'Agent+Skill' : 'Agent'));
  const skillSeqRef = useRef(0);
  function addSkillRow() {
    skillSeqRef.current += 1;
    setSkillRows((r) => [...r, emptySkillRow(`new-${skillSeqRef.current}`)]);
  }
  function removeSkillRow(id) { setSkillRows((r) => r.filter((x) => x._id !== id)); }
  function setSkillRowField(id, k, v) {
    setSkillRows((r) => r.map((x) => (x._id === id ? { ...x, [k]: v } : x)));
  }

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [processes, setProcesses] = useState([]);
  const [useCases, setUseCases] = useState([]);   // full sdlcUseCases docs (processId, name)

  // Load the authoritative SDLC catalogs (same source as PreRegModal) so the
  // Stage/Process/Use Case pickers mirror the New Entry form.
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.all([
      getDocs(collection(db, 'sdlcUseCases')),
      getDocs(collection(db, 'sdlcProcesses')),
    ]).then(([ucSnap, procSnap]) => {
      if (!alive) return;
      setUseCases(ucSnap.docs.map((d) => d.data()).filter((u) => u.name));
      setProcesses(procSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setCatalogLoaded(true);
    }).catch(() => { if (alive) { setUseCases([]); setProcesses([]); setCatalogLoaded(true); } });
    return () => { alive = false; };
  }, []);

  const stageOptions = schema.sdlcStage?.length ? schema.sdlcStage : [];
  const areaOptions = schema.approveArea?.length ? schema.approveArea : AREA_ORDER;
  // Category options come ONLY from /config/schema.category — the curated
  // list. No local fallback and no free-add on purpose: an admin re-files an
  // agent under an existing category, never invents one (see canEditCategory).
  const categoryOptions = schema.category?.length ? schema.category : [];
  // What the agent WOULD resolve to if approveArea were left blank — shown as
  // a hint so an editor can see the automatic answer before overriding it,
  // rather than having to guess what the fallback chain would pick.
  const derivedAreas = useMemo(() => agentApproveAreas({ ...agent, approveArea: [] }), [agent]);
  // Owner suggestions come from the owners already in the library — allAgents
  // is already loaded for pairing/skill linking, so this costs no extra read.
  // Suggestions only: ComboInput still accepts a team name that appears nowhere
  // yet, which is the point (owner is not an enum in /config/schema).
  const ownerOptions = useMemo(
    () => uniq(allAgents.map((a) => (a.owner || '').trim()).filter(Boolean)).sort(),
    [allAgents],
  );

  // Process Mapping is cascaded from the selected Stage(s) via the real
  // stage↔process link in /sdlcProcesses (same rule as PreRegModal).
  const processOptions = useMemo(() => {
    if (form.sdlcStage.size === 0) return [];
    return uniq(processes.filter((p) => form.sdlcStage.has(p.stage)).map(processLabel)).sort();
  }, [processes, form.sdlcStage]);

  // Use Case is scoped to the selected Process Mapping(s) — same join as
  // PreRegModal (sdlcUseCases.processId against each mapping's id prefix).
  // Empty (not "every use case") when no process is selected yet (2026-08-11)
  // — matches PreRegModal's cascade fix; picking Use Case before Process
  // Mapping defeated the whole point of the Stage > Process > Use Case chain.
  const useCaseOptions = useMemo(() => {
    if (form.sdlcProcessMapping.size === 0) return [];
    const selectedIds = new Set([...form.sdlcProcessMapping].map(extractProcessId));
    return uniq(useCases.filter((u) => selectedIds.has(u.processId)).map((u) => u.name)).sort();
  }, [useCases, form.sdlcProcessMapping]);

  // Drop any selected process that no longer belongs to the chosen stages.
  // Gated on stageTouched (2026-08-11) as well as catalogLoaded: this rule is
  // only meant to clean up after the USER changes Stage. Firing it on mount
  // also punished agents whose STORED data is internally inconsistent — e.g.
  // `UX Writer AI Agent` has sdlcStage "Design" but its process 8.2 Copywriting
  // actually belongs to stage "Build", so merely opening the form silently
  // dropped 8.2, which then cascaded into dropping its Use Case as well. The
  // catalogLoaded guard alone couldn't catch that (the catalog HAD loaded; the
  // mismatch is real), so an untouched form must never mutate saved data.
  useEffect(() => {
    if (!catalogLoaded || !stageTouched.current) return;
    setForm((f) => {
      if (f.sdlcProcessMapping.size === 0) return f;
      const valid = new Set(processOptions);
      const kept = new Set([...f.sdlcProcessMapping].filter((p) => valid.has(p)));
      if (kept.size === f.sdlcProcessMapping.size) return f;
      return { ...f, sdlcProcessMapping: kept };
    });
  }, [processOptions]);

  // Same drop-if-stale rule, one level down: a Use Case selection that no
  // longer belongs to the (possibly just-changed) Process Mapping. Same
  // touched-gating as above, for the same reason — a Use Case is only stale if
  // the user actually moved Stage/Process in this session.
  useEffect(() => {
    if (!catalogLoaded || !(stageTouched.current || processTouched.current)) return;
    setForm((f) => {
      if (f.useCase.size === 0) return f;
      const valid = new Set(useCaseOptions);
      const kept = new Set([...f.useCase].filter((u) => valid.has(u)));
      if (kept.size === f.useCase.size) return f;
      return { ...f, useCase: kept };
    });
  }, [useCaseOptions]);

  // Re-hydrate creator chips (loaded from creatorEmails with no name) from the
  // directory cache so `creator` display can be rewritten correctly on save.
  useEffect(() => {
    if (!canEditSensitive) return;
    const emails = (Array.isArray(agent.creatorEmails) ? agent.creatorEmails : []).filter(Boolean);
    if (!emails.length) return;
    let cancelled = false;
    lookupDirectoryNames(emails).then((resolved) => {
      if (cancelled) return;
      const nameByEmail = new Map(resolved.map((r) => [(r.email || '').toLowerCase(), r.name]));
      setForm((f) => ({
        ...f,
        creatorPicks: f.creatorPicks.map((p) => (
          p.name ? p : { ...p, name: nameByEmail.get((p.email || '').toLowerCase()) || '' }
        )),
      }));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [agent.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    // Validate the Tier A required set only when the user can actually edit it
    // (a pure approver-role edits SDLC only and leaves Tier A untouched).
    if (canEditTierA) {
      const agentName = form.agentName.trim();
      if (!agentName || !form.description.trim() || !form.input.trim() || !form.output.trim() || form.coreAbility.size === 0 || form.relatedRole.size === 0 || !form.reusable) {
        setError('กรอกข้อมูลที่จำเป็น (ชื่อ, Description, Input, Output, Core Ability, Related Role, Reusable) ให้ครบ');
        return;
      }
      if (form.reusable === 'Reusable with Conditions' && !form.reuseCondition.trim()) {
        setError('กรุณาระบุ Reuse Conditions');
        return;
      }
    }
    if (!canEditTierA && canEditRTU && !form.description.trim()) {
      setError('กรุณากรอก Description');
      return;
    }
    if (canEditType && typePick === 'Agent+Skill') {
      const skErr = validateSkillRows(skillRows, allAgents);
      if (skErr) { setError(skErr); return; }
    }
    setSaving(true);
    setError('');
    try {
      const isExternal = form.scope === 'External';

      // Write 1 — Tier A (+ sensitive) fields. Skipped entirely for a user who
      // can only edit SDLC, so its affectedKeys never leaks into the SDLC rule
      // branch. The sensitive sub-blocks are included only when permitted.
      if (canEditTierA) {
        await updateDoc(doc(db, 'agents', agent.id), {
          agentName: form.agentName.trim(),
          description: form.description.trim(),
          input: form.input.trim(),
          output: form.output.trim(),
          compatibleAgents: form.compatibleAgents,
          coreAbility: [...form.coreAbility],
          relatedRole: [...form.relatedRole],
          customerFacing: isExternal,
          internalUse: !isExternal,
          reusable: form.reusable,
          reuseCondition: form.reusable === 'Reusable with Conditions' ? form.reuseCondition.trim() : '',
          hml: form.hml,
          humanJob: form.hml ? form.humanJob.trim() : '',
          // Sanitised on write, same as pre-registration — never store a
          // scheme we would refuse to render.
          // Sensitive: creator list — writes `creator` display alongside
          // creatorEmails so the card/detail reflect new names immediately.
          ...(canEditSensitive ? {
            creatorEmails: [
              ...new Map(form.creatorPicks.map((p) => p.email).filter(Boolean).map((e) => [e.toLowerCase(), e])).values(),
            ],
            creator: form.creatorPicks.map((p) => (p.name || p.email)).filter(Boolean).join(', '),
          } : {}),
          // Sensitive: launch date only — locked for a paired sub-skill
          // (cascades from parent) or when the user lacks sensitive rights.
          // devProgress/developmentPhase are deliberately NOT written here
          // (2026-08-06): progress belongs to the dedicated update flow that
          // enforces the 95% ceiling and the deploy-approval gate. Sending it
          // from this form could only ever match the rules by accident, and
          // when it didn't the user got an unattributable permission error.
          ...(lockSensitive ? {} : {
            launchDate: form.launchDate ? new Date(form.launchDate) : null,
          }),
          updatedAt: serverTimestamp(),
        });
      }

      // Write 2 — SDLC metadata (separate write ⇒ its own affectedKeys, matching
      // the dedicated sdlc rule branch: createdBy/staff/approver/admin).
      // 2026-08-11: these three used to be written as `isExternal ? [] : ...`,
      // which SILENTLY DESTROYED an External agent's SDLC data on any save —
      // even a save that only touched the description — while the form hid the
      // fields so nobody could see it happen or put them back. Two live agents
      // were sitting on that landmine (UX Writer AI Agent, Social Listening).
      // Scope answers "who consumes this agent"; SDLC answers "which dev
      // process does it perform". They're independent, so scope no longer
      // erases the other.
      if (canEditSDLCFlag) {
        await updateDoc(doc(db, 'agents', agent.id), {
          sdlcStage: [...form.sdlcStage],
          sdlcProcessMapping: [...form.sdlcProcessMapping],
          useCase: [...form.useCase],
          updatedAt: serverTimestamp(),
        });
      }

      // Write 2b — Approve Area (2026-08-11): its OWN write, staff/admin only
      // per canEditApproveArea/firestore.rules — bundling it into Write 2
      // above would send 'approveArea' in affectedKeys for an approver or
      // createdBy edit too (they share canEditSDLCFlag), which the narrower
      // rule branch now rejects. Not blanked for External — unlike the SDLC
      // fields above, an External agent still needs a routable approver area
      // (that's the whole point of replacing the old 'Business' catch-all).
      if (canSeeApproveArea && canEditSDLCFlag) {
        await updateDoc(doc(db, 'agents', agent.id), {
          approveArea: [...form.approveArea],
          updatedAt: serverTimestamp(),
        });
      }

      // Write 2c — Category (2026-08-17): admin only, its own write for the
      // same affectedKeys reason as 2b. `category` was removed from the Tier A
      // and Tier B rule branches in the same change, so only the blanket
      // isAdmin() branch can carry this — which is exactly the intent.
      if (canSeeCategory) {
        await updateDoc(doc(db, 'agents', agent.id), {
          category: [...form.category],
          updatedAt: serverTimestamp(),
        });
      }

      // Write 2d — Owner (2026-09-23): admin only, and only while the agent is
      // not yet at 100% (canEditOwner). Its own updateDoc for the same
      // affectedKeys reason as 2b/2c — `owner` appears in no hasOnly() list in
      // firestore.rules, so bundling it into any other write would poison that
      // write's branch and fail the whole save. It rides the blanket isAdmin()
      // branch instead, which needs no rules change.
      //
      // Fired only on a real change: an unchanged owner would otherwise bump
      // updatedAt on every save, and activeReview()-style staleness checks
      // elsewhere read updatedAt.
      const ownerNext = form.owner.trim();
      if (canSeeOwner && ownerNext !== (agent.owner || '')) {
        await updateDoc(doc(db, 'agents', agent.id), {
          owner: ownerNext,
          updatedAt: serverTimestamp(),
        });
      }

      // Write 3 — Ready-to-Use exception (2026-07-22): admin/creator touching
      // ONLY description on an agent already 'approved'. Mutually
      // exclusive with Write 1 (canEditTierA is false whenever this runs) —
      // its own affectedKeys matches the dedicated rules branch exactly.
      if (canEditRTU) {
        await updateDoc(doc(db, 'agents', agent.id), {
          description: form.description.trim(),
          updatedAt: serverTimestamp(),
        });
      }

      // Write 4 — Type / child-skill links (2026-08-20). Its OWN updateDoc so
      // affectedKeys stays ['childSkillIds','updatedAt'] and matches the rules
      // branch, same reason as Write 2b/2c. Switching back to Agent only
      // UNLINKS: every skill doc is left exactly as it is, because a skill is
      // an independent library entry that other agents may also depend on.
      if (canEditType) {
        const childIds = [];
        if (typePick === 'Agent+Skill') {
          for (const s of skillRows) {
            if (s.link?.mode === 'existing') { childIds.push(s.link.id); continue; }
            const sName = s.link.name.trim();
            const sExternal = s.scope === 'External';
            // A skill created here enters the approval queue like any other
            // submission — firestore.rules' create branch has no admin
            // exemption and demands approvalStatus 'pending'.
            const ref = await addDoc(collection(db, 'agents'), {
              agentName: sName,
              description: s.description.trim(),
              aiAgent: false,
              skillMd: true,
              owner: agent.owner || '',
              coreAbility: [...s.ability],
              relatedRole: [...s.relatedRole],
              customerFacing: sExternal,
              internalUse: !sExternal,
              internalTool: isInternalToolName(sName),
              reusable: s.reusable,
              reuseCondition: s.reusable === 'Reusable with Conditions' ? s.reuseCondition.trim() : '',
              hml: s.hml,
              humanJob: s.hml ? s.humanJob.trim() : '',
              tool: agent.tool || '',
              llm: agent.llm || '',
              dataPrivacy: agent.dataPrivacy || '',
              sdlcStage: Array.isArray(agent.sdlcStage) ? agent.sdlcStage : [],
              sdlcProcessMapping: Array.isArray(agent.sdlcProcessMapping) ? agent.sdlcProcessMapping : [],
              useCase: agentUseCaseNames(agent),
              category: Array.isArray(agent.category) ? agent.category : [],
              input: s.input.trim(),
              output: s.output.trim(),
              businessValue: agent.businessValue || '',
              matchingAgent: form.agentName.trim() || agent.agentName,
              analysisResult: null,
              developmentPhase: 'To Do',
              devProgress: 0,
              deploymentStatus: 'none',
              launchDate: null,
              approvalStatus: 'pending',
              approvedBy: '',
              creator: agent.creator || '',
              creatorEmails: Array.isArray(agent.creatorEmails) ? agent.creatorEmails : [],
              createdBy: user?.uid || '',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            childIds.push(ref.id);
            reindexAgent(ref.id);
          }
        }
        const before = childSkillIdList(agent);
        const changed = before.length !== childIds.length || before.some((id, i) => id !== childIds[i]);
        if (changed) {
          await updateDoc(doc(db, 'agents', agent.id), { childSkillIds: childIds, updatedAt: serverTimestamp() });
        }
      }

      // One reindex after ALL the conditional writes above — the searchable
      // text may have moved (name/description/input/output/ability/role/use
      // case), and the index has to follow or search silently ranks on stale
      // wording. Fire-and-forget: never let this fail or delay a save.
      reindexAgent(agent.id);

      onSaved?.();
      onClose();
    } catch (e) {
      setError(e.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  // Only ✕ / Cancel / Escape close this form, with a discard prompt if
  // anything changed (2026-09-30) — a stray backdrop click used to wipe it.
  const { requestClose, arm, confirmDialog } = useCloseGuard([form, skillRows, typePick], onClose);

  return (
    <div className="mov open">
      {/* .grid2 (Input/Output side by side) needs real width — the plain
          480px .mbox this used to sit in (sized for mockup's simple
          single-column example) squeezed those two columns down to the
          point of feeling cramped. .mbox.wide matches PreRegModal, which has
          the same kind of two-column content. */}
      <div className="mbox wide" onPointerDownCapture={arm} onKeyDownCapture={arm}>
        <button className="mclose" onClick={requestClose}>✕</button>
        <div className="m-head">
          <div className="m-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
          </div>
          <div>
            <h2 className="mtitle">Edit Details</h2>
            <p>{agent.agentName}</p>
          </div>
        </div>

        {error && <div className="msg error"><span className="dot" style={{ background: '#ea4335' }} />{error}</div>}

        {/* ── Agent Name is always the first field (2026-07-22) — rendered here,
             OUTSIDE the Tier A fieldset, so it stays first in the form even
             though Description/Endpoint (right below) also live outside that
             fieldset. disabled tracks lockTierA directly: whenever the form is
             Ready-to-Use-locked, lockTierA is already true by construction
             (canEditDetails returns false once deploymentStatus is 'approved'),
             so this single flag correctly covers both "read-only after Ready
             to Use" and "no Tier A rights at all" without a separate check. */}
        <div className="fg">
          <label>Agent / Skill Name <span className="req">*</span></label>
          <input disabled={lockTierA} value={form.agentName} onChange={(e) => setField('agentName', e.target.value)} />
        </div>

        {/* ── Type (2026-08-20): Agent+Skill means "an Agent that calls skills",
             i.e. parent + linked child skill docs. It is derived from those
             links, so switching here never touches aiAgent/skillMd and never
             moves the Tier. ── */}
        {canEditType && (
          <div className="fg">
            <label>Type</label>
            <div className="toggle2" role="radiogroup" aria-label="Type">
              {['Agent', 'Agent+Skill'].map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={typePick === t}
                  className={typePick === t ? 'sel' : ''}
                  onClick={() => {
                    setTypePick(t);
                    // Default one blank row in immediately, same as the New form.
                    if (t === 'Agent+Skill' && skillRows.length === 0) addSkillRow();
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
            {typePick === 'Agent' && existingChildren.length > 0 && (
              <div className="msg info" style={{ fontSize: 11, marginTop: 6 }}>
                <span className="dot" style={{ background: '#4a6fa5' }} />
                จะยกเลิกการผูก {existingChildren.length} Skill — ตัว Skill ยังอยู่ในไลบรารีตามเดิม ไม่ถูกลบ
              </div>
            )}
          </div>
        )}

        {canEditType && typePick === 'Agent+Skill' && (
          <div style={{ marginTop: 6, padding: '12px 14px', border: '1px solid var(--bd-soft)', borderRadius: 'var(--r-md)', background: 'var(--sf2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>Cascade Skills</div>
              <button type="button" className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: 12, whiteSpace: 'nowrap' }} onClick={addSkillRow}>+ Add Skill</button>
            </div>
            {skillRows.map((s, idx) => (
              <SkillRow
                key={s._id}
                skill={s}
                index={idx}
                onField={(k, v) => setSkillRowField(s._id, k, v)}
                onRemove={() => removeSkillRow(s._id)}
                canRemove={skillRows.length > 1}
                allAgents={allAgents}
                excludeIds={[agent.id, ...skillRows.filter((x) => x._id !== s._id && x.link?.mode === 'existing').map((x) => x.link.id)]}
                abilityOptions={abilityOptions}
                roleOptions={roleOptions}
                onAddRelatedRole={onAddRelatedRole}
              />
            ))}
          </div>
        )}

        {/* ── Description + Endpoint live OUTSIDE the Tier A fieldset (2026-07-22):
             a disabled <fieldset> forces every descendant control disabled with
             no way to selectively re-enable one — so these two, which admin/
             creator may still touch after Ready to Use, can't live inside it. */}
        {canEditRTU && (
          <div className="msg info" style={{ fontSize: 11 }}>
            <span className="dot" style={{ background: '#4a6fa5' }} />
            Agent/Skill นี้พร้อมใช้งานแล้ว — แก้ไขได้เฉพาะ Description
            (Endpoint/ไฟล์แนบแก้ผ่านปุ่มใน Agent Detail, ชื่อต้องขออนุมัติ)
          </div>
        )}
        <div className="fg">
          <label>Description <span className="req">*</span></label>
          <textarea rows={3} disabled={descLocked} value={form.description} onChange={(e) => setField('description', e.target.value)} />
        </div>
        {/* Endpoint input removed 2026-08-19. It is now set at the moment it
            matters — the transition to 100% (markAgentReady, which refuses to
            declare an agent Ready-to-Use without one) — and edited afterwards
            from Agent Detail, where the same permission set applies (creator,
            area approver/staff, admin) instead of this form's narrower one. */}

        {/* ── Everything else: Tier A (minus Name, moved above), SDLC,
             Creator/Team, Progress/Launch —
             hidden entirely once Ready to Use (deploymentStatus 'approved'),
             not just disabled. See isReadyToUseLocked above. */}
        {!isReadyToUseLocked && (
        <>
        {/* ── Tier A details — locked as one group for a user without detail rights ── */}
        <fieldset disabled={lockTierA} style={{ ...FS, opacity: lockTierA ? 0.6 : 1 }}>
          {lockTierA && !canEditRTU && (
            <div className="msg info" style={{ fontSize: 11 }}>
              <span className="dot" style={{ background: '#4a6fa5' }} />
              คุณมีสิทธิ์แก้ไขเฉพาะ SDLC (Stage / Process / Use Case) เท่านั้น
            </div>
          )}
          <div className="fg">
            <label>Scope <span className="req">*</span></label>
            <div className="toggle2" role="radiogroup" aria-label="Scope">
              {[['Internal', 'Internal Use'], ['External', 'Customer Facing']].map(([v, lbl]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={form.scope === v}
                  className={form.scope === v ? 'sel' : ''}
                  onClick={() => setField('scope', v)}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <div className="grid2">
            <div className="fg">
              <label>Input <span className="req">*</span></label>
              <textarea rows={2} value={form.input} onChange={(e) => setField('input', e.target.value)} placeholder="ข้อมูลที่ Agent/Skill รับ" />
            </div>
            <div className="fg">
              <label>Output <span className="req">*</span></label>
              <textarea rows={2} value={form.output} onChange={(e) => setField('output', e.target.value)} placeholder="ผลลัพธ์ที่สร้าง" />
            </div>
          </div>

          {isSkill(agent) && (
            <div className="fg">
              <label>Compatible Agents <span style={{ fontWeight: 400, color: 'var(--mu)' }}>(optional)</span></label>
              <AgentMultiSelect
                label="เลือก Agent ที่ใช้ร่วมกันได้..."
                agents={allAgents}
                excludeId={agent.id}
                selected={new Set(form.compatibleAgents)}
                onChange={(s) => setField('compatibleAgents', [...s])}
              />
            </div>
          )}

          <div className="grid2">
            <div className="fg">
              <label>Core Ability <span className="req">*</span></label>
              <MultiSelect label="เลือก Core Ability…" options={abilityOptions} selected={form.coreAbility} onChange={(s) => setField('coreAbility', s)} />
            </div>
            <div className="fg">
              <label>Related Role <span className="req">*</span></label>
              <TagMultiSelect label="เลือก Related Role…" options={roleOptions} selected={form.relatedRole} onChange={(s) => setField('relatedRole', s)} onAddNew={onAddRelatedRole} />
            </div>
          </div>

          <div className="grid2">
            <div className="fg">
              <label>Reusable <span className="req">*</span></label>
              <ComboInput value={form.reusable} onChange={(v) => setField('reusable', v)} options={REUSABLE_OPTIONS} placeholder="— เลือก —" readOnly />
            </div>
            {form.reusable === 'Reusable with Conditions' && (
              <div className="fg">
                <label>Reuse Conditions <span className="req">*</span></label>
                <input value={form.reuseCondition} onChange={(e) => setField('reuseCondition', e.target.value)} placeholder="เงื่อนไขในการนำกลับมาใช้" />
              </div>
            )}
          </div>

          <div className="fg">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <input type="checkbox" checked={form.hml} onChange={(e) => setField('hml', e.target.checked)} />
              HML (Human-in-the-Loop)
            </label>
          </div>
          {form.hml && (
            <div className="fg">
              <label>Human Job <span className="req">*</span></label>
              <input value={form.humanJob} onChange={(e) => setField('humanJob', e.target.value)} placeholder="หน้าที่ของ Human ใน loop" />
            </div>
          )}

        </fieldset>

        {/* ── SDLC metadata — own edit right (createdBy/staff/approver/admin) ──
             NOT hidden for External any more (2026-08-11). Scope (who consumes
             the agent) and SDLC participation (which dev process it performs)
             are orthogonal: `UX Writer AI Agent` is scoped External yet
             genuinely performs process 8.2 Copywriting. Hiding the group for
             External meant its owner could neither see nor repair those
             fields, while handleSave silently blanked them on the next save —
             see the isExternal note in Write 2. */}
        <fieldset disabled={!canEditSDLCFlag} style={{ ...FS, opacity: !canEditSDLCFlag ? 0.6 : 1 }}>
            <div className="grid2">
              <div className="fg">
                <label>SDLC Stage</label>
                <MultiSelect label="เลือก SDLC Stage…" options={stageOptions} selected={form.sdlcStage} onChange={(s) => { stageTouched.current = true; setField('sdlcStage', s); }} />
              </div>
              <div className="fg">
                <label>SDLC Process Mapping</label>
                {form.sdlcStage.size === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--mu)', padding: '8px 0' }}>เลือก SDLC Stage ก่อน เพื่อดูรายการ Process ที่ผูกกับ Stage นั้น</div>
                ) : (
                  <MultiSelect label="เลือก Process…" options={processOptions} selected={form.sdlcProcessMapping} onChange={(s) => { processTouched.current = true; setField('sdlcProcessMapping', s); }} />
                )}
              </div>
            </div>
            <div className="fg">
              <label>Use Case</label>
              {form.sdlcProcessMapping.size === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--mu)', padding: '8px 0' }}>เลือก SDLC Process Mapping ก่อน เพื่อดูรายการ Use Case ที่ผูกกับ Process นั้น</div>
              ) : (
                <MultiSelect label="เลือก Use Case…" options={useCaseOptions} selected={form.useCase} onChange={(s) => setField('useCase', s)} />
              )}
            </div>
          </fieldset>

        {/* ── Approver area ──
            External agents need a routable area too (they used to get the
            single catch-all 'Business'). Visibility is admin/staff ONLY
            (2026-08-11,
            canEditApproveArea) — narrower than the rest of the SDLC block,
            which also lets approver/createdBy edit sdlcStage etc. Approve
            Area decides who gets to approve/deploy this very agent, so an
            approver or the submitter self-assigning it would be a routing
            self-serve bug, not just an odd permission. Still shares the SDLC
            group's deploy-freeze (canEditSDLCFlag, via canEditSDLC's
            requested/approved check) for the disabled state. Leaving it empty
            is safe and normal: the resolver falls back to process/category/
            role, and the hint below shows exactly what that fallback produces. */}
        {canSeeApproveArea && (
          <fieldset disabled={!canEditSDLCFlag} style={{ ...FS, opacity: !canEditSDLCFlag ? 0.6 : 1 }}>
            <div className="fg">
              <label>Approve Area</label>
              <MultiSelect label="เลือก Approve Area…" options={areaOptions} selected={form.approveArea} onChange={(s) => setField('approveArea', s)} />
              {form.approveArea.size === 0 && (
                <div style={{ fontSize: 10.5, color: 'var(--mu)', marginTop: 5, lineHeight: 1.5 }}>
                  เว้นว่างได้ ระบบจะใช้: {derivedAreas.join(' + ') || '(คำนวณไม่ได้ — ควรเลือกเอง)'}
                </div>
              )}
            </div>
          </fieldset>
        )}

        {/* ── Category (2026-08-17) — admin ONLY ──
            Normally AI-assigned at submit and never hand-typed, so this is a
            correction tool, not a data-entry field. MultiSelect (pick from the
            curated list) rather than TagMultiSelect (free-add) is the whole
            point: an admin may re-file an agent under an EXISTING category but
            cannot invent a name — new names still come only from the AI's
            proposed_new_category -> CategoryApprovalPanel flow.
            NOT inside the SDLC deploy-freeze: a mis-filed agent should stay
            fixable after go-live, and category affects browse + approver
            routing, not the deploy record. */}
        {canSeeCategory && (
          <div className="fg">
            <label>Category</label>
            <MultiSelect label="เลือก Category…" options={categoryOptions} selected={form.category} onChange={(s) => setField('category', s)} />
          </div>
        )}

        {/* ── Owner (2026-09-23) — admin only, and only while the agent has not
            reached 100%. Unlike Category this is a ComboInput, not a
            MultiSelect: owner is free text and has never lived in
            /config/schema, so the dropdown is a convenience over names already
            in use (from allAgents, already loaded — no extra query) while a
            genuinely new team name stays typable. Changing it is cosmetic for
            pairing/cascade: sameSubmitter() reads createdBy/creator, never
            owner. */}
        {canSeeOwner && (
          <div className="fg">
            <label>Owner</label>
            <ComboInput
              value={form.owner}
              onChange={(v) => setField('owner', v)}
              options={ownerOptions}
              placeholder="ชื่อทีมที่ดูแล…"
            />
          </div>
        )}

        {/* ── Sensitive: creator list ── */}
        <div className="fg">
          <label>Creator / Team member <span className="hint">(รายชื่อสมาชิกในทีม / ชื่อ Key contact หลัก)</span></label>
          {canEditSensitive ? (
            <CreatorPicker selected={form.creatorPicks} onChange={(v) => setField('creatorPicks', v)} placeholder="พิมพ์ชื่อหรืออีเมล…" />
          ) : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {form.creatorPicks.length === 0 && <span style={{ fontSize: 12, color: 'var(--mu)' }}>—</span>}
                {form.creatorPicks.map((p) => (
                  <span key={p.email} style={{ display: 'inline-flex', alignItems: 'center', background: 'var(--sf2)', borderRadius: 20, padding: '3px 11px', fontSize: 11.5 }}>
                    {p.name ? `${p.name} (${p.email})` : p.email}
                  </span>
                ))}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--mu)', marginTop: 4 }}>แก้ไขรายชื่อ Creator ได้เฉพาะ admin, owner และ creator</div>
            </>
          )}
        </div>

        {/* ── Sensitive: progress / launch ── */}
        {lockProgress ? (
          <div className="msg info" style={{ fontSize: 11 }}>
            <span className="dot" style={{ background: '#4a6fa5' }} />
            Status และ Progress ของ Skill นี้จะปรับตาม Agent หลัก
          </div>
        ) : !canEditSensitive ? (
          <div className="msg info" style={{ fontSize: 11 }}>
            <span className="dot" style={{ background: '#4a6fa5' }} />
            Progress และ Launch Date แก้ไขได้เฉพาะ admin, owner และ creator
          </div>
        ) : (
          // Dev Progress is deliberately NOT editable here (2026-08-06).
          // Progress has its own dedicated update flow in AgentDetailModal,
          // which enforces the 95% ceiling and routes anything past it through
          // the deploy-approval request. Offering a free-text % box here let a
          // creator type 100 and hit a raw "Missing or insufficient
          // permissions" from firestore.rules — technically correct (the rule
          // caps devProgress at 95 until deployment is approved) but with no
          // way for the user to tell which field caused it. Removing the input
          // removes the trap; the write below no longer sends devProgress or
          // developmentPhase at all.
          <div className="fg">
            <label>Launch Date</label>
            <input type="date" value={form.launchDate} onChange={(e) => setField('launchDate', e.target.value)} />
          </div>
        )}
        </>
        )}

        <div className="btn-row" style={{ marginTop: 12 }}>
          <button className="btn-sm rej" disabled={saving} onClick={requestClose}>Cancel</button>
          <button className="btn-sm appr" disabled={saving} onClick={handleSave}>{saving ? 'กำลังบันทึก…' : 'Save Changes'}</button>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
