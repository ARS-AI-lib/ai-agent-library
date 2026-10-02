// V7 "no results" state (2026-10-01): says what was searched and offers the
// next steps instead of a dead end. Every action reuses an existing handler.
export default function EmptyResults({ search, onClear, onNew }) {
  const q = (search || '').trim();
  return (
    <div className="v7-empty" role="status">
      <span className="v7-empty-icon" aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5M8.5 11h5" /></svg>
      </span>
      <h2>{q ? `Nothing matches “${q}”` : 'Nothing matches these filters'}</h2>
      <p>อาจยังไม่มี หรือเรียกชื่อต่างกัน — ลองล้างตัวกรอง ถาม ALPHA หรือลงทะเบียนของใหม่</p>
      <div className="v7-empty-actions">
        {onClear && <button type="button" className="v7-btn-outline" onClick={onClear}>Clear filters and search</button>}
        {onNew && <button type="button" className="btn-new" onClick={onNew}>+ Register new</button>}
      </div>
    </div>
  );
}
