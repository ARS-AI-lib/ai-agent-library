import { getType, getTier, TIER_DEF, isInternalOrExternal } from '../lib/tier';
import { agentStatus, ST_DEF, progressBucket } from '../lib/status';
import { fmtDate, relationshipLabel } from '../lib/agentUtils';

export default function AgentCard({ agent, allAgents, onClick }) {
  const type = getType(agent);
  const tier = getTier(agent);
  const tierDef = TIER_DEF[tier];
  const st = agentStatus(agent);
  const sd = ST_DEF[st];
  const rel = relationshipLabel(agent, allAgents);
  const progress = typeof agent.devProgress === 'number' ? agent.devProgress : 0;
  const scope = isInternalOrExternal(agent);

  return (
    <div className={`ac ${type === 'agent' ? 'isag' : 'issk'}`} onClick={() => onClick(agent)}>
      <span className="scope-badge" style={{ color: scope === 'External' ? '#0ea5e9' : 'var(--ag)' }} title={scope === 'External' ? 'Customer Facing' : 'Internal Use'}>
        {scope === 'External' ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="2" width="16" height="20" rx="1" /><line x1="9" y1="6" x2="9" y2="6" /><line x1="15" y1="6" x2="15" y2="6" />
            <line x1="9" y1="10" x2="9" y2="10" /><line x1="15" y1="10" x2="15" y2="10" />
            <line x1="9" y1="14" x2="9" y2="14" /><line x1="15" y1="14" x2="15" y2="14" />
            <path d="M9 22v-4h6v4" />
          </svg>
        )}
      </span>
      <div className="achdr">
        <span className={`tb ${type === 'agent' ? 'tbag' : 'tbsk'}`}>{type === 'agent' ? 'AGENT' : 'SKILL'}</span>
        <span
          className="tier-badge"
          style={{ color: tierDef.color, background: tierDef.bg, borderColor: tierDef.bd }}
          title={tierDef.label}
        >
          {tier}
        </span>
        <span className="acname">{agent.agentName}</span>
      </div>
      <div className="acrows">
        {agent.useCase && (
          <div className="acrow">
            <span className="ack">Usecase</span>
            <span style={{ color: 'var(--tx2)', fontSize: 11 }}>{agent.useCase}</span>
          </div>
        )}
        {agent.owner && (
          <div className="acrow">
            <span className="ack">Owner</span>
            <span className="ttag">{agent.owner}</span>
          </div>
        )}
        {agent.creator && (
          <div className="acrow">
            <span className="ack">Creator</span>
            <span>{agent.creator}</span>
          </div>
        )}
        {agent.coreAbility && (
          <div className="acrow">
            <span className="ack">Ability</span>
            <span>{Array.isArray(agent.coreAbility) ? agent.coreAbility.join(', ') : agent.coreAbility}</span>
          </div>
        )}
        {rel && (
          <div className="acrow">
            <span className="ack">{type === 'skill' ? 'Agent' : 'Skill'}</span>
            <span style={{ color: type === 'skill' ? 'var(--ag)' : 'var(--sk)', fontSize: 11, fontWeight: 600 }}>
              {rel.label}
            </span>
          </div>
        )}
        {agent.relatedRole && (
          <div className="acrow">
            <span className="ack">Role</span>
            <span>{Array.isArray(agent.relatedRole) ? agent.relatedRole.join(', ') : agent.relatedRole}</span>
          </div>
        )}
        <div className="acrow">
          <span className="ack">Phase</span>
          <span className="ph" style={{ background: sd.bg, color: sd.color, border: `1px solid ${sd.bd}` }}>
            {sd.lb}
          </span>
        </div>
        {agent.launchDate && (
          <div className="acrow">
            <span className="ack">Launch</span>
            <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5 }}>{fmtDate(agent.launchDate)}</span>
          </div>
        )}
      </div>
      <div className="prow">
        <div className="pbar">
          <div className={`pfill ${progressBucket(progress)}`} style={{ width: `${progress}%` }} />
        </div>
        <span className="ppct">{progress}%</span>
      </div>
    </div>
  );
}
