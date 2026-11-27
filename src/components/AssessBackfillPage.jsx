import { useEffect, useMemo, useRef, useState } from 'react';
import PageHeader from './PageHeader';
import DeclField from './DeclField';
import { ScreeningQuestions } from './ScreeningQuestions';
import { useAuth } from '../hooks/useAuth';
import { useScreeningConfig } from '../hooks/useScreeningConfig';
import { getFunctions, httpsCallable } from '../lib/callable';
import { DECL_FIELDS } from '../lib/declaration';
import { goToField } from '../lib/formFocus';
import { nextItem, isAssessable, declErrorFields } from '../lib/assessmentBackfill';
import { optionOf } from '../lib/screening';
import { failMsg } from '../lib/copy';
import '../styles/UsageReport.css';
import '../styles/Screening.css';
import '../styles/AssessBackfill.css';

/**
 * Creator assessment page (/assess, 2026-11-27). Lists the caller's items that still need the
 * screening assessment; one form per item (missing declaration fields + all C questions), then
 * "Submit and next". ?agent=<id> preselects, ?review=1 = re-assessment of failed items.
 */
const call = (name, payload) => httpsCallable(getFunctions(undefined, 'asia-southeast1'), name)(payload).then((r) => r.data);
const FIELDS = [...DECL_FIELDS.map((f) => [f.key, f.label]), ['description', 'Description']];
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' }) : '—');
const fmtDue = (d) => { const [y, m, dd] = String(d).split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };

export default function AssessBackfillPage() {
  const { user, loading, roleReady, signIn, domainError } = useAuth();
  const busyRef = useRef(false);
  const config = useScreeningConfig();
  const qs = useMemo(() => new URLSearchParams(window.location.search), []);
  const review = qs.get('review') === '1';
  const mode = review ? 'review' : 'backfill';
  const [data, setData] = useState(null);       // { items, dueDate }
  const [curId, setCurId] = useState(qs.get('agent'));
  const [answers, setAnswers] = useState({});
  const [decl, setDecl] = useState({});
  const [error, setError] = useState('');
  const [declErr, setDeclErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);   // { id, status } after a submit
  const [started, setStarted] = useState(false);

  const load = async () => {
    try { const d = await call('backfillMyItems', {}); setData(d); return d; }
    catch (e) { setError(failMsg('โหลดรายการ', e)); return null; }
  };
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    call('backfillMyItems', {}).then((d) => { if (!cancelled) setData(d); }).catch((e) => { if (!cancelled) setError(failMsg('โหลดรายการ', e)); });
    return () => { cancelled = true; };
  }, [user]);

  const items = data?.items || [];
  const wanted = qs.get('agent');
  const notMine = !!(data && wanted && !items.some((x) => x.id === wanted));
  // Default selection: the first assessable item (once, when no valid ?agent was given).
  useEffect(() => {
    if (!data || started) return;
    setStarted(true);
    if (wanted && items.some((x) => x.id === wanted)) return;
    if (wanted) return;
    const first = items.find((x) => isAssessable(x, mode));
    setCurId(first ? first.id : null);
  }, [data]);   // eslint-disable-line react-hooks/exhaustive-deps

  const cur = items.find((x) => x.id === curId) || null;
  const sync = (id) => { try { const u = new URL(window.location.href); if (id) u.searchParams.set('agent', id); else u.searchParams.delete('agent'); window.history.replaceState(null, '', u); } catch { /* ignore */ } };
  const select = (id) => { sync(id); setCurId(id); setAnswers({}); setDecl({}); setError(''); setDeclErr(''); setResult(null); };
  const doneCount = items.filter((x) => x.status !== 'not_done').length;

  async function submit() {
    if (busyRef.current) return;
    setError(''); setDeclErr('');
    const missing = (cur.missingDecl || []).find((k) => !String(decl[k] ?? '').trim());
    if (missing) {
      const label = FIELDS.find(([k]) => k === missing)?.[1] || missing;
      const none = DECL_FIELDS.find((f) => f.key === missing)?.none;
      const msg = none ? `ใส่ ${label} (หรือติ๊ก "${none}")` : `ใส่ ${label}`;
      setDeclErr(missing); setError(msg); goToField('.abf-wrap', msg, declErrorFields(FIELDS.map(([, l]) => l))); return;
    }
    const unanswered = config.questions.find((q) => !optionOf(config, q.id, answers[q.id]));
    if (unanswered) {
      setError(`ตอบคำถามให้ครบ — ยังไม่ได้ตอบ ${unanswered.code}`);
      setTimeout(() => { const el = document.querySelector(`.abf-wrap [data-q="${unanswered.id}"]`); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); el?.querySelector('input[type=radio]')?.focus({ preventScroll: true }); }, 0);
      return;
    }
    busyRef.current = true; setBusy(true);
    try {
      const r = await call('backfillSubmit', { agentId: cur.id, answers, decl, mode });
      setResult({ id: cur.id, status: r.status, level: r.level });
      const d = await load();
      if (!d) setError('ส่งผลประเมินแล้ว แต่โหลดรายการใหม่ไม่สำเร็จ — โปรดรีเฟรชหน้า');
    } catch (e) {
      if (/already-exists/.test(e?.code || '') || /ประเมินแล้ว/.test(e?.message || '')) { await load(); setError(''); }
      else setError(failMsg('ส่งผลประเมิน', e));
    } finally { busyRef.current = false; setBusy(false); }
  }
  function goNext() {
    const id = nextItem(items, result.id, mode);
    sync(id); setResult(null); setAnswers({}); setDecl({}); setCurId(id);
  }

  if (loading) return <div className="tl-center"><div className="spin" /><span>กำลังโหลด…</span></div>;
  if (!user) {
    return (
      <div className="tl-center">
        <h2>Sign in to assess</h2>
        <p style={{ color: 'var(--mu)', fontSize: 13 }}>หน้านี้ใช้ได้เฉพาะบัญชีขององค์กร</p>
        {domainError && <div className="msg error" style={{ marginBottom: 12 }}><span className="dot" style={{ background: '#ea4335' }} />{domainError}</div>}
        <button className="btn btn-primary" onClick={() => signIn().catch((e) => setError(failMsg('เข้าสู่ระบบ', e)))}>ลงชื่อเข้าใช้ด้วย Google</button>
        {error && <p style={{ color: 'var(--late)' }}>{error}</p>}
      </div>
    );
  }
  if (!roleReady) return <div className="tl-center"><div className="spin" /><span>กำลังตรวจสอบสิทธิ์…</span></div>;

  const allDone = data && !items.some((x) => isAssessable(x, mode));
  const doneCard = cur && !isAssessable(cur, mode) && (review && cur.status === 'not_done' ? (
    <div className="abf-note">รายการนี้ยังไม่ได้ประเมิน — ขอประเมินใหม่ได้เฉพาะรายการที่ไม่ผ่าน</div>
  ) : (
    <div className="abf-note">
      ประเมินแล้วโดย {cur.doneBy || '—'} เมื่อ {fmtDate(cur.doneAt)}
      <div className="abf-meta">ผลประเมิน: {cur.status === 'pass' ? 'ผ่าน' : cur.status === 'fail' ? 'ไม่ผ่าน' : cur.status === 'pending_review' ? 'รอ Approver ยืนยัน' : cur.status}</div>
    </div>
  ));

  return (
    <>
      <PageHeader user={user} />
      <div className="abf-wrap">
        {error && !cur && <div className="msg error"><span className="dot" style={{ background: '#ea4335' }} />{error}</div>}
        {!data && !error && <div className="tl-center"><div className="spin" /></div>}
        {data && (
          <>
            {review && <div className="abf-note">ขอประเมินใหม่ — ผลจะรอการยืนยันจาก Approver</div>}
            <div className="abf-chips">
              {items.map((x) => (
                <button key={x.id} type="button" className={`abf-chip${x.id === curId ? ' cur' : ''}${x.status !== 'not_done' ? ' done' : ''}`} onClick={() => select(x.id)}>
                  {x.status !== 'not_done' ? '✓ ' : ''}{x.name}
                </button>
              ))}
              <span className="abf-cap">{doneCount} of {items.length} done</span>
            </div>
            {notMine && <div className="abf-note bad">ไม่พบรายการนี้ในความรับผิดชอบของคุณ</div>}
            {items.length === 0 && <div className="empty-state">ไม่มีรายการที่ต้องประเมิน</div>}
            {allDone && !result && <div className="abf-note ok">ประเมินครบทุกรายการแล้ว</div>}

            {cur && (
              <>
                <div className="abf-title">
                  <h2>{cur.name}</h2>
                  <span className="abf-meta">{cur.tier} · {cur.phase}</span>
                  {data.dueDate && <span className="abf-due">Due {fmtDue(data.dueDate)}</span>}
                </div>
                {doneCard}
                {result && (
                  <div className={`abf-note ${result.status === 'fail' ? 'bad' : 'ok'}`}>
                    {result.status === 'fail'
                      ? 'ผลประเมินไม่ผ่าน — ระบบแจ้งผู้เกี่ยวข้องแล้ว กรุณาแก้ไขและขอประเมินใหม่'
                      : 'ส่งผลประเมินเรียบร้อย — ผ่านเกณฑ์'}
                  </div>
                )}
                {!result && isAssessable(cur, mode) && (
                  <>
                    {error && <div className="msg error"><span className="dot" style={{ background: '#ea4335' }} />{error}</div>}
                    {(cur.missingDecl || []).length > 0 && (
                      <section className="fsec">
                        <div className="fsec-h">1. Declaration</div>
                        <div className="fgrid">
                          {cur.missingDecl.map((k) => {
                            if (k === 'description') return (
                              <div key={k} className="fg full">
                                <label>Description <span className="req">*</span></label>
                                <textarea rows={3} value={decl.description || ''} aria-invalid={declErr === k || undefined} onChange={(e) => setDecl((d) => ({ ...d, description: e.target.value }))} />
                              </div>
                            );
                            const f = DECL_FIELDS.find((x) => x.key === k);
                            return f ? <DeclField key={k} field={f} value={decl[k]} error={declErr === k} onChange={(v) => setDecl((d) => ({ ...d, [k]: v }))} /> : null;
                          })}
                        </div>
                      </section>
                    )}
                    <section className="fsec">
                      <div className="fsec-h">{(cur.missingDecl || []).length ? '2. ' : ''}Assessment · C1–C11</div>
                      <div>
                        <ScreeningQuestions config={config} questionIds={config.questions.map((q) => q.id)} answers={answers} onChange={(qid, oid) => setAnswers((a) => ({ ...a, [qid]: oid }))} blockKey="blocksDeploy" />
                      </div>
                    </section>
                    <div className="fsticky">
                      <div className="fmeta">{doneCount} of {items.length} done</div>
                      <div className="fbtns"><button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit and next →'}</button></div>
                    </div>
                  </>
                )}
                {result && (
                  <div className="fsticky">
                    <div className="fmeta">{doneCount} of {items.length} done</div>
                    <div className="fbtns"><button className="btn btn-primary" onClick={goNext}>{nextItem(items, result.id, mode) ? 'Next →' : 'Finish'}</button></div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
