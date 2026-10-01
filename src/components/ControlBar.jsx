import MultiSelect from './MultiSelect';
import Dropdown from './Dropdown';
import { TIER_ORDER } from '../lib/tier';
import { SORT_OPTIONS } from '../lib/agentUtils';

const VIEWS = [
  ['by-category', 'By Category'],
  ['by-owner', 'By Owner'],
  ['by-role', 'By Role'],
  ['by-ability', 'By Ability'],
  // Flat ranked list rather than a grouping — see CardGrid.
  ['by-popularity', 'Popularity'],
];

const TYPES = [
  ['all', 'All types'],
  ['agent', 'Agent'],
  ['skill', 'Skill'],
];

export default function ControlBar({
  view, setView,
  sort, setSort,
  ownerOptions, owner, setOwner,
  roleOptions, role, setRole,
  tier, setTier,
  type, setType,
  reusableOptions, reusable, setReusable,
  hasEndpoint, setHasEndpoint,
  onClear,
  layout, setLayout,
}) {
  return (
    <div className="cbar">
      <div className="cg">
        <span className="cl">View</span>
        <Dropdown options={VIEWS} value={view} onChange={setView} ariaLabel="จัดกลุ่มตาม" />
      </div>

      <div className="cg">
        <span className="cl">Sort</span>
        {/* Popularity is already its own ranking (demandScore) — a second sort
            on top of it would just fight the reason someone picked that view,
            so the control is disabled rather than silently ignored there. */}
        <Dropdown options={SORT_OPTIONS} value={sort} onChange={setSort} ariaLabel="เรียงลำดับ" disabled={view === 'by-popularity'} />
      </div>

      <div className="csep" />
      <div className="cg">
        <span className="cl">Owner</span>
        <MultiSelect label="Owner" options={ownerOptions} selected={owner} onChange={setOwner} />
      </div>

      <div className="csep" />
      <div className="cg">
        <span className="cl">Role</span>
        <MultiSelect label="Role" options={roleOptions} selected={role} onChange={setRole} />
      </div>

      <div className="csep" />
      <div className="cg">
        <span className="cl">Tier</span>
        <MultiSelect label="Tier" options={TIER_ORDER} selected={tier} onChange={setTier} />
      </div>

      <div className="csep" />
      <div className="cg">
        <span className="cl">Reusable</span>
        <MultiSelect label="Reusable" options={reusableOptions} selected={reusable} onChange={setReusable} />
      </div>

      <div className="csep" />
      <div className="cg">
        <span className="cl">Type</span>
        <Dropdown options={TYPES} value={type} onChange={setType} ariaLabel="ประเภท" />
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

      <button className="btnclr" title="Clear filters" onClick={onClear}>✕ Clear</button>

      {setLayout && (
        <div className="v7-layout" role="group" aria-label="Layout">
          {[['cards', 'Cards', 'M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v5H4zM13 14h7v5h-7z'], ['list', 'List', 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01']].map(([k, label, d]) => (
            <button key={k} type="button" aria-pressed={layout === k} className={layout === k ? 'active' : ''} onClick={() => setLayout(k)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
