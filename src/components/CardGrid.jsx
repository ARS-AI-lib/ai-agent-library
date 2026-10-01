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
            <div className="sh">
              <div className="sbar" style={{ background: categoryColor(g) }} />
              <span className="sname">{g}</span>
              <span className="sbadge">{gAgents.length}</span>
            </div>
            {body(gAgents, key)}
          </div>
        );
      })}
      {unassigned.length > 0 && (
        <div className="sb">
          <div className="sh">
            <div className="sbar" style={{ background: 'var(--mu2)' }} />
            <span className="sname" style={{ color: 'var(--mu)' }}>(unassigned)</span>
            <span className="sbadge">{unassigned.length}</span>
          </div>
          {body(unassigned, key)}
        </div>
      )}
    </>
  );
}
