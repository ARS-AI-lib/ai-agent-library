import { useEffect, useRef, useState } from 'react';
import { rebuildAllVectors } from '../lib/reindex';

export default function Nav({
  search, setSearch,
  agentCount, skillCount,
  user, onSignOut,
  activeTab, setActiveTab,
  onOpenExport, canSeeTimeline, canSeeDashboard, isAdmin,
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
            {user.photoURL && <img src={user.photoURL} alt="" />}
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
            title="Menu" onClick={() => setMenuOpen((o) => !o)}
            style={{
              width: 32, height: 32, border: 'none', background: 'none', color: 'var(--mu)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 'var(--r-sm)', transition: 'color .15s, background .15s', flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--tx)'; e.currentTarget.style.background = 'var(--sf2)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--mu)'; e.currentTarget.style.background = 'none'; }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          </button>
          {menuOpen && (
            <div
              style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 20,
                background: 'var(--sf)', border: '1px solid var(--bd-soft)', borderRadius: 'var(--r-md)',
                boxShadow: 'var(--shm)', minWidth: 170, overflow: 'hidden',
              }}
            >
              <button
                type="button"
                onClick={() => { onOpenExport?.(); setMenuOpen(false); }}
                style={{
                  display: 'block', width: '100%', padding: '9px 12px', fontSize: 12.5, fontWeight: 500,
                  color: 'var(--tx)', background: 'none', border: 'none', borderBottom: '1px solid var(--bd-soft)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                }}
              >
                Export Data
              </button>
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
                  style={{
                    display: 'block', width: '100%', padding: '9px 12px', fontSize: 12.5, fontWeight: 500,
                    color: 'var(--tx)', background: 'none', border: 'none', borderBottom: '1px solid var(--bd-soft)',
                    cursor: reindexing ? 'wait' : 'pointer', textAlign: 'left', fontFamily: 'inherit',
                    opacity: reindexing ? 0.6 : 1,
                  }}
                >
                  {reindexing ? 'Rebuilding…' : 'Rebuild Search Index'}
                </button>
              )}
              {canSeeTimeline && (
                <button
                  type="button"
                  onClick={() => { window.location.href = '/timeline'; setMenuOpen(false); }}
                  style={{
                    display: 'block', width: '100%', padding: '9px 12px', fontSize: 12.5, fontWeight: 500,
                    color: 'var(--tx)', background: 'none', border: 'none', borderBottom: '1px solid var(--bd-soft)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                  }}
                >
                  SDLC Timeline
                </button>
              )}
              <button
                type="button"
                onClick={() => { setMenuOpen(false); onSignOut?.(); }}
                style={{
                  display: 'block', width: '100%', padding: '9px 12px', fontSize: 12.5, fontWeight: 500,
                  color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                }}
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
