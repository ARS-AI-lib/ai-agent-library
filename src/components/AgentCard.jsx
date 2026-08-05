import { getType, getTier, TIER_DEF, isInternalOrExternal } from '../lib/tier';
import { agentStatus, ST_DEF, progressBucket } from '../lib/status';
import { fmtDate, relationshipLabel, safeEndpointUrl, agentUseCaseNames } from '../lib/agentUtils';

// Card anatomy (2026-07 redesign, reference-matched): eyebrow (type+tier+scope
// +endpoint link) → title+pill ROW (pill always sits next to the title text
// itself, so a 2-line title never knocks the pill out of alignment with
// 1-line-title cards) → progress bar → 2-col meta grid with a FIXED field
// order and an em-dash fallback for missing values, so "Launch" (or any label)
// lands in the same grid cell across every card in a row instead of drifting
// depending on which fields a given agent happens to have.
//
// 2026-07-22: the preview card shows **Owner**, not Creator — the creator list
// is a team roster that belongs in the detail modal, while owner is the single
// accountable name a browsing user actually needs. It replaces Creator *in
// place* in the meta grid (rather than being dropped in as an extra cell or
// left as the old subtitle) precisely to keep that fixed-position guarantee
// above intact; the old `ac-owner` subtitle went away so owner isn't shown
// twice.
export default function AgentCard({ agent, allAgents, onClick }) {
  const type = getType(agent);
  const tier = getTier(agent);
  const tierDef = TIER_DEF[tier];
  const st = agentStatus(agent);
  const sd = ST_DEF[st];
  const rel = relationshipLabel(agent, allAgents);
  const progress = typeof agent.devProgress === 'number' ? agent.devProgress : 0;
  const scope = isInternalOrExternal(agent);
  const ability = Array.isArray(agent.coreAbility) ? agent.coreAbility.join(', ') : agent.coreAbility;
  const role = Array.isArray(agent.relatedRole) ? agent.relatedRole.join(', ') : agent.relatedRole;
  const endpoint = safeEndpointUrl(agent.endpoint);
  const useCaseNames = agentUseCaseNames(agent);

  return (
    <div className={`ac ${type === 'agent' ? 'isag' : 'issk'}`} onClick={() => onClick(agent)}>
      <div className="ac-eyebrow">
        <span className={`tb ${type === 'agent' ? 'tbag' : 'tbsk'}`}>{type === 'agent' ? 'AGENT' : 'SKILL'}</span>
        <span className="tier-badge" style={{ color: tierDef.color, background: tierDef.bg, borderColor: tierDef.bd }} title={tierDef.label}>
          {tier}
        </span>
        <span className="ac-scope" style={{ color: scope === 'External' ? '#0ea5e9' : 'var(--ag)' }} title={scope === 'External' ? 'Customer Facing' : 'Internal Use'}>
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
        {endpoint && (
          // stopPropagation: the whole card is a click target that opens the
          // detail modal, so without it every endpoint click would ALSO open
          // the modal behind the newly-opened tab.
          <a
            href={endpoint}
            target="_blank"
            rel="noopener noreferrer"
            className="ac-endpoint"
            onClick={(e) => e.stopPropagation()}
            title={`เปิดใช้งาน / ดาวน์โหลด: ${endpoint}`}
            aria-label="เปิด endpoint ในแท็บใหม่"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        )}
      </div>

      <div className="ac-titlerow">
        <h3 className="acname">{agent.agentName}</h3>
        <span className="status-pill" style={{ color: sd.color, background: sd.bg }}>
          <span className="status-dot" style={{ background: sd.dot || sd.color }} />
          {sd.lb}
        </span>
      </div>
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
        {useCaseNames.length > 0 && (
          <div className="ac-meta-item ac-meta-span2">
            <div className="ac-meta-label">Use case</div>
            <div className="ac-meta-value">{useCaseNames.join(', ')}</div>
          </div>
        )}
        <div className="ac-meta-item">
          <div className="ac-meta-label">{type === 'skill' ? 'Agent' : 'Skill'}</div>
          <div className="ac-meta-value" style={rel ? { color: type === 'skill' ? 'var(--ag)' : 'var(--sk)', fontWeight: 600 } : undefined}>
            {rel ? rel.label : '—'}
          </div>
        </div>
        <div className="ac-meta-item">
          <div className="ac-meta-label">Role</div>
          <div className="ac-meta-value">{role || '—'}</div>
        </div>
        <div className="ac-meta-item">
          <div className="ac-meta-label">Launch</div>
          <div className="ac-meta-value" style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDate(agent.launchDate) || '—'}</div>
        </div>
      </div>
    </div>
  );
}
