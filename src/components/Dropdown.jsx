import { useEffect, useRef, useState } from 'react';

/**
 * Single-select listbox replacing the native <select className="dd"> in the
 * control bar (2026-08-08 redesign).
 *
 * Why replace a perfectly working <select>: its popup is drawn by the OS and
 * cannot be styled, so it sat next to MultiSelect's custom .ms-btn looking
 * like a different control in a row of otherwise identical filter pills. Both
 * now render the same .dd/.ms-btn pill over the same .dd-panel.
 *
 * A native <select> is focusable, arrow-navigable, type-ahead-able and closes
 * on Escape for free. Replacing it means re-implementing that by hand, or the
 * swap is a straight accessibility regression — hence role="listbox",
 * aria-activedescendant, and the key handling below.
 *
 * `options` is [value, label][] so callers keep their existing value/label
 * split (ControlBar's VIEWS constant is already in that shape).
 */
export default function Dropdown({ options, value, onChange, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0); // keyboard cursor, not the selection
  const wrapRef = useRef(null);
  const btnRef = useRef(null);
  const id = useRef(`dd-${Math.random().toString(36).slice(2, 9)}`).current;

  const selectedIdx = Math.max(0, options.findIndex(([v]) => v === value));
  const current = options[selectedIdx];

  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  // Opening always starts the cursor on what's currently selected, the way a
  // native select does — not at the top of the list.
  function openList() {
    setActive(selectedIdx);
    setOpen(true);
  }

  function commit(idx) {
    const opt = options[idx];
    if (opt) onChange(opt[0]);
    setOpen(false);
    btnRef.current?.focus();
  }

  function onKeyDown(e) {
    if (!open) {
      // ArrowDown/Enter/Space open the list; everything else falls through so
      // Tab still moves focus normally.
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btnRef.current?.focus(); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); commit(active); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); return; }
    if (e.key === 'Home') { e.preventDefault(); setActive(0); return; }
    if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1); }
  }

  return (
    <div className="ms-wrap" ref={wrapRef}>
      <button
        type="button"
        ref={btnRef}
        className="dd"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        {current ? current[1] : ''}
      </button>
      {open && (
        <div className="dd-panel" role="listbox" aria-label={ariaLabel} tabIndex={-1}>
          {options.map(([v, lbl], i) => (
            <div
              key={v}
              id={`${id}-${i}`}
              role="option"
              aria-selected={v === value}
              className={`dd-opt ${v === value ? 'sel' : ''} ${i === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => commit(i)}
            >
              <span className="dd-check single">✓</span>
              {lbl}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
