import { useEffect, useMemo, useState } from 'react';
import { toast } from '../lib/toast';
import { notifyEvent } from '../lib/notify';
import { collection, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { getDirectoryMeta, syncDirectoryToFirestore } from '../lib/directory';
import MultiSelect from './MultiSelect';
import Dropdown from './Dropdown';
import useEscapeKey from '../hooks/useEscapeKey';
import { AREA_ORDER } from '../lib/approveAreas';
import { failMsg } from '../lib/copy';
import Hint from './Hint';

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

const ROLES = ['user', 'workshop', 'staff', 'approver', 'committee', 'admin'];

// This account can never be demoted from admin (firestore.rules enforces
// this as the real boundary — see the /users/{uid} update rule; this is
// just a UI reflection of it so the picker doesn't invite a write that will
// be rejected). Keep in sync with functions/protectedAdmins.js by hand —
// rules/client/functions are three separate bundles that can't share a
// literal JS import across all of them.
const PROTECTED_ADMIN_EMAIL = 'tinnapat.p@arise.tech';

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
  const [roleFilter, setRoleFilter] = useState('all');

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
          ? 'หน้าต่างให้สิทธิ์ Google ถูกปิด — โปรด Sync อีกครั้งและกด Allow เพื่อเข้าถึง directory'
          : (failMsg('ดึงรายชื่อจาก Directory', e))
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
        updatedBy: auth.currentUser?.uid || null, // read by the userRoleAudit trigger
      });
      // Being granted an Approve Area silently changes what lands in your
      // queue, so the person it happens TO is told. The email deliberately
      // does not name who made the change — this write has no audit field
      // for it and the user chose not to add one.
      notifyEvent('user.roleChanged', { targetUid: u.uid });
      setDrafts((prev) => { const n = { ...prev }; delete n[u.uid]; return n; });
      toast(`Saved · ${u.displayName || u.email || u.uid}`);
    } catch (e) {
      setError(failMsg('บันทึก', e));
    } finally {
      setBusyId(null);
    }
  }

  const sorted = [...users].sort((a, b) => (a.email || '').localeCompare(b.email || ''));
  const q = search.trim().toLowerCase();
  const roleCounts = sorted.reduce((o, u) => { const r = u.role || 'user'; o[r] = (o[r] || 0) + 1; return o; }, {});
  const visible = sorted.filter((u) =>
    (roleFilter === 'all' || (u.role || 'user') === roleFilter)
    && (!q || `${u.displayName || ''} ${u.email || ''}`.toLowerCase().includes(q)));

  // V7 board 6 · User Management (2026-10-02). Presentation only: the same
  // drafts / setDraft / save(u) / protected-admin rules as before.
  return (
    <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && onClose()}>
      <div className="mbox wide v7-um">
        <button className="mclose" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="mtitle">User Management</h2>
        <div className="msub">{users.length} users <Hint text="กำหนด role และ Approve area ของผู้ใช้แต่ละคน" /></div>

        {error && <div className="msg error">{error}</div>}

        <div className="v7-um-bar">
          <label className="v7-um-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or email…"
              aria-label="Search users"
            />
          </label>
          <select
            className="v7-um-role"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            aria-label="Filter by role"
          >
            <option value="all">All roles ({users.length})</option>
            {ROLES.map((r) => <option key={r} value={r}>{r} ({roleCounts[r] || 0})</option>)}
          </select>
          <button className="btn btn-secondary" disabled={dirSyncing} onClick={handleSyncDirectory}>
            {dirSyncing ? 'Syncing…' : 'Sync directory now'}
          </button>
        </div>
        <div className="v7-um-cap">
          {dirMeta
            ? `Directory picker: ${dirMeta.count} รายชื่อ · sync ล่าสุด ${fmtSyncTime(dirMeta.updatedAt) || '—'}`
            : 'Directory picker: ยังไม่เคย sync'}
        </div>
        {dirError && <div className="msg error">{dirError}</div>}

        {(q || roleFilter !== 'all') && visible.length === 0 && <div className="v7-inbox-empty">ไม่พบผู้ใช้ที่ตรงกับเงื่อนไขที่เลือก</div>}

        <div className="v7-um-list">
          {visible.map((u) => {
            const d = draftFor(u);
            const dirty = !!drafts[u.uid];
            const isSelf = u.uid === currentUid;
            const isProtected = (u.email || '').toLowerCase() === PROTECTED_ADMIN_EMAIL;
            return (
              <div key={u.uid} className={`v7-um-row ${dirty ? 'dirty' : ''}`}>
                <span className="v7-avatar">{(u.displayName || u.email || '?').trim().charAt(0).toUpperCase()}</span>
                <div className="v7-um-who">
                  <strong>{u.displayName || u.email || u.uid}{isSelf && <span> (คุณ)</span>}</strong>
                  <span>{u.email || '—'}</span>
                </div>
                <div className="v7-um-ctl">
                  <Dropdown
                    pill="Role"
                    options={ROLES.map((r) => [r, r])}
                    value={d.role}
                    onChange={(r) => setDraft(u.uid, { role: r })}
                    ariaLabel={`Role ของ ${u.displayName || u.email || u.uid}`}
                    disabled={isProtected}
                    activeWhen={(r) => r !== 'user'}
                  />
                  {isProtected && <span className="v7-um-lock">🔒 Always admin</span>}
                </div>
                <div className="v7-um-ctl">
                  <MultiSelect
                    pill="Areas"
                    emptyLabel="None"
                    selectAll
                    label="Approve areas"
                    options={areaOptions}
                    selected={d.approveAreas}
                    onChange={(sel) => setDraft(u.uid, { approveAreas: sel })}
                  />
                </div>
                <button
                  type="button"
                  className={dirty ? 'v7-btn-primary-sm' : 'v7-um-save-idle'}
                  disabled={!dirty || busyId === u.uid}
                  onClick={() => save(u)}
                >
                  {busyId === u.uid ? 'Saving…' : 'Save'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

