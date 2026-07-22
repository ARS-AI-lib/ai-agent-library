import { useEffect, useRef, useState } from 'react';

/**
 * Closed-list multi-select combobox over the agent library (2026-07-16,
 * "Compatible Agents" field on Skill entries) — same interaction shape as
 * TagMultiSelect (tag chips, search-filtered dropdown, backspace-to-remove)
 * but with NO free-add: selection is limited to actual agents from `agents`.
 * Selection is a Set of agent doc IDs (not names), so it survives an agent
 * being renamed later.
 */
export default function AgentMultiSelect({ label, agents = [], selected, onChange, excludeId }) {
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

  const pool = agents.filter((a) => a.id !== excludeId);
  const q = query.trim().toLowerCase();
  const filtered = q ? pool.filter((a) => (a.agentName || '').toLowerCase().includes(q)) : pool;
  const nameFor = (id) => pool.find((a) => a.id === id)?.agentName || agents.find((a) => a.id === id)?.agentName || id;

  function toggleAgent(id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  }

  function removeTag(id) {
    const next = new Set(selected);
    next.delete(id);
    onChange(next);
  }

  function onKeyDown(e) {
    if (e.key === 'Backspace' && !query && selected.size > 0) {
      const last = [...selected][selected.size - 1];
      removeTag(last);
    }
  }

  return (
    <div className="tms-wrap" ref={wrapRef}>
      <div className="tms-box" onClick={() => { setOpen(true); inputRef.current?.focus(); }}>
        {[...selected].map((id) => (
          <span key={id} className="tms-tag">
            {nameFor(id)}
            <button type="button" className="tms-tag-x" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); removeTag(id); }}>✕</button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          className="tms-input"
          value={query}
          placeholder={selected.size === 0 ? label : ''}
          onFocus={() => setOpen(true)}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      {open && (
        <div className="tms-list">
          {filtered.map((a) => (
            <div
              key={a.id}
              className={`tms-item ${selected.has(a.id) ? 'sel' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); toggleAgent(a.id); }}
            >
              {a.agentName}
            </div>
          ))}
          {!filtered.length && (
            <div className="tms-item" style={{ color: 'var(--mu2)', cursor: 'default' }}>(no agents found)</div>
          )}
        </div>
      )}
    </div>
  );
}
