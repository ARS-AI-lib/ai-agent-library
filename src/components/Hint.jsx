import { useEffect, useId, useRef, useState } from 'react';

// V7 ⓘ hint (2026-10-02): optional explanations live here instead of always
// on screen. Hover / keyboard focus on desktop, tap on touch; Esc or an
// outside tap closes it. Text may be Thai (explanations), the trigger is an
// icon with an English aria-label.
export default function Hint({ text, label = 'More info' }) {
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const id = useId();
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const r = ref.current?.getBoundingClientRect();
    if (r) setFlip(r.left + 290 > window.innerWidth);
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!text) return null;
  return (
    <span
      className="v7-hint"
      ref={ref}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="v7-hint-btn"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" />
        </svg>
      </button>
      {open && <span role="tooltip" id={id} className={`v7-hint-pop ${flip ? 'flip' : ''}`}>{text}</span>}
    </span>
  );
}
