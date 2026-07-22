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
      {open && filtered.length > 0 && (
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
        </div>
      )}
    </div>
  );
}
