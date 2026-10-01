import { useEffect } from 'react';
import { ALLOWED_DOMAINS_LABEL, USING_EMULATOR } from '../lib/firebase';

// Local emulator only — never rendered in a real build.
const EMU_ACCOUNTS = ['tinnapat.p@arise.tech', 'emu.approver@arise.tech', 'emu.user@arise.tech'];

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.87 2.7-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.98v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.66 9c0-.59.1-1.17.29-1.7V4.97H.98A9 9 0 0 0 0 9c0 1.45.35 2.82.98 4.03l2.97-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .98 4.97l2.97 2.33C4.66 5.17 6.65 3.58 9 3.58z" />
    </svg>
  );
}

export default function LoginScreen({ onSignIn, error }) {
  // The sign-in screen has exactly one look — no dark variant — since the
  // theme toggle itself lives inside the authenticated app's ☰ menu, there's
  // no way to reach it from here anyway. Forcing the attribute (not touching
  // the stored preference in localStorage) means this affects only what's
  // on screen right now: signing out drops back to this component, which
  // re-forces light immediately, and signing back in hands control straight
  // back to useTheme's own effect, which re-applies whatever the user had
  // actually chosen — their preference is never silently reset.
  useEffect(() => {
    const prev = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = 'light';
    return () => {
      if (prev === undefined) delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = prev;
    };
  }, []);

  return (
    <div className="signin-page">
      <div className="signin-card">
        <div className="signin-logos">
          <img src="/logo1.png" alt="Infinitas by Krungthai" />
          <span className="signin-logos-sep" aria-hidden="true" />
          <img src="/logo2.png" alt="Arise by Infinitas" />
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>AI Agent Library</h1>
        {error && <div className="msg error" style={{ maxWidth: 380 }}><span className="dot" style={{ background: '#ea4335' }} />{error}</div>}
        <button className="signin-google-btn" onClick={() => onSignIn()}>
          <GoogleGlyph />
          Sign in with Google
        </button>
        {USING_EMULATOR && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, border: '1px dashed #e0a100', borderRadius: 8 }}>
            <small>Local emulator test sign-in</small>
            {EMU_ACCOUNTS.map((em) => <button key={em} className="btn-sm" onClick={() => onSignIn(em)}>{em}</button>)}
          </div>
        )}
        <p className="signin-domain-hint">เข้าสู่ระบบด้วยบัญชี {ALLOWED_DOMAINS_LABEL}</p>
      </div>
      <div className="signin-footer">
        <span>Copyright © 2026 Arise by Infinitas Co., Ltd. All rights reserved.</span>
        <span className="signin-footer-brand">Powered by Wolfy<img className="signin-footer-logo" src="/wolfy-logo.png" alt="Wolfy" /></span>
      </div>
    </div>
  );
}
