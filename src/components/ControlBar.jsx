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

      <button className="btnclr" title="Clear filters" onClick={onClear}>✕</button>
    </div>
  );
}
