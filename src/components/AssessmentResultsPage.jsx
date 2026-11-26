import { Fragment, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import PageHeader from './PageHeader';
import { db } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import { useScreeningConfig } from '../hooks/useScreeningConfig';
import { AREA_ORDER } from '../lib/approveAreas';
import { downloadCsv } from '../lib/csv';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { filterRecords, groupByOwner, recordCsv, recordResult, answerText, bangkokDay, bangkokYear } from '../lib/assessments';
import { DECL_FIELDS } from '../lib/declaration';
import { failMsg } from '../lib/copy';
import '../styles/UsageReport.css';
import '../styles/Screening.css';

/**
 * Assessment Results (2026-11-26) — one row per registration / deploy request, newest first,
 * grouped by owner. Records are immutable /assessments docs; level / must / should are always
 * RE-EVALUATED from the live questionnaire config (Assessment Settings), so edits show up here.
 * Admin/Committee see everything; an approver is limited to their own Approve Areas — that scoping
 * is UI-side (rules let approver-or-above read, see firestore.rules).
 * Same shape and classes as /usage so the two reports look alike.
 */
const VIEW_ROLES = ['admin', 'committee', 'approver'];
const DECL_ROWS = [{ key: 'description', label: 'Description' }, ...DECL_FIELDS.map((f) => ({ key: f.key, label: f.label }))];

export function exportRecordsCsv(config, records, name) {
  const { headers, rows } = recordCsv(config, records);
  const cols = headers.map((_, i) => String(i));
  downloadCsv(rows.map((r) => Object.fromEntries(r.map((v, i) => [String(i), v]))), `${name}-${bangkokDay(new Date())}.csv`, cols, headers);
}

export function RecordsTable({ config, records, groupOwner }) {
  const [open, setOpen] = useState(null);
  const groups = groupOwner ? groupByOwner(records) : [{ owner: null, rows: groupByOwner(records).flatMap((g) => g.rows).sort((a, b) => (b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt)) - (a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt))) }];
  const Row = ({ r }) => {
    const e = recordResult(config, r);
    const isOpen = open === r.id;
    return (
      <Fragment>
        <tr style={{ cursor: 'pointer' }} onClick={() => setOpen(isOpen ? null : r.id)}>
          <td className="usage-mono">{bangkokDay(r.createdAt)}</td>
          <td className="usage-strong">{r.agentName}</td>
          <td>{r.stage === 'pre' ? 'Pre-assessment' : 'Deploy request'}</td>
          <td><span className={`scr-lvl ${e.level || ''}`}>{e.level || '—'}</span></td>
          <td className="usage-mono">{e.total}</td>
          <td className="usage-dim">
            {e.must.length > 0 && <span className="scr-sum-must">Must {e.must.map((m) => m.item).join(', ')} </span>}
            {e.should.length > 0 && <span>Should {e.should.map((m) => m.item).join(', ')}</span>}
            {!e.must.length && !e.should.length && '—'}
          </td>
          <td className="usage-dim">{(r.approveArea || []).join(', ') || '—'}</td>
        </tr>
        {isOpen && (
          <tr>
            <td colSpan={7} style={{ background: 'var(--sf2)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '6px 18px', fontSize: 11.5, padding: '4px 0' }}>
                {DECL_ROWS.map((d) => <div key={d.key}><span className="usage-dim">{d.label}: </span>{r.decl?.[d.key] || '—'}</div>)}
                {config.questions.map((q) => <div key={q.id}><span className="usage-dim">{q.code}: </span>{answerText(config, r, q) || '—'}</div>)}
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };
  return (
    <div className="usage-scroll">
      <table className="usage-table">
        <thead><tr><th>Date</th><th>Agent/Skill Name</th><th>Stage</th><th>Level</th><th>Score</th><th>Fix</th><th>Area</th></tr></thead>
        {groups.map((g) => (
          <tbody key={g.owner ?? 'all'}>
            {g.owner !== null && <tr className="usage-group"><td colSpan={7}>{g.owner}<span className="usage-badge">{g.rows.length}</span></td></tr>}
            {g.rows.map((r) => <Row key={r.id} r={r} />)}
          </tbody>
        ))}
      </table>
    </div>
  );
}


// Admin-only: archive past years (current year is refused by the callable too) and browse what was
// archived. Archived rows never appear in the normal Results view; they are read through the
// listArchivedAssessments callable and evaluated with the config frozen at archive time.
function ArchivedPanel({ liveRecords, onChanged }) {
  const [years, setYears] = useState(null);
  const [data, setData] = useState(null);     // { year, configSnapshot, items }
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const call = (name, payload) => httpsCallable(getFunctions(undefined, 'asia-southeast1'), name)(payload).then((r) => r.data);
  const refresh = async () => { try { setYears((await call('listArchivedAssessments', {})).years); } catch (e) { setError(failMsg('โหลดรายการ archive', e)); } };
  useEffect(() => { refresh(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const nowYear = bangkokYear(new Date());
  const ready = Object.entries((liveRecords || []).reduce((m, r) => { if (r.year < nowYear) m[r.year] = (m[r.year] || 0) + 1; return m; }, {})).sort((a, b) => b[0] - a[0]);

  async function archive(y, n) {
    if (!window.confirm(`ย้ายผล assessment ปี ${y} (${n} รายการ) ไปเก็บถาวร? จะไม่แสดงในหน้า Results ปกติอีก`)) return;
    setBusy(String(y)); setError('');
    try { await call('archiveAssessmentYear', { year: Number(y) }); await refresh(); await onChanged(); }
    catch (e) { setError(failMsg('archive', e)); } finally { setBusy(''); }
  }
  async function open(y) {
    setBusy(`open${y}`); setError('');
    try { setData({ year: y, ...(await call('listArchivedAssessments', { year: y })) }); }
    catch (e) { setError(failMsg('โหลดข้อมูล archive', e)); } finally { setBusy(''); }
  }

  return (
    <div>
      {error && <div className="msg error"><span className="dot" style={{ background: '#ea4335' }} />{error}</div>}
      <div className="usage-count">Ready to archive (past years with results still in Results)</div>
      {ready.length === 0 ? <div className="empty-state">ไม่มีปีที่ผ่านมาแล้วที่ยังรอ archive (ปีปัจจุบัน({nowYear}) archive ไม่ได้)</div> : (
        <div className="usage-filters">
          {ready.map(([y, n]) => (
            <button key={y} type="button" className="usage-toggle" disabled={!!busy} onClick={() => archive(y, n)}>
              {busy === y ? 'Archiving…' : `Archive ${y} · ${n}`}
            </button>
          ))}
        </div>
      )}
      <div className="usage-count" style={{ marginTop: 16 }}>Archived years</div>
      {years === null ? <div className="tl-center"><div className="spin" /></div> : years.length === 0 ? <div className="empty-state">ยังไม่มีข้อมูลที่ archive</div> : (
        <div className="usage-filters">
          {years.map((y) => (
            <button key={y.year} type="button" className={`usage-toggle${data?.year === y.year ? ' on' : ''}`} disabled={!!busy} onClick={() => open(y.year)}>
              {y.year} · {y.count}
            </button>
          ))}
        </div>
      )}
      {data && (
        <>
          <div className="usage-head">
            <div className="usage-count">Archived {data.year} — {data.items.length} รายการ</div>
            <button className="btn btn-secondary" onClick={() => exportRecordsCsv(data.configSnapshot, data.items, `assessment-archive-${data.year}`)} disabled={!data.items.length}>↓ Download CSV</button>
          </div>
          {data.truncated && <div className="msg error"><span className="dot" style={{ background: '#ea4335' }} />แสดงเพียง {data.items.length} จากทั้งหมด {data.total} รายการ — ข้อมูลปีนี้มากกว่าที่แสดงได้ในครั้งเดียว</div>}
          <RecordsTable config={data.configSnapshot} records={data.items} groupOwner />
        </>
      )}
    </div>
  );
}

export default function AssessmentResultsPage() {
  const { user, role, approveAreas, loading, roleReady } = useAuth();
  const config = useScreeningConfig();
  const [records, setRecords] = useState(null);
  const [error, setError] = useState('');
  const [year, setYear] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [owner, setOwner] = useState('');
  const [area, setArea] = useState('');
  const [groupOwner, setGroupOwner] = useState(true);
  const [tab, setTab] = useState('results');
  const canView = !!user && VIEW_ROLES.includes(role);
  const isApprover = role === 'approver';
  const isAdmin = role === 'admin';

  const load = async () => {
    try {
      const snap = await getDocs(query(collection(db, 'assessments'), orderBy('createdAt', 'desc'), limit(3000)));
      setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) { setError(failMsg('โหลดข้อมูล', e)); }
  };
  useEffect(() => { if (canView) load(); }, [canView]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Approver: only records overlapping their own Approve Areas (UI-side scoping).
  const visible = useMemo(() => {
    if (!records) return null;
    if (!isApprover) return records;
    const mine = new Set(approveAreas || []);
    return records.filter((r) => (r.approveArea || []).some((a) => mine.has(a)));
  }, [records, isApprover, approveAreas]);

  const years = useMemo(() => [...new Set((visible || []).map((r) => r.year))].sort((a, b) => b - a), [visible]);
  const owners = useMemo(() => [...new Set((visible || []).map((r) => r.owner).filter(Boolean))].sort(), [visible]);
  const filtered = useMemo(() => filterRecords(visible || [], { year, from, to, owner, area }), [visible, year, from, to, owner, area]);

  if (loading) return <div className="tl-center"><div className="spin" /><span>กำลังโหลด…</span></div>;
  if (!user) return <div className="tl-center"><h2>Sign in to continue</h2><p style={{ color: 'var(--mu)' }}>โปรด sign in ที่หน้า Library ก่อนเปิดหน้านี้</p></div>;
  if (!roleReady) return <div className="tl-center"><div className="spin" /><span>กำลังตรวจสิทธิ์…</span></div>;
  if (!canView) return <div className="tl-center"><h2>Access restricted</h2><p style={{ color: 'var(--mu)', fontSize: 13 }}>เปิดได้เฉพาะ Admin, Committee และ Approver</p></div>;

  return (
    <div>
      <PageHeader user={user} />
      <div className="usage-page">
        <div className="usage-head">
          <div>
            <h2>Assessment Results</h2>
            {isApprover && <p>Your approve areas only</p>}
          </div>
          {tab === 'results' && <button className="btn btn-secondary" onClick={() => exportRecordsCsv(config, filtered, 'assessment-results')} disabled={!filtered.length}>↓ Download CSV</button>}
        </div>

        {isAdmin && (
          <div className="usage-filters" role="tablist" aria-label="Assessment views">
            <button type="button" role="tab" aria-selected={tab === 'results'} className={`usage-toggle${tab === 'results' ? ' on' : ''}`} onClick={() => setTab('results')}>Results</button>
            <button type="button" role="tab" aria-selected={tab === 'archived'} className={`usage-toggle${tab === 'archived' ? ' on' : ''}`} onClick={() => setTab('archived')}>Archived</button>
          </div>
        )}

        {tab === 'archived' && isAdmin ? <ArchivedPanel liveRecords={records} onChanged={load} /> : (<>

        <div className="usage-filters">
          <label>Year
            <select value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="">All years</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <label>Owner
            <select value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">All owners</option>
              {owners.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <label>Area
            <select value={area} onChange={(e) => setArea(e.target.value)}>
              <option value="">All areas</option>
              {AREA_ORDER.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <button type="button" className={`usage-toggle${groupOwner ? ' on' : ''}`} onClick={() => setGroupOwner((v) => !v)}>Group by Owner</button>
          {(year || from || to || owner || area) && (
            <button type="button" className="usage-clear" onClick={() => { setYear(''); setFrom(''); setTo(''); setOwner(''); setArea(''); }}>Clear filters</button>
          )}
        </div>

        {error && <div className="msg error"><span className="dot" style={{ background: '#ea4335' }} />{error}</div>}
        {visible === null && !error && <div className="tl-center"><div className="spin" /><span>กำลังโหลดผล assessment…</span></div>}
        {isApprover && !(approveAreas || []).length && (
          <div className="empty-state">บัญชีของคุณยังไม่มี Approve Area จึงยังไม่มีผลให้ดู</div>
        )}
        {visible !== null && (
          <>
            <div className="usage-count">{filtered.length} รายการ{filtered.length !== visible.length && ` (จากทั้งหมด ${visible.length})`}</div>
            {filtered.length === 0
              ? <div className="empty-state">ยังไม่มีผล assessment ตามเงื่อนไขนี้</div>
              : <RecordsTable config={config} records={filtered} groupOwner={groupOwner} />}
          </>
        )}
        </>)}
      </div>
    </div>
  );
}
