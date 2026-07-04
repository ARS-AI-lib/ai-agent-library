import { useState, useRef, useEffect } from 'react';

// Text input with a dropdown of existing suggestions — user can pick one or
// type a new value. Used for fields like Owner where most submissions reuse
// an existing team name but the long tail of one-off teams shouldn't block.
export default function ComboInput({ value, onChange, options = [], placeholder }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const q = (value || '').toLowerCase().trim();
  const filtered = q
    ? options.filter((o) => o.toLowerCase().includes(q))
    : options;

  return (
    <div className="combo-wrap" ref={wrapRef}>
      <input
        type="text"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
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
