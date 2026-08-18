import { getType, getTier, TIER_DEF, isInternalOrExternal } from '../lib/tier';
import { agentStatus, ST_DEF, progressBucket } from '../lib/status';
import { fmtDate, safeEndpointUrl } from '../lib/agentUtils';
import { recordAgentEvent } from '../lib/agentEvents';
import { readStats, ratingDisplay } from '../lib/agentStats';

// Card anatomy (2026-08-08 redesign): eyebrow (type + tier + scope) → title
// → progress bar → 2×2 meta grid (Owner / Ability / Status / Launch).
//
// The status pill USED to sit beside the title and the meta grid carried six
// fields (Owner, Ability, Use case, the paired Agent/Skill, Role, Launch) plus
// an endpoint link in the eyebrow. Per the redesign sign-off the preview card
// went lean and the endpoint link moved into AgentDetailModal only — reachable
// one click deeper instead of removed from the product.
//
// 2026-08-10: brought back, per explicit request, as a small top-right icon
// (independent of the eyebrow/meta grid) rather than reverting the whole
// redesign — same target (safeEndpointUrl(agent.endpoint)) as the modal's
// link, just a second, faster entry point for cards that have one.
//
// The fixed 2×2 grid keeps the old alignment guarantee — every card in a row
// has the same four cells in the same order with an em-dash fallback, so
// "Launch" lands in the same position on every card regardless of data.
export default function AgentCard({ agent, allAgents, onClick, stats }) {
  const type = getType(agent);
  const tier = getTier(agent);
  const tierDef = TIER_DEF[tier];
  const st = agentStatus(agent);
  const sd = ST_DEF[st];
  const progress = typeof agent.devProgress === 'number' ? agent.devProgress : 0;
  const scope = isInternalOrExternal(agent);
  const ability = Array.isArray(agent.coreAbility) ? agent.coreAbility.join(', ') : agent.coreAbility;
  const endpointHref = safeEndpointUrl(agent.endpoint);

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
        {/* .ac-scope + .ac-link (when present) form ONE trailing group, right-
            aligned as a unit via margin-left:auto on .ac-scope — not two
            independently-positioned icons. That is what keeps .ac-scope
            flush against the card's right edge on a card with no endpoint,
            instead of leaving a gap where .ac-link would have been. Both
            share the same box size/shape (.ac-icon) so the two never look
            like different-weight controls sitting side by side. */}
        <span className="ac-scope ac-icon" title={scope === 'External' ? 'Customer Facing' : 'Internal Use'}>
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
        {endpointHref && (
          <a
            className="ac-link ac-icon"
            href={endpointHref}
            target="_blank"
            rel="noopener noreferrer"
            title={endpointHref}
            aria-label={`เปิดลิงก์ใช้งาน ${agent.agentName}`}
            onClick={(e) => { e.stopPropagation(); recordAgentEvent(agent.id, 'endpoint'); }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        )}
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

      {/* Rating + demand (2026-08-18). The card redesign went deliberately
          lean, so this is ONE row, only when there is something true to say.
          No average is rendered anywhere — see src/lib/agentStats.js for why a
          mean over 1-2 ratings is the "ตัวเลขประมาณ" the project forbids. When
          nobody has rated, the row shows the usage counts instead of five empty
          stars: 239 cards of empty stars would read as an abandoned library. */}
      <AgentCardStats stats={stats} />
    </div>
  );
}

function AgentCardStats({ stats }) {
  const s = readStats(stats);
  const rd = ratingDisplay(stats);
  const hasUsage = s.detailOpens > 0 || s.endpointClicks > 0;
  if (rd.kind === 'none' && !hasUsage) return null;

  return (
    <div className="ac-stats">
      {rd.kind === 'histogram' ? (
        <span className="ac-stats-bar" title={rd.bars.map((b) => `${b.star}★ ${b.count}`).join(' · ')}>
          {rd.bars.map((b) => (
            <span
              key={b.star}
              className={`ac-stats-seg s${b.star}`}
              style={{ flexGrow: b.count || 0.06 }}
            />
          ))}
        </span>
      ) : (
        <span className="ac-stats-none">No reviews yet</span>
      )}
      {rd.kind === 'histogram' && <span className="ac-stats-n">{rd.total}</span>}
      {hasUsage && (
        <span className="ac-stats-use" title={`Viewed ${s.detailOpens} · Used ${s.endpointClicks}`}>
          {s.detailOpens > 0 && (
            <>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -1 }}>
                <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              {' '}{s.detailOpens}
            </>
          )}
          {s.endpointClicks > 0 && <> ↗ {s.endpointClicks}</>}
        </span>
      )}
    </div>
  );
}
