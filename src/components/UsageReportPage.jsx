import { useEffect, useMemo, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useAuth } from '../hooks/useAuth';
import { AREA_ORDER } from '../lib/approveAreas';
import { downloadCsv } from '../lib/csv';
import { fmtDate } from '../lib/agentUtils';
import ThemeToggle from './ThemeToggle';
import '../styles/UsageReport.css';

/**
 * Agent/Skill Usage — the adoption report (2026-08-26).
 *
 * One row per (agent, person), dated by that person's FIRST endpoint click.
 * The rows are built and access-scoped SERVER-side (exports.usageReport): the
 * /agentEvents collection is closed to clients, /users can only be listed by
 * an admin, and Approve Area cannot be evaluated in security rules — so there
 * is no client-side path to this data at all. This page renders and filters
 * what the callable already decided it is allowed to see.
 *
 * A standalone page rather than a modal, matching /timeline: six columns plus
 * three filters plus grouping needs the width.
 */
const USAGE_ROLES = ['admin', 'committee', 'staff', 'approver'];

export default function UsageReportPage() {
  const { user, role, loading, roleReady, signOut } = useAuth();
  const [rows, setRows] = useState(null);   // null = not loaded yet
  const [scoped, setScoped] = useState(false);
  const [error, setError] = useState('');

  const [owner, setOwner] = useState('');
  const [area, setArea] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [groupByOwner, setGroupByOwner] = useState(false);

  const canView = !!user && USAGE_ROLES.includes(role);

  useEffect(() => {
    if (!canView) return;
    let alive = true;
    (async () => {
      try {
        const call = httpsCallable(getFunctions(undefined, 'asia-southeast1'), 'usageReport');
        const { data } = await call({});
        if (!alive) return;
        setRows(data?.rows || []);
        setScoped(!!data?.scoped);
      } catch (e) {
        if (alive) setError(e?.message || 'โหลดข้อมูลไม่สำเร็จ');
      }
    })();
    return () => { alive = false; };
  }, [canView]);

  const ownerOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.owner).filter(Boolean))].sort(),
    [rows],
  );

  // Filters run over rows the server already scoped — they are a convenience,
  // never the access boundary.
  const filtered = useMemo(() => {
    const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : null;
    // Inclusive end-of-day, or "to 2026-09-01" would silently drop that day.
    const toMs = to ? new Date(`${to}T23:59:59.999`).getTime() : null;
    return (rows || []).filter((r) => {
      if (owner && r.owner !== owner) return false;
      if (area && !String(r.area || '').split(', ').includes(area)) return false;
      if (fromMs && (r.adoptedAt || 0) < fromMs) return false;
      if (toMs && (r.adoptedAt || 0) > toMs) return false;
      return true;
    });
  }, [rows, owner, area, from, to]);

  const grouped = useMemo(() => {
    if (!groupByOwner) return null;
    const map = new Map();
    filtered.forEach((r) => {
      const k = r.owner || '(no owner)';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    });
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [filtered, groupByOwner]);

  function exportCsv() {
    downloadCsv(
      filtered.map((r) => ({ ...r, adoptedDate: r.adoptedAt ? new Date(r.adoptedAt).toISOString().slice(0, 10) : '' })),
      `agent-usage-${new Date().toISOString().slice(0, 10)}.csv`,
      ['agentName', 'owner', 'area', 'category', 'adopterName', 'adopterEmail', 'adoptedDate'],
      ['Agent Name', 'Owner', 'Area', 'Category', 'Adopter', 'Adopter Email', 'Adopted Date'],
    );
  }

  // Staged gates, same order as TimelinePage.
  if (loading) return <div className="tl-center"><div className="spin" /><span>กำลังโหลด…</span></div>;
  if (!user) {
    return (
      <div className="tl-center">
        <h2>กรุณาเข้าสู่ระบบ</h2>
        <p style={{ color: 'var(--mu)' }}>เปิดหน้านี้จากในแอปหลังจาก sign in แล้ว</p>
      </div>
    );
  }
  if (!roleReady) return <div className="tl-center"><div className="spin" /><span>กำลังตรวจสิทธิ์…</span></div>;
  if (!canView) {
    return (
      <div className="tl-center">
        <h2>ไม่มีสิทธิ์เข้าถึง</h2>
        <p style={{ color: 'var(--mu)', fontSize: 13 }}>
          บัญชี {user.email} ไม่มีสิทธิ์ดูรายงานการใช้งาน (เฉพาะ Admin, Committee, Staff และ Approver)
        </p>
      </div>
    );
  }

  const Row = ({ r }) => (
    <tr>
      <td className="usage-strong">{r.agentName}</td>
      <td>{r.owner || '—'}</td>
      <td className="usage-dim">{r.area || '—'}</td>
      <td className="usage-dim">{r.category || '—'}</td>
      <td>
        <div className="usage-strong">{r.adopterName || '—'}</div>
        <div className="usage-dim">{r.adopterEmail}</div>
      </td>
      <td className="usage-mono">{r.adoptedAt ? fmtDate(new Date(r.adoptedAt)) : '—'}</td>
    </tr>
  );

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
          <button className="nav-tab" onClick={() => { window.location.href = '/'; }}>← Back to Library</button>
        </div>
        <div className="nav-r" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="menu" style={{ position: 'static', minWidth: 0, marginTop: 0 }}>
            <ThemeToggle />
          </div>
          {user && (
            <div className="nav-user">
              {user.photoURL
                ? <img src={user.photoURL} alt="" />
                : <span className="nav-user-fallback">{(user.displayName || user.email || '?').trim().charAt(0).toUpperCase()}</span>}
              <button className="nav-signout" onClick={signOut}>Sign out</button>
            </div>
          )}
        </div>
      </nav>

      <div className="usage-page">
        <div className="usage-head">
          <div>
            <h2>Agent/Skill Usage</h2>
            <p>
              1 แถว = 1 คนที่เริ่มใช้ Agent/Skill นั้น · Adopted date คือวันที่คลิกใช้งานครั้งแรก
              {scoped && ' · แสดงเฉพาะ Agent/Skill ที่อยู่ใน Approve Area ของคุณ'}
            </p>
          </div>
          <button className="btn btn-secondary" onClick={exportCsv} disabled={!filtered.length}>
            ↓ Download CSV
          </button>
        </div>

        <div className="usage-filters">
          <label>
            Owner
            <select value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">All owners</option>
              {ownerOptions.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <label>
            Area
            <select value={area} onChange={(e) => setArea(e.target.value)}>
              <option value="">All areas</option>
              {AREA_ORDER.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label>
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button
            type="button"
            className={`usage-toggle${groupByOwner ? ' on' : ''}`}
            onClick={() => setGroupByOwner((v) => !v)}
          >
            Group by Owner
          </button>
          {(owner || area || from || to) && (
            <button
              type="button"
              className="usage-clear"
              onClick={() => { setOwner(''); setArea(''); setFrom(''); setTo(''); }}
            >
              Clear filters
            </button>
          )}
        </div>

        {error && <div className="msg error"><span className="dot" style={{ background: '#ea4335' }} />{error}</div>}
        {rows === null && !error && <div className="tl-center"><div className="spin" /><span>กำลังโหลดข้อมูลการใช้งาน…</span></div>}

        {rows !== null && (
          <>
            <div className="usage-count">
              {filtered.length} รายการ
              {filtered.length !== rows.length && ` (จากทั้งหมด ${rows.length})`}
            </div>

            {filtered.length === 0 ? (
              <div className="empty-state">ยังไม่มีข้อมูลการใช้งานตามเงื่อนไขนี้</div>
            ) : (
              <div className="usage-scroll">
                <table className="usage-table">
                  <thead>
                    <tr>
                      <th>Agent Name</th><th>Owner</th><th>Area</th>
                      <th>Category</th><th>Adopter</th><th>Adopted Date</th>
                    </tr>
                  </thead>
                  {groupByOwner ? grouped.map(([g, list]) => (
                    <tbody key={g}>
                      <tr className="usage-group">
                        <td colSpan={6}>{g}<span className="usage-badge">{list.length}</span></td>
                      </tr>
                      {list.map((r) => <Row key={`${r.agentId}__${r.adopterEmail}`} r={r} />)}
                    </tbody>
                  )) : (
                    <tbody>
                      {filtered.map((r) => <Row key={`${r.agentId}__${r.adopterEmail}`} r={r} />)}
                    </tbody>
                  )}
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
