import { ST_ORDER, ST_DEF, statusCounts } from '../lib/status';
import { SORT_OPTIONS } from '../lib/agentUtils';

// V7 board 1 title row (2026-10-01): what am I looking at + what is filtering
// it. The chips are a read-out of the SAME filter state as the action row —
// each ✕ just calls that filter's existing setter. The legend is the old
// StatusLegend (still a status filter), moved up beside the title.
export default function LibraryTitle({
  agents, title, sort,
  // SDLC (boards 7–8) passes `count` instead: "SDLC AI Adoption · 58 processes".
  count,
  chips = [],
  selectedStatus, onStatusClick,
  layout, setLayout,
}) {
  const counts = statusCounts(agents);
  const sortLabel = (SORT_OPTIONS.find(([v]) => v === sort) || [])[1];
  const n = agents.length;

  function toggleStatus(s) {
    const next = new Set(selectedStatus);
    if (next.has(s)) next.delete(s); else next.add(s);
    onStatusClick(next);
  }

  return (
    <div className="v7-title">
      <div className="v7-title-text">
        <h1>{title}{count && <span className="v7-title-count"> · {count}</span>}</h1>
        {!count && <p>
          Showing <strong>{n}</strong> Agents &amp; Skills
          {sortLabel && <> · Sorted by {sortLabel}</>}
          {chips.map((c) => (
            <span key={c.key} className="v7-chip">
              {c.label}
              <button type="button" aria-label={`Remove filter ${c.label}`} onClick={c.onRemove}>✕</button>
            </span>
          ))}
        </p>}
      </div>
      <div className="v7-title-right">
        <div className="v7-legend" role="group" aria-label="Filter by status">
          {ST_ORDER.map((s) => {
            const d = ST_DEF[s];
            const on = selectedStatus.has(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                className={`v7-lg ${on ? 'on' : ''}`}
                style={{ color: d.color, background: on ? d.bg : undefined, borderColor: on ? d.bd : undefined }}
                onClick={() => toggleStatus(s)}
                title={`Filter: ${d.lb}`}
              >
                <span className="v7-lg-dot" style={{ background: d.dot }} />
                {d.lb}
                <span className="v7-lg-n">{counts[s]}</span>
              </button>
            );
          })}
        </div>
        {setLayout && (
          <div className="v7-layout" role="group" aria-label="Layout">
            {[['cards', 'Cards', 'M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v5H4zM13 14h7v5h-7z'], ['list', 'List', 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01']].map(([k, label, d]) => (
              <button key={k} type="button" aria-pressed={layout === k} className={layout === k ? 'active' : ''} onClick={() => setLayout(k)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
