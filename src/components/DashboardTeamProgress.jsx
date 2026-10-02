import { useMemo, useState } from 'react';
import { ST_DEF, ST_ORDER, progressBucket } from '../lib/status';
import { getType } from '../lib/tier';
import { normalizeProgress } from '../lib/agentUtils';
import TagMultiSelect from './TagMultiSelect';
import Hint from './Hint';

/**
 * Dashboard → "Team Progress" (2026-09-28).
 *
 * One row per team (agent.owner): Agent / Skill counts, a stacked status bar,
 * % Progress (average progress) and % Complete (share Ready to Use). Modelled
 * on the team sheet and Portfolio's "AI Contribution by Project" card.
 *
 * Status = progressBucket() — the same bucket as every other status in the
 * app — except an item with a pending deploy request, which gets its own
 * "Deploy Pending" slice (shown only when non-zero). Colours are the site
 * legend (ST_DEF[k].dot); they are not a CVD-safe categorical set, so every
 * segment also carries a text label/tooltip and the legend has names.
 */
const DP = { lb: 'Deploy requested', dot: '#c2418b' };
const SLICES = [...ST_ORDER.slice(0, 3), 'dp', ST_ORDER[3]]; // td ip pilot dp ru
const sliceDef = (k) => (k === 'dp' ? DP : ST_DEF[k]);
const TOP = 8;
const NO_TEAM = '(No team)';

/** Team key used by the rows AND the Dashboard-wide team filter — one definition. */
export const teamOf = (a) => String(a?.owner || '').trim() || NO_TEAM;

function sliceOf(a) {
  if (a.deploymentStatus === 'requested') return 'dp';
  return progressBucket(normalizeProgress(a.devProgress));
}

export function teamRows(agents) {
  const m = new Map();
  agents.forEach((a) => {
    const team = teamOf(a);
    const r = m.get(team) || { team, agents: 0, skills: 0, sum: 0, list: [], c: Object.fromEntries(SLICES.map((k) => [k, 0])) };
    if (getType(a) === 'skill') r.skills += 1; else r.agents += 1;
    r.sum += normalizeProgress(a.devProgress);
    r.c[sliceOf(a)] += 1;
    r.list.push(a);
    m.set(team, r);
  });
  return [...m.values()]
    .map((r) => {
      const n = r.list.length;
      return { ...r, n, progress: Math.round(r.sum / n), complete: Math.round((r.c.ru / n) * 100) };
    })
    .sort((x, y) => y.n - x.n || x.team.localeCompare(y.team));
}

function Row({ r, onOpen }) {
  return (
    <button type="button" className="dash-tp-row" onClick={() => onOpen(r)} title={`${r.team} — ${r.n} items`}>
      <span className="dash-tp-name">{r.team}</span>
      <span className="dash-tp-num">{r.agents}</span>
      <span className="dash-tp-num">{r.skills}</span>
      <span className="dash-tp-bar">
        {SLICES.filter((k) => r.c[k] > 0).map((k) => {
          const share = r.c[k] / r.n;
          const label = share >= 0.3 ? `${sliceDef(k).lb} (${r.c[k]})` : share >= 0.06 ? String(r.c[k]) : '';
          return (
            <i key={k} data-s={k} style={{ flexGrow: r.c[k], background: sliceDef(k).dot }} title={`${sliceDef(k).lb} · ${r.c[k]} item${r.c[k] > 1 ? 's' : ''}`}>
              {label}
            </i>
          );
        })}
      </span>
      <span className="dash-tp-pct"><em>Progress</em>{r.progress}%</span>
      <span className="dash-tp-pct"><em>Complete</em>{r.complete}%</span>
    </button>
  );
}

function Table({ rows, onOpen }) {
  return (
    <div className="dash-tp">
      <div className="dash-tp-head">
        <span>Team</span><span>Agent</span><span>Skill</span><span>Status</span><span>% Progress</span><span>% Complete</span>
      </div>
      {rows.map((r) => <Row key={r.team} r={r} onOpen={onOpen} />)}
    </div>
  );
}

export default function DashboardTeamProgress({ agents = [], onOpenTeam, teamOptions = [], selectedTeams, onTeamsChange }) {
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => teamRows(agents), [agents]);
  const used = SLICES.filter((k) => rows.some((r) => r.c[k] > 0));
  const open = (r) => { setShowAll(false); onOpenTeam?.(r.team, r.list); };

  return (
    <div className="dash-card">
      <div className="dash-tp-top">
        <div className="dash-card-title">Team Progress</div>
        {onTeamsChange && (
          <div className="dash-tp-filter">
            <TagMultiSelect label="Filter teams…" options={teamOptions} selected={selectedTeams} onChange={onTeamsChange} allowNew={false} />
          </div>
        )}
      </div>
      <div className="dash-card-sub dash-mb">By team and status <Hint text="AI ของแต่ละทีมแยกตามสถานะ — คลิกแถวเพื่อดูรายการ" /></div>
      <Table rows={rows.slice(0, TOP)} onOpen={open} />
      {rows.length > TOP && (
        <button type="button" className="dash-more" onClick={() => setShowAll(true)}>View all {rows.length} teams ›</button>
      )}
      <div className="dash-lg">
        {used.map((k) => <span key={k}><b style={{ background: sliceDef(k).dot }} />{sliceDef(k).lb}</span>)}
      </div>
      <div className="dash-tp-note">How % is calculated <Hint text="% Progress = ค่าเฉลี่ย progress ของ AI ในทีม · % Complete = สัดส่วนที่ Ready to Use" /></div>

      {showAll && (
        <div className="sdlc-ovl" onClick={() => setShowAll(false)}>
          <div className="sdlc-mbox dash-tp-modal" onClick={(e) => e.stopPropagation()}>
            <button className="sdlc-mclose" onClick={() => setShowAll(false)}>✕</button>
            <div className="sdlc-msub">Team Progress</div>
            <div className="sdlc-mtitle">All teams ({rows.length})</div>
            <Table rows={rows} onOpen={open} />
          </div>
        </div>
      )}
    </div>
  );
}
