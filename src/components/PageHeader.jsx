import ThemeToggle from './ThemeToggle';

// V7 header for the standalone pages (/timeline, /usage, /workshop, /f/…).
// Same brand + avatar look as Nav.jsx so every page reads as one product;
// "← Library" is the way home (same-tab navigation, as before).
export function BrandMark() {
  return (
    <span className="v7-brand-mark" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9l3-5 3 4h4l3-4 3 5-2 8-6 3-6-3z" /><path d="M9.5 12.5h.01M14.5 12.5h.01" /></svg>
    </span>
  );
}

function initials(user) {
  const full = (user?.displayName || user?.email || '?').trim();
  const parts = full.split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

export default function PageHeader({ user, children, right, back = true }) {
  return (
    <nav className="nav v7-nav v7-page-nav">
      <a className="nav-brand v7-brand-link" href="/" aria-label="AI Agent Library home">
        <BrandMark />
        <div>
          <h1>AI Agent Library</h1>
          <p>Powered by Wolfy</p>
        </div>
      </a>
      {back && (
        <a className="v7-back" href="/">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
          Library
        </a>
      )}
      {children}
      <div className="nav-r">
        {right}
        <div className="menu v7-theme-mini"><ThemeToggle /></div>
        {user && (
          user.photoURL
            ? <img className="v7-avatar" src={user.photoURL} alt="" />
            : <span className="v7-avatar" title={user.email || ''}>{initials(user)}</span>
        )}
      </div>
    </nav>
  );
}
