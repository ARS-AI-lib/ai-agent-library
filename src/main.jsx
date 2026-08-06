import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/theme.css'
import App from './App.jsx'
import TimelinePage from './components/TimelinePage.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// Lightweight path routing (no router lib): the SPA serves every path via the
// Firebase rewrite, so we pick the root component by pathname. /timeline is a
// standalone, access-gated page opened in a new tab from the hamburger menu.
const isTimeline = window.location.pathname.replace(/\/+$/, '') === '/timeline';
const Root = isTimeline ? TimelinePage : App;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
)
