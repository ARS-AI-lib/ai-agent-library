import { useEffect, useMemo, useRef, useState } from 'react';
import PageHeader from './PageHeader';
import { useAuth } from '../hooks/useAuth';
import { getFunctions, httpsCallable } from '../lib/callable';
import { goToField } from '../lib/formFocus';
import { estimateSendMinutes, backfillCsv, summarize, filterRows, defaultSelection, toggleId, selectAllFiltered, selectionState, selectionCounts, pruneSelection, STATUS_LABEL } from '../lib/assessmentBackfill';
import { bangkokDay } from '../lib/assessments';
import { failMsg } from '../lib/copy';
import '../styles/UsageReport.css';
import '../styles/AssessBackfill.css';

/**
 * Admin setup page for the assessment backfill (/assessment-backfill, 2026-11-27).
 * Admin/committee only. Sends ONE digest per creator who still has not-done items (the server
 * decides the real recipients); no per-row reminders and no automatic scheduling by design.
 */
// backfillSend paces 10 s per creator (can run ~55 min), so it needs a long client timeout.
const call = (name, payload) => httpsCallable(getFunctions(undefined, 'asia-southeast1'), name, name === 'backfillSend' ? { timeout: 3600000 } : undefined)(payload).then((r) => r.data);
const ROLES = ['admin', 'committee'];
const CHANNELS = [['inbox', 'Inbox'], ['teams', 'Teams'], ['email', 'Email']];
const FIELDS = [['Due date', /^Due date/], ['Channels', /^Channels/], ['Subject', /^Subject/], ['Items', /^Items/]];
const fmtDate = (ms) => (ms ? bangkokDay(new Date(ms)) : '—');
const plusDays = (n) => bangkokDay(new Date(Date.now() + n * 86400000));

// The server states what really happened (inbox written vs Teams/Email outcome) in r.summary.
function tally(r) {
  const p = [r.summary || 'ไม่มีข้อความที่ส่งออก'];
  if (r.skippedNoEmail) p.push(`${r.skippedNoEmail} skipped (no email)`);
  if ((r.failedRecipients || []).length) p.push(`failed: ${r.failedRecipients.join(', ')}`);
  return p.join(' · ');
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
  const [phaseF, setPhaseF] = useState('all');
  const [selected, setSelected] = useState(null);   // Set of row ids (not_done only); null until first load
  const [msg, setMsg] = useState({ subject: '', intro: '', outro: '' });
  const [touched, setTouched] = useState({});       // which message parts the admin edited
  const [defaults, setDefaults] = useState(null);   // server default copy
  const allSel = useRef(null);

  const canView = !!user && ROLES.includes(role);
  const aliveRef = useRef(true);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);
  const load = async () => {
    try { const d = await call('backfillList', {}); if (aliveRef.current) { setData(d); setError(''); } return true; }
    catch (e) { if (aliveRef.current) setError(failMsg('โหลดรายการ', e)); return false; }
  };
  useEffect(() => { if (canView) load(); }, [canView]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPreview(null); }, [dueDate, channels, msg, selected]);

  const rows = data?.rows || [];
  const sum = useMemo(() => summarize(rows), [rows]);
  useEffect(() => {
    if (!data) return;
    setSelected((prev) => (prev === null ? defaultSelection(data.rows) : pruneSelection(prev, data.rows)));
  }, [data]);
  const sel = selected || new Set();
  const { items: selItems, creators: targets } = useMemo(() => selectionCounts(rows, sel), [rows, selected]);   // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => filterRows(rows, { q, status: statusF, phase: phaseF })
    .sort((a, b) => (a.status === 'not_done' ? 0 : 1) - (b.status === 'not_done' ? 0 : 1) || a.name.localeCompare(b.name)), [rows, q, statusF, phaseF]);
  const headState = selectionState(sel, shown);
  useEffect(() => { if (allSel.current) allSel.current.indeterminate = headState === 'some'; }, [headState]);

  // Default copy comes from the server (it depends on the due date); untouched parts follow it.
  useEffect(() => {
    if (!canView || !data || !dueDate || !channels.length) return undefined;
    let dead = false;
    // debounced: backfillSend is rate limited, so a date being edited must not fire a call per keystroke
    const timer = setTimeout(() => call('backfillSend', { dueDate, channels: ['inbox'], preview: true }).then((r) => {
      if (dead || !r.defaults) return;
      setDefaults(r.defaults);
      setMsg((m) => ({ subject: touched.subject ? m.subject : r.defaults.subject, intro: touched.intro ? m.intro : r.defaults.intro, outro: touched.outro ? m.outro : r.defaults.outro }));
    }).catch(() => {}), 700);
    return () => { dead = true; clearTimeout(timer); };
  }, [canView, !!data, dueDate]);   // eslint-disable-line react-hooks/exhaustive-deps
  const editMsg = (k, v) => { setMsg((m) => ({ ...m, [k]: v })); setTouched((t) => ({ ...t, [k]: true })); };
  const resetMsg = () => { if (defaults) setMsg(defaults); setTouched({}); };
  const payloadExtra = () => ({ message: msg, agentIds: [...sel] });

  function validate() {
    let m = '';
    if (!dueDate) m = 'Due date: ใส่วันครบกำหนด';
    else if (dueDate < bangkokDay(new Date())) m = 'Due date: วันครบกำหนดต้องไม่เป็นวันที่ผ่านมาแล้ว';
    else if (!channels.length) m = 'Channels: เลือกอย่างน้อย 1 ช่องทาง';
    else if (defaults && !msg.subject.trim()) m = 'Subject: ใส่หัวข้อข้อความ';
    if (m) { setError(m); goToField('.abf-wrap', m, FIELDS); return false; }
    return true;
  }
  async function run(label, payload, after) {
    if (busyRef.current) return;
    setError(''); setNotice('');
    if (!validate()) return;
    busyRef.current = true; setBusy(true);
    try { await after(await call('backfillSend', { dueDate, channels, ...payloadExtra(), ...payload })); }
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
        {!data && error && <div className="abf-actions"><button className="btn" onClick={() => { setError(''); load(); }}>Retry</button></div>}
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
              <div className="fg abf-msg">
                <label>Message</label>
                <div className="fhelp">คำขึ้นต้น (เรียน คุณ…), รายการพร้อมลิงก์ และประโยควันครบกำหนด ระบบเติมให้อัตโนมัติ — แก้ได้เฉพาะ Subject, Intro และ Closing</div>
                <label className="abf-sub">Subject <span className="req">*</span></label>
                <input value={msg.subject} maxLength={200} onChange={(e) => editMsg('subject', e.target.value)} />
                <label className="abf-sub">Intro</label>
                <textarea rows={4} value={msg.intro} maxLength={2000} onChange={(e) => editMsg('intro', e.target.value)} />
                <label className="abf-sub">Closing</label>
                <textarea rows={4} value={msg.outro} maxLength={2000} onChange={(e) => editMsg('outro', e.target.value)} />
                <div><button type="button" className="btn" disabled={!defaults} onClick={resetMsg}>Reset to default</button></div>
              </div>
              <div className="abf-actions">
                <button className="btn" disabled={busy} onClick={doPreview}>Preview message</button>
                <button className="btn" disabled={busy} onClick={doTest}>Send test to me</button>
                <button className="btn btn-primary" disabled={busy || !selItems} onClick={() => { if (validate()) setConfirming(true); }}>Send to {targets} creators ({selItems} items)</button>
                {!selItems && <span className="abf-meta">Items: เลือกรายการที่ยังไม่ทำอย่างน้อย 1 รายการในตารางด้านล่าง</span>}
              </div>
              {confirming && (
                <div className="abf-note">
                  Send the assessment request to <b>{targets}</b> creators (<b>{selItems}</b> items), due <b>{dueDate}</b>, via {channels.join(', ')}? ส่งแล้วย้อนกลับไม่ได้
                  <div style={{ marginTop: 6 }}>ระบบจะส่งทีละคนเว้นระยะ 10 วินาที ใช้เวลาประมาณ {estimateSendMinutes(targets)} นาที — กรุณาอย่าปิดหน้านี้จนกว่าจะเสร็จ</div>
                  {busy && <div style={{ marginTop: 6, fontWeight: 600 }}>กำลังส่ง… ประมาณ {estimateSendMinutes(targets)} นาที อย่าปิดหน้านี้</div>}
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
              <label>Phase
                <select value={phaseF} onChange={(e) => setPhaseF(e.target.value)}>
                  <option value="all">All</option>
                  <option value="Pilot">Pilot</option>
                  <option value="Ready to Use">Ready to Use</option>
                </select>
              </label>
              <label>Status
                <select value={statusF} onChange={(e) => setStatusF(e.target.value)}>
                  <option value="all">All</option>
                  <option value="not_done">Not done</option>
                  <option value="pass">Pass</option>
                  <option value="fail">Not pass</option>
                </select>
              </label>
              <button className="btn" onClick={() => {
                const blob = new Blob(['﻿', backfillCsv(rows, data?.campaign?.dueDate || '')], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = `assessment-backfill-${bangkokDay(new Date())}.csv`; a.click(); URL.revokeObjectURL(url);
              }}>Download CSV</button>
            </div>
            <div className="usage-count">{shown.length} of {rows.length} items</div>
            {shown.length === 0 ? <div className="empty-state">No items match</div> : (
              <div className="usage-scroll">
                <table className="usage-table">
                  <thead><tr><th className="abf-selcol"><input ref={allSel} type="checkbox" aria-label="Select all filtered not-done items" checked={headState === 'all'} disabled={busy} onChange={(e) => setSelected(selectAllFiltered(sel, shown, e.target.checked))} /></th><th>Agent/Skill</th><th>Phase</th><th>Status</th><th>Creators</th><th>Result</th><th>Last assessed</th></tr></thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.id}>
                        <td className="abf-selcol">{r.status === 'not_done' && <input type="checkbox" aria-label={`Select ${r.name}`} checked={sel.has(r.id)} disabled={busy} onChange={() => setSelected(toggleId(sel, r.id))} />}</td>
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
