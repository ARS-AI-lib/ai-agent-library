import { useEffect, useMemo, useRef, useState } from 'react';
import PageHeader from './PageHeader';
import { useAuth } from '../hooks/useAuth';
import { getFunctions, httpsCallable } from '../lib/callable';
import { goToField } from '../lib/formFocus';
import { backfillCsv, summarize, STATUS_LABEL } from '../lib/assessmentBackfill';
import { bangkokDay } from '../lib/assessments';
import { failMsg } from '../lib/copy';
import '../styles/UsageReport.css';
import '../styles/AssessBackfill.css';

/**
 * Admin setup page for the assessment backfill (/assessment-backfill, 2026-11-27).
 * Admin/committee only. Sends ONE digest per creator who still has not-done items (the server
 * decides the real recipients); no per-row reminders and no automatic scheduling by design.
 */
const call = (name, payload) => httpsCallable(getFunctions(undefined, 'asia-southeast1'), name)(payload).then((r) => r.data);
const ROLES = ['admin', 'committee'];
const CHANNELS = [['inbox', 'Inbox'], ['teams', 'Teams'], ['email', 'Email']];
const FIELDS = [['Due date', /^Due date/], ['Channels', /^Channels/]];
const fmtDate = (ms) => (ms ? bangkokDay(new Date(ms)) : '—');
const plusDays = (n) => bangkokDay(new Date(Date.now() + n * 86400000));

function tally(r) {
  const p = [];
  if (r.sent != null) p.push(`${r.sent} sent`);
  if (r.held) p.push(`${r.held} held`);
  if (r.skipped) p.push(`${r.skipped} skipped`);
  if (r.skippedNoEmail) p.push(`${r.skippedNoEmail} skipped (no email)`);
  if (r.failed) p.push(`${r.failed} failed`);
  let t = p.join(' · ') || 'Nothing to send';
  if (r.dryRun) t += ' (dry run — nothing was really delivered)';
  if (r.disabled) t += ' (sending is switched off)';
  return t;
}

export default function AssessmentBackfillPage() {
  const { user, role, loading, roleReady, signIn, domainError } = useAuth();
  const busyRef = useRef(false);
  const [data, setData] = useState(null);   // { rows, campaign }
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [dueDate, setDueDate] = useState(() => plusDays(14));
  const [channels, setChannels] = useState(['inbox', 'teams', 'email']);
  const [preview, setPreview] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('all');

  const canView = !!user && ROLES.includes(role);
  const load = async () => {
    try { setData(await call('backfillList', {})); return true; }
    catch (e) { setError(failMsg('โหลดรายการ', e)); return false; }
  };
  useEffect(() => { if (canView) load(); }, [canView]);   // eslint-disable-line react-hooks/exhaustive-deps

  const rows = data?.rows || [];
  const sum = useMemo(() => summarize(rows), [rows]);
  const targets = useMemo(() => new Set(rows.filter((r) => r.status === 'not_done').flatMap((r) => r.creators || [])).size, [rows]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows
      .filter((r) => (statusF === 'all' || r.status === statusF)
        && (!t || r.name.toLowerCase().includes(t) || (r.creators || []).some((c) => c.toLowerCase().includes(t))))
      .sort((a, b) => (a.status === 'not_done' ? 0 : 1) - (b.status === 'not_done' ? 0 : 1) || a.name.localeCompare(b.name));
  }, [rows, q, statusF]);

  function validate() {
    let msg = '';
    if (!dueDate) msg = 'Due date: ใส่วันครบกำหนด';
    else if (dueDate < bangkokDay(new Date())) msg = 'Due date: วันครบกำหนดต้องไม่เป็นวันที่ผ่านมาแล้ว';
    else if (!channels.length) msg = 'Channels: เลือกอย่างน้อย 1 ช่องทาง';
    if (msg) { setError(msg); goToField('.abf-wrap', msg, FIELDS); return false; }
    return true;
  }
  async function run(label, payload, after) {
    if (busyRef.current) return;
    setError(''); setNotice('');
    if (!validate()) return;
    busyRef.current = true; setBusy(true);
    try { await after(await call('backfillSend', { dueDate, channels, ...payload })); }
    catch (e) { setError(failMsg(label, e)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const doPreview = () => run('ดูตัวอย่างข้อความ', { preview: true }, (r) => setPreview(r));
  const doTest = () => run('ส่งทดสอบ', { testOnly: true }, (r) => setNotice(`Test to you: ${tally(r)}`));
  const doSend = () => { setConfirming(false); return run('ส่งข้อความ', {}, async (r) => { setNotice(`Sent: ${tally(r)}`); await load(); }); };
  const toggleCh = (c) => setChannels((l) => (l.includes(c) ? l.filter((x) => x !== c) : [...l, c]));

  if (loading) return <div className="tl-center"><div className="spin" /><span>กำลังโหลด…</span></div>;
  if (!user) {
    return (
      <div className="tl-center">
        <h2>Sign in to continue</h2>
        <p style={{ color: 'var(--mu)', fontSize: 13 }}>หน้านี้ใช้ได้เฉพาะบัญชีขององค์กร</p>
        {domainError && <div className="msg error" style={{ marginBottom: 12 }}><span className="dot" style={{ background: '#ea4335' }} />{domainError}</div>}
        <button className="btn btn-primary" onClick={() => signIn().catch((e) => setError(failMsg('เข้าสู่ระบบ', e)))}>ลงชื่อเข้าใช้ด้วย Google</button>
        {error && <p style={{ color: 'var(--late)' }}>{error}</p>}
      </div>
    );
  }
  if (!roleReady) return <div className="tl-center"><div className="spin" /><span>กำลังตรวจสอบสิทธิ์…</span></div>;
  if (!canView) return (<><PageHeader user={user} /><div className="abf-wrap"><div className="empty-state">Access restricted — เฉพาะ Admin และ Committee</div></div></>);

  const camp = data?.campaign;
  return (
    <>
      <PageHeader user={user} />
      <div className="abf-wrap">
        <h2 style={{ margin: '0 0 4px' }}>Assessment Backfill</h2>
        {camp && <div className="abf-meta">Round sent {(camp.sends || []).filter((s) => !s.testOnly).length} times · due {camp.dueDate}</div>}
        {error && <div className="msg error"><span className="dot" style={{ background: '#ea4335' }} />{error}</div>}
        {notice && <div className="abf-note ok">{notice}</div>}
        {!data && !error && <div className="tl-center"><div className="spin" /></div>}
        {data && (
          <>
            <div className="abf-kpis">
              <div className="abf-kpi"><b>{sum.items}</b><span>Items</span></div>
              <div className="abf-kpi"><b>{sum.done}</b><span>Done</span></div>
              <div className="abf-kpi"><b>{sum.notDone}</b><span>Not started</span></div>
              <div className={`abf-kpi${sum.noEmail ? ' bad' : ''}`}><b>{sum.noEmail}</b><span>No creator email</span></div>
            </div>

            <section className="fsec">
              <div className="fsec-h">Send setup</div>
              <div className="fgrid">
                <div className="fg">
                  <label>Due date <span className="req">*</span></label>
                  <input type="date" value={dueDate} min={bangkokDay(new Date())} onChange={(e) => setDueDate(e.target.value)} />
                </div>
                <div className="fg">
                  <label>Channels <span className="req">*</span></label>
                  <div className="abf-chk">
                    {CHANNELS.map(([k, l]) => (
                      <label key={k}><input type="checkbox" checked={channels.includes(k)} onChange={() => toggleCh(k)} />{l}</label>
                    ))}
                  </div>
                </div>
              </div>
              <div className="abf-actions">
                <button className="btn" disabled={busy} onClick={doPreview}>Preview message</button>
                <button className="btn" disabled={busy} onClick={doTest}>Send test to me</button>
                <button className="btn btn-primary" disabled={busy || !targets} onClick={() => { if (validate()) setConfirming(true); }}>Send to {targets} creators</button>
              </div>
              {confirming && (
                <div className="abf-note">
                  Send the assessment request to <b>{targets}</b> creators, due <b>{dueDate}</b>, via {channels.join(', ')}? ส่งแล้วย้อนกลับไม่ได้
                  <div className="abf-actions">
                    <button className="btn btn-primary" disabled={busy} onClick={doSend}>Confirm send</button>
                    <button className="btn" onClick={() => setConfirming(false)}>Cancel</button>
                  </div>
                </div>
              )}
              {preview && (
                <div className="abf-preview">
                  <b>{preview.preview?.subject}</b>
                  <pre>{preview.preview?.text}</pre>
                  <div className="abf-meta">Would reach {preview.count} creators · nothing was sent</div>
                  <button className="btn" onClick={() => setPreview(null)}>Close preview</button>
                </div>
              )}
            </section>

            <div className="usage-filters">
              <label>Search<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Item or creator" /></label>
              <label>Status
                <select value={statusF} onChange={(e) => setStatusF(e.target.value)}>
                  <option value="all">All</option>
                  <option value="not_done">Not done</option>
                  <option value="pass">Pass</option>
                  <option value="fail">Not pass</option>
                </select>
              </label>
              <button className="btn" onClick={() => {
                const blob = new Blob(['﻿', backfillCsv(rows, dueDate)], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = `assessment-backfill-${bangkokDay(new Date())}.csv`; a.click(); URL.revokeObjectURL(url);
              }}>Download CSV</button>
            </div>
            <div className="usage-count">{shown.length} of {rows.length} items</div>
            {shown.length === 0 ? <div className="empty-state">No items match</div> : (
              <div className="usage-scroll">
                <table className="usage-table">
                  <thead><tr><th>Agent/Skill</th><th>Phase</th><th>Status</th><th>Creators</th><th>Result</th><th>Last assessed</th></tr></thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.id}>
                        <td className="usage-strong">{r.name}</td>
                        <td className="usage-dim">{r.phase}</td>
                        <td>{STATUS_LABEL[r.status] || r.status}</td>
                        <td>{(r.creators || []).length ? r.creators.join(', ') : <span className="abf-nomail">No email</span>}</td>
                        <td>{r.level || '—'}{r.status === 'fail' && (r.reasons || []).length > 0 && <div className="abf-reason">Not pass: {r.reasons.join(', ')}</div>}</td>
                        <td className="usage-mono">{fmtDate(r.lastAssessedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
