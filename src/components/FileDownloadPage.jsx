import { useCallback, useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import { fetchEndpointFile, triggerDownload, formatBytes } from '../lib/endpointFiles';
import { recordAgentEvent } from '../lib/agentEvents';

/**
 * `/f/{agentId}` — the SSO gate for library-hosted files.
 *
 * This page IS the security mechanism, not a convenience wrapper around one.
 * Firebase Hosting rewrites `**` to index.html, so this URL loads the SPA
 * rather than an object, and the bytes only ever arrive through the
 * `getEndpointFile` callable, which rejects anyone without a valid org token.
 *
 * The practical consequence, and the reason it is built this way: the link
 * survives being pasted into a chat. Whoever opens it lands here and is asked
 * to sign in. A Cloud Storage download token, by contrast, is a bearer
 * credential — forwarding the URL forwards the access, which is exactly the
 * hole the old static `/skills/*.zip` URLs had.
 *
 * So unlike TimelinePage — which assumes you arrived from inside the app and
 * just says "go sign in" — this page offers a real sign-in button. Arriving
 * here cold from someone else's message is the expected path, not an edge case.
 */
export default function FileDownloadPage() {
  const { user, loading, signIn, domainError } = useAuth();
  const [agent, setAgent] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | working | done | error
  const [error, setError] = useState('');

  const agentId = decodeURIComponent(
    window.location.pathname.replace(/\/+$/, '').split('/f/')[1] || '',
  );

  // Agent name/file metadata for the card. Read directly rather than through
  // useApprovedAgents: this page needs exactly one doc, and pulling the whole
  // library to render a single filename would be absurd.
  useEffect(() => {
    if (!user || !agentId) return;
    getDoc(doc(db, 'agents', agentId))
      .then((s) => setAgent(s.exists() ? { id: s.id, ...s.data() } : null))
      .catch(() => setAgent(null));
  }, [user, agentId]);

  const download = useCallback(async () => {
    setStatus('working');
    setError('');
    try {
      triggerDownload(await fetchEndpointFile(agentId));
      setStatus('done');
    } catch (e) {
      setError(e?.message || 'ดาวน์โหลดไม่สำเร็จ');
      setStatus('error');
    }
  }, [agentId]);

  // Auto-start once signed in. The user already expressed intent by opening a
  // download link; making them click a second button to confirm the thing they
  // just clicked would be pure ceremony.
  useEffect(() => {
    if (user && agentId && status === 'idle') {
      // Count the adoption (2026-08-26). Until now this page recorded nothing,
      // so anyone who opened a shared /f/ link from Teams was invisible to the
      // usage report even though they demonstrably used the thing. The weekly
      // dedup in recordAgentEvent makes this idempotent against the in-library
      // click that produced the link, so no double counting.
      recordAgentEvent(agentId, 'endpoint');
      download();
    }
  }, [user, agentId, status, download]);

  const wrap = (children) => (
    <div className="fdl-wrap">
      <div className="fdl-card">
        <img src="/wolfy-logo.png" alt="" className="fdl-logo" />
        {children}
        <a className="fdl-back" href="/">← กลับไปที่ AI Agent Library</a>
      </div>
    </div>
  );

  if (!agentId) return wrap(<><h2>ลิงก์ไม่ถูกต้อง</h2><p className="fdl-mu">URL นี้ไม่ได้ระบุว่าเป็นไฟล์ของ Agent ตัวไหน</p></>);
  if (loading) return wrap(<><div className="spin" /><p className="fdl-mu">กำลังตรวจสอบสิทธิ์…</p></>);

  if (!user) {
    return wrap(
      <>
        <h2>ต้องเข้าสู่ระบบก่อนดาวน์โหลด</h2>
        <p className="fdl-mu">
          ไฟล์ในไลบรารีนี้เปิดให้เฉพาะบัญชีขององค์กร กรุณาลงชื่อเข้าใช้เพื่อดาวน์โหลด
        </p>
        {domainError && <div className="msg error" style={{ marginBottom: 12 }}><span className="dot" style={{ background: '#ea4335' }} />{domainError}</div>}
        <button className="btn btn-primary" onClick={() => signIn().catch((e) => setError(e?.message || 'เข้าสู่ระบบไม่สำเร็จ'))}>
          ลงชื่อเข้าใช้ด้วย Google
        </button>
        {error && <p className="fdl-err">{error}</p>}
      </>,
    );
  }

  const file = agent?.endpointFile;

  return wrap(
    <>
      <h2>{agent?.agentName || 'ดาวน์โหลดไฟล์'}</h2>
      {file ? (
        <p className="fdl-mu">
          <strong style={{ color: 'var(--tx)' }}>{file.name}</strong>
          {file.size ? ` · ${formatBytes(file.size)}` : ''}
        </p>
      ) : (
        <p className="fdl-mu">ยังไม่มีไฟล์แนบสำหรับรายการนี้</p>
      )}

      {status === 'working' && <><div className="spin" /><p className="fdl-mu">กำลังดาวน์โหลด…</p></>}
      {status === 'done' && <p className="fdl-ok">✓ ดาวน์โหลดเรียบร้อย — ตรวจดูในโฟลเดอร์ Downloads</p>}
      {status === 'error' && <p className="fdl-err">{error}</p>}

      {status !== 'working' && file && (
        <button className="btn btn-primary" onClick={download}>
          {status === 'done' ? 'ดาวน์โหลดอีกครั้ง' : 'ดาวน์โหลด'}
        </button>
      )}
    </>,
  );
}
