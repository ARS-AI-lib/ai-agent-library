import { useMemo, useState } from 'react';
import { HITL_DEF, HITL_ORDER, hitlLevel } from '../lib/status';
import { getType } from '../lib/tier';
import { agentProcessIds, normalizeProgress } from '../lib/agentUtils';
import { roleGroupsOf, roleGroupLabel, ROLE_GROUP_ORDER } from '../lib/roleGroups';

/**
 * Dashboard → "Role Coverage" (2026-09-23, reworked 2026-09-24).
 *
 * Left: the AI-SDLC blueprint — one square per sdlcProcesses doc, coloured by
 * how much of that capability's work AI carries (hitlLevel in status.js):
 * Human (To Do) · Gen AI + Human (In Progress, Pilot, Ready with hml) ·
 * Gen AI (Ready without a human in the loop). The colours are the ones the
 * user specified for this view only — the rest of the Dashboard keeps ST_DEF.
 * A square takes the level MOST of its agents are at; ties lean to the more
 * AI-driven level.
 *
 * Right: one card per role group, each agent/skill counted ONCE by its stored
 * PRIMARY group (agent.roleGroup, written by the classifyRoleGroup Cloud
 * Function — functions/roleGroupRules.js). An item not classified yet falls
 * back to the first alias match (roleGroupsOf) so it never drops off the
 * page; the header says how many are waiting.
 *
 * Read-only: nothing here writes.
 */
const TIE_RANK = { ai: 3, mixed: 2, human: 1 };

// Processes are keyed by doc id. Most are "10.1"-style; the Post-Development
// and platform ones are plain names ("FinOps"). localeCompare with numeric
// ordering sorts 2.2 before 10.1 and pushes the named ones to the end.
const byProcessId = (a, b) => {
  const na = /^\d/.test(a.id), nb = /^\d/.test(b.id);
  if (na !== nb) return na ? -1 : 1;
  return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
};

/** Stored primary group, else the alias fallback. `null` only if neither exists. */
function primaryGroupOf(a) {
  if (ROLE_GROUP_ORDER.includes(a.roleGroup)) return { group: a.roleGroup, fallback: false };
  const g = roleGroupsOf(a)[0];
  return g ? { group: g, fallback: true } : null;
}

export default function DashboardRoleView({ agents = [], processes = [], onProcClick, onRoleClick }) {
  // ── Blueprint: per-process level ──
  // `list` keeps the actual agents behind each square so the click-through
  // opens the same set the count claims.
  const squares = useMemo(() => {
    const byPid = new Map();
    agents.forEach((a) => {
      const lv = hitlLevel(normalizeProgress(a.devProgress), a.hml);
      agentProcessIds(a).forEach((pid) => {
        if (!byPid.has(pid)) byPid.set(pid, { list: [], c: { human: 0, mixed: 0, ai: 0 } });
        const e = byPid.get(pid);
        e.list.push(a);
        e.c[lv] += 1;
      });
    });
    return [...processes].sort(byProcessId).map((p) => {
      const e = byPid.get(p.id);
      let lv = 'none';
      if (e) {
        lv = HITL_ORDER.reduce((best, k) => (
          e.c[k] > e.c[best] || (e.c[k] === e.c[best] && TIE_RANK[k] > TIE_RANK[best]) ? k : best
        ), 'human');
      }
      return {
        id: p.id,
        name: p.name || p.processName || p.id,
        owner: p.owner || '',
        n: e ? e.list.length : 0,
        lv,
        c: e ? e.c : null,
        list: e ? e.list : [],
      };
    });
  }, [agents, processes]);

  const covered = squares.filter((s) => s.n > 0).length;
  const lvTally = useMemo(() => {
    const t = { none: 0, human: 0, mixed: 0, ai: 0 };
    squares.forEach((s) => { t[s.lv] += 1; });
    return t;
  }, [squares]);

  // ── Role cards: one primary group per item ──
  const { cards, pending } = useMemo(() => {
    const m = new Map();
    let fb = 0;
    agents.forEach((a) => {
      const pg = primaryGroupOf(a);
      if (!pg) return;
      if (pg.fallback) fb += 1;
      const row = m.get(pg.group) || { group: pg.group, agents: 0, skills: 0, list: [] };
      if (getType(a) === 'agent') row.agents += 1; else row.skills += 1;
      row.list.push(a);
      m.set(pg.group, row);
    });
    const orderIdx = (g) => { const i = ROLE_GROUP_ORDER.indexOf(g); return i < 0 ? ROLE_GROUP_ORDER.length : i; };
    return {
      cards: [...m.values()]
        .map((r) => ({ ...r, total: r.agents + r.skills }))
        .sort((a, b) => orderIdx(a.group) - orderIdx(b.group)),
      pending: fb,
    };
  }, [agents]);

  const counted = cards.reduce((s, c) => s + c.total, 0);

  // Hides squares with no agent (and the matching legend row). Display-only.
  const [hideEmpty, setHideEmpty] = useState(false);
  const shownSquares = hideEmpty ? squares.filter((s) => s.n > 0) : squares;

  const tileTitle = (s) => {
    const head = `${/^\d/.test(s.id) ? `${s.id} ` : ''}${s.name}`;
    if (s.lv === 'none') return `${head} — No agent yet`;
    const split = HITL_ORDER.filter((k) => s.c[k]).map((k) => `${HITL_DEF[k].lb} ${s.c[k]}`).join(' · ');
    return `${head} — ${HITL_DEF[s.lv].lb} · ${s.n} agent${s.n > 1 ? 's' : ''} (${split})`;
  };

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
            <button
              type="button"
              key={s.id}
              data-lv={s.lv}
              disabled={!s.n}
              onClick={() => onProcClick?.({ id: s.id, name: s.name, owner: s.owner }, s.list)}
              title={tileTitle(s)}
            />
          ))}
        </div>

        <div className="dash-bp-lg">
          {HITL_ORDER.map((k) => (
            <span key={k} className="dash-bp-chip" data-lv={k}>{HITL_DEF[k].lb} <em>{lvTally[k]}</em></span>
          ))}
          {!hideEmpty && <span className="dash-bp-chip" data-lv="none">No agent yet <em>{lvTally.none}</em></span>}
        </div>
      </div>

      <div>
        <div className="dash-rv-top">
          <b>{agents.length} AI total across {cards.length} roles</b>
          <span>
            · each counted once by its primary role
            {pending > 0 && ` · ${pending} awaiting classification`}
            {counted !== agents.length && ` · ${agents.length - counted} without a role`}
          </span>
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
                {c.skills > 0 && <i><b style={{ background: '#15803d' }} />{c.skills} Skill{c.skills > 1 ? 's' : ''}</i>}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
