import { useEffect, useRef, useState } from 'react';

export default function Nav({
  search, setSearch,
  agentCount, skillCount,
  user, onSignOut,
  activeTab, setActiveTab,
  myAI, onToggleMyAI, onOpenExport,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
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
      </div>
      <div className="nav-search">
        <div className="nav-search-wrap">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="nav-search-inp"
            placeholder="Search name or owner…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

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
          <button className="btn-icon" title="Menu" onClick={() => setMenuOpen((o) => !o)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          </button>
          {menuOpen && (
            <div
              style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 20,
                background: 'var(--sf)', border: '1.5px solid var(--bd2)', borderRadius: 8,
                boxShadow: 'var(--shm)', minWidth: 170, overflow: 'hidden',
              }}
            >
              <button
                type="button"
                onClick={() => { onToggleMyAI?.(); setMenuOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                  padding: '9px 12px', fontSize: 12.5, fontWeight: myAI ? 700 : 500,
                  color: myAI ? 'var(--ag)' : 'var(--tx)', background: myAI ? 'var(--sf2)' : 'none',
                  border: 'none', borderBottom: '1px solid var(--bd)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                }}
              >
                My AI {myAI && <span style={{ fontSize: 10 }}>✓ on</span>}
              </button>
              <button
                type="button"
                onClick={() => { onOpenExport?.(); setMenuOpen(false); }}
                style={{
                  display: 'block', width: '100%', padding: '9px 12px', fontSize: 12.5, fontWeight: 500,
                  color: 'var(--tx)', background: 'none', border: 'none', borderBottom: '1px solid var(--bd)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                }}
              >
                Export Data
              </button>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); onSignOut?.(); }}
                style={{
                  display: 'block', width: '100%', padding: '9px 12px', fontSize: 12.5, fontWeight: 500,
                  color: 'var(--tx)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
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
