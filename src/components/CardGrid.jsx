import AgentCard from './AgentCard';
import { groupAgents, categoryColor } from '../lib/agentUtils';

// Group-header bar colour. Was one fixed hex per view (owner/ability/role),
// which made every group in a view identical and gave the eye nothing to
// track when scrolling a 240-item library. Each group now gets its own hue
// from the decorative --c1..--c6 ramp, hashed off the group NAME so it stays
// put as data changes (same helper and same reasoning as the sidebar dots).


export default function CardGrid({ agents, allAgents, view, onCardClick }) {
  const key = view === 'by-role' ? 'role' : view === 'by-ability' ? 'ability' : 'owner';
  const { groups, byGroup } = groupAgents(agents, key);

  const unassigned =
    key === 'owner' ? agents.filter((a) => !(a.owner || '')) : [];

  if (groups.length === 0 && unassigned.length === 0) {
    return <div className="empty-state">No data matching filters</div>;
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
            <div className="agrid">
              {gAgents.map((a) => (
                <AgentCard key={a.id} agent={a} allAgents={allAgents} onClick={onCardClick} groupKey={key} />
              ))}
            </div>
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
          <div className="agrid">
            {unassigned.map((a) => (
              <AgentCard key={a.id} agent={a} allAgents={allAgents} onClick={onCardClick} groupKey={key} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
