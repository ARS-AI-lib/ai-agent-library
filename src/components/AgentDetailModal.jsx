import { useState } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { getType, getTier, TIER_DEF, isInternalOrExternal } from '../lib/tier';
import { agentStatus, ST_DEF, progressBucket, developmentPhaseLabel } from '../lib/status';
import { fmtDate, skillsOfAgent, agentsOfSkill, canUpdateProgress, canEditDetails } from '../lib/agentUtils';

function fmtLaunchFull(d) {
  if (!d) return '';
  try {
    const dt = d?.toDate ? d.toDate() : new Date(d);
    if (isNaN(dt)) return String(d);
    return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return String(d);
  }
}

// Firestore Timestamp / Date / string → "YYYY-MM-DD" for <input type="date">.
function toDateInputValue(d) {
  if (!d) return '';
  try {
    const dt = d?.toDate ? d.toDate() : new Date(d);
    if (isNaN(dt)) return '';
    return dt.toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

const DEPLOY_STATUS_LABEL = { requested: 'รออนุมัติ Deploy', approved: 'อนุมัติ Deploy แล้ว', rejected: 'ถูกปฏิเสธ Deploy' };
const DEPLOY_STATUS_COLOR = { requested: '#c96a00', approved: '#137333', rejected: '#c5221f' };

export default function AgentDetailModal({ agent, allAgents, onClose, user, isAdmin, onEditAgent }) {
  const [editing, setEditing] = useState(false);
  const [editProgress, setEditProgress] = useState(0);
  const [editLaunch, setEditLaunch] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [confirmingDeploy, setConfirmingDeploy] = useState(false);

  if (!agent) return null;
  const type = getType(agent);
  const tier = getTier(agent);
  const tierDef = TIER_DEF[tier];
  const st = agentStatus(agent);
  const sd = ST_DEF[st];
  const progress = typeof agent.devProgress === 'number' ? agent.devProgress : 0;
  const deploymentStatus = agent.deploymentStatus || 'none';

  const related = type === 'skill' ? agentsOfSkill(agent) : skillsOfAgent(agent, allAgents);
  const launchLbl = fmtLaunchFull(agent.launchDate);
  const role = Array.isArray(agent.relatedRole) ? agent.relatedRole.join(', ') : agent.relatedRole;
  const ability = Array.isArray(agent.coreAbility) ? agent.coreAbility.join(', ') : agent.coreAbility;
  const process = Array.isArray(agent.sdlcProcessMapping) ? agent.sdlcProcessMapping.join(', ') : agent.sdlcProcessMapping;
  const scope = isInternalOrExternal(agent);

  const canEdit = progress < 100 && canUpdateProgress(agent, user, isAdmin);
  // Deploy Approval gate (2026-07-02, revised): no disabled/greyed button —
  // clicking "Deployment Request" always opens a confirm dialog ("tested and
  // ready?"); on Yes the system bumps devProgress to 95 AND files the request
  // in one write (see handleRequestDeploy). The button itself is only hidden
  // once a request is already in flight or already approved — nothing left
  // to request in that state.
  const mayEditThisAgent = canUpdateProgress(agent, user, isAdmin);
  const mayEditDetails = canEditDetails(agent, user, isAdmin);
  const canRequestDeploy = mayEditThisAgent && deploymentStatus !== 'requested' && deploymentStatus !== 'approved';

  function startEdit() {
    setEditProgress(progress);
    setEditLaunch(toDateInputValue(agent.launchDate));
    setSaveError('');
    setEditing(true);
  }

  async function handleSave() {
    const clamped = Math.max(0, Math.min(100, Math.round(Number(editProgress) || 0)));
    if (clamped > 95 && deploymentStatus !== 'approved') {
      setSaveError('ไม่สามารถตั้งค่าเกิน 95% ได้จนกว่าจะได้รับอนุมัติ Deployment Request (ปุ่มขออนุมัติอยู่ใต้แถบ Progress ด้านล่าง)');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      await updateDoc(doc(db, 'agents', agent.id), {
        devProgress: clamped,
        developmentPhase: developmentPhaseLabel(clamped),
        launchDate: editLaunch ? new Date(editLaunch) : null,
        updatedAt: serverTimestamp(),
      });
      setEditing(false);
    } catch (e) {
      setSaveError(e.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  // Confirm-then-request flow (revised 2026-07-02): clicking the button opens
  // a Y/N confirm dialog instead of a disabled/greyed state. On Yes, one write
  // both bumps devProgress to 95 and files the request — no separate
  // "save to 95 first" step. See the matching firestore.rules branch, which
  // requires request.resource.data.devProgress == 95 for this exact write.
  async function handleRequestDeploy() {
    setConfirmingDeploy(false);
    setRequesting(true);
    setSaveError('');
    try {
      await updateDoc(doc(db, 'agents', agent.id), {
        devProgress: 95,
        deploymentStatus: 'requested',
        deployRequestedBy: user?.uid || '',
        deployRequestedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      setSaveError(e.message || 'ขออนุมัติไม่สำเร็จ');
    } finally {
      setRequesting(false);
    }
  }

  return (
    <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && onClose()}>
      <div className="mbox">
        <button className="mclose" onClick={onClose}>✕</button>

        {launchLbl && (
          <div style={{ fontSize: 10.5, color: 'var(--mu)', marginBottom: 6 }}>Launch: {launchLbl}</div>
        )}

        <div className="mtitle" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {agent.agentName}
          {mayEditDetails && (
            <button
              className="btn-icon" style={{ width: 22, height: 22 }} title="Edit Details"
              onClick={() => onEditAgent?.(agent)}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 21v-7" /><path d="M4 10V3" /><path d="M12 21v-9" /><path d="M12 8V3" /><path d="M20 21v-5" /><path d="M20 12V3" />
                <path d="M1 14h6" /><path d="M9 8h6" /><path d="M17 16h6" />
              </svg>
            </button>
          )}
        </div>
        <div className="msub">1 agent/skill</div>

        <div className="msec">Details</div>
        <div className="mac">
          <div className="machdr">
            <span className={`tb ${type === 'agent' ? 'tbag' : 'tbsk'}`}>{type === 'agent' ? 'AGENT' : 'SKILL'}</span>
            <span className="tier-badge" style={{ color: tierDef.color, background: tierDef.bg, borderColor: tierDef.bd }}>
              {tier}
            </span>
            <span className="macname">{agent.agentName}</span>
            <span className="scope-badge" style={{ position: 'static', marginLeft: 'auto', color: scope === 'External' ? '#0ea5e9' : 'var(--ag)' }} title={scope === 'External' ? 'Customer Facing' : 'Internal Use'}>
              {scope === 'External' ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="2" width="16" height="20" rx="1" />
                  <line x1="9" y1="10" x2="9" y2="10" /><line x1="15" y1="10" x2="15" y2="10" />
                  <line x1="9" y1="14" x2="9" y2="14" /><line x1="15" y1="14" x2="15" y2="14" />
                  <path d="M9 22v-4h6v4" />
                </svg>
              )}
            </span>
          </div>

          {agent.description && (
            <div className="mrow" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 3 }}>
              <span className="mk">Description</span>
              <span style={{ color: 'var(--tx2)', fontSize: 11, lineHeight: 1.45 }}>{agent.description}</span>
            </div>
          )}
          {agent.useCase && (
            <div className="mrow"><span className="mk">Use case</span><span style={{ color: 'var(--tx2)', fontSize: 11 }}>{agent.useCase}</span></div>
          )}
          <div className="mrow"><span className="mk">Owner</span><span>{agent.owner || '—'}</span></div>
          <div className="mrow"><span className="mk">Creator</span><span>{agent.creator || '—'}</span></div>
          <div className="mrow"><span className="mk">Ability</span><span>{ability || '—'}</span></div>
          {related.length > 0 && (
            <div className="mrow">
              <span className="mk">{type === 'skill' ? 'Agent' : 'Skill'}</span>
              <span style={{ color: type === 'skill' ? 'var(--ag)' : 'var(--sk)', fontSize: 11, fontWeight: 600 }}>{related.join(', ')}</span>
            </div>
          )}
          <div className="mrow"><span className="mk">Role</span><span>{role || '—'}</span></div>
          <div className="mrow"><span className="mk">Process</span><span style={{ color: 'var(--mu)', fontSize: 11 }}>{process || '—'}</span></div>
          <div className="mrow"><span className="mk">Phase</span>
            <span className="ph" style={{ background: sd.bg, color: sd.color, border: `1px solid ${sd.bd}` }}>{sd.lb}</span>
          </div>

          {!editing && (
            <div className="mrow"><span className="mk">Launch</span><span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5 }}>{fmtDate(agent.launchDate) || '—'}</span></div>
          )}

          {editing ? (
            <div style={{ marginTop: 8, padding: 10, background: 'var(--sf)', border: '1px solid var(--bd-soft)', borderRadius: 'var(--r-sm)' }}>
              {saveError && <div className="msg error" style={{ marginBottom: 8 }}><span className="dot" style={{ background: '#ea4335' }} />{saveError}</div>}
              <div className="fg" style={{ marginBottom: 8 }}>
                <label>Dev Progress (%) <span className="hint">0-100, สูงสุด 100</span></label>
                <input
                  type="number" min={0} max={100} value={editProgress}
                  onChange={(e) => setEditProgress(e.target.value)}
                />
              </div>
              <div className="fg" style={{ marginBottom: 0 }}>
                <label>Launch Date</label>
                <input type="date" value={editLaunch} onChange={(e) => setEditLaunch(e.target.value)} />
              </div>
              <div className="btn-group" style={{ marginTop: 10 }}>
                <button className="btn btn-secondary" disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
                <button className="btn btn-success" disabled={saving} onClick={handleSave}>
                  {saving ? 'กำลังบันทึก…' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <div className="mpbw">
              {saveError && <div className="msg error" style={{ marginBottom: 8 }}><span className="dot" style={{ background: '#ea4335' }} />{saveError}</div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10.5, color: 'var(--mu)' }}>
                <span>Progress</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <strong style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{progress}%</strong>
                  {canEdit && (
                    <button className="btn-icon" style={{ width: 20, height: 20 }} title="Update progress" onClick={startEdit}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                  )}
                </span>
              </div>
              <div className="mpb">
                <div className={`mpf ${progressBucket(progress)}`} style={{ width: `${progress}%` }} />
              </div>
              {mayEditThisAgent && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  {deploymentStatus !== 'none' && (
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: DEPLOY_STATUS_COLOR[deploymentStatus], background: `${DEPLOY_STATUS_COLOR[deploymentStatus]}15`, border: `1px solid ${DEPLOY_STATUS_COLOR[deploymentStatus]}40`, padding: '2px 7px', borderRadius: 4 }}>
                      {DEPLOY_STATUS_LABEL[deploymentStatus]}
                    </span>
                  )}
                  {canRequestDeploy && (
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 11, padding: '3px 9px' }}
                      disabled={requesting}
                      onClick={() => setConfirmingDeploy(true)}
                    >
                      {requesting ? 'กำลังส่งคำขอ…' : 'Deployment Request'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {confirmingDeploy && (
        <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && setConfirmingDeploy(false)}>
          <div className="mbox" style={{ padding: 18, maxWidth: 380 }}>
            <button className="mclose" onClick={() => setConfirmingDeploy(false)}>✕</button>
            <h3 style={{ fontSize: 15, marginBottom: 10 }}>ยืนยัน Deployment Request</h3>
            <p style={{ fontSize: 12.5, color: 'var(--tx2)', lineHeight: 1.6, marginBottom: 16 }}>
              Agent/Skill ของท่านผ่านการทดสอบ (กรุณาส่งหลักฐานให้กับ Approver พิจารณา)
              และพร้อมที่จะ Deployment แล้วใช่หรือไม่?
            </p>
            <div className="btn-group">
              <button className="btn btn-secondary" onClick={() => setConfirmingDeploy(false)}>No</button>
              <button className="btn btn-success" onClick={handleRequestDeploy}>Yes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
