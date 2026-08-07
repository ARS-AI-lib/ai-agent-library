import MultiSelect from './MultiSelect';
import { TIER_ORDER } from '../lib/tier';

const VIEWS = [
  ['by-owner', 'By Owner'],
  ['by-role', 'By Role'],
  ['by-ability', 'By Ability'],
];

export default function ControlBar({
  view, setView,
  ownerOptions, owner, setOwner,
  roleOptions, role, setRole,
  abilityOptions, ability, setAbility,
  tier, setTier,
  type, setType,
  reusableOptions, reusable, setReusable,
  hasEndpoint, setHasEndpoint,
  onClear,
}) {
  return (
    <div className="cbar">
      <div className="cg">
        <span className="cl">VIEW</span>
        <select className="dd" value={view} onChange={(e) => setView(e.target.value)}>
          {VIEWS.map(([v, lbl]) => (
            <option key={v} value={v}>{lbl}</option>
          ))}
        </select>
      </div>

      <div className="csep" />
      <div className="cg">
        <span className="cl">OWNER</span>
        <MultiSelect label="Owner" options={ownerOptions} selected={owner} onChange={setOwner} />
      </div>

      <div className="csep" />
      <div className="cg">
        <span className="cl">ROLE</span>
        <MultiSelect label="Role" options={roleOptions} selected={role} onChange={setRole} />
      </div>

      <div className="csep" />
      <div className="cg">
        <span className="cl">ABILITY</span>
        <MultiSelect label="Ability" options={abilityOptions} selected={ability} onChange={setAbility} />
      </div>

      <div className="csep" />
      <div className="cg">
        <span className="cl">TIER</span>
        <MultiSelect label="Tier" options={TIER_ORDER} selected={tier} onChange={setTier} />
      </div>

      <div className="csep" />
      <div className="cg">
        <span className="cl">REUSABLE</span>
        <MultiSelect label="Reusable" options={reusableOptions} selected={reusable} onChange={setReusable} />
      </div>

      <div className="csep" />
      <div className="cg">
        <span className="cl">TYPE</span>
        <select className="dd" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">All types</option>
          <option value="agent">Agent</option>
          <option value="skill">Skill</option>
        </select>
      </div>

      {/* Icon-only toggle rather than another labelled dropdown: it is a single
          on/off condition, and the link glyph is the same one the cards use for
          an endpoint — so the button reads as "show only the ones with this". */}
      <div className="csep" />
      <button
        type="button"
        className={`cb-toggle ${hasEndpoint ? 'on' : ''}`}
        aria-pressed={hasEndpoint}
        title={hasEndpoint ? 'กำลังกรองเฉพาะที่มีลิงก์ใช้งาน — กดเพื่อยกเลิก' : 'กรองเฉพาะ Agent/Skill ที่มีลิงก์ใช้งานแล้ว'}
        onClick={() => setHasEndpoint(!hasEndpoint)}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      </button>

      <button className="btnclr" title="Clear filters" onClick={onClear}>✕</button>
    </div>
  );
}
