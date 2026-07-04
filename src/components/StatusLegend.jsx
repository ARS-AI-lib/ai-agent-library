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
        {ST_ORDER.map((s, i) => {
          const d = ST_DEF[s];
          const on = selected.has(s);
          const inner = (
            <>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: d.dot, display: 'inline-block' }} />
              <span style={{ color: d.color, fontWeight: 600 }}>{d.lb}</span>
              <span style={{ fontWeight: 700, color: d.color }}>{counts[s]}</span>
            </>
          );
          return (
            <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {clickable ? (
                <button
                  type="button"
                  className={`lg lg-btn ${on ? 'on' : ''}`}
                  style={on ? { color: d.color } : undefined}
                  onClick={() => {
                    const next = new Set(selected);
                    if (on) next.delete(s); else next.add(s);
                    onStatusClick(next);
                  }}
                  title={on ? 'คลิกเพื่อยกเลิกตัวกรองนี้' : `เพิ่มตัวกรอง ${d.lb}`}
                >
                  {inner}
                </button>
              ) : (
                <span className="lg">{inner}</span>
              )}
              {i < ST_ORDER.length - 1 && <span className="lsep" />}
            </span>
          );
        })}
      </div>
      {actions && <div className="legend-actions">{actions}</div>}
    </div>
  );
}
