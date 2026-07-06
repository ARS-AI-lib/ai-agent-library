import { useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import { useApprovedAgents } from '../hooks/useAgents';
import {
  TL_ST, toTimelineItem, timelineStatus, autoFitRange, monthTicks,
  inAnyMilestone, toDate, startOfToday,
} from '../lib/timeline';
import { uniq } from '../lib/agentUtils';
import AgentDetailModal from './AgentDetailModal';
import MilestoneEditor from './MilestoneEditor';
import '../styles/TimelinePage.css';

const LW = 200, RH = 76, HH = 36, AH = 52, IR = 12, PAD = 16, DAY = 864e5;
const DEFAULT_MS_COLORS = ['#0b7a68', '#2f6bff', '#6d28d9', '#c2590a', '#b45309', '#0369a1'];

export default function TimelinePage() {
  const { user, isAdmin, loading, roleReady, role } = useAuth();
  const { agents } = useApprovedAgents(!!role);
  const [config, setConfig] = useState(null);   // { viewers:[], milestones:[] } | null
  const [cfgLoaded, setCfgLoaded] = useState(false);
  const [filter, setFilter] = useState(null);    // milestone id | 'out' | null
  const [detailAgent, setDetailAgent] = useState(null);
  const [editMs, setEditMs] = useState(false);
  const canvasRef = useRef(null);

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
    drawTimeline(canvasRef.current, items, milestones, range, filter, setDetailAgent, setFilter);
  }, [canView, items, milestones, range, filter]);

  useEffect(() => {
    if (!canView) return;
    const onResize = () => drawTimeline(canvasRef.current, items, milestones, range, filter, setDetailAgent, setFilter);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [canView, items, milestones, range, filter]);

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
  const canEdit = canView; // same allowlist edits milestones (locked decision)

  return (
    <div className="tl-page">
      <div className="tl-topbar">
        <div>
          <h1 className="tl-title">SDLC Timeline</h1>
          <div className="tl-subtitle">Generative AI for SDLC — Launch Timeline</div>
        </div>
        {canEdit && (
          <button className="btn btn-primary" style={{ fontSize: 12.5, padding: '7px 14px' }} onClick={() => setEditMs(true)}>
            จัดการ Milestone
          </button>
        )}
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

      <OutOfMilestoneCard items={outItems} allItems={items} filter={filter} setFilter={setFilter} />

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

function Stat({ n, l, c }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'IBM Plex Mono',monospace", color: c }}>{n}</div>
      <div style={{ fontSize: 8.5, color: 'var(--mu)' }}>{l}</div>
    </div>
  );
}

// ── canvas drawing (ported from reference, adapted: auto-fit range, our
//    theme colors, Firestore-backed milestones) ──
function drawTimeline(cv, items, milestones, range, filter, onDotClick, onFilter) {
  if (!cv) return;
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
  ctx.fillStyle = '#f8fafd'; ctx.fillRect(0, 0, W, HH);
  ctx.fillStyle = '#f1f5fb'; ctx.fillRect(0, 0, LW, HH);
  ctx.fillStyle = '#7784a0'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('Owner', 14, HH / 2);
  monthTicks(S, E).forEach((m) => {
    const x1 = Math.max(dx(m.start), LW), x2 = Math.min(dx(new Date(m.end.getTime() + DAY)), LW + tw);
    if (x2 <= x1) return;
    ctx.strokeStyle = '#e8edf6'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x1, 0); ctx.lineTo(x1, HH); ctx.stroke();
    ctx.fillStyle = '#46516d'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(m.label, (x1 + x2) / 2, HH / 2);
  });
  ctx.strokeStyle = '#c8d0e0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, HH); ctx.lineTo(W, HH); ctx.stroke();

  // milestone axis
  const ay = HH;
  ctx.fillStyle = '#f8fafd'; ctx.fillRect(0, ay, W, AH);
  ctx.fillStyle = '#f1f5fb'; ctx.fillRect(0, ay, LW, AH);
  ctx.fillStyle = '#7784a0'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('Milestones', 14, ay + AH / 2);
  const msClicks = [];
  milestones.forEach((m) => {
    const ms = toDate(m.start), me = toDate(m.end);
    if (!ms || !me) return;
    const x1 = dx(ms), x2 = dx(me), w = Math.max(2, x2 - x1), sel = filter === m.id;
    const col = m.color || '#2f6bff';
    ctx.fillStyle = col + (sel ? '55' : '30'); rrect(ctx, x1, ay + 7, w, AH - 14, 5); ctx.fill();
    ctx.strokeStyle = sel ? col : col + '90'; ctx.lineWidth = sel ? 2.5 : 1.5; rrect(ctx, x1, ay + 7, w, AH - 14, 5); ctx.stroke();
    ctx.fillStyle = col; ctx.font = `bold ${sel ? 12 : 11}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(m.name || m.id, x1 + w / 2, ay + AH / 2 - 7);
    const sL = ms.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), eL = me.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    ctx.font = '8.5px sans-serif'; ctx.fillStyle = col + 'cc'; ctx.fillText(`${sL}–${eL}`, x1 + w / 2, ay + AH / 2 + 8);
    msClicks.push({ x1, y1: ay, x2, y2: ay + AH, id: m.id });
  });
  ctx.strokeStyle = '#e8edf6'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, ay + AH); ctx.lineTo(W, ay + AH); ctx.stroke();

  // team rows
  const dotClicks = [];
  vis.forEach((team, ti) => {
    const tAgs = items.filter((a) => a.team === team);
    const ry = HH + AH + ti * RH, my = ry + RH / 2 - 8;
    ctx.fillStyle = ti % 2 === 0 ? '#fff' : '#fafbfd'; ctx.fillRect(0, ry, W, RH);
    ctx.fillStyle = '#f4f6fb'; ctx.fillRect(0, ry, LW, RH);
    ctx.strokeStyle = '#e8edf6'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, ry + RH); ctx.lineTo(W, ry + RH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(LW, ry); ctx.lineTo(LW, ry + RH); ctx.stroke();
    ctx.fillStyle = '#182135'; ctx.font = 'bold 12.5px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(team, 14, ry + 10);
    const rN = tAgs.filter((a) => a.progress >= 70).length;
    ctx.fillStyle = '#7784a0'; ctx.font = '10px sans-serif'; ctx.fillText(`${tAgs.length} items · ${rN} ≥70%`, 14, ry + 27);

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
      if (dim) { ctx.globalAlpha = .15; ctx.beginPath(); ctx.arc(cx, my, IR, 0, Math.PI * 2); ctx.fillStyle = '#9ca3af'; ctx.fill(); ctx.globalAlpha = 1; return; }
      const order = ['delay', 'risk', 'ontime', 'pilot', 'done', 'notstart'];
      const statuses = ags.map((a) => timelineStatus(a, S, today));
      const pr = order.find((s) => statuses.includes(s)) || 'notstart';
      const st = TL_ST[pr]; const n = ags.length;
      ctx.shadowColor = 'rgba(0,0,0,0.12)'; ctx.shadowBlur = 4;
      ctx.beginPath(); ctx.arc(cx, my, IR, 0, Math.PI * 2); ctx.fillStyle = st.bg; ctx.fill();
      ctx.shadowBlur = 0; ctx.strokeStyle = st.bd; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, my, IR, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = st.tx; ctx.font = `bold ${n > 1 ? 11 : 10}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(n > 1 ? String(n) : st.ic, cx, my);
      const lb = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      ctx.font = '600 8.5px sans-serif'; ctx.textBaseline = 'top'; ctx.fillText(lb, cx, my + IR + 3);
      dotClicks.push({ x1: cx - IR - 2, y1: ry, x2: cx + IR + 2, y2: ry + RH, agents: ags });
    });
  });

  // today line
  ctx.save(); ctx.strokeStyle = '#ef4444aa'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.moveTo(tx, HH); ctx.lineTo(tx, H); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
  ctx.strokeStyle = '#c8d0e0'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(LW, HH); ctx.lineTo(LW, H); ctx.stroke();

  cv.onclick = (e) => {
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const mh = msClicks.find((a) => mx >= a.x1 && mx <= a.x2 && my >= a.y1 && my <= a.y2);
    if (mh) { onFilter((cur) => (cur === mh.id ? null : mh.id)); return; }
    const ah = dotClicks.find((a) => mx >= a.x1 && mx <= a.x2 && my >= a.y1 && my <= a.y2);
    if (ah) onDotClick(ah.agents[0]._raw);   // open first agent's detail (reuse library modal)
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
