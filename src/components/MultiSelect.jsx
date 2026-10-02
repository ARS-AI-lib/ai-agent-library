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
// `pill` (V7, 2026-10-01): when set, the trigger renders as a filter pill with
// the field name inside it ("ROLE  2 selected") plus an inline ✕ that clears
// it, and the panel gains a search box, per-option counts (`counts`) and a
// Clear footer. Form usages pass no `pill` and render exactly as before.
export default function MultiSelect({ label, options, selected, onChange, pill, counts }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
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

  const shown = pill && q.trim()
    ? options.filter((o) => String(o).toLowerCase().includes(q.trim().toLowerCase()))
    : options;

  if (pill) {
    return (
      <div className="ms-wrap" ref={wrapRef}>
        <button
          type="button"
          className={`v7-fpill ${selected.size > 0 ? 'on has-x' : ''}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="v7-pl">{pill}</span>
          {selected.size === 0 ? 'All' : selected.size === 1 ? [...selected][0] : <>{[...selected][0]}<span className="v7-plus">+{selected.size - 1}</span></>}
          {selected.size === 0 && <span className="v7-caret" aria-hidden="true" />}
        </button>
        {/* Sibling, not nested: a control inside a <button> is invalid. CSS
            pulls it back inside the pill's right edge. */}
        {selected.size > 0 && (
          <button type="button" className="v7-px" aria-label={`Clear ${pill}`} onClick={() => onChange(new Set())}>✕</button>
        )}
        {open && (
          <div className="dd-panel v7-ms-panel" role="listbox" aria-multiselectable="true" aria-label={label}>
            {options.length > 6 && (
              <label className="v7-ms-search">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
                <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label={`Search ${label}`} autoFocus />
              </label>
            )}
            <div className="v7-ms-list">
              {shown.map((opt) => (
                <div
                  key={opt}
                  role="option"
                  aria-selected={selected.has(opt)}
                  className={`dd-opt ${selected.has(opt) ? 'sel' : ''}`}
                  onClick={() => toggleValue(opt)}
                >
                  <span className="dd-check">✓</span>
                  <span className="v7-ms-name">{opt}</span>
                  {counts && <span className="v7-ms-n">{counts.get(opt) || 0}</span>}
                </div>
              ))}
              {shown.length === 0 && <div className="dd-empty">(no options)</div>}
            </div>
            <div className="v7-ms-foot">
              <button type="button" disabled={selected.size === 0} onClick={() => onChange(new Set())}>Clear</button>
              <span>Applied instantly</span>
            </div>
          </div>
        )}
      </div>
    );
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
