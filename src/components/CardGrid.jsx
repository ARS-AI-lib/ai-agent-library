import AgentCard from './AgentCard';
import { groupAgents } from '../lib/agentUtils';

const GROUP_COLOR = { owner: '#1558b0', ability: '#6d28d9', role: '#0b7a68' };

export default function CardGrid({ agents, allAgents, view, onCardClick }) {
  const key = view === 'by-role' ? 'role' : view === 'by-ability' ? 'ability' : 'owner';
  const { groups, byGroup } = groupAgents(agents, key);
  const color = GROUP_COLOR[key];

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
              <div className="sbar" style={{ background: color }} />
              <span className="sname" style={{ color }}>{g}</span>
              <span className="sbadge">{gAgents.length}</span>
            </div>
            <div className="agrid">
              {gAgents.map((a) => (
                <AgentCard key={a.id} agent={a} allAgents={allAgents} onClick={onCardClick} />
              ))}
            </div>
          </div>
        );
      })}
      {unassigned.length > 0 && (
        <div className="sb">
          <div className="sh">
            <div className="sbar" style={{ background: '#9ca3af' }} />
            <span className="sname" style={{ color: '#9ca3af' }}>(unassigned)</span>
            <span className="sbadge">{unassigned.length}</span>
          </div>
          <div className="agrid">
            {unassigned.map((a) => (
              <AgentCard key={a.id} agent={a} allAgents={allAgents} onClick={onCardClick} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
