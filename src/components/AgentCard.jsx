import { getType, getTier, TIER_DEF, isInternalOrExternal } from '../lib/tier';
import { agentStatus, ST_DEF, progressBucket } from '../lib/status';
import { fmtDate } from '../lib/agentUtils';

// Card anatomy (2026-08-08 redesign): eyebrow (type + tier + scope) → title
// → progress bar → 2×2 meta grid (Owner / Ability / Status / Launch).
//
// The status pill USED to sit beside the title and the meta grid carried six
// fields (Owner, Ability, Use case, the paired Agent/Skill, Role, Launch) plus
// an endpoint link in the eyebrow. Per the redesign sign-off the preview card
// is now deliberately lean: those four extra fields and the endpoint link live
// in AgentDetailModal only, and the pill became its own labelled meta cell.
//
// Consequence worth knowing before "restoring" anything here: the endpoint
// link is a real shipped feature (Aug 2026) that is now reachable one click
// deeper, not removed from the product. That was the explicit call.
//
// The fixed 2×2 grid keeps the old alignment guarantee — every card in a row
// has the same four cells in the same order with an em-dash fallback, so
// "Launch" lands in the same position on every card regardless of data.
export default function AgentCard({ agent, allAgents, onClick }) {
  const type = getType(agent);
  const tier = getTier(agent);
  const tierDef = TIER_DEF[tier];
  const st = agentStatus(agent);
  const sd = ST_DEF[st];
  const progress = typeof agent.devProgress === 'number' ? agent.devProgress : 0;
  const scope = isInternalOrExternal(agent);
  const ability = Array.isArray(agent.coreAbility) ? agent.coreAbility.join(', ') : agent.coreAbility;

  return (
    // The whole card is the click target, so it also has to be a real control
    // for anyone not using a mouse: role="button" + tabIndex + Enter/Space
    // matches what a <button> would do; it stays a <div> because <button>
    // would fight the card's block layout.
    <div
      className={`ac ${type === 'agent' ? 'isag' : 'issk'}`}
      role="button"
      tabIndex={0}
      aria-label={`${agent.agentName} — ${type === 'agent' ? 'Agent' : 'Skill'}, ${tier}, ${sd.lb}`}
      onClick={() => onClick(agent)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        // Space scrolls the page by default; the card is acting as a button so
        // that has to be suppressed. (The old `e.target !== e.currentTarget`
        // guard went with the endpoint <a> — there is no nested focusable
        // control left inside the card to double-fire.)
        e.preventDefault();
        onClick(agent);
      }}
    >
      <div className="ac-eyebrow">
        <span className={`tb ${type === 'agent' ? 'tbag' : 'tbsk'}`}>{type === 'agent' ? 'AGENT' : 'SKILL'}</span>
        <span className="tier-badge" style={{ color: tierDef.color, background: tierDef.bg, borderColor: tierDef.bd }} title={tierDef.label}>
          {tier}
        </span>
        {/* Flat/neutral on the card (mockup .ac-scope: var(--mu)) — colouring
            this per-scope was extra emphasis the card grid doesn't need; the
            AGENT/SKILL badge and tier already carry the primary signal here.
            The colored version is intentionally kept in AgentDetailModal and
            the SDLC nested-card view, where scope is the point of the row. */}
        <span className="ac-scope" title={scope === 'External' ? 'Customer Facing' : 'Internal Use'}>
          {scope === 'External' ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="2" width="16" height="20" rx="1" /><line x1="9" y1="6" x2="9" y2="6" /><line x1="15" y1="6" x2="15" y2="6" />
              <line x1="9" y1="10" x2="9" y2="10" /><line x1="15" y1="10" x2="15" y2="10" />
              <line x1="9" y1="14" x2="9" y2="14" /><line x1="15" y1="14" x2="15" y2="14" />
              <path d="M9 22v-4h6v4" />
            </svg>
          )}
        </span>
      </div>

      <h3 className="ac-title">{agent.agentName}</h3>

      <div className="ac-progress-row">
        <div className="ac-progress-track">
          <div className={`ac-progress-fill ${progressBucket(progress)}`} style={{ width: `${progress}%` }} />
        </div>
        <span className="ac-progress-pct">{progress}%</span>
      </div>

      <div className="ac-meta">
        <div className="ac-meta-item">
          <div className="ac-meta-label">Owner</div>
          <div className="ac-meta-value">{agent.owner || '—'}</div>
        </div>
        <div className="ac-meta-item">
          <div className="ac-meta-label">Ability</div>
          <div className="ac-meta-value">{ability || '—'}</div>
        </div>
        <div className="ac-meta-item">
          <div className="ac-meta-label">Status</div>
          <div>
            <span className="status-pill" style={{ color: sd.color, background: sd.bg }}>
              <span className="status-dot" style={{ background: sd.dot || sd.color }} />
              {sd.lb}
            </span>
          </div>
        </div>
        <div className="ac-meta-item">
          <div className="ac-meta-label">Launch</div>
          <div className="ac-meta-value" style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDate(agent.launchDate) || '—'}</div>
        </div>
      </div>
    </div>
  );
}
