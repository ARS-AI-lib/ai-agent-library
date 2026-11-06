import { Fragment, useState } from 'react';
import { agentCategories, agentStages, categoryColor } from '../lib/agentUtils';
import { groupCategories } from '../lib/approveAreas';

// Left-hand shortcut menu (2026-08) — a faster path into the 242-item
// library alongside (not instead of) the horizontal filter bar in ControlBar.
// See docs/../.claude/plans/agent-skill-structured-horizon.md for the full
// design rationale.
//
// Multi-select behaviour: OR within a group (Category, SDLC Stage), AND
// across groups — this mirrors buildAgentFilter's existing ability/role
// semantics exactly (src/lib/agentUtils.js), just extended with two new
// groups (category, stage) plus one boolean (platformTools).
//
// Category options come ONLY from /config/schema.category (the approved
// list) — a category still pending admin approval never appears here, even
// though the agent that triggered it already carries the fallback category
// and is fully findable through it. See CategoryApprovalPanel.jsx.

function toggle(set, value) {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function countFor(agents, predicate) {
  return agents.reduce((n, a) => (predicate(a) ? n + 1 : n), 0);
}

export default function Sidebar({
  agents,
  categoryOptions,
  category, setCategory,
  stageOptions,
  stage, setStage,
  platformTools, setPlatformTools,
  externalSkills, setExternalSkills,
  myAI, onToggleMyAI,
  isAdmin, pendingProposalCount, onOpenProposals,
}) {
  // Collapsed category groups (session-only). Empty set = everything expanded,
  // the default the user asked for — nothing is hidden until they click a
  // group name. Never persisted, same as the VIEW/SORT dropdowns.
  const [collapsed, setCollapsed] = useState(() => new Set());
  const toggleGroup = (g) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(g)) next.delete(g); else next.add(g);
    return next;
  });

  return (
    <aside className="sidebar">
      {/* V7 moved My AI to the quick paths in the action row; the sidebar
          keeps it only if a caller still passes the toggle. */}
      {onToggleMyAI && (
      <button
        type="button"
        className={`sidebar-myai ${myAI ? 'active' : ''}`}
        onClick={onToggleMyAI}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
        </svg>
        My AI
        {myAI && <span className="sidebar-on">✓</span>}
      </button>
      )}

      <div className="sidebar-group">
        <div className="sidebar-h">Category</div>
        {/* Named groups (2026-11-06). Grouping + collapse live here only; the
            mobile Category sheet reuses this very component via App.jsx's
            `categoryPanel`, so there is a single implementation. */}
        {groupCategories(categoryOptions).map(({ group, items }) => {
          const isCollapsed = collapsed.has(group);
          return (
            <Fragment key={group}>
              <button
                type="button"
                className={`v7-sb-group ${isCollapsed ? 'collapsed' : ''}`}
                aria-expanded={!isCollapsed}
                onClick={() => toggleGroup(group)}
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
                <span>{group}</span>
              </button>
              {!isCollapsed && items.map((c) => {
                const n = countFor(agents, (a) => agentCategories(a).includes(c));
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={category.has(c)}
                    className={`sidebar-item ${category.has(c) ? 'active' : ''}`}
                    onClick={() => setCategory(toggle(category, c))}
                  >
                    <span className="sb-dot" style={{ background: categoryColor(c) }} />
                    <span className="sb-label">{c}</span>
                    <span className="sidebar-count">{n}</span>
                  </button>
                );
              })}
            </Fragment>
          );
        })}
        {categoryOptions.length === 0 && (
          <div className="sidebar-empty">ยังไม่มีหมวดที่อนุมัติ</div>
        )}
      </div>

      <div className="sidebar-group">
        <div className="sidebar-h">SDLC Stage</div>
        {stageOptions.map((s) => {
          const n = countFor(agents, (a) => agentStages(a).includes(s));
          return (
            <button
              key={s}
              type="button"
              className={`sidebar-item ${stage.has(s) ? 'active' : ''}`}
              onClick={() => setStage(toggle(stage, s))}
            >
              <span className="sb-dot" style={{ background: categoryColor(s) }} />
              <span className="sb-label">{s}</span>
              <span className="sidebar-count">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="sidebar-group">
        <div className="sidebar-h">Other</div>
        <button
          type="button"
          className={`sidebar-item ${platformTools ? 'active' : ''}`}
          onClick={() => setPlatformTools(!platformTools)}
        >
          <span className="sb-dot" style={{ background: 'var(--mu2)' }} />
          <span className="sb-label">Platform Tools</span>
          <span className="sidebar-count">{countFor(agents, (a) => a.internalTool === true)}</span>
        </button>
        <button
          type="button"
          aria-pressed={!!externalSkills}
          className={`sidebar-item ${externalSkills ? 'active' : ''}`}
          onClick={() => setExternalSkills(!externalSkills)}
        >
          <span className="sb-dot" style={{ background: 'var(--mu2)' }} />
          <span className="sb-label">External Skills</span>
          <span className="sidebar-count">{countFor(agents, (a) => a.externalSource === true)}</span>
        </button>
      </div>

      {isAdmin && pendingProposalCount > 0 && (
        <button type="button" className="sidebar-admin" onClick={onOpenProposals}>
          New categories <span className="sidebar-badge">{pendingProposalCount}</span>
        </button>
      )}
    </aside>
  );
}
