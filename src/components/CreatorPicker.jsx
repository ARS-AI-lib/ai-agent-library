import { useEffect, useRef, useState } from 'react';
import { searchDirectory } from '../lib/directory';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "Creator / Team member" multi-select. Searches a Firestore-cached directory
 * (synced by an admin from the Google People API — src/lib/directory.js) as
 * the user types, and lets them pick multiple people — each becomes a
 * removable chip. Selected value is an array of { name, email }.
 *
 * Falls back to manual email entry (Enter to add) only if the Firestore
 * directory doc doesn't exist yet — i.e. before any admin has ever synced it.
 * Every user reads the same Firestore-backed cache via their normal Firebase
 * session, so this works after reloads with no Google OAuth token involved.
 */
export default function CreatorPicker({ selected, onChange, placeholder }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [searching, setSearching] = useState(false);
  const [manualError, setManualError] = useState('');
  const wrapRef = useRef(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  useEffect(() => {
    if (fallback) return;
    const q = query.trim();
    if (!q) { setResults([]); setSearching(false); return; }
    const myReq = ++reqIdRef.current;
    setSearching(true);
    const t = setTimeout(() => {
      searchDirectory(q)
        .then((people) => {
          if (reqIdRef.current !== myReq) return;
          setResults(people.filter((p) => !selected.some((s) => s.email === p.email)));
          setSearching(false);
        })
        .catch(() => {
          if (reqIdRef.current !== myReq) return;
          // No /config/directory doc yet (no admin has synced it) — drop to
          // manual entry rather than leaving the field dead.
          setFallback(true);
          setResults([]);
          setSearching(false);
        });
    }, 200);
    return () => clearTimeout(t);
  }, [query, fallback, selected]);

  function addPerson(p) {
    onChange([...selected, p]);
    setQuery('');
    setResults([]);
  }

  function removePerson(email) {
    onChange(selected.filter((s) => s.email !== email));
  }

  function addManual() {
    const email = query.trim();
    if (!email) return;
    if (!EMAIL_RE.test(email)) { setManualError('รูปแบบอีเมลไม่ถูกต้อง'); return; }
    if (selected.some((s) => s.email.toLowerCase() === email.toLowerCase())) {
      setManualError('อีเมลนี้ถูกเพิ่มแล้ว');
      return;
    }
    setManualError('');
    addPerson({ name: '', email });
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {selected.map((p) => (
            <span
              key={p.email}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'var(--sf2)', border: 'none', borderRadius: 20,
                padding: '3px 6px 3px 11px', fontSize: 11.5,
              }}
            >
              {p.name ? `${p.name} (${p.email})` : p.email}
              <button
                type="button"
                onClick={() => removePerson(p.email)}
                title="Remove" aria-label="Remove"
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--mu)', fontSize: 13, padding: '0 3px', fontFamily: 'inherit' }}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <div style={{ position: 'relative' }}>
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setManualError(''); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (fallback && e.key === 'Enter') { e.preventDefault(); addManual(); } }}
          placeholder={placeholder}
          style={{ width: '100%', boxSizing: 'border-box', paddingRight: searching ? 30 : undefined }}
        />
        {searching && (
          <div style={{ position: 'absolute', right: 10, top: 0, bottom: 0, display: 'flex', alignItems: 'center' }}>
            <span className="spin" style={{ width: 14, height: 14, borderWidth: 2 }} />
          </div>
        )}
      </div>

      {fallback && (
        <div style={{ fontSize: 10.5, color: 'var(--mu)', marginTop: 3 }}>
          ค้นหารายชื่อจาก directory ไม่พร้อมใช้งาน (ยังไม่เคย sync) — พิมพ์อีเมลแล้วกด Enter เพื่อเพิ่ม
        </div>
      )}
      {manualError && (
        <div style={{ fontSize: 10.5, color: 'var(--late)', marginTop: 3 }}>{manualError}</div>
      )}

      {!fallback && open && results.length > 0 && (
        <div
          style={{
            position: 'absolute', zIndex: 5, top: '100%', left: 0, right: 0, marginTop: 3,
            background: 'var(--sf)', border: '1px solid var(--bd-soft)', borderRadius: 'var(--r-md)',
            boxShadow: 'var(--shm)', maxHeight: 220, overflowY: 'auto',
          }}
        >
          {results.map((p) => (
            <div
              key={p.email}
              onClick={() => addPerson(p)}
              style={{ padding: '7px 11px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid var(--bd)' }}
              onMouseDown={(e) => e.preventDefault()}
            >
              <div style={{ fontWeight: 600 }}>{p.name || p.email}</div>
              {p.name && <div style={{ fontSize: 10.5, color: 'var(--mu)' }}>{p.email}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
