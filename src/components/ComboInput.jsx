import { useState, useRef, useEffect } from 'react';

// Text input with a dropdown of existing suggestions — user can pick one or
// type a new value. Used for fields like Owner where most submissions reuse
// an existing team name but the long tail of one-off teams shouldn't block.
// readOnly=true: click-to-open list only (no free-text), used for fixed-choice
// fields like Reusable where the valid set is known in advance.
export default function ComboInput({ value, onChange, options = [], placeholder, readOnly = false }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const q = readOnly ? '' : (value || '').toLowerCase().trim();
  const filtered = q
    ? options.filter((o) => o.toLowerCase().includes(q))
    : options;
  // Same "+ Add" affordance as TagMultiSelect (2026-08-10) — free-typing a
  // value with no exact match (case-insensitive) among the known options is
  // silently accepted here already (onChange fires on every keystroke), but
  // without this row nothing on screen told the user that was fine. Only
  // meaningful when free-typing is possible at all, so readOnly fields
  // (Reusable) never show it.
  const exactMatch = !readOnly && options.some((o) => o.toLowerCase() === q);
  const showAddHint = !readOnly && q && !exactMatch;

  return (
    <div className="combo-wrap" ref={wrapRef}>
      <input
        type="text"
        value={value || ''}
        readOnly={readOnly}
        onChange={readOnly ? undefined : (e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onClick={readOnly ? () => setOpen((o) => !o) : undefined}
        placeholder={placeholder}
        style={readOnly ? { cursor: 'pointer' } : undefined}
      />
      {open && (filtered.length > 0 || showAddHint) && (
        <div className="combo-list">
          {filtered.slice(0, 50).map((o) => (
            <div
              key={o}
              className={`combo-item ${o === value ? 'sel' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); onChange(o); setOpen(false); }}
            >
              {o}
            </div>
          ))}
          {showAddHint && (
            <div className="combo-item combo-add" onMouseDown={(e) => { e.preventDefault(); setOpen(false); }}>
              + Add "{value.trim()}"
            </div>
          )}
        </div>
      )}
    </div>
  );
}
