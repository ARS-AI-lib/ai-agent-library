import { useEffect, useRef, useState } from 'react';
import { rebuildAllVectors } from '../lib/reindex';
import ThemeToggle from './ThemeToggle';

export default function Nav({
  search, setSearch,
  agentCount, skillCount,
  user, onSignOut,
  activeTab, setActiveTab,
  onOpenExport, onOpenRoleGroups, canManageRoleGroups, onOpenUpload, canUploadFiles, canSeeTimeline, canSeeUsage, canSeeWorkshop, canSeeDashboard, isAdmin,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  return (
    <nav className="nav">
      <div className="nav-brand">
        <div>
          <h1>AI Agent Library</h1>
          <p>Powered by Wolfy</p>
        </div>
      </div>
      <div className="nav-tabs">
        <button 
          className={`nav-tab ${activeTab === 'lib' ? 'active' : ''}`}
          onClick={() => setActiveTab('lib')}
        >
          Agent Library
        </button>
        <button
          className={`nav-tab ${activeTab === 'sdlc' ? 'active' : ''}`}
          onClick={() => setActiveTab('sdlc')}
        >
          SDLC AI Adoption
        </button>
        {canSeeDashboard && (
          <button
            className={`nav-tab ${activeTab === 'dash' ? 'active' : ''}`}
            onClick={() => setActiveTab('dash')}
          >
            Dashboard
          </button>
        )}
      </div>
      {activeTab !== 'dash' && (
        <div className="nav-search">
          <div className="nav-search-wrap">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="nav-search-inp"
              placeholder="Search name, owner, description, ability, role…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="nav-r">
        <div className="chips">
          <div className="chip c-ag"><div className="n">{agentCount}</div><div className="l">Agents</div></div>
          <div className="chip c-sk"><div className="n">{skillCount}</div><div className="l">Skills</div></div>
        </div>

        {user && (
          <div className="nav-user">
            {user.photoURL
                ? <img src={user.photoURL} alt="" />
                : <span className="nav-user-fallback">{(user.displayName || user.email || '?').trim().charAt(0).toUpperCase()}</span>}
            <div className="nav-user-name">
              {(() => {
                const full = (user.displayName || user.email || '').trim();
                const [first, ...rest] = full.split(' ');
                const last = rest.join(' ');
                return (
                  <>
                    <span>{first}</span>
                    {last && <span>{last}</span>}
                  </>
                );
              })()}
            </div>
          </div>
        )}

        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            className="icon-btn"
            title="Menu"
            aria-label="Menu"
            aria-haspopup="true"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          </button>
          {menuOpen && (
            <div className="menu">
              {/* Dark mode lives in the ☰ menu rather than as its own nav
                  button — it is a set-once preference, not something worth a
                  permanent slot in a row that already holds counts, avatar and
                  menu. */}
              <ThemeToggle />
              <button
                type="button"
                onClick={() => { onOpenExport?.(); setMenuOpen(false); }}
              >
                Export Data
              </button>
              {canManageRoleGroups && (
                <button
                  type="button"
                  onClick={() => { onOpenRoleGroups?.(); setMenuOpen(false); }}
                >
                  Role Group Management
                </button>
              )}
              {/* Attach a file to a deploy-approved agent's endpoint. Visible
                  to admin/staff/approver; the callable re-checks the role and
                  the Approve Area, so this is presentation only. */}
              {canUploadFiles && (
                <button
                  type="button"
                  onClick={() => { onOpenUpload?.(); setMenuOpen(false); }}
                >
                  Attach Endpoint File
                </button>
              )}
              {isAdmin && (
                // Admin escape hatch for the semantic search index. Individual
                // saves reindex themselves fire-and-forget, so this is only
                // needed after a bulk import/migration that bypassed the UI, or
                // if a save-time reindex was ever lost. Safe to run any time:
                // it hashes content and re-embeds only what actually changed.
                <button
                  type="button"
                  disabled={reindexing}
                  onClick={async () => {
                    setReindexing(true);
                    try {
                      const r = await rebuildAllVectors();
                      window.alert(`Search index rebuilt\n\nScanned ${r.scanned} · Re-indexed ${r.embedded} · Already current ${r.skipped} · Removed ${r.pruned}`);
                    } catch (e) {
                      window.alert(`Rebuild failed: ${e?.message || e}`);
                    } finally {
                      setReindexing(false);
                      setMenuOpen(false);
                    }
                  }}
                >
                  {reindexing ? 'Rebuilding…' : 'Rebuild Search Index'}
                </button>
              )}
              {canSeeTimeline && (
                <button
                  type="button"
                  onClick={() => { window.location.href = '/timeline'; setMenuOpen(false); }}
                >
                  SDLC Timeline
                </button>
              )}
          {canSeeUsage && (
            <button type="button" onClick={() => { window.location.href = '/usage'; setMenuOpen(false); }}>
              Agent/Skill Usage
            </button>
          )}
          {canSeeWorkshop && (
            <button type="button" onClick={() => { window.location.href = '/workshop'; setMenuOpen(false); }}>
              Workshop
            </button>
          )}
              <button
                type="button"
                className="danger"
                onClick={() => { setMenuOpen(false); onSignOut?.(); }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
