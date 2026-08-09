import { ST_ORDER, ST_DEF, statusCounts } from '../lib/status';

// The legend doubles as a status filter: clicking a status chip toggles that
// status in/out of a multi-select filter set (click an active chip to remove
// it). onStatusClick/selectedStatus are optional — when omitted the chips
// render as plain (non-interactive) labels, preserving the old read-only
// behaviour. selectedStatus is a Set<string> of active statuses (empty Set =
// no filter, matching the old `null` behaviour).
export default function StatusLegend({ agents, actions, onStatusClick, selectedStatus }) {
  const counts = statusCounts(agents);
  const clickable = typeof onStatusClick === 'function';
  const selected = selectedStatus instanceof Set ? selectedStatus : new Set();
  return (
    <div className="legend">
      <div className="legend-items">
        {ST_ORDER.map((s) => {
          const d = ST_DEF[s];
          const on = selected.has(s);
          // The dot keeps ST_DEF's saturated `dot` hex (identical in both
          // themes — that mapping is what the legend exists to teach); the
          // label/count use the theme-aware `color` token.
          const inner = (
            <>
              <span className="lg-dot" style={{ background: d.dot }} />
              <span style={{ color: d.color, fontWeight: 600 }}>{d.lb}</span>
              <span className="lg-n" style={{ color: d.color }}>{counts[s]}</span>
            </>
          );
          if (!clickable) return <span key={s} className="lg-item">{inner}</span>;
          return (
            <button
              key={s}
              type="button"
              className={`lg-item ${on ? 'on' : ''}`}
              style={on ? { color: d.color } : undefined}
              aria-pressed={on}
              onClick={() => {
                const next = new Set(selected);
                if (on) next.delete(s); else next.add(s);
                onStatusClick(next);
              }}
              title={on ? 'คลิกเพื่อยกเลิกตัวกรองนี้' : `เพิ่มตัวกรอง ${d.lb}`}
            >
              {inner}
            </button>
          );
        })}
      </div>
      {actions && <div className="legend-actions">{actions}</div>}
    </div>
  );
}
