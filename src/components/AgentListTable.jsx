import { getType, getTier, TIER_DEF } from '../lib/tier';
import { agentStatus, ST_DEF, progressBucket } from '../lib/status';
import { fmtDate } from '../lib/agentUtils';
import { ratingDisplay } from '../lib/agentStats';

// V7 List view (2026-10-01). Same data as AgentCard, one row per item, and
// the same derivations (getType/getTier/agentStatus) — nothing inline-guessed.
// A row is a real <button>-like control: click / Enter opens the detail modal.
export default function AgentListTable({ agents, onClick, statsById }) {
  return (
    <div className="v7-list" role="table" aria-label="Agents and skills">
      <div className="v7-list-row v7-list-head" role="row">
        <span role="columnheader">Name</span>
        <span role="columnheader">Type</span>
        <span role="columnheader">Status</span>
        <span role="columnheader">Owner</span>
        <span role="columnheader">Progress</span>
        <span role="columnheader">Launch</span>
        <span role="columnheader">Reviews</span>
      </div>
      {agents.map((a) => {
        const type = getType(a);
        const tier = getTier(a);
        const td = TIER_DEF[tier];
        const sd = ST_DEF[agentStatus(a)];
        const progress = typeof a.devProgress === 'number' ? a.devProgress : 0;
        const rd = ratingDisplay(statsById?.get(a.id));
        return (
          <div
            key={a.id}
            className="v7-list-row"
            role="row"
            tabIndex={0}
            onClick={() => onClick(a)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(a); } }}
          >
            <span role="cell" className="v7-list-name">{a.agentName}</span>
            <span role="cell" className="v7-list-type">
              <span className={`tb ${type === 'agent' ? 'tbag' : 'tbsk'}`}>{type === 'agent' ? 'AGENT' : 'SKILL'}</span>
              <span className="tier-badge" style={{ color: td.color, background: td.bg, borderColor: td.bd }} title={td.label}>{tier}</span>
            </span>
            <span role="cell">
              <span className="status-pill" style={{ color: sd.color, background: sd.bg }}>
                <span className="status-dot" style={{ background: sd.dot || sd.color }} />{sd.lb}
              </span>
            </span>
            <span role="cell" className="v7-list-muted">{a.owner || '—'}</span>
            <span role="cell" className="v7-list-prog">
              <span className="ac-progress-track"><span className={`ac-progress-fill ${progressBucket(progress)}`} style={{ width: `${progress}%`, display: 'block' }} /></span>
              <span className="v7-list-pct">{progress}%</span>
            </span>
            <span role="cell" className="v7-list-mono">{fmtDate(a.launchDate) || '—'}</span>
            <span role="cell" className="v7-list-muted">{rd.kind === 'histogram' ? rd.total : '—'}</span>
          </div>
        );
      })}
    </div>
  );
}
