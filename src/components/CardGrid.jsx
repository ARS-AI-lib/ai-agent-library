import { useState } from 'react';
import AgentCard from './AgentCard';
import AgentListTable from './AgentListTable';
import EmptyResults from './EmptyResults';
import { groupAgents, categoryColor, sortAgents, agentCategories } from '../lib/agentUtils';
import { demandScore } from '../lib/agentStats';

// Group-header bar colour. Was one fixed hex per view (owner/ability/role),
// which made every group in a view identical and gave the eye nothing to
// track when scrolling a 240-item library. Each group now gets its own hue
// from the decorative --c1..--c6 ramp, hashed off the group NAME so it stays
// put as data changes (same helper and same reasoning as the sidebar dots).


export default function CardGrid({ agents, allAgents, view, sort = 'name', onCardClick, statsById, layout = 'cards', search, onClear, onNew }) {
  // Cards and List show the same groups in the same order; only the body of
  // each group changes.
  const body = (list, groupKey) => (layout === 'list'
    ? <AgentListTable agents={list} onClick={onCardClick} statsById={statsById} />
    : (
      <div className="agrid">
        {list.map((a) => (
          <AgentCard key={a.id} agent={a} allAgents={allAgents} onClick={onCardClick} groupKey={groupKey} stats={statsById?.get(a.id)} />
        ))}
      </div>
    ));
  const empty = <EmptyResults search={search} onClear={onClear} onNew={onNew} />;
  // V7 polish: a group header collapses its group (session-only, not saved).
  const [collapsed, setCollapsed] = useState(() => new Set());
  const toggleGroup = (g) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(g)) next.delete(g); else next.add(g);
    return next;
  });
  const GroupHead = ({ id, color, label, n, muted }) => (
    <button type="button" className="sh v7-sh" aria-expanded={!collapsed.has(id)} onClick={() => toggleGroup(id)}>
      <span className="v7-sh-caret" aria-hidden="true" />
      <div className="sbar" style={{ background: color }} />
      <span className="sname" style={muted ? { color: 'var(--mu)' } : undefined}>{label}</span>
      <span className="sbadge">{n}</span>
    </button>
  );
  // Popularity is a SORT, not a grouping like the other views — an agent has
  // one owner but no natural "popularity bucket". So it renders one flat,
  // ranked list. Ordering is by raw event counts (demandScore); no average is
  // involved, here or anywhere else — see src/lib/agentStats.js.
  if (view === 'by-popularity') {
    const ranked = [...agents].sort(
      (x, y) => demandScore(statsById?.get(y.id)) - demandScore(statsById?.get(x.id))
    );
    if (!ranked.length) return empty;
    return (
      <div className="sb">
        <div className="sh">
          <div className="sbar" style={{ background: 'var(--accent)' }} />
          <span className="sname">Popularity</span>
          <span className="sbadge">{ranked.length}</span>
        </div>
        {body(ranked)}
      </div>
    );
  }

  const key = view === 'by-role' ? 'role' : view === 'by-ability' ? 'ability' : view === 'by-owner' ? 'owner' : 'category';
  const { groups, byGroup: byGroupRaw } = groupAgents(agents, key);
  // Sort applies WITHIN each group, not instead of it (locked 2026-08-20) —
  // the grouping the user picked via VIEW still stands, only the card order
  // inside each bucket changes.
  const byGroup = (g) => sortAgents(byGroupRaw(g), sort);

  // An agent missing the group's own field falls into its own bucket rather
  // than vanishing from the grid — Owner is the case with live data (some
  // agents have owner === ''); Category is defensive (0 live agents lack a
  // category today, per CLAUDE.md §28, but the shape can drift).
  const unassigned = key === 'owner'
    ? sortAgents(agents.filter((a) => !(a.owner || '')), sort)
    : key === 'category'
      ? sortAgents(agents.filter((a) => agentCategories(a).length === 0), sort)
      : [];

  if (groups.length === 0 && unassigned.length === 0) {
    return empty;
  }

  return (
    <>
      {groups.map((g) => {
        const gAgents = byGroup(g);
        if (!gAgents.length) return null;
        return (
          <div className="sb" key={g}>
            <GroupHead id={g} color={categoryColor(g)} label={g} n={gAgents.length} />
            {!collapsed.has(g) && body(gAgents, key)}
          </div>
        );
      })}
      {unassigned.length > 0 && (
        <div className="sb">
          <GroupHead id="__unassigned" color="var(--mu2)" label="(unassigned)" n={unassigned.length} muted />
          {!collapsed.has('__unassigned') && body(unassigned, key)}
        </div>
      )}
    </>
  );
}

// V7 polish: placeholder cards while the library loads (replaces "Loading…").
export function SkeletonGrid({ count = 6 }) {
  return (
    <div className="agrid" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="ac v7-skel" aria-hidden="true">
          <span className="v7-skel-line w30" />
          <span className="v7-skel-line w70 h" />
          <span className="v7-skel-line w90" />
          <span className="v7-skel-line w60" />
        </div>
      ))}
    </div>
  );
}
