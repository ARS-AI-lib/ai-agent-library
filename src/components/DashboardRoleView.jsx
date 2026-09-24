import { useMemo, useState } from 'react';
import { ST_DEF, ST_ORDER, progressBucket } from '../lib/status';
import { getType } from '../lib/tier';
import { agentProcessIds, normalizeProgress } from '../lib/agentUtils';
import { roleGroupsOf, roleGroupLabel, ROLE_GROUP_ORDER } from '../lib/roleGroups';

/**
 * Dashboard → "Role Coverage" view (2026-09-23).
 *
 * Left: the AI-SDLC blueprint — one square per sdlcProcesses doc, coloured by
 * the furthest-along status among the agents mapped to that process.
 * Right: one card per role group with its total and an Agents/Skills split.
 *
 * Read-only. Every number is computed from the props; nothing is hardcoded and
 * nothing is written back.
 *
 * ── Why each square carries a title ──
 * The palette is the main site's status palette (locked by the brief), and it
 * was measured: adjacent-pair CVD separation passes (worst ΔE 15.7 deutan) but
 * To Do grey (2.54) and In Progress orange (2.03) sit under 3:1 against the
 * surface, and Pilot blue ↔ Ready green are only ΔE 3.3 apart under tritanopia.
 * Colour alone therefore cannot carry the meaning, so the legend is always
 * rendered and every square names its status in words on hover.
 *
 * Status rank for "furthest along". ST_ORDER already runs td → ip → pilot → ru,
 * so its index IS the rank — deriving it here instead of writing the order out
 * again keeps this in step with status.js if a bucket ever changes.
 */
const rank = (b) => ST_ORDER.indexOf(b);

// Processes are keyed by doc id. Most are "10.1"-style; the Post-Development
// and platform ones are plain names ("FinOps"). localeCompare with numeric
// ordering sorts 2.2 before 10.1 and pushes the named ones to the end.
const byProcessId = (a, b) => {
  const na = /^\d/.test(a.id), nb = /^\d/.test(b.id);
  if (na !== nb) return na ? -1 : 1;
  return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
};

export default function DashboardRoleView({ agents = [], processes = [], onProcClick, onRoleClick }) {
  // ── Blueprint: per-process coverage ──
  // `list` keeps the actual agents behind each square so the click-through opens
  // the same set the count claims — recomputing it in the parent would be a
  // second copy of the agentProcessIds() join and could drift from the number.
  const squares = useMemo(() => {
    const cnt = new Map();
    const best = new Map();
    const list = new Map();
    agents.forEach((a) => {
      // normalizeProgress first: devProgress is "90%" on CSV-imported docs and
      // 90 on UI-saved ones, and progressBucket only understands the number.
      // agentStatus() reads the raw field and would score every imported doc
      // as To Do.
      const b = progressBucket(normalizeProgress(a.devProgress));
      agentProcessIds(a).forEach((pid) => {
        cnt.set(pid, (cnt.get(pid) || 0) + 1);
        if (!list.has(pid)) list.set(pid, []);
        list.get(pid).push(a);
        if (!best.has(pid) || rank(b) > rank(best.get(pid))) best.set(pid, b);
      });
    });
    return [...processes].sort(byProcessId).map((p) => ({
      id: p.id,
      name: p.name || p.processName || p.id,
      owner: p.owner || '',
      n: cnt.get(p.id) || 0,
      st: best.get(p.id) || 'none',
      list: list.get(p.id) || [],
    }));
  }, [agents, processes]);

  const covered = squares.filter((s) => s.n > 0).length;
  const stTally = useMemo(() => {
    const t = { none: 0 };
    ST_ORDER.forEach((k) => { t[k] = 0; });
    squares.forEach((s) => { t[s.st] += 1; });
    return t;
  }, [squares]);

  // ── Role cards ──
  // An agent lands in every group its roles map to — see roleGroups.js for why.
  // getType() is the only Agent/Skill rule; agentTypeLabel() is a display
  // string ("Agent+Skill" for a parent with children) and would not add up.
  const cards = useMemo(() => {
    const m = new Map();
    agents.forEach((a) => {
      const isAgent = getType(a) === 'agent';
      roleGroupsOf(a).forEach((g) => {
        const row = m.get(g) || { group: g, agents: 0, skills: 0, list: [] };
        if (isAgent) row.agents += 1; else row.skills += 1;
        row.list.push(a);
        m.set(g, row);
      });
    });
    // Fixed order (matches the approved mock, and ROLE_GROUP_ORDER row-for-row)
    // rather than sorted by count — the count changes as the library grows and
    // a reshuffling grid is harder to scan than a stable one.
    const orderIdx = (g) => { const i = ROLE_GROUP_ORDER.indexOf(g); return i < 0 ? ROLE_GROUP_ORDER.length : i; };
    return [...m.values()]
      .map((r) => ({ ...r, total: r.agents + r.skills }))
      .sort((a, b) => orderIdx(a.group) - orderIdx(b.group));
  }, [agents]);

  const slots = cards.reduce((s, c) => s + c.total, 0);

  // Hides squares with no agent (and the matching legend row) so the map reads
  // as "what's built" instead of "what's built + what's still blank". Purely
  // client-side display state, nothing computed here changes.
  const [hideEmpty, setHideEmpty] = useState(false);
  const shownSquares = hideEmpty ? squares.filter((s) => s.n > 0) : squares;

  return (
    <div className="dash-rv-grid">
      <div className="dash-card dash-bp">
        <button
          type="button"
          className="dash-bp-hide"
          aria-pressed={hideEmpty}
          onClick={() => setHideEmpty((v) => !v)}
          title={hideEmpty ? 'Show all capabilities' : 'Hide capabilities with no agent yet'}
        >
          {hideEmpty ? '◱' : '▦'}
        </button>
        <div className="dash-bp-h">AI-SDLC Blueprint</div>
        <div className="dash-bp-sub">{processes.length} capabilities across the SDLC · {covered} covered</div>

        <div className="dash-bp-sq">
          {shownSquares.map((s) => (
            // <button> not <i>: the tile is a real control now, so it is
            // keyboard-reachable and the title stays the accessible name.
            <button
              type="button"
              key={s.id}
              data-st={s.st}
              disabled={!s.n}
              onClick={() => onProcClick?.({ id: s.id, name: s.name, owner: s.owner }, s.list)}
              title={`${/^\d/.test(s.id) ? `${s.id} ` : ''}${s.name} — ${s.st === 'none' ? 'No agent yet' : ST_DEF[s.st].lb}${s.n ? ` · ${s.n} agent${s.n > 1 ? 's' : ''}` : ''}`}
            />
          ))}
        </div>

        <div className="dash-bp-lg">
          {ST_ORDER.map((k) => (
            <span key={k}><b style={{ background: ST_DEF[k].dot }} />{ST_DEF[k].lb} {stTally[k]}</span>
          ))}
          {!hideEmpty && <span><b className="dash-bp-none" />No agent yet {stTally.none}</span>}
        </div>

      </div>

      <div>
        <div className="dash-rv-top">
          <b>{agents.length} AI total across {cards.length} roles</b>
          <span>· {slots} role slots (an agent serving 2 roles counts in both)</span>
        </div>
        <div className="dash-roles">
          {cards.map((c) => (
            <button
              type="button"
              key={c.group}
              className="dash-rc"
              onClick={() => onRoleClick?.(roleGroupLabel(c.group), c.list)}
              title={`${roleGroupLabel(c.group)} — ${c.total} item${c.total > 1 ? 's' : ''}`}
            >
              <div className="dash-rc-t">
                <div className="dash-rc-n">{roleGroupLabel(c.group)}</div>
                <div className="dash-rc-b">{c.total}</div>
              </div>
              <div className="dash-rc-s">
                {c.agents > 0 && <i><b style={{ background: 'var(--accent)' }} />{c.agents} Agent{c.agents > 1 ? 's' : ''}</i>}
                {c.skills > 0 && <i><b style={{ background: ST_DEF.ru.dot }} />{c.skills} Skill{c.skills > 1 ? 's' : ''}</i>}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
