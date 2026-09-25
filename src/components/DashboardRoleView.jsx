import { useMemo } from 'react';
import { HITL_DEF, HITL_ORDER, hitlLevel } from '../lib/status';
import { getType } from '../lib/tier';
import { agentProcessIds, normalizeProgress } from '../lib/agentUtils';
import { useRoleGroups } from '../hooks/useRoleGroups';

/**
 * Dashboard → "Role Coverage" (2026-09-23, reworked 2026-09-24).
 *
 * Left: the AI-SDLC blueprint — one square per sdlcProcesses doc, coloured by
 * how much of that capability's work AI carries (hitlLevel in status.js):
 * Human (no agent yet, or To Do) · Gen AI + Human (In Progress, Pilot, Ready with hml) ·
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
function primaryGroupOf(a, rg) {
  if (rg.has(a.roleGroup)) return { group: a.roleGroup, fallback: false };
  const g = rg.groupsOf(a)[0];
  return g ? { group: g, fallback: true } : null;
}

export default function DashboardRoleView({ agents = [], processes = [], onProcClick, onRoleClick }) {
  // Groups, labels, order and role aliases come from /config/roleGroups.
  const rg = useRoleGroups();
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
      // No agent yet = work is still fully human (user rule 2026-09-24).
      let lv = 'human';
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

  // "covered" = capabilities where AI is already working alongside people
  // (the Gen AI + Human / orange level) — user rule 2026-09-25.
  const covered = squares.filter((s) => s.lv === 'mixed').length;
  const lvTally = useMemo(() => {
    const t = { human: 0, mixed: 0, ai: 0 };
    squares.forEach((s) => { t[s.lv] += 1; });
    return t;
  }, [squares]);

  // ── Role cards: one primary group per item ──
  const { cards, pending } = useMemo(() => {
    const m = new Map();
    let fb = 0;
    agents.forEach((a) => {
      const pg = primaryGroupOf(a, rg);
      if (!pg) return;
      if (pg.fallback) fb += 1;
      const row = m.get(pg.group) || { group: pg.group, agents: 0, skills: 0, list: [] };
      if (getType(a) === 'agent') row.agents += 1; else row.skills += 1;
      row.list.push(a);
      m.set(pg.group, row);
    });
    const orderIdx = (g) => { const i = rg.order.indexOf(g); return i < 0 ? rg.order.length : i; };
    return {
      cards: [...m.values()]
        .map((r) => ({ ...r, total: r.agents + r.skills }))
        .sort((a, b) => orderIdx(a.group) - orderIdx(b.group)),
      pending: fb,
    };
  }, [agents, rg]);

  const counted = cards.reduce((s, c) => s + c.total, 0);

  const tileTitle = (s) => {
    const head = `${/^\d/.test(s.id) ? `${s.id} ` : ''}${s.name}`;
    if (!s.n) return `${head} — Human · no agent yet`;
    const split = HITL_ORDER.filter((k) => s.c[k]).map((k) => `${HITL_DEF[k].lb} ${s.c[k]}`).join(' · ');
    return `${head} — ${HITL_DEF[s.lv].lb} · ${s.n} agent${s.n > 1 ? 's' : ''} (${split})`;
  };

  return (
    <div className="dash-rv-grid">
      <div className="dash-card dash-bp">
        <div className="dash-bp-h">AI-SDLC Blueprint</div>
        <div className="dash-bp-sub">{processes.length} capabilities across the SDLC · {covered} covered</div>

        <div className="dash-bp-sq">
          {squares.map((s) => (
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
          {HITL_ORDER.filter((k) => lvTally[k] > 0).map((k) => (
            <span key={k} className="dash-bp-chip" data-lv={k}>{HITL_DEF[k].lb} <em>{lvTally[k]}</em></span>
          ))}
        </div>
      </div>

      <div className="dash-rv-right">
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
              onClick={() => onRoleClick?.(rg.labelOf(c.group), c.list)}
              title={`${rg.labelOf(c.group)} — ${c.total} item${c.total > 1 ? 's' : ''}`}
            >
              <div className="dash-rc-t">
                <div className="dash-rc-n">{rg.labelOf(c.group)}</div>
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
