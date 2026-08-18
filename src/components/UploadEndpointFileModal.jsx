import { useMemo, useRef, useState } from 'react';
import useEscapeKey from '../hooks/useEscapeKey';
import {
  ACCEPT_ATTR, ALLOWED_EXT, MAX_UPLOAD_BYTES,
  attachEndpointFile, formatBytes, validateUploadFile,
} from '../lib/endpointFiles';

/**
 * Attach a file to an agent's `endpoint` (2026-08-18).
 *
 * ── Why the agent list is so short ──
 * Eligibility is `deploymentStatus === 'approved'`: 26 agents out of 239.
 * That is the point, not an oversight — an endpoint is where you go to USE a
 * finished thing, so attaching a package to something still at 40% would be
 * publishing an unfinished artefact. The original ask also included
 * "devProgress = 100" and "has a deployment request", but both were dropped
 * after checking live data: all 26 deploy-approved agents are already at 100,
 * and approval implies the request. Extra clauses that filter nothing are just
 * extra places to drift.
 *
 * ── Why the area filter is client-side AND server-side ──
 * This list is UX: it stops an approver hunting through agents they cannot
 * touch. `attachEndpointFile` repeats every check, because a callable is
 * reachable by anyone who knows its name — hiding a button is presentation,
 * never enforcement.
 */
export default function UploadEndpointFileModal({
  onClose, agents = [], role, isAdmin, approveAreas = [],
}) {
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);
  useEscapeKey(onClose);

  const eligible = useMemo(() => {
    const mine = new Set(approveAreas || []);
    return agents
      .filter((a) => a.approvalStatus === 'approved' && a.archived !== true)
      .filter((a) => a.deploymentStatus === 'approved')
      // Non-admins are scoped to their own Approve Areas. The check uses the
      // agent's STORED approveArea, matching what the server enforces — all 26
      // eligible agents carry one, and an agent without a stored area is
      // admin-only rather than silently open to everyone.
      .filter((a) => isAdmin || (Array.isArray(a.approveArea) && a.approveArea.some((x) => mine.has(x))))
      .sort((a, b) => {
        // Most-recently deploy-approved first. There is no dedicated
        // "deployApprovedAt" field on the agent doc — decideDeploy() in
        // PendingApprovalModal only bumps `updatedAt` on the same write that
        // sets deploymentStatus to 'approved' — so updatedAt is the closest
        // proxy available without a schema change. Ties (same second) fall
        // back to createdAt, then agent name, so the order never bounces
        // around when both timestamps are identical.
        const ts = (v) => v?.seconds || 0;
        return ts(b.updatedAt) - ts(a.updatedAt)
          || ts(b.createdAt) - ts(a.createdAt)
          || (a.agentName || '').localeCompare(b.agentName || '');
      });
  }, [agents, isAdmin, approveAreas]);

  // Client-side substring filter only — the eligible list is already small
  // (26 agents total today) and this is a picker, not a search feature, so
  // there is no need for the semantic/debounced machinery ControlBar uses.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return eligible;
    return eligible.filter((a) => (a.agentName || '').toLowerCase().includes(q));
  }, [eligible, query]);

  function pickFile(f) {
    setResult(null);
    const err = validateUploadFile(f);
    setError(err);
    setFile(err ? null : f);
  }

  async function handleUpload() {
    if (!selected || !file) return;
    setBusy(true);
    setError('');
    try {
      const r = await attachEndpointFile({ agentId: selected.id, file });
      setResult(r);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
    } catch (e) {
      setError(e?.message || 'อัปโหลดไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  const existing = String(selected?.endpoint || '').trim();

  return (
    <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && onClose()}>
      <div className="mbox" style={{ maxWidth: 520 }}>
        <button className="mclose" onClick={onClose}>✕</button>
        <h2 className="mtitle" style={{ marginBottom: 4 }}>Attach Endpoint File</h2>
        <p style={{ fontSize: 11.5, color: 'var(--mu)', lineHeight: 1.6, marginBottom: 14 }}>
          แนบไฟล์ให้ Agent/Skill ที่ผ่านการอนุมัติ Deployment แล้ว
        </p>

        {eligible.length === 0 ? (
          <div className="msg info" style={{ fontSize: 11.5 }}>
            <span className="dot" style={{ background: '#4a6fa5' }} />
            {isAdmin
              ? 'ยังไม่มี Agent/Skill ที่ deployment ผ่านการอนุมัติ'
              : `ไม่มีรายการใน Approve Area ของคุณ (${(approveAreas || []).join(', ') || 'ยังไม่ได้กำหนด area'})`}
          </div>
        ) : (
          <>
            <div className="fg" style={{ marginBottom: 12 }}>
              <label>1. เลือก Agent / Skill <span className="hint">{eligible.length} items</span></label>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ค้นหาชื่อ Agent / Skill…"
                style={{ marginBottom: 6 }}
              />
              <div className="uef-pick">
                {visible.length === 0 ? (
                  <div style={{ padding: '10px 12px', fontSize: 11.5, color: 'var(--mu2)' }}>ไม่พบรายการที่ตรงกับ "{query}"</div>
                ) : visible.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={`uef-row${selected?.id === a.id ? ' sel' : ''}`}
                    onClick={() => { setSelected(a); setResult(null); setError(''); }}
                  >
                    <span className="uef-name">{a.agentName}</span>
                    {String(a.endpoint || '').trim() && <span className="uef-has">มีไฟล์/ลิงก์แล้ว</span>}
                    <span className="uef-area">{(a.approveArea || []).join(', ')}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="fg" style={{ marginBottom: 12 }}>
              <label>
                2. เลือกไฟล์{' '}
                <span className="hint">{ALLOWED_EXT.map((e) => `.${e}`).join(' ')} · ไม่เกิน {formatBytes(MAX_UPLOAD_BYTES)}</span>
              </label>
              <div
                className={`uef-drop${file ? ' has' : ''}`}
                onClick={() => inputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
              >
                {file ? `${file.name} · ${formatBytes(file.size)}` : 'คลิกเพื่อเลือกไฟล์'}
              </div>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT_ATTR}
                style={{ display: 'none' }}
                onChange={(e) => pickFile(e.target.files?.[0] || null)}
              />
            </div>

            {/* An endpoint is a single field, so uploading REPLACES whatever is
                there. 38 agents currently point at the internal GitLab — losing
                one of those silently would be a genuine data loss, so the old
                value is shown in full before the button is pressed. */}
            {selected && existing && (
              <div className="msg warn" style={{ fontSize: 11.5, marginBottom: 12, alignItems: 'flex-start' }}>
                <span className="dot" style={{ background: 'var(--msg-warn-fg)', marginTop: 5, flexShrink: 0 }} />
                <span>
                  <strong>{selected.agentName}</strong> มี endpoint อยู่แล้ว การอัปโหลดจะ<strong>แทนที่</strong>ค่าเดิม
                  <span style={{ display: 'block', marginTop: 3, wordBreak: 'break-all', color: 'var(--mu)', fontSize: 10.5 }}>{existing}</span>
                </span>
              </div>
            )}

            {error && (
              <div className="msg error" style={{ fontSize: 11.5, marginBottom: 12 }}>
                <span className="dot" style={{ background: '#ea4335' }} />{error}
              </div>
            )}
            {result?.ok && (
              <div className="msg success" style={{ fontSize: 11.5, marginBottom: 12, alignItems: 'flex-start' }}>
                <span className="dot" style={{ background: 'var(--msg-success-fg)', marginTop: 5, flexShrink: 0 }} />
                <span>
                  แนบ <strong>{result.name}</strong> ({formatBytes(result.size)}) เรียบร้อย
                  <span style={{ display: 'block', marginTop: 3, wordBreak: 'break-all', color: 'var(--mu)', fontSize: 10.5 }}>{result.endpoint}</span>
                  {result.replacedEndpoint && (
                    <span style={{ display: 'block', marginTop: 3, color: 'var(--mu)', fontSize: 10.5 }}>
                      แทนที่ค่าเดิม: {result.replacedEndpoint}
                    </span>
                  )}
                </span>
              </div>
            )}

            <div className="btn-group">
              <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Close</button>
              <button className="btn btn-primary" onClick={handleUpload} disabled={busy || !selected || !file}>
                {busy ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
