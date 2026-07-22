import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { getDirectoryMeta, syncDirectoryToFirestore } from '../lib/directory';
import MultiSelect from './MultiSelect';
import useEscapeKey from '../hooks/useEscapeKey';

function fmtSyncTime(ts) {
  if (!ts) return '';
  try {
    const dt = ts?.toDate ? ts.toDate() : new Date(ts);
    if (isNaN(dt)) return '';
    return dt.toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

const ROLES = ['user', 'staff', 'approver', 'committee', 'admin'];

// Admin-only console for granting roles + approve areas. Security rules only
// permit an admin to update /users docs, so this UI is gated on isAdmin too.
export default function UserManagementModal({ onClose, schema, currentUid }) {
  const [users, setUsers] = useState([]);
  const [drafts, setDrafts] = useState({});   // uid → { role, approveAreas:Set }
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [dirMeta, setDirMeta] = useState(null);      // { count, updatedAt } | null
  const [dirSyncing, setDirSyncing] = useState(false);
  useEscapeKey(onClose);
  const [dirError, setDirError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    getDirectoryMeta().then(setDirMeta).catch(() => {});
  }, []);

  async function handleSyncDirectory() {
    setDirSyncing(true);
    setDirError('');
    try {
      await syncDirectoryToFirestore();
      const meta = await getDirectoryMeta();
      setDirMeta(meta);
    } catch (e) {
      // The sync now asks Google for the directory scope via a popup at click
      // time; the common failure is the admin closing/denying that popup.
      const code = e?.code || '';
      setDirError(
        code.includes('popup') || code.includes('cancelled')
          ? 'ยกเลิก/ปิดหน้าต่างให้สิทธิ์ Google — ลอง Sync ใหม่แล้วกด Allow เพื่อเข้าถึง directory'
          : (e.message || 'Sync ไม่สำเร็จ')
      );
    } finally {
      setDirSyncing(false);
    }
  }

  const areaOptions = useMemo(
    () => [...(schema.sdlcStage?.length ? schema.sdlcStage : []), 'Business'],
    [schema.sdlcStage]
  );

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), (snap) => {
      setUsers(snap.docs.map((d) => ({ uid: d.id, ...d.data() })));
    }, (e) => setError(e.message));
    return unsub;
  }, []);

  function draftFor(u) {
    return drafts[u.uid] || { role: u.role || 'user', approveAreas: new Set(u.approveAreas || []) };
  }
  function setDraft(uid, patch) {
    setDrafts((prev) => {
      const u = users.find((x) => x.uid === uid);
      const base = prev[uid] || { role: u?.role || 'user', approveAreas: new Set(u?.approveAreas || []) };
      return { ...prev, [uid]: { ...base, ...patch } };
    });
  }

  async function save(u) {
    const d = draftFor(u);
    setBusyId(u.uid);
    setError('');
    try {
      await updateDoc(doc(db, 'users', u.uid), {
        role: d.role,
        approveAreas: [...d.approveAreas],
        updatedAt: serverTimestamp(),
      });
      setDrafts((prev) => { const n = { ...prev }; delete n[u.uid]; return n; });
    } catch (e) {
      setError(e.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setBusyId(null);
    }
  }

  const sorted = [...users].sort((a, b) => (a.email || '').localeCompare(b.email || ''));
  const q = search.trim().toLowerCase();
  const visible = q
    ? sorted.filter((u) => `${u.displayName || ''} ${u.email || ''}`.toLowerCase().includes(q))
    : sorted;

  return (
    <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && onClose()}>
      <div className="mbox wide">
        <button className="mclose" onClick={onClose}>✕</button>
        <div className="mtitle">User Management</div>
        <div className="msub">{users.length} ผู้ใช้ · กำหนด role และ approve area</div>

        {error && <div className="msg error"><span className="dot" style={{ background: '#ea4335' }} />{error}</div>}

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อหรืออีเมล…"
          style={{ width: '100%', height: 32, padding: '0 10px', border: '1.5px solid var(--bd2)', borderRadius: 8, fontSize: 12.5, background: 'var(--sf)', color: 'var(--tx)', fontFamily: 'inherit', outline: 'none', margin: '2px 2px 8px' }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '9px 2px', borderBottom: '1px solid var(--bd)', marginBottom: 4 }}>
          <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: 12 }} disabled={dirSyncing} onClick={handleSyncDirectory}>
            {dirSyncing ? 'กำลัง sync…' : 'Sync directory now'}
          </button>
          <span style={{ fontSize: 11, color: 'var(--mu)' }}>
            {dirMeta
              ? `Directory picker: ${dirMeta.count} รายชื่อ · sync ล่าสุด ${fmtSyncTime(dirMeta.updatedAt) || '—'}`
              : 'Directory picker: ยังไม่เคย sync'}
          </span>
        </div>
        {dirError && <div className="msg error"><span className="dot" style={{ background: '#ea4335' }} />{dirError}</div>}

        {q && visible.length === 0 && <div className="empty-state" style={{ padding: '20px 0' }}>ไม่พบผู้ใช้ที่ตรงกับ "{search}"</div>}

        {visible.map((u) => {
          const d = draftFor(u);
          const dirty = !!drafts[u.uid];
          const isSelf = u.uid === currentUid;
          return (
            <div key={u.uid} style={UM_ROW}>
              <div style={{ minWidth: 0 }}>
                <div className="dup-name" style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {u.displayName || u.email || u.uid}{isSelf && <span style={{ color: 'var(--mu)', fontWeight: 400 }}> (คุณ)</span>}
                </div>
                <div className="queue-meta" style={{ fontSize: 11 }}>{u.email || '—'}</div>
              </div>
              <div>
                <div style={UM_LABEL}>Role</div>
                <select value={d.role} onChange={(e) => setDraft(u.uid, { role: e.target.value })} style={UM_CTRL}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={UM_LABEL}>Approve areas</div>
                <MultiSelect
                  label="เลือก area…"
                  options={areaOptions}
                  selected={d.approveAreas}
                  onChange={(s) => setDraft(u.uid, { approveAreas: s })}
                />
              </div>
              <button style={UM_SAVE(dirty && busyId !== u.uid)} disabled={!dirty || busyId === u.uid} onClick={() => save(u)}>
                {busyId === u.uid ? 'บันทึก…' : 'Save'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Compact, aligned row styling — deliberately NOT using .fg/.btn (those are
// full-form-sized). Every control is the same 26px height so Role, Approve
// areas and Save line up on one baseline.
const UM_ROW = { display: 'grid', gridTemplateColumns: '1fr 110px 150px 62px', gap: 10, alignItems: 'end', padding: '9px 2px', borderBottom: '1px solid var(--bd)' };
const UM_LABEL = { fontSize: 10, fontWeight: 700, color: 'var(--mu)', marginBottom: 3, letterSpacing: '.03em' };
const UM_CTRL = { width: '100%', height: 26, padding: '0 8px', border: '1.5px solid var(--bd2)', borderRadius: 8, fontSize: 12, background: 'var(--sf)', color: 'var(--tx)', fontFamily: 'inherit', outline: 'none' };
const UM_SAVE = (active) => ({ height: 26, padding: '0 12px', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, background: active ? 'var(--ok)' : 'var(--bd2)', color: '#fff', cursor: active ? 'pointer' : 'not-allowed', fontFamily: 'inherit' });
