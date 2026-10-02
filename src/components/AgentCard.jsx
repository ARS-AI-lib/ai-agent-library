import { getType, getTier, TIER_DEF, isInternalOrExternal } from '../lib/tier';
import { agentStatus, ST_DEF, progressBucket } from '../lib/status';
import { fmtDate, safeEndpointUrl } from '../lib/agentUtils';
import Term from './Term';
import { recordAgentEvent } from '../lib/agentEvents';
import { handleEndpointClick } from '../lib/endpointFiles';
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
  const isReady = st === 'ru';

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
      {/* V7 card (board 1 · 2026-10-01): tier + scope + status on top, then
          name + what it does, progress only while it is still being built,
          and a footer with owner, reviews, usage and — when it is live and has
          a link — an Open button. Same data and handlers as before. */}
      <div className="v7-ac-top">
        <Term k={tier}>
          <span className="tier-badge" style={{ color: tierDef.color, background: tierDef.bg, borderColor: tierDef.bd }} title={tierDef.label}>
            {tier} {type === 'agent' ? 'Agent' : 'Skill'}
          </span>
        </Term>
        <span className="v7-ac-scope">{scope === 'External' ? 'Customer-facing' : 'Internal'}</span>
        <span className="status-pill v7-ac-status" style={{ color: sd.color, background: sd.bg, borderColor: sd.bd }}>
          <span className="status-dot" style={{ background: sd.dot || sd.color }} />
          {sd.lb}
        </span>
      </div>

      <div className="v7-ac-head">
        <h3 className="ac-title">{agent.agentName}</h3>
        {agent.description && <p className="v7-ac-desc">{agent.description}</p>}
      </div>

      {!isReady && (
        <div className="v7-ac-prog">
          <div className="ac-progress-track">
            <div className={`ac-progress-fill ${progressBucket(progress)}`} style={{ width: `${progress}%` }} />
          </div>
          <span className="ac-progress-pct">{progress}%</span>
          {agent.launchDate && <span className="v7-ac-launch">· expected {fmtDate(agent.launchDate)}</span>}
        </div>
      )}

      <div className="v7-ac-foot">
        <span className="v7-ac-owner" title="Owner">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></svg>
          {agent.owner || '—'}
        </span>
        <AgentCardStats stats={stats} />
        {isReady && endpointHref && (
          <a
            className="v7-open"
            href={endpointHref}
            target="_blank"
            rel="noopener noreferrer"
            title={endpointHref}
            aria-label={`Open ${agent.agentName}`}
            onClick={(e) => {
              e.stopPropagation();
              recordAgentEvent(agent.id, 'endpoint');
              // Our own files download through the authed callable; external
              // links (GitLab, Cloud Run) fall through to the plain anchor.
              handleEndpointClick(e, agent.endpoint);
            }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            Open
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8" /></svg>
          </a>
        )}
      </div>
    </div>
  );
}

function AgentCardStats({ stats }) {
  // No average anywhere (src/lib/agentStats.js): a mean over 1-2 ratings is
  // the "ตัวเลขประมาณ" the project forbids — so the star shows a COUNT.
  const s = readStats(stats);
  const rd = ratingDisplay(stats);
  return (
    <>
      {rd.kind === 'histogram' && (
        <span className="v7-ac-stat" title={rd.bars.map((b) => `${b.star}★ ${b.count}`).join(' · ')}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="#f5a623" stroke="#f5a623" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></svg>
          {rd.total} {rd.total === 1 ? 'review' : 'reviews'}
        </span>
      )}
      {s.endpointClicks > 0
        ? <span className="v7-ac-stat" title={`Viewed ${s.detailOpens} · Used ${s.endpointClicks}`}>{s.endpointClicks} used</span>
        : s.detailOpens > 0 && <span className="v7-ac-stat">{s.detailOpens} views</span>}
    </>
  );
}
