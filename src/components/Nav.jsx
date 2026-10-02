import { useEffect, useRef, useState } from 'react';
import { rebuildAllVectors } from '../lib/reindex';
import ThemeToggle from './ThemeToggle';
import { toast } from '../lib/toast';
import { failMsg } from '../lib/copy';

// V7 header (2026-10-01). Same items and the same role conditions as before —
// only the layout changed: segmented tabs with icons, and the ☰ menu grouped
// into Data / Reports / Admin / Appearance. A group heading renders only when
// at least one of its items is visible to this user.

const ICON = {
  lib: 'M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v5H4zM13 14h7v5h-7z',
  sdlc: 'M4 6h16M4 12h16M4 18h10',
  dash: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  export: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  attach: 'M21 12l-9 9a6 6 0 0 1-8-8l9-9a4 4 0 0 1 6 6l-9 9a2 2 0 0 1-3-3l8-8',
  timeline: 'M4 6h10M4 12h16M4 18h7',
  usage: 'M4 20V10M10 20V4M16 20v-7',
  workshop: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  roles: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21c1-4 4-6 8-6s7 2 8 6',
  reindex: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  subs: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 14l2 2 4-4',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  out: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
};

function Ic({ d, size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function initials(user) {
  const full = (user?.displayName || user?.email || '?').trim();
  const parts = full.split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

export default function Nav({
  search, setSearch,
  agentCount, skillCount,
  user, role, onSignOut,
  activeTab, setActiveTab,
  onOpenExport, onOpenRoleGroups, canManageRoleGroups, onOpenUpload, canUploadFiles, canSeeTimeline, canSeeUsage, canSeeWorkshop, canSeeDashboard, isAdmin,
  onOpenMySubmissions, onOpenGlossary, mySubsNeedAction = 0,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setMenuOpen(false); }
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', onDocClick); document.removeEventListener('keydown', onKey); };
  }, []);

  // V7 polish F: "/" or Cmd/Ctrl+K jumps to search (not while typing).
  const searchRef = useRef(null);
  useEffect(() => {
    function onKey(e) {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        if (!searchRef.current) return;
        e.preventDefault();
        searchRef.current.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const close = () => setMenuOpen(false);
  const go = (href) => { window.location.href = href; close(); };

  async function rebuild() {
    setReindexing(true);
    try {
      const r = await rebuildAllVectors();
      toast(`Search index updated · ${r.scanned} รายการ (อัปเดต ${r.embedded})`);
    } catch (e) {
      toast(failMsg('อัปเดตการค้นหา', e));
    } finally {
      setReindexing(false);
      close();
    }
  }

  const tabs = [
    { key: 'lib', label: 'Agent Library', show: true },
    { key: 'sdlc', label: 'SDLC AI Adoption', show: true },
    { key: 'dash', label: 'Dashboard', show: canSeeDashboard },
  ].filter((t) => t.show);

  const reports = [
    canSeeTimeline && { k: 'timeline', label: 'SDLC Timeline', on: () => go('/timeline') },
    canSeeUsage && { k: 'usage', label: 'Agent/Skill Usage', on: () => go('/usage') },
    canSeeWorkshop && { k: 'workshop', label: 'Workshop', on: () => go('/workshop') },
  ].filter(Boolean);
  const admin = [
    canManageRoleGroups && { k: 'roles', label: 'Role Group Management', on: () => { onOpenRoleGroups?.(); close(); } },
    isAdmin && { k: 'reindex', label: reindexing ? 'Rebuilding…' : 'Rebuild Search Index', on: rebuild, disabled: reindexing },
  ].filter(Boolean);

  const Item = ({ k, label, on, disabled }) => (
    <button type="button" role="menuitem" disabled={disabled} onClick={on}>
      <span className="mi-icon"><Ic d={ICON[k]} />{label}</span>
    </button>
  );

  return (
    <nav className="nav v7-nav">
      <div className="nav-brand">
        <span className="v7-brand-mark" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9l3-5 3 4h4l3-4 3 5-2 8-6 3-6-3z" /><path d="M9.5 12.5h.01M14.5 12.5h.01" /></svg>
        </span>
        <div>
          <h1>AI Agent Library</h1>
          <p>Powered by Wolfy</p>
        </div>
      </div>

      <div className="v7-seg" role="tablist" aria-label="Sections">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={activeTab === t.key}
            className={`v7-seg-btn ${activeTab === t.key ? 'active' : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            <Ic d={ICON[t.key]} size={14} />{t.label}
          </button>
        ))}
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
              ref={searchRef}
              aria-keyshortcuts="/ Meta+K Control+K"
              aria-label="Search the library"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {!search && <kbd className="v7-kbd" aria-hidden="true">⌘K</kbd>}
          </div>
        </div>
      )}

      <div className="nav-r">
        <span className="v7-count ag"><strong>{agentCount}</strong><span>Agents</span></span>
        <span className="v7-count sk"><strong>{skillCount}</strong><span>Skills</span></span>
        <span className="v7-nav-sep" aria-hidden="true" />

        {/* Avatar = My submissions (board 1). The dot means at least one of
            my items needs an action from me. */}
        {onOpenMySubmissions && (
          <button
            type="button"
            className="v7-avatar-only"
            title="My submissions"
            aria-label={mySubsNeedAction > 0 ? `My submissions, ${mySubsNeedAction} need your action` : 'My submissions'}
            onClick={onOpenMySubmissions}
          >
            {user?.photoURL ? <img src={user.photoURL} alt="" /> : initials(user)}
            {mySubsNeedAction > 0 && <span className="v7-avatar-dot" />}
          </button>
        )}

        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            className="v7-avatar-btn"
            title="Menu"
            aria-label="Menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          {menuOpen && (
            <div className="menu v7-menu" role="menu" aria-label="Main menu">
              {user && (
                <div className="v7-menu-user">
                  <span className="v7-avatar lg">{initials(user)}</span>
                  <div>
                    <strong>{user.displayName || user.email}</strong>
                    <span>{user.email}{role ? ` · ${role.charAt(0).toUpperCase()}${role.slice(1)}` : ''}</span>
                  </div>
                </div>
              )}
              {onOpenMySubmissions && (
                <Item k="subs" label="My Submissions" on={() => { onOpenMySubmissions(); close(); }} />
              )}

              <div className="v7-menu-head">Data</div>
              <Item k="export" label="Export Data" on={() => { onOpenExport?.(); close(); }} />
              {/* Visible to admin/staff/approver; the callable re-checks role + area. */}
              {canUploadFiles && <Item k="attach" label="Attach Endpoint File" on={() => { onOpenUpload?.(); close(); }} />}

              {reports.length > 0 && <div className="v7-menu-head">Reports</div>}
              {reports.map((r) => <Item key={r.k} {...r} />)}

              {admin.length > 0 && <div className="v7-menu-head">Admin</div>}
              {admin.map((r) => <Item key={r.k} {...r} />)}

              {onOpenGlossary && (<>
                <div className="v7-menu-head">Help</div>
                <Item k="help" label="Glossary" on={() => { onOpenGlossary(); close(); }} />
              </>)}

              <div className="v7-menu-head">Appearance</div>
              <ThemeToggle />

              <div className="v7-menu-sep" />
              <button type="button" role="menuitem" className="danger" onClick={() => { close(); onSignOut?.(); }}>
                <span className="mi-icon"><Ic d={ICON.out} />Sign out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
