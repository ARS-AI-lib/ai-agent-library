import { useEffect, useRef, useState } from 'react';

function msLabel(set, placeholder) {
  if (set.size === 0) return placeholder;
  if (set.size === 1) return [...set][0];
  return `${[...set][0]} +${set.size - 1}`;
}

/**
 * Multi-select dropdown — ported from the original .ms-wrap/.ms-btn/.ms-list
 * pattern in Agent-lib.html (checkbox list under a button).
 */
export default function MultiSelect({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  function toggleValue(v) {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(next);
  }

  return (
    <div className="ms-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`ms-btn ${selected.size > 0 ? 'has-sel' : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        {msLabel(selected, label)}
      </button>
      <div className={`ms-list ${open ? 'open' : ''}`}>
        {options.map((opt) => (
          <label key={opt} className={`ms-item ${selected.has(opt) ? 'checked' : ''}`}>
            <input type="checkbox" checked={selected.has(opt)} onChange={() => toggleValue(opt)} />
            {opt}
          </label>
        ))}
        {options.length === 0 && (
          <div className="ms-item" style={{ color: 'var(--mu2)', cursor: 'default' }}>
            (no options)
          </div>
        )}
      </div>
    </div>
  );
}
