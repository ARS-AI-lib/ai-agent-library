import { useId, useState } from 'react';
import { glossaryTerm } from '../lib/glossary';

// Hover / focus explanation for a glossary term (V7). Renders children with a
// dashed underline; the tooltip text comes from src/lib/glossary.js only.
// Unknown keys render the children unchanged.
export default function Term({ k, children }) {
  const t = glossaryTerm(k);
  const id = useId();
  const [open, setOpen] = useState(false);
  if (!t) return children;
  return (
    <span
      className="v7-term"
      tabIndex={0}
      aria-describedby={open ? id : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
      {open && (
        <span role="tooltip" id={id} className="v7-tip">
          <strong>{t.k}</strong>
          <span>{t.v}</span>
        </span>
      )}
    </span>
  );
}
