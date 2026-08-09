import { useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import { useApprovedAgents } from '../hooks/useAgents';
import {
  TL_ST, toTimelineItem, timelineStatus, autoFitRange, monthTicks,
  inAnyMilestone, toDate, startOfToday,
} from '../lib/timeline';
import { uniq, fmtDate } from '../lib/agentUtils';
import { agentStatus, ST_DEF, progressBucket } from '../lib/status';
import { getType, getTier, TIER_DEF, isInternalOrExternal } from '../lib/tier';
import AgentDetailModal from './AgentDetailModal';
import MilestoneEditor from './MilestoneEditor';
import ThemeToggle from './ThemeToggle';
import { useTheme } from '../hooks/useTheme';
import '../styles/SDLCTab.css';
import '../styles/TimelinePage.css';

const LW = 200, RH = 76, HH = 36, AH = 52, IR = 12, PAD = 16, DAY = 864e5;
const DEFAULT_MS_COLORS = ['#0b7a68', '#2f6bff', '#6d28d9', '#c2590a', '#b45309', '#0369a1'];

// devProgress is a string like "90%" — coerce to number for agentStatus()
// (same helper as SDLCTab.jsx, duplicated here since it's page-local).
function withProgress(agent) {
  const prog = agent?.devProgress;
  const num = typeof prog === 'number' ? prog : parseInt(String(prog || '').replace('%', ''), 10);
  return { ...agent, devProgress: isNaN(num) ? 0 : num };
}

export default function TimelinePage() {
  const { user, isAdmin, loading, roleReady, role } = useAuth();
  const { agents } = useApprovedAgents(!!role);
  const [config, setConfig] = useState(null);   // { viewers:[], milestones:[] } | null
  const [cfgLoaded, setCfgLoaded] = useState(false);
  const [filter, setFilter] = useState(null);    // milestone id | 'out' | null
  const [detailAgent, setDetailAgent] = useState(null);
  const [listPopup, setListPopup] = useState(null); // { launch, agents:[timelineItem] } | null
  const [editMs, setEditMs] = useState(false);
  const canvasRef = useRef(null);
  const [theme] = useTheme(); // <canvas> can't read CSS var() itself — drawTimeline
  // re-resolves the palette by name on every draw, so this just needs to be a
  // dependency that changes when the toggle flips (see drawTimeline below).

  // Live config: viewers allowlist + milestones live in one /config/timeline doc.
  useEffect(() => {
    if (!role) return;
    const unsub = onSnapshot(doc(db, 'config', 'timeline'), (snap) => {
      setConfig(snap.exists() ? snap.data() : { viewers: [], milestones: [] });
      setCfgLoaded(true);
    }, () => setCfgLoaded(true));
    return unsub;
  }, [role]);

  const viewers = useMemo(() => (config?.viewers || []).map((e) => (e || '').toLowerCase()), [config]);
  const milestones = useMemo(() => config?.milestones || [], [config]);
  const canView = !!user && viewers.includes((user.email || '').toLowerCase());

  const items = useMemo(() => agents.map(toTimelineItem), [agents]);
  const range = useMemo(() => autoFitRange(items, milestones), [items, milestones]);

  async function saveMilestones(next) {
    await setDoc(doc(db, 'config', 'timeline'), { ...(config || {}), milestones: next }, { merge: true });
  }

  // ── draw ──
  useEffect(() => {
    if (!canView) return;
    drawTimeline(canvasRef.current, items, milestones, range, filter, setListPopup, setFilter);
  }, [canView, items, milestones, range, filter, theme]);

  useEffect(() => {
    if (!canView) return;
    const onResize = () => drawTimeline(canvasRef.current, items, milestones, range, filter, setListPopup, setFilter);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [canView, items, milestones, range, filter, theme]);

  if (loading) {
    return <div className="tl-center"><div className="spin" /><span>กำลังโหลด…</span></div>;
  }
  if (!user) {
    return <div className="tl-center"><h2>กรุณาเข้าสู่ระบบ</h2><p style={{ color: 'var(--mu)' }}>เปิดหน้านี้จากในแอปหลังจาก sign in แล้ว</p></div>;
  }
  if (!roleReady || !cfgLoaded) {
    return <div className="tl-center"><div className="spin" /><span>กำลังตรวจสิทธิ์…</span></div>;
  }
  if (!canView) {
    return (
      <div className="tl-center">
        <h2>ไม่มีสิทธิ์เข้าถึง</h2>
        <p style={{ color: 'var(--mu)', fontSize: 13 }}>บัญชี {user.email} ไม่อยู่ในรายชื่อผู้มีสิทธิ์ดู SDLC Timeline</p>
      </div>
    );
  }

  const outItems = items.filter((it) => !inAnyMilestone(it.launch, milestones));
  const activeMs = filter && filter !== 'out' ? milestones.find((m) => m.id === filter) : null;
  const msItems = activeMs ? items.filter((it) => it.launch && inRange(it.launch, activeMs)) : [];
  const canEdit = canView; // same allowlist edits milestones (locked decision)

  return (
    <div>
      <nav className="nav">
        <div className="nav-brand">
          <div>
            <h1>AI Agent Library</h1>
            <p>Powered by Wolfy</p>
          </div>
        </div>
        <div className="nav-tabs">
          <button className="nav-tab" onClick={() => { window.location.href = '/'; }}>
            ← Back to Library
          </button>
        </div>
        <div className="nav-r" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* This page has no ☰ menu of its own, so the toggle (which renders
              as a bare menu row — see ThemeToggle.jsx) gets a .menu wrapper
              here to pick up the same row styling instead of falling through
              to an unstyled UA button. */}
          <div className="menu" style={{ position: 'static', minWidth: 0, marginTop: 0 }}>
            <ThemeToggle />
          </div>
          {user && (
            <div className="nav-user">
              {user.photoURL
                ? <img src={user.photoURL} alt="" />
                : <span className="nav-user-fallback">{(user.displayName || user.email || '?').trim().charAt(0).toUpperCase()}</span>}
              <div className="nav-user-name">
                {(() => {
                  const full = (user.displayName || user.email || '').trim();
                  const [first, ...rest] = full.split(' ');
                  const last = rest.join(' ');
                  return (
                    <>
                      <span>{first}</span>
                      {last && <span>{last}</span>}
                    </>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      </nav>

    <div className="tl-page">
      <div className="tl-topbar">
        <div>
          <h1 className="tl-title">SDLC Timeline</h1>
          <div className="tl-subtitle">Generative AI for SDLC — Launch Timeline</div>
        </div>
        {canEdit && (
          <button className="btn btn-primary" style={{ fontSize: 12.5, padding: '7px 14px' }} onClick={() => setEditMs(true)}>
            Manage Milestones
          </button>
        )}
      </div>

      <div className="tl-mobile-banner">
        หน้านี้แสดงผลได้ดีที่สุดบนจอกว้าง — บนมือถือกรุณาเลื่อนซ้าย-ขวาเพื่อดู Timeline หรือหมุนจอเป็นแนวนอน
      </div>

      <div className="tl-legend">
        <span className="tl-legend-title">STATUS</span>
        {Object.entries(TL_ST).map(([k, v]) => (
          <div key={k} className="tl-legend-item">
            <span className="tl-legend-dot" style={{ background: v.bg, borderColor: v.bd, color: v.tx }}>{v.ic}</span>
            {v.lb}
          </div>
        ))}
        <div className="tl-legend-item" style={{ color: '#ef4444' }}>
          <span style={{ width: 2, height: 16, background: '#ef4444', borderRadius: 1, display: 'inline-block' }} />
          Today
        </div>
      </div>

      <div className="tl-canvas-wrap">
        <div className="tl-canvas-hdr">
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>Launch Timeline</div>
            <div style={{ fontSize: 10.5, opacity: .75, marginTop: 2 }}>คลิกจุด → รายละเอียด · คลิก milestone → กรอง</div>
          </div>
          <div style={{ fontSize: 11, opacity: .75 }}>
            {range.start.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })} – {range.end.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })}
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <canvas ref={canvasRef} style={{ display: 'block' }} />
        </div>
      </div>

      {activeMs && (
        <MilestoneSummaryCard milestone={activeMs} items={msItems} onClear={() => setFilter(null)} />
      )}

      <OutOfMilestoneCard items={outItems} allItems={items} filter={filter} setFilter={setFilter} />

      {listPopup && (
        <div className="sdlc-ovl" onClick={() => setListPopup(null)}>
          <div className="sdlc-mbox" onClick={(e) => e.stopPropagation()}>
            <button className="sdlc-mclose" onClick={() => setListPopup(null)}>✕</button>
            {listPopup.launch && (
              <div className="sdlc-msub">
                Launch: {listPopup.launch.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </div>
            )}
            <div className="sdlc-mtitle">{listPopup.agents.length} Agent{listPopup.agents.length > 1 ? 's' : ''}/Skill{listPopup.agents.length > 1 ? 's' : ''}</div>
            <div className="sdlc-msec">Agents &amp; Skills ({listPopup.agents.length})</div>
            {listPopup.agents.map((item) => {
              const a = item._raw;
              const withP = withProgress(a);
              const st = agentStatus(withP);
              const sd = ST_DEF[st];
              const t = getType(a);
              const progress = withP.devProgress;
              const ability = Array.isArray(a.coreAbility) ? a.coreAbility.join(', ') : a.coreAbility;
              const tier = getTier(a);
              const tierDef = TIER_DEF[tier];
              const scope = isInternalOrExternal(a);
              return (
                <div key={a.id} className="sdlc-mac" style={{ cursor: 'pointer' }} onClick={() => { setListPopup(null); setDetailAgent(a); }}>
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
                  <div className="sdlc-mrow"><span className="sdlc-mk">Creator</span><span>{a.creator || '—'}</span></div>
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
            })}
          </div>
        </div>
      )}

      {detailAgent && (
        <AgentDetailModal
          key={detailAgent.id}
          agent={detailAgent}
          allAgents={agents}
          onClose={() => setDetailAgent(null)}
          user={user}
          isAdmin={isAdmin}
        />
      )}
      {editMs && (
        <MilestoneEditor
          milestones={milestones}
          defaultColors={DEFAULT_MS_COLORS}
          onSave={saveMilestones}
          onClose={() => setEditMs(false)}
        />
      )}
    </div>
    </div>
  );
}

function OutOfMilestoneCard({ items, allItems, filter, setFilter }) {
  const teams = uniq(items.map((a) => a.team));
  const agN = items.filter((a) => a.type === 'agent').length;
  const skN = items.filter((a) => a.type === 'skill').length;
  const noDate = items.filter((a) => !a.launch).length;
  const sel = filter === 'out';
  return (
    <div
      className={`tl-out-card ${sel ? 'on' : ''}`}
      onClick={() => setFilter(sel ? null : 'out')}
    >
      <div className="tl-out-hdr">
        <span className="tl-out-title">Out of Milestone</span>
        <span style={{ fontSize: 10, color: 'var(--mu)' }}>Agent/Skill ที่ launch ไม่อยู่ใน milestone ใด</span>
        {sel && <span className="tl-out-active">Active</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 14 }}>
          <Stat n={items.length} l="Total" c="#d97706" />
          <Stat n={agN} l="Agent" c="var(--ag)" />
          <Stat n={skN} l="Skill" c="var(--sk)" />
          {noDate > 0 && <Stat n={noDate} l="No date" c="var(--mu)" />}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {teams.map((t) => <span key={t} className="tl-out-team">{t}</span>)}
        {!items.length && <span style={{ fontSize: 11, color: 'var(--mu)' }}>ทุก Agent/Skill อยู่ใน milestone แล้ว</span>}
      </div>
    </div>
  );
}

function MilestoneSummaryCard({ milestone, items, onClear }) {
  const teams = uniq(items.map((a) => a.team));
  const agN = items.filter((a) => a.type === 'agent').length;
  const skN = items.filter((a) => a.type === 'skill').length;
  const col = milestone.color || '#2f6bff';
  return (
    <div className="tl-ms-card" onClick={onClear} style={{ borderTopColor: col, boxShadow: `0 0 0 2px ${col}33, var(--sh)` }}>
      <div className="tl-out-hdr">
        <span className="tl-ms-title" style={{ color: col }}>{milestone.name || milestone.id}</span>
        <span style={{ fontSize: 10, color: 'var(--mu)' }}>Agent/Skill ที่ launch อยู่ใน milestone นี้</span>
        <span className="tl-ms-active" style={{ background: col }}>Active</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 14 }}>
          <Stat n={items.length} l="Total" c={col} />
          <Stat n={agN} l="Agent" c="var(--ag)" />
          <Stat n={skN} l="Skill" c="var(--sk)" />
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {teams.map((t) => <span key={t} className="tl-out-team">{t}</span>)}
        {!items.length && <span style={{ fontSize: 11, color: 'var(--mu)' }}>ไม่มี Agent/Skill launch ใน milestone นี้</span>}
      </div>
    </div>
  );
}

function Stat({ n, l, c }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'IBM Plex Mono',monospace", color: c }}>{n}</div>
      <div style={{ fontSize: 8.5, color: 'var(--mu)' }}>{l}</div>
    </div>
  );
}

// <canvas> fillStyle/strokeStyle can't read CSS var() strings directly —
// unlike every other themed surface in this app, the chart is painted by
// hand each frame, so its palette has to be resolved to real hex/rgba values
// up front. Reading it fresh on every call (rather than caching) is what
// makes the dark-mode toggle repaint the chart: TimelinePage's draw effect
// already re-runs on `theme` change, so the next drawTimeline() call just
// picks up whatever the cascade currently resolves these tokens to.
function themeColors() {
  const css = getComputedStyle(document.documentElement);
  const v = (name, fallback) => (css.getPropertyValue(name).trim() || fallback);
  return {
    hdrBg: v('--tlc-hdr-bg', '#f8fafd'), gutBg: v('--tlc-gut-bg', '#f1f5fb'),
    mu: v('--tlc-mu', '#7784a0'), tx2: v('--tlc-tx2', '#46516d'), tx: v('--tlc-tx', '#182135'),
    rowA: v('--tlc-row-a', '#fff'), rowB: v('--tlc-row-b', '#fafbfd'),
    line: v('--tlc-line', '#e8edf6'), line2: v('--tlc-line2', '#c8d0e0'), dim: v('--tlc-dim', '#9ca3af'),
  };
}

// TL_ST's bg/bd/tx are var(--tl-...) strings (see timeline.js) for the DOM
// legend; canvas needs the resolved value, same reasoning as themeColors().
function resolveTlSt(css) {
  const v = (name) => css.getPropertyValue(name.replace(/^var\(|\)$/g, '')).trim();
  const out = {};
  for (const [k, st] of Object.entries(TL_ST)) out[k] = { ...st, bg: v(st.bg), bd: v(st.bd), tx: v(st.tx) };
  return out;
}

// ── canvas drawing (ported from reference, adapted: auto-fit range, our
//    theme colors, Firestore-backed milestones) ──
function drawTimeline(cv, items, milestones, range, filter, onDotsClick, onFilter) {
  if (!cv) return;
  const T = themeColors();
  const TL = resolveTlSt(getComputedStyle(document.documentElement));
  const today = startOfToday();
  const { start: S, end: E } = range;
  const totalDays = Math.max(1, (E - S) / DAY);

  const teams = uniq(items.map((a) => a.team).filter(Boolean));
  const actMs = filter && filter !== 'out' ? milestones.find((m) => m.id === filter) : null;
  const vis = (filter === 'out')
    ? teams.filter((t) => items.some((a) => a.team === t && !inAnyMilestone(a.launch, milestones)))
    : actMs
      ? teams.filter((t) => items.some((a) => a.team === t && a.launch && a.launch >= toDate(actMs.start) && a.launch <= toDate(actMs.end)))
      : teams;

  const wrap = cv.parentElement;
  const W = Math.max(wrap.clientWidth || 860, 700), tw = W - LW - PAD;
  const H = HH + AH + vis.length * RH;
  const DPR = window.devicePixelRatio || 1;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const ctx = cv.getContext('2d');
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const dx = (d) => LW + Math.max(0, Math.min(1, (d - S) / DAY / totalDays)) * tw;
  const tx = dx(today);

  // month header
  ctx.fillStyle = T.hdrBg; ctx.fillRect(0, 0, W, HH);
  ctx.fillStyle = T.gutBg; ctx.fillRect(0, 0, LW, HH);
  ctx.fillStyle = T.mu; ctx.font = `bold 11px 'IBM Plex Sans Thai Looped',sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('Owner', 14, HH / 2);
  monthTicks(S, E).forEach((m) => {
    const x1 = Math.max(dx(m.start), LW), x2 = Math.min(dx(new Date(m.end.getTime() + DAY)), LW + tw);
    if (x2 <= x1) return;
    ctx.strokeStyle = T.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x1, 0); ctx.lineTo(x1, HH); ctx.stroke();
    ctx.fillStyle = T.tx2; ctx.font = `bold 11px 'IBM Plex Sans Thai Looped',sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(m.label, (x1 + x2) / 2, HH / 2);
  });
  ctx.strokeStyle = T.line2; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, HH); ctx.lineTo(W, HH); ctx.stroke();

  // milestone axis
  const ay = HH;
  ctx.fillStyle = T.hdrBg; ctx.fillRect(0, ay, W, AH);
  ctx.fillStyle = T.gutBg; ctx.fillRect(0, ay, LW, AH);
  ctx.fillStyle = T.mu; ctx.font = `10px 'IBM Plex Sans Thai Looped',sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('Milestones', 14, ay + AH / 2);
  const msClicks = [];
  milestones.forEach((m) => {
    const ms = toDate(m.start), me = toDate(m.end);
    if (!ms || !me) return;
    const x1 = dx(ms), x2 = dx(me), w = Math.max(2, x2 - x1), sel = filter === m.id;
    const col = m.color || '#2f6bff';
    ctx.fillStyle = col + (sel ? '55' : '30'); rrect(ctx, x1, ay + 7, w, AH - 14, 5); ctx.fill();
    ctx.strokeStyle = sel ? col : col + '90'; ctx.lineWidth = sel ? 2.5 : 1.5; rrect(ctx, x1, ay + 7, w, AH - 14, 5); ctx.stroke();
    ctx.fillStyle = col; ctx.font = `bold ${sel ? 12 : 11}px 'IBM Plex Sans Thai Looped',sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(m.name || m.id, x1 + w / 2, ay + AH / 2 - 7);
    const sL = ms.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), eL = me.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    ctx.font = `8.5px 'IBM Plex Sans Thai Looped',sans-serif`; ctx.fillStyle = col + 'cc'; ctx.fillText(`${sL}–${eL}`, x1 + w / 2, ay + AH / 2 + 8);
    msClicks.push({ x1, y1: ay, x2, y2: ay + AH, id: m.id });
  });
  ctx.strokeStyle = T.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, ay + AH); ctx.lineTo(W, ay + AH); ctx.stroke();

  // team rows
  const dotClicks = [];
  vis.forEach((team, ti) => {
    const tAgs = items.filter((a) => a.team === team);
    const ry = HH + AH + ti * RH, my = ry + RH / 2 - 8;
    ctx.fillStyle = ti % 2 === 0 ? T.rowA : T.rowB; ctx.fillRect(0, ry, W, RH);
    ctx.fillStyle = T.gutBg; ctx.fillRect(0, ry, LW, RH);
    ctx.strokeStyle = T.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, ry + RH); ctx.lineTo(W, ry + RH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(LW, ry); ctx.lineTo(LW, ry + RH); ctx.stroke();
    ctx.fillStyle = T.tx; ctx.font = `bold 12.5px 'IBM Plex Sans Thai Looped',sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(team, 14, ry + 10);
    const rN = tAgs.filter((a) => a.progress >= 70).length;
    ctx.fillStyle = T.mu; ctx.font = `10px 'IBM Plex Sans Thai Looped',sans-serif`; ctx.fillText(`${tAgs.length} items · ${rN} ≥70%`, 14, ry + 27);

    // milestone band tint per row
    milestones.forEach((m) => {
      const ms = toDate(m.start), me = toDate(m.end); if (!ms || !me) return;
      const isO = filter && filter !== m.id;
      ctx.fillStyle = (m.color || '#2f6bff') + (isO ? '08' : '12');
      ctx.fillRect(dx(ms), ry, dx(me) - dx(ms), RH);
    });

    // dots grouped by launch date
    const byDate = {};
    tAgs.forEach((a) => { const k = a.launch ? a.launch.getTime() : '_'; (byDate[k] = byDate[k] || []).push(a); });
    Object.entries(byDate).forEach(([k, ags]) => {
      const d = k === '_' ? null : new Date(Number(k)); if (!d) return;
      const inMs = inAnyMilestone(d, milestones);
      const dim = (filter === 'out') ? inMs : (filter && (!inMs || !inRange(d, milestones.find((m) => m.id === filter))));
      const cx = dx(d);
      if (dim) { ctx.globalAlpha = .15; ctx.beginPath(); ctx.arc(cx, my, IR, 0, Math.PI * 2); ctx.fillStyle = T.dim; ctx.fill(); ctx.globalAlpha = 1; return; }
      const order = ['delay', 'risk', 'ontime', 'pilot', 'done'];
      const statuses = ags.map((a) => timelineStatus(a, S, today));
      const pr = order.find((s) => statuses.includes(s)) || 'ontime';
      const st = TL[pr]; const n = ags.length;
      ctx.shadowColor = 'rgba(0,0,0,0.12)'; ctx.shadowBlur = 4;
      ctx.beginPath(); ctx.arc(cx, my, IR, 0, Math.PI * 2); ctx.fillStyle = st.bg; ctx.fill();
      ctx.shadowBlur = 0; ctx.strokeStyle = st.bd; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, my, IR, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = st.tx; ctx.font = `bold ${n > 1 ? 11 : 10}px 'IBM Plex Sans Thai Looped',sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(n > 1 ? String(n) : st.ic, cx, my);
      const lb = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      ctx.font = `600 8.5px 'IBM Plex Sans Thai Looped',sans-serif`; ctx.textBaseline = 'top'; ctx.fillText(lb, cx, my + IR + 3);
      dotClicks.push({ x1: cx - IR - 2, y1: ry, x2: cx + IR + 2, y2: ry + RH, agents: ags, launch: d });
    });
  });

  // today line
  ctx.save(); ctx.strokeStyle = '#ef4444aa'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.moveTo(tx, HH); ctx.lineTo(tx, H); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
  ctx.strokeStyle = T.line2; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(LW, HH); ctx.lineTo(LW, H); ctx.stroke();

  cv.onclick = (e) => {
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const mh = msClicks.find((a) => mx >= a.x1 && mx <= a.x2 && my >= a.y1 && my <= a.y2);
    if (mh) { onFilter((cur) => (cur === mh.id ? null : mh.id)); return; }
    const ah = dotClicks.find((a) => mx >= a.x1 && mx <= a.x2 && my >= a.y1 && my <= a.y2);
    if (ah) onDotsClick({ launch: ah.launch, agents: ah.agents });   // show agent list first, detail is a second click away
  };
  cv.onmousemove = (e) => {
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const hit = msClicks.some((a) => mx >= a.x1 && mx <= a.x2 && my >= a.y1 && my <= a.y2)
      || dotClicks.some((a) => mx >= a.x1 && mx <= a.x2 && my >= a.y1 && my <= a.y2);
    cv.style.cursor = hit ? 'pointer' : 'default';
  };
}

function inRange(d, m) {
  if (!m) return false;
  const s = toDate(m.start), e = toDate(m.end);
  return s && e && d >= s && d <= e;
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
