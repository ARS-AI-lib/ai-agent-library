import MultiSelect from './MultiSelect';
import TagMultiSelect from './TagMultiSelect';
import ComboInput from './ComboInput';
import SkillNameInput from './SkillNameInput';
import { normalizeProgress } from '../lib/agentUtils';

const REUSABLE_OPTIONS = ['Reusable', 'Reusable with Conditions', 'Non-reusable'];

/**
 * One paired sub-skill row, shared by PreRegModal (new submission) and
 * EditAgentModal (attaching skills later) so the two cannot drift (2026-08-20).
 *
 * Two modes, chosen by the name field:
 *   · NEW      — the full 8 required fields; becomes its own pending doc.
 *   · EXISTING — the skill is pulled from the library and shown READ-ONLY.
 *                Nothing about it is editable here: it is an independent
 *                library entry that other agents may also depend on, so this
 *                form links it, it does not own it.
 */
export default function SkillRow({
  skill, index, onField, onRemove, canRemove,
  allAgents = [], excludeIds = [],
  abilityOptions = [], roleOptions = [], onAddRelatedRole,
}) {
  const isExisting = skill.link?.mode === 'existing';
  const linked = isExisting ? allAgents.find((a) => a.id === skill.link.id) : null;

  return (
    <div style={{ marginTop: 12, padding: 12, border: '1px solid var(--bd-soft)', borderRadius: 'var(--r-md)', background: 'var(--sf)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <strong style={{ fontSize: 12.5, color: 'var(--ag)' }}>Skill #{index + 1}</strong>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            title="Remove this skill"
            style={{ border: '1px solid var(--clr-bd)', background: 'var(--clr-bg)', color: 'var(--clr-fg)', borderRadius: 6, padding: '2px 9px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            ✕ Remove
          </button>
        )}
      </div>

      <div className="fg">
        <label>
          Skill Name <span className="req">*</span>
        </label>
        <SkillNameInput
          value={skill.link}
          onChange={(v) => onField('link', v)}
          allAgents={allAgents}
          excludeIds={excludeIds}
        />
      </div>

      {isExisting ? (
        // Linked existing skill — read-only. Its current state is shown because
        // a skill that is already live (or already another agent's child) is
        // still linkable, and the user should see what they attached.
        linked ? (
          <div style={{ padding: '10px 12px', background: 'var(--sf2)', borderRadius: 'var(--r-sm)', fontSize: 11.5 }}>
            <div className="msg info" style={{ fontSize: 11, marginBottom: 8 }}>
              <span className="dot" style={{ background: '#4a6fa5' }} />
              ผูกกับ Skill ที่มีอยู่แล้ว
            </div>
            <Row k="Description" v={linked.description} />
            <Row k="Owner" v={linked.owner} />
            <Row k="Scope" v={linked.customerFacing ? 'Customer Facing' : 'Internal Use'} />
            <Row k="Core Ability" v={(Array.isArray(linked.coreAbility) ? linked.coreAbility : [linked.coreAbility]).filter(Boolean).join(', ')} />
            <Row k="Related Role" v={(Array.isArray(linked.relatedRole) ? linked.relatedRole : [linked.relatedRole]).filter(Boolean).join(', ')} />
            <Row k="Reusable" v={linked.reusable} />
            <Row k="Progress" v={`${normalizeProgress(linked.devProgress)}%`} />
            {linked.deploymentStatus === 'approved' && <Row k="สถานะ" v="Deploy อนุมัติแล้ว" />}
            {String(linked.endpoint || '').trim() && <Row k="Endpoint" v="มีแล้ว" />}
          </div>
        ) : (
          <div className="msg error" style={{ fontSize: 11 }}>
            <span className="dot" style={{ background: '#ea4335' }} />
            ไม่พบ Skill ที่ผูกไว้ (อาจถูกลบหรือ archive) — เลือกใหม่อีกครั้ง
          </div>
        )
      ) : (
        <>
          <div className="fg">
            <label>Description <span className="req">*</span></label>
            <textarea rows={2} value={skill.description} onChange={(e) => onField('description', e.target.value)} placeholder="Skill นี้ทำอะไร" />
          </div>
          <div className="fg">
            <label>Scope <span className="req">*</span></label>
            <div className="toggle2" role="radiogroup" aria-label={`Scope ของ ${skill.link?.name || 'skill นี้'}`}>
              {[['Internal', 'Internal Use'], ['External', 'Customer Facing']].map(([v, lbl]) => (
                <button key={v} type="button" role="radio" aria-checked={skill.scope === v} className={skill.scope === v ? 'sel' : ''} onClick={() => onField('scope', v)}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
          <div className="grid2">
            <div className="fg">
              <label>Core Ability <span className="req">*</span></label>
              <MultiSelect label="Select ability…" options={abilityOptions} selected={skill.ability} onChange={(v) => onField('ability', v)} />
            </div>
            <div className="fg">
              <label>Related Role <span className="req">*</span></label>
              <TagMultiSelect label="Select role…" options={roleOptions} selected={skill.relatedRole} onChange={(v) => onField('relatedRole', v)} onAddNew={onAddRelatedRole} />
            </div>
          </div>
          <div className="grid2">
            <div className="fg">
              <label>Input <span className="req">*</span></label>
              <textarea rows={2} value={skill.input} onChange={(e) => onField('input', e.target.value)} placeholder="ข้อมูลที่ Skill รับ" />
            </div>
            <div className="fg">
              <label>Output <span className="req">*</span></label>
              <textarea rows={2} value={skill.output} onChange={(e) => onField('output', e.target.value)} placeholder="ผลลัพธ์ที่สร้าง" />
            </div>
          </div>
          <div className="grid2">
            <div className="fg">
              <label>Reusable <span className="req">*</span></label>
              <ComboInput value={skill.reusable} onChange={(v) => onField('reusable', v)} options={REUSABLE_OPTIONS} placeholder="— เลือก —" readOnly />
            </div>
            {skill.reusable === 'Reusable with Conditions' && (
              <div className="fg">
                <label>Reuse Conditions <span className="req">*</span></label>
                <input value={skill.reuseCondition} onChange={(e) => onField('reuseCondition', e.target.value)} placeholder="เงื่อนไขในการนำกลับมาใช้" />
              </div>
            )}
          </div>
          <div className="fg">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <input type="checkbox" checked={!!skill.externalSource} onChange={(e) => onField('externalSource', e.target.checked)} />
              External Source
            </label>
            <div style={{ fontSize: 11.5, color: 'var(--mu)', marginTop: 2 }}>Skill ที่นำมาจากภายนอกองค์กร (ไม่ได้พัฒนาเอง)</div>
          </div>
          <div className="fg">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <input type="checkbox" checked={skill.hml} onChange={(e) => onField('hml', e.target.checked)} />
              HML (Human-in-the-Loop)
            </label>
          </div>
          {skill.hml && (
            <div className="fg">
              <label>Human Job <span className="req">*</span></label>
              <input value={skill.humanJob} onChange={(e) => onField('humanJob', e.target.value)} placeholder="หน้าที่ของ Human ใน loop" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Row({ k, v }) {
  if (!String(v == null ? '' : v).trim()) return null;
  return (
    <div style={{ display: 'flex', gap: 8, padding: '2px 0' }}>
      <span style={{ color: 'var(--mu)', minWidth: 92, flexShrink: 0 }}>{k}</span>
      <span style={{ color: 'var(--tx2)' }}>{v}</span>
    </div>
  );
}

/** Blank NEW-skill row. `link` carries the name+mode; the rest is the 8-field form. */
export function emptySkillRow(id) {
  return {
    _id: id,
    link: { mode: 'new', name: '' },
    description: '', scope: 'Internal',
    ability: new Set(), relatedRole: new Set(),
    input: '', output: '', reusable: '', reuseCondition: '',
    hml: false, humanJob: '', externalSource: false,
  };
}

/**
 * Validation shared by both forms. An EXISTING link is already-approved
 * library data and is deliberately not re-validated against today's rules —
 * only that it still resolves.
 */
export function validateSkillRows(rows, allAgents) {
  if (!rows.length) return 'Type = Agent+Skill ต้องเพิ่ม Skill อย่างน้อย 1 ตัว (หรือเปลี่ยน Type เป็น Agent)';
  for (let i = 0; i < rows.length; i += 1) {
    const s = rows[i];
    const n = `Skill #${i + 1}`;
    if (s.link?.mode === 'existing') {
      if (!allAgents.some((a) => a.id === s.link.id)) return `${n}: ไม่พบ Skill ที่ผูกไว้`;
      continue;
    }
    if (!s.link?.name?.trim()) return `${n}: ใส่ชื่อ Skill`;
    if (!s.description.trim()) return `${n}: ใส่ Description`;
    if (s.ability.size === 0) return `${n}: เลือก Core Ability`;
    if (s.relatedRole.size === 0) return `${n}: เลือก Related Role`;
    if (!s.input.trim()) return `${n}: ใส่ Input`;
    if (!s.output.trim()) return `${n}: ใส่ Output`;
    if (!s.reusable) return `${n}: เลือก Reusable`;
    if (s.reusable === 'Reusable with Conditions' && !s.reuseCondition.trim()) return `${n}: ใส่ Reuse Conditions`;
    if (s.hml && !s.humanJob.trim()) return `${n}: ใส่ Human Job`;
  }
  // Two rows pointing at the same existing skill would create a duplicate link.
  const ids = rows.filter((s) => s.link?.mode === 'existing').map((s) => s.link.id);
  if (new Set(ids).size !== ids.length) return 'มี Skill ที่ผูกซ้ำกัน — เลือกคนละตัว';
  return '';
}
