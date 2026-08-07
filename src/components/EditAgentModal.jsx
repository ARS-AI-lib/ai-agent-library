import { useEffect, useMemo, useState } from 'react';
import { doc, updateDoc, collection, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { isInternalOrExternal, isSkill } from '../lib/tier';
import { splitRoles, uniq, extractProcessId, processLabel, canUpdateProgress, canEditDetails, canEditSDLC, canEditReadyToUseFields, safeEndpointUrl, agentUseCaseNames } from '../lib/agentUtils';
import { lookupDirectoryNames } from '../lib/directory';
import { reindexAgent } from '../lib/reindex';
import MultiSelect from './MultiSelect';
import TagMultiSelect from './TagMultiSelect';
import AgentMultiSelect from './AgentMultiSelect';
import ComboInput from './ComboInput';
import CreatorPicker from './CreatorPicker';
import useEscapeKey from '../hooks/useEscapeKey';

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
  const lockTierA = !canEditTierA;
  const lockSensitive = lockProgress || !canEditSensitive;
  // Ready-to-Use exception (2026-07-22): only relevant when the general Tier A
  // right is ALREADY blocked (the freeze at deploymentStatus 'approved') — if
  // canEditTierA is true nothing extra is needed, Description/Endpoint are
  // already editable as part of that group.
  const canEditRTU = lockTierA && canEditReadyToUseFields(agent, user, isAdmin);
  const descEndpointLocked = lockTierA && !canEditRTU;
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
    reusable: agent.reusable || '',
    reuseCondition: agent.reuseCondition || '',
    hml: !!agent.hml,
    humanJob: agent.humanJob || '',
    endpoint: agent.endpoint || '',
    launchDate: toDateInputValue(agent.launchDate),
    compatibleAgents: Array.isArray(agent.compatibleAgents) ? agent.compatibleAgents : [],
    sdlcStage: new Set(Array.isArray(agent.sdlcStage) ? agent.sdlcStage : [agent.sdlcStage].filter(Boolean)),
    sdlcProcessMapping: new Set(Array.isArray(agent.sdlcProcessMapping) ? agent.sdlcProcessMapping : [agent.sdlcProcessMapping].filter(Boolean)),
    useCase: new Set(agentUseCaseNames(agent)),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [processes, setProcesses] = useState([]);
  const [useCases, setUseCases] = useState([]);   // full sdlcUseCases docs (processId, name)
  useEscapeKey(onClose);

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
  // Process Mapping is cascaded from the selected Stage(s) via the real
  // stage↔process link in /sdlcProcesses (same rule as PreRegModal).
  const processOptions = useMemo(() => {
    if (form.sdlcStage.size === 0) return [];
    return uniq(processes.filter((p) => form.sdlcStage.has(p.stage)).map(processLabel)).sort();
  }, [processes, form.sdlcStage]);

  // Use Case is scoped to the selected Process Mapping(s) — same join as
  // PreRegModal (sdlcUseCases.processId against each mapping's id prefix).
  // Falls back to every use case when no process is selected yet.
  const useCaseOptions = useMemo(() => {
    if (form.sdlcProcessMapping.size === 0) return uniq(useCases.map((u) => u.name)).sort();
    const selectedIds = new Set([...form.sdlcProcessMapping].map(extractProcessId));
    return uniq(useCases.filter((u) => selectedIds.has(u.processId)).map((u) => u.name)).sort();
  }, [useCases, form.sdlcProcessMapping]);

  // Drop any selected process that no longer belongs to the chosen stages —
  // but ONLY after the catalog has actually loaded. Without this guard, the
  // effect fires on mount while `processes` is still [] (fetch is async), so
  // processOptions is empty and it wipes the agent's pre-existing selection
  // before the real catalog arrives (2026-07 bug: Edit form showed Process
  // Mapping as blank even though the agent had one saved).
  useEffect(() => {
    if (!catalogLoaded) return;
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
  // catalogLoaded guard for the same reason — otherwise this fires before the
  // catalog arrives and wipes the agent's saved Use Case(s) on mount.
  useEffect(() => {
    if (!catalogLoaded) return;
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
    } else if (canEditRTU && !form.description.trim()) {
      setError('กรุณากรอก Description');
      return;
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
          endpoint: safeEndpointUrl(form.endpoint),
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
      if (canEditSDLCFlag) {
        await updateDoc(doc(db, 'agents', agent.id), {
          sdlcStage: isExternal ? [] : [...form.sdlcStage],
          sdlcProcessMapping: isExternal ? [] : [...form.sdlcProcessMapping],
          useCase: isExternal ? [] : [...form.useCase],
          updatedAt: serverTimestamp(),
        });
      }

      // Write 3 — Ready-to-Use exception (2026-07-22): admin/creator touching
      // ONLY description + endpoint on an agent already 'approved'. Mutually
      // exclusive with Write 1 (canEditTierA is false whenever this runs) —
      // its own affectedKeys matches the dedicated rules branch exactly.
      if (canEditRTU) {
        await updateDoc(doc(db, 'agents', agent.id), {
          description: form.description.trim(),
          endpoint: safeEndpointUrl(form.endpoint),
          updatedAt: serverTimestamp(),
        });
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

  const internalShown = form.scope === 'Internal';

  return (
    <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && onClose()}>
      <div className="mbox">
        <button className="mclose" onClick={onClose}>✕</button>
        <div className="mtitle">Edit Details</div>
        <div className="msub">{agent.agentName}</div>

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

        {/* ── Description + Endpoint live OUTSIDE the Tier A fieldset (2026-07-22):
             a disabled <fieldset> forces every descendant control disabled with
             no way to selectively re-enable one — so these two, which admin/
             creator may still touch after Ready to Use, can't live inside it. */}
        {canEditRTU && (
          <div className="msg info" style={{ fontSize: 11 }}>
            <span className="dot" style={{ background: '#4a6fa5' }} />
            Agent/Skill นี้พร้อมใช้งานแล้ว — แก้ไขได้เฉพาะ Description และ Endpoint
          </div>
        )}
        <div className="fg">
          <label>Description <span className="req">*</span></label>
          <textarea rows={3} disabled={descEndpointLocked} value={form.description} onChange={(e) => setField('description', e.target.value)} />
        </div>
        <div className="fg">
          <label>Endpoint</label>
          <input
            disabled={descEndpointLocked}
            value={form.endpoint}
            onChange={(e) => setField('endpoint', e.target.value)}
            placeholder="ลิงก์เข้าใช้งาน Agent หรือลิงก์ดาวน์โหลด Skill (ไม่บังคับ)"
          />
          <div style={{ fontSize: 11, color: 'var(--mu)', marginTop: 3 }}>
            ผู้ใช้กดจากการ์ดไปใช้งานได้ทันที — รองรับเฉพาะ http/https
          </div>
        </div>

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
            <div className="radio-row">
              {[['Internal', 'Internal Use'], ['External', 'Customer Facing']].map(([v, lbl]) => (
                <label key={v}>
                  <input type="radio" name="edit-scope" value={v} checked={form.scope === v} onChange={() => setField('scope', v)} />
                  {lbl}
                </label>
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

        {/* ── SDLC metadata — own edit right (createdBy/staff/approver/admin) ── */}
        {internalShown && (
          <fieldset disabled={!canEditSDLCFlag} style={{ ...FS, opacity: !canEditSDLCFlag ? 0.6 : 1 }}>
            <div className="grid2">
              <div className="fg">
                <label>SDLC Stage</label>
                <MultiSelect label="เลือก SDLC Stage…" options={stageOptions} selected={form.sdlcStage} onChange={(s) => setField('sdlcStage', s)} />
              </div>
              <div className="fg">
                <label>SDLC Process Mapping</label>
                {form.sdlcStage.size === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--mu)', padding: '8px 0' }}>เลือก SDLC Stage ก่อน เพื่อดูรายการ Process ที่ผูกกับ Stage นั้น</div>
                ) : (
                  <MultiSelect label="เลือก Process…" options={processOptions} selected={form.sdlcProcessMapping} onChange={(s) => setField('sdlcProcessMapping', s)} />
                )}
              </div>
            </div>
            <div className="fg">
              <label>Use Case</label>
              <MultiSelect label="เลือก Use Case…" options={useCaseOptions} selected={form.useCase} onChange={(s) => setField('useCase', s)} />
            </div>
          </fieldset>
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

        <div className="btn-group" style={{ marginTop: 12 }}>
          <button className="btn btn-secondary" disabled={saving} onClick={onClose}>Cancel</button>
          <button className="btn btn-success" disabled={saving} onClick={handleSave}>{saving ? 'กำลังบันทึก…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
