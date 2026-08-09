import { useCallback, useEffect, useState } from 'react';

// Single global light/dark switch (2026-08-08) — first dark mode this app has
// ever had. Lives outside React (module-level store + listener set) rather
// than Context because the two consumers (Nav's toggle button, TimelinePage's
// <canvas> redraw) don't share a tree and a Context provider would have to
// wrap the whole app just for this. `apply()` runs once at import time so
// `data-theme` is set on <html> before first paint — no flash of the wrong
// theme.
const STORAGE_KEY = 'agentlib-theme';
const listeners = new Set();

function readInitial() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* localStorage unavailable — fall through to OS preference */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply(theme) {
  document.documentElement.dataset.theme = theme;
}

let current = readInitial();
apply(current);

function setTheme(theme) {
  current = theme;
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore quota/private-mode errors */ }
  apply(theme);
  listeners.forEach((l) => l(theme));
}

export function useTheme() {
  const [theme, setLocal] = useState(current);
  useEffect(() => {
    const l = (t) => setLocal(t);
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  const toggleTheme = useCallback(() => setTheme(current === 'dark' ? 'light' : 'dark'), []);
  return [theme, toggleTheme];
}
