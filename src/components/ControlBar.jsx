import MultiSelect from './MultiSelect';
import Dropdown from './Dropdown';
import { TIER_ORDER } from '../lib/tier';
import { SORT_OPTIONS } from '../lib/agentUtils';

// V7 action row (board 1 · 2026-10-01): filter pills → the
// page actions (Inbox / Users / New) on the right. Every control drives the
// SAME state it did before the redesign; only placement and skin changed.

const VIEWS = [
  ['by-category', 'Category'],
  ['by-owner', 'Owner'],
  ['by-role', 'Role'],
  ['by-ability', 'Ability'],
  // Flat ranked list rather than a grouping — see CardGrid.
  ['by-popularity', 'Popularity'],
];

const TYPES = [
  ['all', 'All'],
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
  counts = {},
  actions,
}) {

  return (
    <div className="cbar v7-actrow">

      <Dropdown pill="View" options={VIEWS} value={view} onChange={setView} ariaLabel="Group by" activeWhen={(v) => v !== 'by-category'} />
      {/* Popularity is already its own ranking (demandScore) — a second sort
          on top of it would just fight the reason someone picked that view,
          so the control is disabled rather than silently ignored there. */}
      <Dropdown pill="Sort" options={SORT_OPTIONS} value={sort} onChange={setSort} ariaLabel="Sort" disabled={view === 'by-popularity'} activeWhen={(v) => v !== 'created'} />
      <MultiSelect pill="Owner" label="Owner" options={ownerOptions} selected={owner} onChange={setOwner} counts={counts.owner} />
      <MultiSelect pill="Role" label="Role" options={roleOptions} selected={role} onChange={setRole} counts={counts.role} />
      <MultiSelect pill="Tier" label="Tier" options={TIER_ORDER} selected={tier} onChange={setTier} counts={counts.tier} />
      <MultiSelect pill="Reusable" label="Reusable" options={reusableOptions} selected={reusable} onChange={setReusable} counts={counts.reusable} />
      <Dropdown pill="Type" options={TYPES} value={type} onChange={setType} ariaLabel="Type" activeWhen={(v) => v !== 'all'} />

      {/* Icon-only toggle: the link glyph is the same one the cards use for an
          endpoint — so the button reads as "show only the ones with this". */}
      <button
        type="button"
        className={`cb-toggle v7-icon-toggle ${hasEndpoint ? 'on' : ''}`}
        aria-pressed={hasEndpoint}
        aria-label="Has endpoint"
        title={hasEndpoint ? 'กำลังกรองเฉพาะที่มีลิงก์ใช้งาน — กดเพื่อยกเลิก' : 'กรองเฉพาะ Agent/Skill ที่มีลิงก์ใช้งานแล้ว'}
        onClick={() => setHasEndpoint(!hasEndpoint)}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      </button>

      <button type="button" className="v7-clear" aria-label="Clear filters" title="Clear filters" onClick={onClear}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>

      {actions && <div className="v7-row-actions">{actions}</div>}
    </div>
  );
}
