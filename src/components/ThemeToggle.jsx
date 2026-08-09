import { useTheme } from '../hooks/useTheme';

// Renders as a row INSIDE the ☰ menu (Nav.jsx) — hence a bare <button> with
// no className of its own: `.menu button` already styles it, and giving it a
// class here would just be a second place to keep the menu row style in sync.
// TimelinePage.jsx renders its own <nav> without a ☰ menu, so it wraps this
// in .menu itself (see there).
export default function ThemeToggle() {
  const [theme, toggleTheme] = useTheme();
  const dark = theme === 'dark';
  return (
    <button type="button" role="switch" aria-checked={dark} onClick={toggleTheme}>
      <span className="mi-icon">
        {dark ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4" />
            <line x1="12" y1="1.5" x2="12" y2="3.5" /><line x1="12" y1="20.5" x2="12" y2="22.5" />
            <line x1="3.5" y1="12" x2="1.5" y2="12" /><line x1="22.5" y1="12" x2="20.5" y2="12" />
            <line x1="5.1" y1="5.1" x2="3.7" y2="3.7" /><line x1="20.3" y1="20.3" x2="18.9" y2="18.9" />
            <line x1="5.1" y1="18.9" x2="3.7" y2="20.3" /><line x1="20.3" y1="3.7" x2="18.9" y2="5.1" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.4A9 9 0 1 1 11.6 3a7 7 0 0 0 9.4 9.4z" />
          </svg>
        )}
        Dark mode
      </span>
      <span className="theme-pill">{dark ? 'On' : 'Off'}</span>
    </button>
  );
}
