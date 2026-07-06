import { useState } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { isInternalOrExternal } from '../lib/tier';
import { developmentPhaseLabel } from '../lib/status';
import { splitRoles } from '../lib/agentUtils';
import MultiSelect from './MultiSelect';
import TagMultiSelect from './TagMultiSelect';
import CreatorPicker from './CreatorPicker';

const REUSABLE_OPTIONS = ['Reusable', 'Reusable with Conditions', 'Non-reusable'];

function toDateInputValue(d) {
  if (!d) return '';
  try {
    const dt = d?.toDate ? d.toDate() : new Date(d);
    return isNaN(dt) ? '' : dt.toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

function progressNum(agent) {
  const raw = agent?.devProgress;
  const num = typeof raw === 'number' ? raw : parseInt(String(raw || '').replace('%', ''), 10);
  return isNaN(num) ? 0 : num;
}

/**
 * Edit an already-approved agent/skill's details (2026-07-03 feature) — a
 * broader field set than AgentDetailModal's inline progress/launch-date
 * editor. Gated by canEditDetails() (creatorEmails or admin, locked the
 * moment a deployment request is filed — no admin bypass) both here and in
 * firestore.rules.
 *
 * Type (Agent/Skill) is NOT editable here — locked permanently once
 * approved. Adding a new paired sub-skill is also NOT part of this form —
 * that's what "New Entry" (PreRegModal) is for; this modal only edits the
 * ONE existing doc it was opened for.
 */
export default function EditAgentModal({ agent, onClose, onSaved, user, abilityOptions, roleOptions, onAddRelatedRole, lockProgress = false }) {
  const [form, setForm] = useState(() => ({
    agentName: agent.agentName || '',
    description: agent.description || '',
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
    launchDate: toDateInputValue(agent.launchDate),
    devProgress: progressNum(agent),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    const agentName = form.agentName.trim();
    if (!agentName || !form.description.trim() || form.coreAbility.size === 0 || form.relatedRole.size === 0 || !form.reusable) {
      setError('กรอกข้อมูลที่จำเป็น (ชื่อ, Description, Core Ability, Related Role, Reusable) ให้ครบ');
      return;
    }
    if (form.reusable === 'Reusable with Conditions' && !form.reuseCondition.trim()) {
      setError('กรุณาระบุ Reuse Conditions');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const isExternal = form.scope === 'External';
      const clampedProgress = Math.max(0, Math.min(100, Math.round(Number(form.devProgress) || 0)));
      const creatorEmails = [
        ...new Map(form.creatorPicks.map((p) => p.email).filter(Boolean).map((e) => [e.toLowerCase(), e])).values(),
      ];

      await updateDoc(doc(db, 'agents', agent.id), {
        agentName,
        description: form.description.trim(),
        coreAbility: [...form.coreAbility],
        relatedRole: [...form.relatedRole],
        customerFacing: isExternal,
        internalUse: !isExternal,
        creatorEmails,
        reusable: form.reusable,
        reuseCondition: form.reusable === 'Reusable with Conditions' ? form.reuseCondition.trim() : '',
        hml: form.hml,
        humanJob: form.hml ? form.humanJob.trim() : '',
        // A locked paired sub-skill never owns its progress/launch — those
        // cascade from the parent Agent, so leave them untouched here
        // (2026-07-06).
        ...(lockProgress ? {} : {
          launchDate: form.launchDate ? new Date(form.launchDate) : null,
          devProgress: clampedProgress,
          developmentPhase: developmentPhaseLabel(clampedProgress),
        }),
        updatedAt: serverTimestamp(),
      });

      onSaved?.();
      onClose();
    } catch (e) {
      setError(e.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && onClose()}>
      <div className="mbox">
        <button className="mclose" onClick={onClose}>✕</button>
        <div className="mtitle">Edit Details</div>
        <div className="msub">{agent.agentName}</div>

        {error && <div className="msg error"><span className="dot" style={{ background: '#ea4335' }} />{error}</div>}

        <div className="fg">
          <label>Agent / Skill Name <span className="req">*</span></label>
          <input value={form.agentName} onChange={(e) => setField('agentName', e.target.value)} />
        </div>

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

        <div className="fg">
          <label>Description <span className="req">*</span></label>
          <textarea rows={3} value={form.description} onChange={(e) => setField('description', e.target.value)} />
        </div>

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

        <div className="fg">
          <label>Creator / Team member <span className="hint">(รายชื่อสมาชิกในทีม / ชื่อ Key contact หลัก)</span></label>
          <CreatorPicker selected={form.creatorPicks} onChange={(v) => setField('creatorPicks', v)} placeholder="พิมพ์ชื่อหรืออีเมล…" />
        </div>

        <div className="grid2">
          <div className="fg">
            <label>Reusable <span className="req">*</span></label>
            <select value={form.reusable} onChange={(e) => setField('reusable', e.target.value)}>
              <option value="">— เลือก —</option>
              {REUSABLE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
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

        {lockProgress ? (
          <div className="msg info" style={{ fontSize: 11 }}>
            <span className="dot" style={{ background: '#4a6fa5' }} />
            Skill นี้ผูกกับ Agent หลัก — Progress และ Launch Date จะไปพร้อมกับ Agent แม่ (แก้แยกไม่ได้)
          </div>
        ) : (
          <div className="grid2">
            <div className="fg">
              <label>Dev Progress (%)</label>
              <input type="number" min={0} max={100} value={form.devProgress} onChange={(e) => setField('devProgress', e.target.value)} />
            </div>
            <div className="fg">
              <label>Launch Date</label>
              <input type="date" value={form.launchDate} onChange={(e) => setField('launchDate', e.target.value)} />
            </div>
          </div>
        )}

        <div className="btn-group" style={{ marginTop: 12 }}>
          <button className="btn btn-secondary" disabled={saving} onClick={onClose}>Cancel</button>
          <button className="btn btn-success" disabled={saving} onClick={handleSave}>{saving ? 'กำลังบันทึก…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
