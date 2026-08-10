import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { getDirectoryMeta, syncDirectoryToFirestore } from '../lib/directory';
import MultiSelect from './MultiSelect';
import Dropdown from './Dropdown';
import useEscapeKey from '../hooks/useEscapeKey';
import { AREA_ORDER } from '../lib/approveAreas';

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

  // Approver scope is the 12 discipline areas (2026-08-10), not SDLC stages.
  // Falls back to the module's AREA_ORDER if /config/schema.approveArea hasn't
  // been seeded yet, so the picker is never empty mid-rollout — same taxonomy
  // either way, since the seed script reads AREA_ORDER too.
  const areaOptions = useMemo(
    () => (schema.approveArea?.length ? schema.approveArea : AREA_ORDER),
    [schema.approveArea]
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
        <div className="m-head">
          <div className="m-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <div>
            <h2 className="mtitle">User Management</h2>
            <p>{users.length} ผู้ใช้ · กำหนด role และ approve area</p>
          </div>
        </div>

        {error && <div className="msg error"><span className="dot" style={{ background: '#ea4335' }} />{error}</div>}

        <input
          type="text"
          className="um-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อหรืออีเมล…"
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '9px 2px', borderBottom: '1px solid var(--bd)', marginBottom: 4 }}>
          <button className="btn-sm rej" disabled={dirSyncing} onClick={handleSyncDirectory}>
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
              <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="um-avatar">{(u.displayName || u.email || '?').trim().charAt(0).toUpperCase()}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="dup-name" style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.displayName || u.email || u.uid}{isSelf && <span style={{ color: 'var(--mu)', fontWeight: 400 }}> (คุณ)</span>}
                  </div>
                  <div className="queue-meta" style={{ fontSize: 11 }}>{u.email || '—'}</div>
                </div>
              </div>
              <div>
                <div style={UM_LABEL}>Role</div>
                {/* Last native <select> in the app — swapped for the shared
                    listbox so the role picker matches the Approve-areas
                    MultiSelect sitting immediately beside it in the same row. */}
                <Dropdown
                  options={ROLES.map((r) => [r, r])}
                  value={d.role}
                  onChange={(r) => setDraft(u.uid, { role: r })}
                  ariaLabel={`Role ของ ${u.displayName || u.email || u.uid}`}
                />
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
              <button className={`btn-sm ${dirty && busyId !== u.uid ? 'appr' : 'rej'}`} disabled={!dirty || busyId === u.uid} onClick={() => save(u)}>
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
const UM_ROW = { display: 'grid', gridTemplateColumns: '1fr 110px 150px 62px', gap: 10, alignItems: 'end', padding: '9px 2px', borderBottom: '1px solid var(--bd-soft)' };
const UM_LABEL = { fontSize: 10, fontWeight: 700, color: 'var(--mu)', marginBottom: 3, letterSpacing: '.03em' };
