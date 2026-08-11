import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { agentStatus, statusCounts, ST_DEF, ST_ORDER, progressBucket } from '../lib/status';
import { getType, getTier, TIER_DEF, TIER_ORDER, isInternalOrExternal } from '../lib/tier';
import { toTimelineItem, timelineStatus, autoFitRange, TL_ST } from '../lib/timeline';
import { agentProcessIds, uniq, fmtDate, normalizeProgress } from '../lib/agentUtils';
import { AREA_ORDER, agentApproveAreas } from '../lib/approveAreas';
import '../styles/SDLCTab.css';
import '../styles/DashboardTab.css';

const DAY = 864e5;
const STAGE_ORDER = ['Initiation', 'Discovery', 'Design', 'Build', 'Test', 'Deployment', 'Post Development'];

/**
 * Dashboard tab (v1, 2026-07-07) — executive/ops overview computed 100% from
 * data that exists today: approved agents (real-time via App's
 * useApprovedAgents) + the sdlcProcesses catalog. No adoption/satisfaction
 * metrics until the marketplace integration lands (locked in grilling
 * session — see plan delightful-hopping-globe).
 *
 * Delay/At-risk MUST agree with the Timeline page's dot colors, so both the
 * item mapping (toTimelineItem) and the forecast (timelineStatus) are the
 * exact same functions, fed the same axis start (autoFitRange over items +
 * the /config/timeline milestones).
 */
export default function DashboardTab({ agents = [], onAgentClick }) {
  const [processes, setProcesses] = useState([]);
  const [procLoading, setProcLoading] = useState(true);
  const [milestones, setMilestones] = useState([]);
  const [procModal, setProcModal] = useState(null); // { proc, agents:[agent] } | null
  const [approverUsers, setApproverUsers] = useState([]); // role==='approver' only — see areaApproverCounts below
  const [areaModal, setAreaModal] = useState(null); // { area, agents:[agent] } | null — B widget's click-through

  useEffect(() => {
    let active = true;
    getDocs(collection(db, 'sdlcProcesses'))
      .then((snap) => { if (active) setProcesses(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); })
      .catch((e) => console.error('Error loading sdlcProcesses:', e))
      .finally(() => { if (active) setProcLoading(false); });
    return () => { active = false; };
  }, []);

  // Milestones only matter here as autoFitRange input — keeping the forecast
  // axis identical to the Timeline page so Delay/At-risk counts match 1:1.
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'timeline'), (snap) => {
      setMilestones(snap.exists() ? (snap.data().milestones || []) : []);
    }, () => setMilestones([]));
    return unsub;
  }, []);

  // Approve Area coverage widget (2026-08-10) needs to know which areas have
  // a DEDICATED approver — self-fetched here rather than threaded as a prop
  // from App.jsx, same pattern as `processes` above (Dashboard already fetches
  // its own supplementary data). Same collection/query shape as
  // UserManagementModal.jsx, filtered client-side to role==='approver' only.
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), (snap) => {
      setApproverUsers(snap.docs.map((d) => d.data()).filter((u) => u.role === 'approver'));
    }, () => setApproverUsers([]));
    return unsub;
  }, []);

  const items = useMemo(() => agents.map(toTimelineItem), [agents]);
  const axisStart = useMemo(() => autoFitRange(items, milestones).start, [items, milestones]);

  // ── KPI row ──
  const agentN = agents.filter((a) => getType(a) === 'agent').length;
  const skillN = agents.length - agentN;
  const stCounts = useMemo(() => statusCounts(agents), [agents]);
  const avgProgress = agents.length
    ? Math.round(agents.reduce((s, a) => s + normalizeProgress(a?.devProgress), 0) / agents.length)
    : 0;
  const launch90 = useMemo(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const end = new Date(now.getTime() + 90 * DAY);
    return items.filter((it) => it.launch && it.launch >= now && it.launch <= end && it.progress < 100).length;
  }, [items]);

  // ── Delay / At-risk board ──
  const flagged = useMemo(() => {
    const rows = items
      .map((it) => ({ ...it, tlSt: timelineStatus(it, axisStart) }))
      .filter((it) => it.tlSt === 'delay' || it.tlSt === 'risk');
    rows.sort((a, b) => (a.tlSt === b.tlSt ? (a.launch || 0) - (b.launch || 0) : a.tlSt === 'delay' ? -1 : 1));
    return rows;
  }, [items, axisStart]);
  const delayN = flagged.filter((r) => r.tlSt === 'delay').length;
  const riskN = flagged.length - delayN;

  // ── SDLC coverage ──
  const procAgents = useMemo(() => {
    const map = {};
    agents.forEach((a) => agentProcessIds(a).forEach((pid) => { (map[pid] = map[pid] || []).push(a); }));
    return map;
  }, [agents]);
  const procCounts = useMemo(() => {
    const counts = {};
    Object.entries(procAgents).forEach(([pid, list]) => { counts[pid] = list.length; });
    return counts;
  }, [procAgents]);
  const byStage = useMemo(() => {
    const stages = uniq([...STAGE_ORDER, ...processes.map((p) => p.stage)]);
    return stages
      .map((stage) => ({ stage, procs: processes.filter((p) => p.stage === stage).sort((a, b) => parseFloat(a.id) - parseFloat(b.id) || a.id.localeCompare(b.id)) }))
      .filter((s) => s.procs.length > 0);
  }, [processes]);
  const coveredN = processes.filter((p) => (procCounts[p.id] || 0) > 0).length;

  // ── Approve Area coverage (2026-08-10) ──
  // agentAreaCounts: how many agents route to each area (same computation
  // PendingApprovalModal uses to decide queue visibility).
  // areaApproverCounts: how many DEDICATED approvers (role==='approver', NOT
  // admin/committee) are assigned to each area. Admin/committee are excluded
  // on purpose — they're the fullAccess safety net every area already has
  // implicitly, so counting them would hide the exact gap (areas nobody has
  // been deliberately assigned to yet) this widget exists to surface.
  const areaAgents = useMemo(() => {
    const map = {};
    agents.forEach((a) => agentApproveAreas(a).forEach((ar) => { (map[ar] = map[ar] || []).push(a); }));
    return map;
  }, [agents]);
  const areaApproverCounts = useMemo(() => {
    const c = {};
    approverUsers.forEach((u) => (u.approveAreas || []).forEach((ar) => { c[ar] = (c[ar] || 0) + 1; }));
    return c;
  }, [approverUsers]);
  const areaCoveredN = AREA_ORDER.filter((ar) => (areaApproverCounts[ar] || 0) > 0).length;

  // ── Owner workload ──
  const ownerRows = useMemo(() => {
    const map = {};
    agents.forEach((a) => {
      const o = a.owner || '—';
      (map[o] = map[o] || []).push(normalizeProgress(a?.devProgress));
    });
    return Object.entries(map)
      .map(([owner, ps]) => ({ owner, count: ps.length, avg: Math.round(ps.reduce((s, p) => s + p, 0) / ps.length) }))
      .sort((a, b) => b.count - a.count);
  }, [agents]);
  const maxOwnerCount = ownerRows[0]?.count || 1;

  // ── Tier + Reusable ──
  const tierCounts = useMemo(() => {
    const c = { T1: 0, T2: 0, T3: 0, T4: 0 };
    agents.forEach((a) => { c[getTier(a)] += 1; });
    return c;
  }, [agents]);
  const reusableCounts = useMemo(() => {
    const c = {};
    agents.forEach((a) => { const k = a.reusable || 'Unspecified'; c[k] = (c[k] || 0) + 1; });
    return c;
  }, [agents]);
  const REUSE_COLOR = { Reusable: '#15803d', 'Reusable with Conditions': '#d97706', 'Non-reusable': '#dc2626', Unspecified: '#9ca3af' };

  return (
    <div className="dash-page">
      {/* ── KPI row ── */}
      <div className="dash-kpis">
        <Kpi n={agents.length} label="Total" sub={`${agentN} Agents · ${skillN} Skills`} icon={KPI_ICON.total} />
        <Kpi n={stCounts.ru} label="Ready to Use" color={ST_DEF.ru.color} icon={KPI_ICON.ready} />
        <Kpi n={stCounts.ip + stCounts.pilot} label="In Development" sub={`${stCounts.ip} In Progress · ${stCounts.pilot} Pilot`} color={ST_DEF.ip.color} icon={KPI_ICON.dev} />
        <Kpi n={`${avgProgress}%`} label="Avg Progress" icon={KPI_ICON.progress} />
        <Kpi n={launch90} label="Launch ใน 90 วัน" color="var(--accent)" icon={KPI_ICON.launch} />
      </div>

      {/* ── Status + Tier + Reusable ── */}
      <div className="dash-grid3">
        <div className="dash-card">
          <div className="dash-card-hdr"><span className="dash-card-title">Status Distribution</span></div>
          {ST_ORDER.map((k) => (
            <BarRow key={k} label={ST_DEF[k].lb} n={stCounts[k]} total={agents.length} color={ST_DEF[k].dot} />
          ))}
        </div>
        <div className="dash-card">
          <div className="dash-card-hdr"><span className="dash-card-title">Tier Distribution</span></div>
          {TIER_ORDER.map((t) => (
            <BarRow key={t} label={TIER_DEF[t].label} n={tierCounts[t]} total={agents.length} color={TIER_DEF[t].color} />
          ))}
        </div>
        <div className="dash-card">
          <div className="dash-card-hdr"><span className="dash-card-title">Reusable Breakdown</span></div>
          {Object.entries(reusableCounts).sort((a, b) => (a[0] === 'Unspecified' ? 1 : b[0] === 'Unspecified' ? -1 : b[1] - a[1])).map(([k, n]) => (
            <BarRow key={k} label={k} n={n} total={agents.length} color={REUSE_COLOR[k] || '#9ca3af'} />
          ))}
        </div>
      </div>

      {/* ── SDLC coverage gap map ── */}
      <div className="dash-card">
        <div className="dash-card-hdr">
          <span className="dash-card-title">SDLC Coverage</span>
          <span className="dash-card-sub">{coveredN}/{processes.length} processes มี agent ครอบคลุม · ช่องแดง = gap</span>
        </div>
        {procLoading ? (
          <div className="dash-empty">Loading…</div>
        ) : (
          <div className="dash-stages">
            {byStage.map(({ stage, procs }) => {
              const gapN = procs.filter((p) => !(procCounts[p.id] > 0)).length;
              return (
                <div key={stage} className="dash-stage">
                  <div className="dash-stage-hdr">
                    <span>{stage}</span>
                    <span className="dash-stage-gap">{gapN > 0 ? `${gapN} gap` : 'Complete'}</span>
                  </div>
                  <div className="dash-procs">
                    {procs.map((p) => {
                      const n = procCounts[p.id] || 0;
                      const clickable = n > 0;
                      return (
                        <span
                          key={p.id}
                          className={`dash-proc ${n === 0 ? 'gap' : ''} ${clickable ? 'clickable' : ''}`}
                          title={`${p.id} ${p.name || ''}${n ? ` — ${n} agent${n > 1 ? 's' : ''}` : ' — ยังไม่มี agent'}`}
                          onClick={clickable ? () => setProcModal({ proc: p, agents: procAgents[p.id] || [] }) : undefined}
                        >
                          {p.id}{n > 0 && <b>{n}</b>}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Approve Area coverage (2026-08-10) ── mirrors SDLC Coverage above:
          same dash-stages/dash-proc classes, but one flat row (areas have no
          stage-like grouping) and the gap signal is APPROVER count, not
          agent count — an area can be full of agents and still be a gap if
          nobody dedicated is assigned to review them. */}
      <div className="dash-card">
        <div className="dash-card-hdr">
          <span className="dash-card-title">Approve Area Coverage</span>
          <span className="dash-card-sub">{areaCoveredN}/{AREA_ORDER.length} area มี approver ครอบคลุม · ช่องแดง = ยังไม่มี approver</span>
        </div>
        <div className="dash-stages">
          <div className="dash-stage">
            <div className="dash-procs">
              {AREA_ORDER.map((area) => {
                const approverN = areaApproverCounts[area] || 0;
                const agentN2 = (areaAgents[area] || []).length;
                const clickable = agentN2 > 0;
                return (
                  <span
                    key={area}
                    className={`dash-proc ${approverN === 0 ? 'gap' : ''} ${clickable ? 'clickable' : ''}`}
                    title={`${area} — ${agentN2} agent${agentN2 === 1 ? '' : 's'}, ${approverN} approver${approverN === 1 ? '' : 's'}${approverN === 0 ? ' (ยังไม่มี approver)' : ''}`}
                    onClick={clickable ? () => setAreaModal({ area, agents: areaAgents[area] || [] }) : undefined}
                  >
                    {area}{agentN2 > 0 && <b>{agentN2}</b>}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Delay/At-risk (60%) + Owner Workload (40%) ── */}
      <div className="dash-grid-flag">
        <div className="dash-card">
          <div className="dash-card-hdr">
            <span className="dash-card-title">Delayed / At risk</span>
            <span className="dash-flag-counts">
              <span className="dash-flag-pill" style={pillStyle(TL_ST.delay)}>{delayN} Delayed</span>
              <span className="dash-flag-pill" style={pillStyle(TL_ST.risk)}>{riskN} At risk</span>
            </span>
          </div>
          {flagged.length === 0 ? (
            <div className="dash-empty">ไม่มีรายการล่าช้าหรือเสี่ยง delay</div>
          ) : (
            <div className="dash-flag-list">
              {flagged.map((r) => {
                const st = TL_ST[r.tlSt];
                return (
                  <div key={r.id} className="dash-flag-row" onClick={() => onAgentClick?.(r._raw)}>
                    <span className="dash-flag-pill" style={pillStyle(st)}>{st.lb}</span>
                    <span className="dash-flag-name">{r.name}</span>
                    <span className="dash-flag-meta">{r.team || '—'}</span>
                    <span className="dash-flag-meta">{r.launch ? fmtDate(r.launch) : 'no date'}</span>
                    <span className="dash-flag-prog">{r.progress}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="dash-card">
          <div className="dash-card-hdr">
            <span className="dash-card-title">Owner Workload</span>
            <span className="dash-card-sub">จำนวน Agent/Skill ต่อทีม · ค่าเฉลี่ย progress</span>
          </div>
          <div className="dash-owner-list">
            {ownerRows.map((r) => (
              <div key={r.owner} className="dash-owner-row">
                <span className="dash-owner-name">{r.owner}</span>
                <div className="dash-owner-bar">
                  <div className="dash-owner-fill" style={{ width: `${(r.count / maxOwnerCount) * 100}%` }} />
                </div>
                <span className="dash-owner-n">{r.count}</span>
                <span className="dash-owner-avg">avg {r.avg}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {procModal && (
        <div className="sdlc-ovl" onClick={() => setProcModal(null)}>
          <div className="sdlc-mbox" onClick={(e) => e.stopPropagation()}>
            <button className="sdlc-mclose" onClick={() => setProcModal(null)}>✕</button>
            <div className="sdlc-msub">{procModal.proc.id}{procModal.proc.owner ? ` · Process Owner: ${procModal.proc.owner}` : ''}</div>
            <div className="sdlc-mtitle">{procModal.proc.name || procModal.proc.id}</div>
            <div className="sdlc-msec">Agents &amp; Skills ({procModal.agents.length})</div>
            {procModal.agents.map((a) => (
              <AgentQuickCard key={a.id} agent={a} onClick={() => { setProcModal(null); onAgentClick?.(a); }} />
            ))}
          </div>
        </div>
      )}

      {/* Area coverage widget's click-through — same modal shell as SDLC's,
          no process-owner subline (areas don't have one), agent rows use the
          shared AgentQuickCard so both modals stay visually identical. */}
      {areaModal && (
        <div className="sdlc-ovl" onClick={() => setAreaModal(null)}>
          <div className="sdlc-mbox" onClick={(e) => e.stopPropagation()}>
            <button className="sdlc-mclose" onClick={() => setAreaModal(null)}>✕</button>
            <div className="sdlc-msub">Approve Area</div>
            <div className="sdlc-mtitle">{areaModal.area}</div>
            <div className="sdlc-msec">Agents &amp; Skills ({areaModal.agents.length})</div>
            {areaModal.agents.map((a) => (
              <AgentQuickCard key={a.id} agent={a} onClick={() => { setAreaModal(null); onAgentClick?.(a); }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function pillStyle(st) {
  return { background: st.bg, color: st.tx, border: `1px solid ${st.bd}` };
}

// Extracted 2026-08-10 (was inlined once, in the SDLC-coverage proc modal) so
// the new Approve Area coverage modal renders identical agent rows without a
// second copy of this block drifting from the original.
function AgentQuickCard({ agent: a, onClick }) {
  const st = agentStatus(a);
  const sd = ST_DEF[st];
  const t = getType(a);
  const progress = normalizeProgress(a?.devProgress);
  const ability = Array.isArray(a.coreAbility) ? a.coreAbility.join(', ') : a.coreAbility;
  const tier = getTier(a);
  const tierDef = TIER_DEF[tier];
  const scope = isInternalOrExternal(a);
  return (
    <div className="sdlc-mac" style={{ cursor: 'pointer' }} onClick={onClick}>
      <div className="sdlc-machdr">
        <span className={`uc-tb ${t === 'agent' ? 'tbag' : 'tbsk'}`}>{t.toUpperCase()}</span>
        <span className="tier-badge" style={{ color: tierDef.color, background: tierDef.bg, borderColor: tierDef.bd }} title={tierDef.label}>{tier}</span>
        <span className="sdlc-macname">{a.agentName}</span>
        <span className="scope-badge" style={{ position: 'static', marginLeft: 'auto', color: scope === 'External' ? '#0ea5e9' : 'var(--ag)' }} title={scope === 'External' ? 'Customer Facing' : 'Internal Use'}>
          {scope === 'External' ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="2" width="16" height="20" rx="1" />
              <line x1="9" y1="10" x2="9" y2="10" /><line x1="15" y1="10" x2="15" y2="10" />
              <line x1="9" y1="14" x2="9" y2="14" /><line x1="15" y1="14" x2="15" y2="14" />
              <path d="M9 22v-4h6v4" />
            </svg>
          )}
        </span>
      </div>
      <div className="sdlc-mrow"><span className="sdlc-mk">Owner</span><span>{a.owner || '—'}</span></div>
      <div className="sdlc-mrow"><span className="sdlc-mk">Ability</span><span>{ability || '—'}</span></div>
      <div className="sdlc-mrow"><span className="sdlc-mk">Phase</span>
        <span className="sdlc-ph" style={{ background: sd.bg, color: sd.color, border: `1px solid ${sd.bd}` }}>{sd.lb}</span>
      </div>
      <div className="sdlc-mrow"><span className="sdlc-mk">Launch</span><span>{fmtDate(a.launchDate) || '—'}</span></div>
      <div style={{ marginTop: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--mu)' }}>
          <span>Progress</span><strong style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{progress}%</strong>
        </div>
        <div className="mpb"><div className={`mpf ${progressBucket(progress)}`} style={{ width: `${progress}%` }} /></div>
      </div>
    </div>
  );
}

// Semantic pictograms per KPI (mockup .kpi-icon) — was a plain 10×10 colour
// swatch, which only ever repeated the number's own colour rather than
// telling the tile apart from its neighbours at a glance.
const KPI_ICON = {
  total: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  ready: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  dev: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  ),
  progress: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="20" x2="4" y2="12" /><line x1="12" y1="20" x2="12" y2="7" /><line x1="20" y1="20" x2="20" y2="15" />
    </svg>
  ),
  launch: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
};

function Kpi({ n, label, sub, color, icon }) {
  return (
    <div className="dash-kpi">
      {/* The tile is a tinted wash of the KPI's own colour (14%), not a new
          hue — it must not read as a separate signal from the number. */}
      <div
        className="dash-kpi-icon"
        style={{ background: color ? `color-mix(in srgb, ${color} 14%, transparent)` : 'var(--sf2)', color: color || 'var(--mu)' }}
        aria-hidden="true"
      >
        {icon}
      </div>
      <div className="dash-kpi-body">
        <div className="dash-kpi-n" style={color ? { color } : undefined}>{n}</div>
        <div className="dash-kpi-l">{label}</div>
        {sub && <div className="dash-kpi-sub">{sub}</div>}
      </div>
    </div>
  );
}

function BarRow({ label, n, total, color }) {
  const pct = total > 0 ? Math.round((n / total) * 100) : 0;
  return (
    <div className="dash-bar-row">
      <span className="dash-bar-label" title={label}>{label}</span>
      <div className="dash-bar-track">
        <div className="dash-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="dash-bar-n">{n}</span>
      <span className="dash-bar-pct">{pct}%</span>
    </div>
  );
}
