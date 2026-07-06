import { useEffect, useMemo, useRef, useState } from 'react';

// Split "BA, PM / QA" into ['BA', 'PM', 'QA'] — the two separators users
// actually type when pasting/typing multiple roles at once (2026-07-06 ask).
function splitTokens(raw) {
  return raw.split(/[,/]/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Multi-select combobox that also lets the user type a brand-new value that
 * isn't in `options` yet (auto-complete + free-add, replaces the plain
 * checkbox MultiSelect for Related Role — 2026-07-06). Selection is a Set of
 * strings, same contract as MultiSelect. Newly-typed values not already in
 * `options` are reported via `onAddNew(newValues)` so the caller can persist
 * them to the shared list (see useConfigSchema.addRelatedRoles).
 */
export default function TagMultiSelect({ label, options = [], selected, onChange, onAddNew }) {
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

  const optionSet = useMemo(() => new Set(options.map((o) => o.toLowerCase())), [options]);
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  const exactMatch = q && options.some((o) => o.toLowerCase() === q);

  function addTokens(tokens) {
    const next = new Set(selected);
    const brandNew = [];
    tokens.forEach((raw) => {
      const t = raw.trim();
      if (!t) return;
      const already = [...next].some((s) => s.toLowerCase() === t.toLowerCase());
      if (!already) next.add(t);
      if (!optionSet.has(t.toLowerCase())) brandNew.push(t);
    });
    onChange(next);
    if (brandNew.length) onAddNew?.(brandNew);
  }

  function toggleOption(opt) {
    const next = new Set(selected);
    const hit = [...next].find((s) => s.toLowerCase() === opt.toLowerCase());
    if (hit) next.delete(hit); else next.add(opt);
    onChange(next);
  }

  function removeTag(tag) {
    const next = new Set(selected);
    next.delete(tag);
    onChange(next);
  }

  function commitQuery() {
    if (!query.trim()) return;
    addTokens(splitTokens(query));
    setQuery('');
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); commitQuery(); }
    else if (e.key === 'Backspace' && !query && selected.size > 0) {
      const last = [...selected][selected.size - 1];
      removeTag(last);
    }
  }

  function onInputChange(e) {
    const v = e.target.value;
    // Comma/slash typed directly (not just pasted) commits everything before
    // it immediately, so multi-role paste/typing splits as you go.
    if (/[,/]$/.test(v)) {
      addTokens(splitTokens(v));
      setQuery('');
      return;
    }
    setQuery(v);
  }

  return (
    <div className="tms-wrap" ref={wrapRef}>
      <div className="tms-box" onClick={() => { setOpen(true); inputRef.current?.focus(); }}>
        {[...selected].map((tag) => (
          <span key={tag} className="tms-tag">
            {tag}
            <button type="button" className="tms-tag-x" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); removeTag(tag); }}>✕</button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          className="tms-input"
          value={query}
          placeholder={selected.size === 0 ? label : ''}
          onFocus={() => setOpen(true)}
          onChange={onInputChange}
          onKeyDown={onKeyDown}
        />
      </div>
      {open && (
        <div className="tms-list">
          {filtered.map((opt) => (
            <div
              key={opt}
              className={`tms-item ${[...selected].some((s) => s.toLowerCase() === opt.toLowerCase()) ? 'sel' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); toggleOption(opt); }}
            >
              {opt}
            </div>
          ))}
          {q && !exactMatch && (
            <div className="tms-item tms-add" onMouseDown={(e) => { e.preventDefault(); commitQuery(); }}>
              + Add "{query.trim()}"
            </div>
          )}
          {!filtered.length && !q && (
            <div className="tms-item" style={{ color: 'var(--mu2)', cursor: 'default' }}>(no options)</div>
          )}
        </div>
      )}
    </div>
  );
}
