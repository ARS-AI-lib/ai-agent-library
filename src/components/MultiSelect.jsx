import { useEffect, useRef, useState } from 'react';

function msLabel(set, placeholder) {
  if (set.size === 0) return placeholder;
  if (set.size === 1) return [...set][0];
  return `${[...set][0]} +${set.size - 1}`;
}

/**
 * Multi-select dropdown — .ms-wrap/.ms-btn trigger over the SHARED .dd-panel
 * (2026-08-08). It used to own a private .ms-list/.ms-item panel that was a
 * near-copy of the single-select one; both now render the same rows, so the
 * two controls can no longer drift apart visually. The only difference left
 * is the leading glyph: a checkbox here, a check mark in Dropdown.jsx.
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
      {open && (
        <div className="dd-panel" role="listbox" aria-multiselectable="true" aria-label={label}>
          {options.map((opt) => (
            <div
              key={opt}
              role="option"
              aria-selected={selected.has(opt)}
              className={`dd-opt ${selected.has(opt) ? 'sel' : ''}`}
              onClick={() => toggleValue(opt)}
            >
              <span className="dd-check">✓</span>
              {opt}
            </div>
          ))}
          {options.length === 0 && <div className="dd-empty">(no options)</div>}
        </div>
      )}
    </div>
  );
}
