import { useEffect, useMemo, useRef, useState } from 'react';
import { getType } from '../lib/tier';

/**
 * Skill name field that either LINKS an existing library skill or NAMES a new
 * one (2026-08-20).
 *
 * Same interaction as the Owner/Team field (ComboInput: type to filter, or
 * "+ Add" what you typed), but it reports WHICH branch the user took —
 * `{ mode: 'existing', id }` vs `{ mode: 'new', name }` — because the two
 * diverge completely afterwards: an existing skill is pulled read-only from
 * the DB and linked by doc ID, while a new one is a full 8-field form that
 * becomes its own pending doc.
 *
 * Linking is by doc ID, never by name: `matchingAgent` stores names and
 * detaches on rename (CLAUDE.md §25), which is exactly the fragility the
 * explicit `childSkillIds` link exists to avoid.
 */
export default function SkillNameInput({
  value,             // { mode: 'existing', id } | { mode: 'new', name }
  onChange,
  allAgents = [],
  excludeIds = [],   // already-attached skills + the parent itself
  placeholder = 'Skill name',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setQuery(''); }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Only real, live skills are linkable. An archived or still-pending entry is
  // not something to hang a shipping agent off.
  const pool = useMemo(() => allAgents.filter((a) => getType(a) === 'skill'
    && a.approvalStatus === 'approved'
    && a.archived !== true
    && !excludeIds.includes(a.id)), [allAgents, excludeIds]);

  const linked = value?.mode === 'existing' ? allAgents.find((a) => a.id === value.id) : null;
  const typed = value?.mode === 'new' ? (value.name || '') : '';
  const shown = open ? query : (linked ? linked.agentName : typed);

  const q = query.trim().toLowerCase();
  const filtered = q ? pool.filter((a) => (a.agentName || '').toLowerCase().includes(q)) : pool;
  const exact = q && pool.some((a) => (a.agentName || '').toLowerCase() === q);

  function pickExisting(a) {
    onChange({ mode: 'existing', id: a.id });
    setQuery('');
    setOpen(false);
  }
  function commitNew(name) {
    const n = name.trim();
    if (!n) return;
    onChange({ mode: 'new', name: n });
    setQuery('');
    setOpen(false);
  }

  return (
    <div className="combo-wrap" ref={wrapRef}>
      <input
        ref={inputRef}
        type="text"
        value={shown}
        placeholder={placeholder}
        onFocus={() => { setQuery(linked ? '' : typed); setOpen(true); }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          // Typing always drops back to "new": the field must never show one
          // name while still holding a different doc ID underneath.
          onChange({ mode: 'new', name: e.target.value });
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitNew(query); } }}
      />
      {open && (filtered.length > 0 || (q && !exact)) && (
        <div className="combo-list">
          {filtered.slice(0, 50).map((a) => (
            <div
              key={a.id}
              className="combo-item"
              onMouseDown={(e) => { e.preventDefault(); pickExisting(a); }}
            >
              <span>{a.agentName}</span>
              {/* Show what is being attached: a skill that is already live, or
                  already someone else's child, is still linkable — but the
                  user should see that before clicking. */}
              <span style={{ float: 'right', fontSize: 10, color: 'var(--mu2)' }}>
                {a.owner || ''}
              </span>
            </div>
          ))}
          {q && !exact && (
            <div className="combo-item combo-add" onMouseDown={(e) => { e.preventDefault(); commitNew(query); }}>
              + Add "{query.trim()}"
            </div>
          )}
        </div>
      )}
    </div>
  );
}
