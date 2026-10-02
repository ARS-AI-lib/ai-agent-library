import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { agentStatus, ST_DEF, progressBucket } from '../lib/status';
import { getType, getTier, TIER_DEF } from '../lib/tier';
import { uniq, splitRoles, relationshipLabel, fmtDate, extractProcessId, agentProcessIds, agentUseCaseNames } from '../lib/agentUtils';
import MultiSelect from './MultiSelect';
import Dropdown from './Dropdown';
import LibraryTitle from './LibraryTitle';
import useIsMobile from '../hooks/useIsMobile';
import FilterSheet, { FiltersButton } from './FilterSheet';
import '../styles/SDLCTab.css';

// Stage palette — SINGLE source of truth (2026-07 redesign fix: this used to
// be duplicated with different values in GROUPS.sub vs STAGE_COLOR, so
// "Initiation" rendered orange in the Use-Case view but blue in the Process
// View — same stage, two colors. Also muted/desaturated per user's pick
// (grill-me A/B comparison) so 6+ stage colors sitting side-by-side in the
// board don't visually fight each other.
const STAGE_COLOR = { Initiation: '#a9754a', Discovery: '#4d6b96', Design: '#7d6a9e', Build: '#4d8c7c', Test: '#8c6b45', Deployment: '#a85f5f', 'Post Development': '#9c6478' };

// ── Board structure (faithful port of ADOPT_GROUPS) ──
const GROUPS = [
  { label: 'Discovery', merged: false, sub: [
    { label: 'INITIATION', stage: 'Initiation' },
    { label: 'DISCOVERY', stage: 'Discovery' },
  ]},
  { label: 'Development', merged: false, sub: [
    { label: 'DESIGN', stage: 'Design' },
    { label: 'BUILD', stage: 'Build' },
    { label: 'TEST', stage: 'Test' },
    { label: 'DEPLOYMENT', stage: 'Deployment' },
  ]},
  { label: 'After Development', merged: true, sub: [
    { label: 'POST DEVELOPMENT', stage: 'Post Development' },
  ]},
];

const ALL_STAGES = GROUPS.flatMap((g) => g.sub.map((s) => s.stage));
const STATUS_ICON = { td: '◦', ip: '●', pilot: '◆', ru: '✓' };
const PRIORITY = ['ru', 'pilot', 'ip', 'td'];
// Weight per status (To Do lowest → Ready-to-Use highest) and the inverse map,
// used only for the tie-break average below.
const WEIGHT_STATUS = { 1: 'td', 2: 'ip', 3: 'pilot', 4: 'ru' };

// The colour a process card takes = the status holding the LARGEST share of the
// card's agents (plurality/mode), NOT the most-advanced status present. The old
// rule picked the highest status with any count at all, so a card of 3 To-Do +
// 1 Pilot looked blue (Pilot) instead of grey. On a TIE for the top count, fall
// back to the weighted average across every agent and round HALF DOWN
// (conservative — an evenly-split card shouldn't read as more mature than it
// is), then map that middle value back to a status.
function dominantStatus(counts) {
  const total = counts.td + counts.ip + counts.pilot + counts.ru;
  if (total === 0) return 'td';
  const max = Math.max(counts.td, counts.ip, counts.pilot, counts.ru);
  const top = ['td', 'ip', 'pilot', 'ru'].filter((s) => counts[s] === max);
  if (top.length === 1) return top[0];
  const avg = ((counts.td * 1) + (counts.ip * 2) + (counts.pilot * 3) + (counts.ru * 4)) / total;
  const idx = Math.max(1, Math.min(4, Math.ceil(avg - 0.5)));  // round half down
  return WEIGHT_STATUS[idx];
}

// Owner / relationship-label / role tags for a mini agent row — deduped by
// visible text (2026-07 fix): owner and relatedRole are different fields
// that can legitimately hold the same string (e.g. a team literally named
// "BA" whose related role is also "BA"), which rendered as two identical
// adjacent pills. Same text only ever shows once, first field wins.
function tagRow(a, t, rel) {
  const roleText = a.relatedRole ? (Array.isArray(a.relatedRole) ? a.relatedRole.join(', ') : a.relatedRole) : '';
  const seen = new Set();
  const tags = [];
  if (a.owner && !seen.has(a.owner)) { seen.add(a.owner); tags.push({ key: 'owner', text: a.owner }); }
  if (rel && !seen.has(rel.label)) { seen.add(rel.label); tags.push({ key: 'rel', text: rel.label, color: t === 'skill' ? 'var(--ag)' : 'var(--sk)' }); }
  if (roleText && !seen.has(roleText)) { seen.add(roleText); tags.push({ key: 'role', text: roleText }); }
  return tags.map((tag) => (
    <span key={tag.key} className="ttag" style={tag.color ? { color: tag.color } : undefined}>{tag.text}</span>
  ));
}

// devProgress is a string like "90%" — coerce to number for agentStatus()
function withProgress(agent) {
  const prog = agent?.devProgress;
  const num = typeof prog === 'number' ? prog : parseInt(String(prog || '').replace('%', ''), 10);
  return { ...agent, devProgress: isNaN(num) ? 0 : num };
}

function sortProcs(procs) {
  return [...procs].sort((a, b) => {
    const aNum = /^\d/.test(a.id), bNum = /^\d/.test(b.id);
    if (aNum && bNum) return parseFloat(a.id) - parseFloat(b.id) || a.id.localeCompare(b.id);
    if (aNum) return -1;
    if (bNum) return 1;
    return a.id.localeCompare(b.id);
  });
}

const pct = (a, b) => (b === 0 ? 0 : Math.round((a / b) * 100));

export default function SDLCTab({ agents = [], search = '', onVisibleAgentsChange, onAgentClick, legendActions, schema = {} }) {
  const [processes, setProcesses] = useState([]);
  const [useCases, setUseCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showUseCases, setShowUseCases] = useState(false);
  // V7 mobile: filters move into a bottom sheet (same controls, same state).
  const isMobile = useIsMobile();
  const [filterSheet, setFilterSheet] = useState(false);
  const [adoptView, setAdoptView] = useState('by-stage');
  const [stage, setStage] = useState('all');
  const [owner, setOwner] = useState(new Set());
  const [role, setRole] = useState(new Set());
  const [reusable, setReusable] = useState(new Set());
  const [hasAgent, setHasAgent] = useState(false);
  const [nonSdlcOnly, setNonSdlcOnly] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState(new Set());
  const [modal, setModal] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [procSnap, ucSnap] = await Promise.all([
          getDocs(collection(db, 'sdlcProcesses')),
          getDocs(collection(db, 'sdlcUseCases')),
        ]);
        if (!active) return;
        setProcesses(procSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setUseCases(ucSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.error('Error loading SDLC data:', e);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  function toggleUseCases() {
    setShowUseCases((v) => {
      const next = !v;
      if (next) setAdoptView('by-stage'); else setStage('all');
      return next;
    });
  }
  function changeAdoptView(v) { setAdoptView(v); if (v !== 'by-stage') setStage('all'); }
  function clearFilters() {
    setShowUseCases(false); setHasAgent(false); setNonSdlcOnly(false); setAdoptView('by-stage');
    setStage('all'); setOwner(new Set()); setRole(new Set()); setReusable(new Set()); setSelectedStatus(new Set());
  }

  // Unioned with /config/schema.team (2026-08-10) — same reasoning as App.jsx's
  // Library-tab Owner filter.
  const ownerOptions = uniq([...(schema.team || []), ...agents.map((a) => a.owner)]).sort();
  const roleOptions = uniq(agents.flatMap((a) => splitRoles(a.relatedRole))).sort();
  const reusableOptions = uniq(agents.map((a) => a.reusable).filter(Boolean)).sort();

  // Shared agent filter (Owner + Role + Reusable + search)
  const visAgents = useMemo(() => agents.filter((a) => {
    if (owner.size > 0 && !owner.has(a.owner || '')) return false;
    if (role.size > 0) {
      const roles = splitRoles(a.relatedRole);
      if (!roles.some((r) => role.has(r))) return false;
    }
    if (reusable.size > 0 && !reusable.has(a.reusable || '')) return false;
    // Legend status filter — board cards + use-case cards both derive from
    // visAgents, so filtering here makes the whole board respect the click.
    if (selectedStatus.size > 0 && !selectedStatus.has(agentStatus(withProgress(a)))) return false;
    if (search) {
      const q = search.toLowerCase();
      const coreAbility = Array.isArray(a.coreAbility) ? a.coreAbility.join(' ') : (a.coreAbility || '');
      const hay = `${a.agentName || ''} ${a.owner || ''} ${a.description || ''} ${coreAbility} ${a.relatedRole || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [agents, owner, role, reusable, selectedStatus, search]);

  const agentsForProcess = (procId) => visAgents.filter((a) => agentProcessIds(a).includes(procId));
  // Matching on name alone double-counted an agent under every process that
  // happened to share a Use Case label — 21 names in the catalog were
  // duplicated across processes (2026-08-11 audit), so e.g. "TC Writer"
  // (sdlcProcessMapping = 11.2) also rendered under 7.3 just because a
  // same-named UC doc existed there too. Once the name matches, also require
  // the agent's OWN sdlcProcessMapping to include this UC's process — unless
  // the agent has no process mapping at all (a handful of legacy agents carry
  // a useCase with an empty sdlcProcessMapping), in which case there's no way
  // to disambiguate and the old name-only behavior is kept as a fallback.
  const agentsForUC = (uc) => visAgents.filter((a) => {
    const names = agentUseCaseNames(a);
    if (!names.some((n) => n.toLowerCase() === uc.name.toLowerCase())) return false;
    const pids = agentProcessIds(a);
    if (pids.length === 0) return true;
    return pids.includes(uc.processId);
  });

  // "Non-SDLC" = agents/skills that pass every active filter but never render
  // on the board because they aren't mapped to any real SDLC process (board
  // view) or use case (UC view). Before this they silently vanished, making
  // the legend/nav counters (which count all of visAgents) disagree with what's
  // on screen. The definition legitimately differs per view because the two
  // views attach agents by different keys (process id vs useCase name).
  const nonSdlcBoard = useMemo(() => {
    const procIdSet = new Set(processes.map((p) => p.id));
    return visAgents.filter((a) => !agentProcessIds(a).some((id) => procIdSet.has(id)));
  }, [visAgents, processes]);

  // UC view splits its leftover agents into two distinct groups (2026-07-xx —
  // "Non-SDLC" was misleadingly catching agents that DO have a real Stage/
  // Process, just no Use Case picked yet): "missing Use Case only" (has a
  // valid process mapping) vs true "Non-SDLC" (no process mapping at all,
  // same definition as nonSdlcBoard above).
  const noUseCaseOnly = useMemo(() => {
    const ucNameSet = new Set(useCases.map((u) => (u.name || '').toLowerCase()));
    const procIdSet = new Set(processes.map((p) => p.id));
    return visAgents.filter((a) =>
      !agentUseCaseNames(a).some((n) => ucNameSet.has(n.toLowerCase()))
      && agentProcessIds(a).some((id) => procIdSet.has(id))
    );
  }, [visAgents, useCases, processes]);

  // "Non-SDLC" must mean the exact same thing everywhere in this tab — an
  // agent with no matching process — regardless of its (possibly stale/
  // inconsistent) useCase field. This is deliberately the SAME set as
  // nonSdlcBoard (not filtered by useCase at all), so the count reconciles
  // between the always-visible board card and the Non-SDLC filter view
  // (2026-07 bug: a handful of agents have no valid process match yet still
  // carry a useCase string that happens to match the catalog — they used to
  // fall out of this bucket silently, undercounting it vs. nonSdlcBoard).
  const nonSdlcUC = nonSdlcBoard;

  // The legend/counters used to be narrowed by the Process Owner filter
  // (removed 2026-09-23). With that filter gone there is no process-level
  // filter left, so the agents on screen are exactly visAgents — and the
  // Non-SDLC group no longer has a case where it must be hidden to keep the
  // counters reconciled.
  const legendAgents = visAgents;

  useEffect(() => {
    onVisibleAgentsChange?.(legendAgents);
  }, [legendAgents, onVisibleAgentsChange]);

  if (loading) {
    return <div className="sdlc-tab"><div className="sdlc-empty">Loading…</div></div>;
  }

  // ── PROCESS BOARD CARD ──
  function ProcessCard({ proc }) {
    const ags = agentsForProcess(proc.id);
    if (hasAgent && !ags.length) return null;

    const counts = { td: 0, ip: 0, pilot: 0, ru: 0 };
    ags.forEach((a) => { counts[agentStatus(withProgress(a))]++; });

    const dominant = dominantStatus(counts);
    const empty = ags.length === 0;
    const breakdown = PRIORITY.filter((s) => counts[s] > 0).map((s) => `${counts[s]} ${ST_DEF[s].lb}`).join(', ');

    return (
      <div
        className={`aproc ${dominant}${empty ? ' empty' : ''}`}
        onClick={() => setModal({ title: `${proc.id} — ${proc.name}`, agents: ags })}
      >
        <div className="aproc-num">{proc.id}</div>
        <div className="aproc-name">{proc.name}</div>
        <div className="aproc-count">
          {empty ? <span style={{ color: '#9ca3af' }}>No agents</span> : `${STATUS_ICON[dominant]} ${breakdown}`}
        </div>
      </div>
    );
  }

  // Full-width summary card shown UNDER the board — same visual language as an
  // .aproc process card, but spanning the whole board width. Clicking it opens
  // the shared modal listing the Non-SDLC agents/skills.
  function NonSdlcBoardCard() {
    const ags = nonSdlcBoard;
    const counts = { td: 0, ip: 0, pilot: 0, ru: 0 };
    ags.forEach((a) => { counts[agentStatus(withProgress(a))]++; });
    const dominant = dominantStatus(counts);
    const breakdown = PRIORITY.filter((s) => counts[s] > 0).map((s) => `${counts[s]} ${ST_DEF[s].lb}`).join(', ');
    return (
      <div
        className={`aproc ${dominant}`}
        style={{ width: '100%', marginTop: 10 }}
        onClick={() => setModal({ title: 'Non-SDLC — not mapped to an SDLC process', agents: ags })}
      >
        <div className="aproc-num">Non-SDLC</div>
        <div className="aproc-name">Agent / Skill not mapped to an SDLC process — not shown in the table above</div>
        <div className="aproc-count">{STATUS_ICON[dominant]} {ags.length} total{breakdown ? ` · ${breakdown}` : ''}</div>
      </div>
    );
  }

  // "Non-SDLC" filter view — shared by both Board and Use Case view (2026-07-xx:
  // toggling this filter should surface BOTH incomplete-SDLC-info groups no
  // matter which view you're on, since "Missing Use Case" only exists as a
  // concept in the UC view otherwise and would silently vanish from Board view).
  function renderNonSdlcFilter() {
    if (noUseCaseOnly.length === 0 && nonSdlcUC.length === 0) {
      return <div className="sdlc-empty">ไม่มี Agent/Skill ที่อยู่นอก SDLC</div>;
    }
    return (
      <>
        {noUseCaseOnly.length > 0 && (
          <div className="sb">
            <div className="sh">
              <div className="sbar" style={{ background: '#8c6b45' }} />
              <span className="sname" style={{ color: '#8c6b45' }}>Missing Use Case</span>
              <span className="sbadge">{noUseCaseOnly.length} items</span>
              <span className="scov">มี Stage/Process แล้ว แต่ยังไม่ระบุ Use Case</span>
            </div>
            <div className="uc-grid">
              {noUseCaseOnly.map((a) => <NonSdlcUCCard key={a.id} agent={a} />)}
            </div>
          </div>
        )}
        {nonSdlcUC.length > 0 && (
          <div className="sb">
            <div className="sh">
              <div className="sbar" style={{ background: '#7a85a3' }} />
              <span className="sname" style={{ color: '#7a85a3' }}>Non-SDLC</span>
              <span className="sbadge">{nonSdlcUC.length} items</span>
              <span className="scov">Agent/Skill not mapped to an SDLC process</span>
            </div>
            <div className="uc-grid">
              {nonSdlcUC.map((a) => <NonSdlcUCCard key={a.id} agent={a} />)}
            </div>
          </div>
        )}
      </>
    );
  }

  function renderBoard() {
    // "Non-SDLC" filter isolates the process-less agents — hide the whole
    // stage/process board and show only the Non-SDLC summary card.
    if (nonSdlcOnly) {
      return renderNonSdlcFilter();
    }
    return (
      <>
      <div className="adopt-board">
        {GROUPS.map((grp) => (
          <div key={grp.label} className="adopt-grp" style={{ flex: grp.sub.length }}>
            {!grp.merged && <div className="adopt-grp-hdr">{grp.label}</div>}
            <div className="adopt-sub-row">
              {grp.sub.map((sub) => {
                const procs = sortProcs(processes.filter((p) => p.stage === sub.stage));
                const subColor = STAGE_COLOR[sub.stage] || '#7a85a3';
                return (
                  <div key={sub.stage} className="adopt-subcol" style={{ flex: 1 }}>
                    {grp.merged ? (
                      <div className="adopt-grp-hdr adopt-grp-hdr--merged">{sub.label}</div>
                    ) : (
                      <div className="adopt-sub-hdr" style={{ background: `${subColor}18`, color: subColor, borderBottom: `2px solid ${subColor}40` }}>
                        {sub.label}
                      </div>
                    )}
                    <div className="adopt-cards">
                      {procs.map((proc) => <ProcessCard key={proc.id} proc={proc} />)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {nonSdlcBoard.length > 0 && <NonSdlcBoardCard />}
      </>
    );
  }

  // ── USE CASE CARD ──
  function UCCard({ uc }) {
    const ags = agentsForUC(uc);
    const proc = processes.find((p) => p.id === uc.processId);
    const procColor = STAGE_COLOR[proc?.stage] || '#7a85a3';
    const cov = ags.length > 0;
    return (
      <div
        className={`uc-card ${cov ? 'cov' : 'emp'}`}
        onClick={() => setModal({ title: uc.name, sub: `${uc.processId} ${uc.processName}`, procOwner: proc?.owner, agents: ags })}
      >
        <div className="uc-meta">
          <span className="uc-id">{uc.processId}</span>
          <span className="uc-proc" style={{ background: `${procColor}15`, color: procColor, border: `1px solid ${procColor}30` }}>
            {uc.processName}
          </span>
        </div>
        {proc?.owner && <div className="uc-powner">Process Owner: {proc.owner}</div>}
        <div className="uc-name">{uc.name}</div>
        <div className="uc-alist">
          {ags.length > 0 ? ags.map((a) => {
            const t = getType(a);
            const rel = relationshipLabel(a, agents);
            const progress = typeof a.devProgress === 'number' ? a.devProgress : 0;
            return (
              <div
                key={a.id}
                className={`uc-arow ${t}`}
                style={{ cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); onAgentClick?.(a); }}
              >
                <span className={`uc-tb ${t === 'agent' ? 'tbag' : 'tbsk'}`}>{t.toUpperCase()}</span>
                <div className="uc-abody">
                  <div className="uc-aname">{a.agentName}</div>
                  <div className="uc-afoot">
                    {tagRow(a, t, rel)}
                  </div>
                  <div className="ac-progress-row" style={{ margin: '6px 0 0' }}>
                    <div className="ac-progress-track"><div className={`ac-progress-fill ${progressBucket(progress)}`} style={{ width: `${progress}%` }} /></div>
                    <span className="ac-progress-pct">{progress}%</span>
                  </div>
                </div>
              </div>
            );
          }) : <span className="uc-ecap"><span className="uc-edot" />No agent / skill yet</span>}
        </div>
      </div>
    );
  }

  // One card per Non-SDLC agent in the UC grid — mirrors the agent-row layout
  // used inside a UCCard (type badge, name, owner/role tags, progress bar).
  function NonSdlcUCCard({ agent: a }) {
    const t = getType(a);
    const rel = relationshipLabel(a, agents);
    const progress = typeof a.devProgress === 'number' ? a.devProgress : 0;
    return (
      <div className="uc-card" onClick={() => onAgentClick?.(a)}>
        <div className={`uc-arow ${t}`} style={{ background: 'transparent', border: 'none', padding: 0 }}>
          <span className={`uc-tb ${t === 'agent' ? 'tbag' : 'tbsk'}`}>{t.toUpperCase()}</span>
          <div className="uc-abody">
            <div className="uc-aname">{a.agentName}</div>
            <div className="uc-afoot">
              {tagRow(a, t, rel)}
            </div>
            <div className="ac-progress-row" style={{ margin: '6px 0 0' }}>
              <div className="ac-progress-track"><div className={`ac-progress-fill ${progressBucket(progress)}`} style={{ width: `${progress}%` }} /></div>
              <span className="ac-progress-pct">{progress}%</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderUseCaseView() {
    // "Non-SDLC" filter — same shared view as Board (see renderNonSdlcFilter).
    if (nonSdlcOnly) {
      return renderNonSdlcFilter();
    }

    const procToStage = {};
    processes.forEach((p) => { procToStage[p.id] = p.stage; });
    const dim = adoptView === 'by-process' ? 'process' : 'stage';

    let groups;
    if (dim === 'stage') {
      groups = ALL_STAGES
        .filter((s) => stage === 'all' || s === stage)
        .filter((s) => useCases.some((u) => procToStage[u.processId] === s))
        .map((s) => ({ key: s, label: s, color: STAGE_COLOR[s] || '#7a85a3' }));
    } else {
      groups = uniq(useCases.map((u) => u.processId)).map((p) => ({
        key: p,
        label: useCases.find((u) => u.processId === p)?.processName || p,
        color: STAGE_COLOR[procToStage[p]] || '#7a85a3',
      }));
    }

    const out = groups.map((g) => {
      let ucs = useCases.filter((u) => (dim === 'stage' ? procToStage[u.processId] === g.key : u.processId === g.key));
      const all = ucs.length;
      const cov = ucs.filter((u) => agentsForUC(u).length > 0).length;
      if (hasAgent) ucs = ucs.filter((u) => agentsForUC(u).length > 0);
      if (!ucs.length) return null;
      return (
        <div key={g.key} className="sb">
          <div className="sh">
            <div className="sbar" style={{ background: g.color }} />
            <span className="sname" style={{ color: g.color }}>{g.label}</span>
            <span className="sbadge">{all} UC</span>
            <span className="scov">Covered: <strong style={{ color: g.color }}>{cov}/{all}</strong> ({pct(cov, all)}%)</span>
          </div>
          <div className="uc-grid">
            {ucs.map((u) => <UCCard key={u.id} uc={u} />)}
          </div>
        </div>
      );
    }).filter(Boolean);

    // "Missing Use Case" group — agents/skills that DO have a real Stage/
    // Process mapping but no Use Case picked yet. Kept separate from true
    // "Non-SDLC" below so it isn't mislabeled as having no SDLC info at all.
    if (noUseCaseOnly.length > 0) {
      out.push(
        <div key="__no_use_case__" className="sb">
          <div className="sh">
            <div className="sbar" style={{ background: '#8c6b45' }} />
            <span className="sname" style={{ color: '#8c6b45' }}>Missing Use Case</span>
            <span className="sbadge">{noUseCaseOnly.length} items</span>
            <span className="scov">มี Stage/Process แล้ว แต่ยังไม่ระบุ Use Case</span>
          </div>
          <div className="uc-grid">
            {noUseCaseOnly.map((a) => <NonSdlcUCCard key={a.id} agent={a} />)}
          </div>
        </div>
      );
    }

    // Non-SDLC group — agents/skills with NO process mapping at all, shown as
    // their own section at the bottom so the UC view total reconciles with the legend.
    if (nonSdlcUC.length > 0) {
      out.push(
        <div key="__non_sdlc__" className="sb">
          <div className="sh">
            <div className="sbar" style={{ background: '#7a85a3' }} />
            <span className="sname" style={{ color: '#7a85a3' }}>Non-SDLC</span>
            <span className="sbadge">{nonSdlcUC.length} items</span>
            <span className="scov">Agent/Skill not mapped to a Use Case</span>
          </div>
          <div className="uc-grid">
            {nonSdlcUC.map((a) => <NonSdlcUCCard key={a.id} agent={a} />)}
          </div>
        </div>
      );
    }

    return out.length ? out : <div className="sdlc-empty">No data matching filters</div>;
  }

  return (
    <div className="sdlc-tab">
      {/* No page title here on purpose — the Nav tab above already reads
          "SDLC AI Adoption", so a repeated heading was pure redundancy.
          .sdlc-title stays defined in SDLCTab.css in case something else
          ever needs it, it's just not rendered on this page. */}
      {/* V7 boards 7–8 (2026-10-01): action row first (same filters, pill
          skin, page actions on the right), then a title row with the status
          legend — the same state and handlers as before, only re-ordered. */}
      {isMobile && (
        <div className="cbar v7-actrow v7-actrow-m">
          <button className={`pill ${showUseCases ? 'on' : ''}`} aria-pressed={showUseCases} onClick={toggleUseCases}>Use Cases</button>
          <FiltersButton
            count={owner.size + role.size + reusable.size + (hasAgent ? 1 : 0) + (nonSdlcOnly ? 1 : 0) + (stage !== 'all' ? 1 : 0)}
            onClick={() => setFilterSheet(true)}
          />
          {legendActions && <div className="v7-row-actions">{legendActions}</div>}
        </div>
      )}
      <FilterSheet
        open={isMobile && filterSheet}
        onClose={() => setFilterSheet(false)}
        onClear={clearFilters}
        count={owner.size + role.size + reusable.size + (hasAgent ? 1 : 0) + (nonSdlcOnly ? 1 : 0) + (stage !== 'all' ? 1 : 0)}
      >
        {showUseCases && (
          <Dropdown pill="View" options={[['by-stage', 'By Stage'], ['by-process', 'By Process']]} value={adoptView} onChange={changeAdoptView} ariaLabel="จัดกลุ่ม Use Case ตาม" />
        )}
        {showUseCases && adoptView === 'by-stage' && (
          <Dropdown pill="Stage" options={[['all', 'All'], ...ALL_STAGES.map((s) => [s, s])]} value={stage} onChange={setStage} ariaLabel="กรองตาม Stage" activeWhen={(v) => v !== 'all'} />
        )}
        <MultiSelect pill="Owner" label="Owner" options={ownerOptions} selected={owner} onChange={setOwner} />
        <MultiSelect pill="Role" label="Role" options={roleOptions} selected={role} onChange={setRole} />
        <MultiSelect pill="Reusable" label="Reusable" options={reusableOptions} selected={reusable} onChange={setReusable} />
        <button className={`pill ${hasAgent ? 'on' : ''}`} aria-pressed={hasAgent} onClick={() => setHasAgent((v) => !v)}>Has agent</button>
        <button className={`pill ${nonSdlcOnly ? 'on' : ''}`} aria-pressed={nonSdlcOnly} onClick={() => setNonSdlcOnly((v) => !v)}>Non-SDLC</button>
      </FilterSheet>

      {!isMobile && (
      <div className="cbar v7-actrow">
        <button className={`pill ${showUseCases ? 'on' : ''}`} aria-pressed={showUseCases} onClick={toggleUseCases}>Use Cases</button>
        <span className="v7-vsep" aria-hidden="true" />

        {showUseCases && (
          <Dropdown
            pill="View"
            options={[['by-stage', 'By Stage'], ['by-process', 'By Process']]}
            value={adoptView}
            onChange={changeAdoptView}
            ariaLabel="จัดกลุ่ม Use Case ตาม"
          />
        )}
        {showUseCases && adoptView === 'by-stage' && (
          <Dropdown
            pill="Stage"
            options={[['all', 'All'], ...ALL_STAGES.map((s) => [s, s])]}
            value={stage}
            onChange={setStage}
            ariaLabel="กรองตาม Stage"
            activeWhen={(v) => v !== 'all'}
          />
        )}

        <MultiSelect pill="Owner" label="Owner" options={ownerOptions} selected={owner} onChange={setOwner} />
        <MultiSelect pill="Role" label="Role" options={roleOptions} selected={role} onChange={setRole} />
        <MultiSelect pill="Reusable" label="Reusable" options={reusableOptions} selected={reusable} onChange={setReusable} />
        <span className="v7-vsep" aria-hidden="true" />
        <button className={`pill ${hasAgent ? 'on' : ''}`} aria-pressed={hasAgent} onClick={() => setHasAgent((v) => !v)}>Has agent</button>
        <button className={`pill ${nonSdlcOnly ? 'on' : ''}`} aria-pressed={nonSdlcOnly} onClick={() => setNonSdlcOnly((v) => !v)}>Non-SDLC</button>
        <button type="button" className="v7-clear" aria-label="Clear filters" title="Clear filters" onClick={clearFilters}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        {legendActions && <div className="v7-row-actions">{legendActions}</div>}
      </div>
      )}

      <div className="v7-sdlc-title">
        <LibraryTitle
          agents={legendAgents}
          title={showUseCases ? 'Use Cases' : 'SDLC AI Adoption'}
          count={showUseCases ? `${useCases.length} use cases` : `${processes.length} processes`}
          selectedStatus={selectedStatus}
          onStatusClick={setSelectedStatus}
        />
      </div>

      <div className="adopt-scroll">
        {showUseCases ? renderUseCaseView() : renderBoard()}
      </div>

      {modal && (
        <div className="sdlc-ovl" onClick={() => setModal(null)}>
          <div className="sdlc-mbox" onClick={(e) => e.stopPropagation()}>
            <button className="sdlc-mclose" onClick={() => setModal(null)}>✕</button>
            {modal.sub && <div className="sdlc-msub">{modal.sub}</div>}
            {modal.procOwner && <div className="sdlc-mpowner">Process Owner: <strong>{modal.procOwner}</strong></div>}
            <div className="sdlc-mtitle">{modal.title}</div>
            <div className="sdlc-msec">Agents &amp; Skills ({modal.agents.length})</div>
            {modal.agents.length === 0 ? (
              <span className="uc-ecap"><span className="uc-edot" />No agent or skill for this</span>
            ) : modal.agents.map((a) => {
              const withP = withProgress(a);
              const st = agentStatus(withP);
              const sd = ST_DEF[st];
              const t = getType(a);
              const progress = withP.devProgress;
              const ability = Array.isArray(a.coreAbility) ? a.coreAbility.join(', ') : a.coreAbility;
              const tier = getTier(a);
              const tierDef = TIER_DEF[tier];
              // V7 (2026-10-02): one compact row per agent — same data (owner,
              // creator, ability, phase, launch, progress), same click target.
              return (
                <div
                  key={a.id}
                  className="sdlc-mac v7-mac"
                  role="button"
                  tabIndex={0}
                  onClick={() => onAgentClick?.(a)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAgentClick?.(a); } }}
                >
                  <div className="v7-mac-top">
                    <span className="tier-badge" style={{ color: tierDef.color, background: tierDef.bg, borderColor: tierDef.bd }} title={tierDef.label}>
                      {tier} {t === 'agent' ? 'Agent' : 'Skill'}
                    </span>
                    <span className="v7-mac-name">{a.agentName}</span>
                    <span className="status-pill v7-ac-status" style={{ color: sd.color, background: sd.bg, borderColor: sd.bd }}>
                      <span className="status-dot" style={{ background: sd.dot || sd.color }} />{sd.lb}
                    </span>
                  </div>
                  <div className="v7-mac-meta">
                    <span>{a.owner || '—'}</span>
                    {ability && <span>{ability}</span>}
                    <span>Launch {fmtDate(a.launchDate) || '—'}</span>
                    {a.creator && <span className="v7-mac-creator" title={a.creator}>by {a.creator}</span>}
                  </div>
                  <div className="v7-mac-prog">
                    <div className="mpb"><div className={`mpf ${progressBucket(progress)}`} style={{ width: `${progress}%` }} /></div>
                    <strong>{progress}%</strong>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
