import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/theme.css'
import './styles/v7.css'

import App from './App.jsx'
import TimelinePage from './components/TimelinePage.jsx'
import FileDownloadPage from './components/FileDownloadPage.jsx'
import UsageReportPage from './components/UsageReportPage.jsx'
import WorkshopPage from './components/WorkshopPage.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// V7 look is scoped under body.v7 (see styles/v7.css).
document.body.classList.add('v7');

// Lightweight path routing (no router lib): the SPA serves every path via the
// Firebase rewrite, so we pick the root component by pathname. /timeline is a
// standalone, access-gated page opened in a new tab from the hamburger menu.
//
// /f/{agentId} is the download gate for library-hosted files (2026-08-18). It
// relies on exactly the same rewrite: the URL looks like a file but resolves to
// this SPA, which forces SSO before any byte is served. That indirection IS the
// security property — a static Hosting path or a Storage download token would
// both hand the file to anyone holding the link.
const path = window.location.pathname.replace(/\/+$/, '');
const Root = path === '/timeline' ? TimelinePage
  : path === '/usage' ? UsageReportPage
    : path === '/workshop' ? WorkshopPage
      : path.startsWith('/f/') ? FileDownloadPage
        : App;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
)
