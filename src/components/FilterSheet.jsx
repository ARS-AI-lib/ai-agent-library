import useEscapeKey from '../hooks/useEscapeKey';

// V7 mobile filter sheet (2026-10-02). Holds the SAME filter controls the
// desktop action row renders — passed in as children — so there is one set of
// controls and one set of state, just a different container on phones.
export default function FilterSheet({ open, onClose, onClear, count, resultCount, children, title = 'Filters' }) {
  useEscapeKey(open ? onClose : () => {});
  if (!open) return null;
  return (
    <div className="mov open v7-sheet-ovl" onClick={(e) => e.target.classList.contains('mov') && onClose()}>
      <div className="mbox v7-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="v7-sheet-head">
          <h2 className="mtitle">{title}{count > 0 ? ` (${count})` : ''}</h2>
          <button type="button" className="mclose" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="v7-sheet-body">{children}</div>
        <div className="v7-sheet-foot">
          <button type="button" className="btn btn-secondary" onClick={onClear} disabled={count === 0}>Clear all</button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {typeof resultCount === 'number' ? `Show ${resultCount} results` : 'Done'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Button that opens the sheet; shows how many filters are on.
export function FiltersButton({ count, onClick }) {
  return (
    <button type="button" className={`v7-filters-btn ${count > 0 ? 'on' : ''}`} onClick={onClick} aria-haspopup="dialog">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
      Filters{count > 0 && <span className="v7-badge v7-badge-blue">{count}</span>}
    </button>
  );
}
