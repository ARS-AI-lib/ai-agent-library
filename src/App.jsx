import { useEffect, useMemo, useState, useRef } from 'react';
import { doc, onSnapshot, collection, query, where } from 'firebase/firestore';
import { db } from './lib/firebase';
import { useAuth } from './hooks/useAuth';
import { useApprovedAgents, usePendingAgents, useDeploymentRequests } from './hooks/useAgents';
import { useConfigSchema } from './hooks/useConfigSchema';
import { buildAgentFilter, uniq, splitRoles, isMyAgent, isPairedSubSkill } from './lib/agentUtils';
import { getType } from './lib/tier';
import { queueViewer, pendingBadgeCount } from './lib/pendingQueue';
import { recordSearchHits } from './lib/agentEvents';
import { useAgentStats } from './hooks/useAgentStats';
import { ALLOWED_DOMAINS_LABEL } from './lib/firebase';
import { agentStatus } from './lib/status';

import LoginScreen from './components/LoginScreen';
import Nav from './components/Nav';
import Sidebar from './components/Sidebar';
import StatusLegend from './components/StatusLegend';
import ControlBar from './components/ControlBar';
import CardGrid from './components/CardGrid';
import CategoryApprovalPanel from './components/CategoryApprovalPanel';
import AgentDetailModal from './components/AgentDetailModal';
import PreRegModal from './components/PreRegModal';
import PendingApprovalModal from './components/PendingApprovalModal';
import ChatAssistant from './components/ChatAssistant';
import UserManagementModal from './components/UserManagementModal';
import ExportDataModal from './components/ExportDataModal';
import RoleGroupManagerModal from './components/RoleGroupManagerModal';
import UploadEndpointFileModal from './components/UploadEndpointFileModal';
import EditAgentModal from './components/EditAgentModal';
import SDLCTab from './components/SDLCTab';
import DashboardTab from './components/DashboardTab';

export default function App() {
  const { user, role, approveAreas, loading, roleReady, domainError, canSubmitIdea, isAdmin, isCommittee, canManageUsers, signIn, signOut } = useAuth();
  // Gate agent subscriptions on the role doc existing — avoids a permanent
  // permission-denied race on a brand-new user's first login (see useAgents).
  // `agents` excludes archived entries (grid/search/Dashboard/Timeline all read
  // it). `allAgents` keeps them, for the three places where retired work still
  // matters: export audit trail, duplicate warnings, and the chat assistant's
  // background context. See useApprovedAgents.
  const { agents, allAgents, loading: agentsLoading } = useApprovedAgents(!!role);
  const { pending } = usePendingAgents(!!role);
  const { deployRequests } = useDeploymentRequests(!!role);
  const { schema, addRelatedRoles, addTeams } = useConfigSchema(!!role);
  // Usage counters + rating histogram, one subscription for the whole grid.
  const statsById = useAgentStats(!!role);

  // Directory sync is no longer auto-run at login: the People API scope is now
  // requested on-demand only when an admin clicks "Sync directory now" in User
  // Management (src/lib/directory.js). Everyone reads the Firestore-cached
  // directory, so nothing needs to happen here at startup.

  // Timeline access allowlist (for showing the hamburger menu item only).
  // Read-only here; the actual page re-checks the same list before rendering.
  // NOTE: this state MUST be declared before the effect + canSeeTimeline below
  // that reference it — otherwise the render body hits a const TDZ (crash).
  const [timelineViewers, setTimelineViewers] = useState([]);
  useEffect(() => {
    if (!role) return;
    const unsub = onSnapshot(doc(db, 'config', 'timeline'), (snap) => {
      setTimelineViewers(snap.exists() ? (snap.data().viewers || []) : []);
    }, () => setTimelineViewers([]));
    return unsub;
  }, [role]);
  const canSeeTimeline = !!user && (isAdmin || timelineViewers.map((e) => (e || '').toLowerCase()).includes((user.email || '').toLowerCase()));

  // Dashboard access (2026-07-07): high roles see it automatically; regular
  // users can be granted via /config/dashboard.viewers[] (same pattern as
  // Timeline). Rules already cover /config/dashboard via the /config/{id}
  // block (read: known user, write: admin) — no rules change needed.
  const [dashboardViewers, setDashboardViewers] = useState([]);
  useEffect(() => {
    if (!role) return;
    const unsub = onSnapshot(doc(db, 'config', 'dashboard'), (snap) => {
      setDashboardViewers(snap.exists() ? (snap.data().viewers || []) : []);
    }, () => setDashboardViewers([]));
    return unsub;
  }, [role]);
  const canSeeDashboard = !!user && (
    ['staff', 'approver', 'committee', 'admin'].includes(role)
    || dashboardViewers.map((e) => (e || '').toLowerCase()).includes((user.email || '').toLowerCase())
  );

  // Endpoint file upload (2026-08-18). Role gate only — the AGENT gate (deploy
  // approved, plus Approve Area for non-admins) lives in the modal and, for
  // real, in the attachEndpointFile callable. Note this menu entry can be
  // visible while the list inside is empty: staff currently hold no
  // approveAreas at all, so the modal tells them that rather than the menu
  // pretending the feature doesn't exist.
  // 2026-08-19: any signed-in user may open this — a base-'user' CREATOR must
  // be able to attach a file to their own agent (measured: 8 such creators own
  // a deploy-approved agent). The modal's own list, and checkAgentActor()
  // server-side, decide which agents they actually see.
  const canUploadFiles = !!user && !!role;
  // Agent/Skill Usage (2026-08-26). Plain role gating — the roles were named
  // exactly, so unlike Timeline/Dashboard there is no /config allowlist. The
  // callable re-checks this and additionally scopes staff/approver to their
  // own Approve Areas; hiding the menu is presentation, never enforcement.
  const canSeeUsage = !!user && ['admin', 'committee', 'staff', 'approver'].includes(role);

  // Workshop board (2026-09) — a dedicated 'workshop' role (participants) plus
  // staff+ (facilitators). 'workshop' otherwise behaves exactly like 'user'
  // everywhere else in this file — this is the only gate that references it.
  const canSeeWorkshop = !!user && ['admin', 'committee', 'staff', 'workshop'].includes(role);

  // Pending Category proposals (2026-08) — admin-only badge/panel; the query
  // itself is fine for isKnownUser() per rules, but there's no reason for a
  // non-admin client to subscribe to something it can't act on.
  const [pendingProposalCount, setPendingProposalCount] = useState(0);
  useEffect(() => {
    if (!isAdmin) { setPendingProposalCount(0); return; }
    const q = query(collection(db, 'categoryProposals'), where('status', '==', 'pending'));
    const unsub = onSnapshot(q, (snap) => setPendingProposalCount(snap.size), () => setPendingProposalCount(0));
    return unsub;
  }, [isAdmin]);

  const [search, setSearch] = useState('');
  const [view, setView] = useState('by-category');
  const [sort, setSort] = useState('created'); // reset on reload, same as view — not persisted (locked 2026-08-20)
  const [owner, setOwner] = useState(new Set());
  const [role_, setRole_] = useState(new Set());
  // Grouping follows the filter (2026-08-20). Picking an Owner or Role — or a
  // Category in the sidebar — while the grid is grouped By Category produces a
  // view whose headers no longer answer the question just asked: filter by one
  // category and every card lands under a single header; filter by owner and
  // the owner you chose is nowhere in the headings. Switching to By Owner puts
  // the useful axis back. Done at the setter (not in an effect) so it fires
  // only on a real user action and never fights a manual VIEW change
  // afterwards — same pattern as the sidebar group-exclusivity below.
  function handleSetOwner(next) {
    setOwner(next);
    if (next.size > 0) setView('by-owner');
  }
  function handleSetRole(next) {
    setRole_(next);
    if (next.size > 0) setView('by-owner');
  }
  const [tier, setTier] = useState(new Set());
  const [type, setType] = useState('all');
  const [reusable, setReusable] = useState(new Set());
  const [hasEndpoint, setHasEndpoint] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState(new Set());
  // Left sidebar shortcuts (2026-08) — separate state from the ControlBar
  // filters above. Only ONE sidebar group may be active at a time (2026-08-07
  // revision, explicit user request): picking in Category clears Stage and
  // Platform Tools, and vice versa — AND only ever applies WITHIN a group
  // (multi-select there stays OR), never ACROSS groups. buildAgentFilter()
  // itself still ANDs category/stage/platformTools together, so this
  // exclusivity is enforced here at the setter level, not in the predicate.
  const [category, setCategory] = useState(new Set());
  const [stage, setStage] = useState(new Set());
  const [platformTools, setPlatformTools] = useState(false);
  function handleSetCategory(next) {
    setCategory(next);
    if (next.size > 0) { setStage(new Set()); setPlatformTools(false); setView('by-owner'); }
  }
  function handleSetStage(next) {
    setStage(next);
    if (next.size > 0) { setCategory(new Set()); setPlatformTools(false); }
  }
  function handleSetPlatformTools(next) {
    setPlatformTools(next);
    if (next) { setCategory(new Set()); setStage(new Set()); }
  }
  const [showCategoryProposals, setShowCategoryProposals] = useState(false);

  const [selectedAgent, setSelectedAgent] = useState(null);
  const [showPreReg, setShowPreReg] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showRoleGroups, setShowRoleGroups] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [myAI, setMyAI] = useState(false);

  // Deep links from Teams notifications (2026-09-28): ?agent=<id> opens that
  // agent's detail, ?view=pending opens the approval queue. Consumed once after
  // agents load, then stripped so a refresh doesn't re-open it. An id that is
  // not in the library (still pending) falls back to the queue.
  const deepLinkDone = useRef(false);
  useEffect(() => {
    if (deepLinkDone.current || !role || agentsLoading) return;
    deepLinkDone.current = true;
    const q = new URLSearchParams(window.location.search);
    const id = q.get('agent');
    const view = q.get('view');
    if (!id && !view) return;
    const hit = id ? (allAgents || []).find((a) => a.id === id) : null;
    if (hit) setSelectedAgent(hit);
    else if (view === 'pending' || id) setShowPending(true);
    window.history.replaceState(null, '', window.location.pathname);
  }, [role, agentsLoading, allAgents]);
  const [editingAgent, setEditingAgent] = useState(null);
  const [activeTab, setActiveTab] = useState('lib');
  const [signInError, setSignInError] = useState('');
  const [sdlcVisAgents, setSdlcVisAgents] = useState([]);

  // Unioned with /config/schema.team (2026-08-10) so the Owner filter can
  // select a real org team even before any agent is tagged with it yet —
  // same reasoning as PreRegModal's Owner autocomplete.
  const ownerOptions = useMemo(
    () => uniq([...(schema.team || []), ...agents.map((a) => a.owner)]).sort(),
    [agents, schema.team]
  );
  // Merges roles already in use on agents with any newly-typed roles persisted
  // to /config/schema.relatedRole (2026-07-06) — a role someone just typed
  // shows up for everyone immediately, even before any agent uses it.
  const roleOptions = useMemo(
    () => uniq([...agents.flatMap((a) => splitRoles(a.relatedRole)), ...(schema.relatedRole || [])]).sort(),
    [agents, schema.relatedRole]
  );
  // Filter options merge BOTH sources — the values agents actually carry AND
  // the configured choices in /config/schema — the same way roleOptions above
  // already did. Deriving from agent data alone meant a newly configured
  // choice stayed invisible in the filter until some agent happened to use it,
  // so an admin adding "UI Generation" saw nothing change and had no way to
  // tell whether the config had even saved. relatedRole was already correct;
  // coreAbility and reusable were simply never updated to match.
  const abilityOptions = useMemo(
    () => uniq([
      ...agents.flatMap((a) => (Array.isArray(a.coreAbility) ? a.coreAbility : [a.coreAbility])),
      ...(schema.coreAbility || []),
    ].filter(Boolean)).sort(),
    [agents, schema.coreAbility]
  );
  const reusableOptions = useMemo(
    () => uniq([...agents.map((a) => a.reusable), ...(schema.reusable || [])].filter(Boolean)).sort(),
    [agents, schema.reusable]
  );

  // Paired sub-skills are cascaded to deploymentStatus 'requested' alongside
  // their parent Agent, but must never count/show as separate deploy requests
  // — the parent represents the whole package (2026-07-06).
  const parentDeployRequests = useMemo(
    () => deployRequests.filter((a) => !isPairedSubSkill(a, agents)),
    [deployRequests, agents]
  );

  // The Pending badge must count EXACTLY what PendingApprovalModal will list.
  // It used to count every pending item and deploy request regardless of area,
  // so a scoped approver saw a number, opened the queue, and found nothing —
  // the badge was counting other areas' work (2026-08-12). Both now derive
  // from src/lib/pendingQueue.js rather than each filtering on their own.
  const queueViewerCtx = useMemo(
    () => queueViewer({ isAdmin, isCommittee, role, approveAreas, uid: user?.uid, email: user?.email, categoryAreaMap: schema.categoryAreaMap }),
    [isAdmin, isCommittee, role, approveAreas, user?.uid, user?.email, schema.categoryAreaMap]
  );
  // Rename requests are the third queue and were missing from this count
  // entirely (2026-08-20) — a request appeared inside the modal with no badge
  // to lead anyone there. Subscribed here, not only in the modal, precisely so
  // the badge can see it; PendingApprovalModal takes it as a prop rather than
  // opening a second identical listener.
  const [renameReqs, setRenameReqs] = useState([]);
  useEffect(() => {
    if (!role) return undefined;
    const q = query(collection(db, 'renameRequests'), where('status', '==', 'pending'));
    const unsub = onSnapshot(
      q,
      (snap) => setRenameReqs(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setRenameReqs([]),
    );
    return unsub;
  }, [role]);
  const pendingCount = useMemo(
    () => pendingBadgeCount(pending, deployRequests, renameReqs, agents, queueViewerCtx),
    [pending, deployRequests, renameReqs, agents, queueViewerCtx]
  );

  const filtered = useMemo(() => {
    let pred = buildAgentFilter({ type, owner, role: role_, tier, reusable, hasEndpoint, category, stage, platformTools, search });
    let result = agents.filter(pred);
    if (selectedStatus.size > 0) {
      result = result.filter((a) => selectedStatus.has(agentStatus(a)));
    }
    if (myAI) {
      result = result.filter((a) => isMyAgent(a, user));
    }
    return result;
  }, [agents, type, owner, role_, tier, reusable, hasEndpoint, category, stage, platformTools, search, selectedStatus, myAI, user]);

  // Count "the catalogue surfaced this for a search someone actually made"
  // (2026-08-18). Three guards, because a naive version of this is worse than
  // no metric at all:
  //   · >= 3 chars — a search for "a" matches nearly the whole library and
  //     would inflate every agent equally, which is noise dressed as data.
  //   · debounced 800ms — the list re-filters on every keystroke; without this
  //     typing "figma" would count 5 different result sets.
  //   · top 10 only (inside recordSearchHits) — nobody considered result #47.
  // Server-side per-user-per-day dedup then turns it into "this many people
  // met this agent through search today".
  useEffect(() => {
    const q = search.trim();
    if (q.length < 3 || activeTab !== 'lib') return undefined;
    const t = setTimeout(() => recordSearchHits(filtered.map((a) => a.id)), 800);
    return () => clearTimeout(t);
  }, [search, activeTab, filtered]);

  const agentCount = filtered.filter((a) => getType(a) === 'agent').length;
  const skillCount = filtered.filter((a) => getType(a) === 'skill').length;

  // Nav chips reflect whichever tab is active — SDLC tab has its own local filters
  // (Owner/Role/Process Owner/Has-agent), separate from the Agent Library control bar above.
  const navAgentCount = activeTab === 'sdlc'
    ? sdlcVisAgents.filter((a) => getType(a) === 'agent').length
    : agentCount;
  const navSkillCount = activeTab === 'sdlc'
    ? sdlcVisAgents.filter((a) => getType(a) === 'skill').length
    : skillCount;

  const legendActions = (
    <>
      {canSubmitIdea && (
        <button className="btn-legend new" onClick={() => setShowPreReg(true)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New
        </button>
      )}
      {canSubmitIdea && (
        <button className="btn-legend pending" onClick={() => setShowPending(true)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" />
          </svg>
          Pending
          {pendingCount > 0 && <span className="btn-legend-badge">{pendingCount}</span>}
        </button>
      )}
      {canManageUsers && (
        <button className="btn-legend pending" onClick={() => setShowUsers(true)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          Users
        </button>
      )}
    </>
  );

  function clearFilters() {
    setView('by-category');
    setSort('created');
    setOwner(new Set());
    setRole_(new Set());
    setTier(new Set());
    setType('all');
    setReusable(new Set());
    setHasEndpoint(false);
    setSelectedStatus(new Set());
    setCategory(new Set());
    setStage(new Set());
    setPlatformTools(false);
    setSearch('');
  }

  async function handleSignIn(testEmail) {
    setSignInError('');
    try {
      await signIn(typeof testEmail === 'string' ? testEmail : undefined);
    } catch (e) {
      setSignInError(e.message);
    }
  }

  if (loading) {
    return (
      <div className="center-screen">
        <div className="spin" />
        <span>Loading…</span>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onSignIn={handleSignIn} error={signInError} />;
  }

  if (domainError) {
    return (
      <LoginScreen
        onSignIn={handleSignIn}
        error={`อีเมลนี้ไม่อยู่ใน domain ที่อนุญาต (${ALLOWED_DOMAINS_LABEL})`}
      />
    );
  }

  // Role doc still resolving (incl. the post-login retry window / first-time
  // auto-provisioning) — show a spinner, NOT the alarming "no access" screen.
  if (!roleReady) {
    return (
      <div className="center-screen">
        <div className="spin" />
        <span>กำลังเตรียมพื้นที่ทำงาน…</span>
      </div>
    );
  }

  if (!role) {
    return (
      <div className="center-screen">
        <h1 style={{ fontSize: 18 }}>ยังไม่ได้รับสิทธิ์เข้าใช้งาน</h1>
        <p style={{ color: 'var(--mu)', fontSize: 13 }}>
          บัญชี {user.email} ยังไม่มี role กำหนดไว้ — ติดต่อ admin เพื่อขอสิทธิ์
        </p>
        <button className="btnclr" style={{ width: 'auto', padding: '7px 16px' }} onClick={signOut}>Sign out</button>
      </div>
    );
  }

  return (
    <div>
      <Nav
        search={search}
        setSearch={setSearch}
        agentCount={navAgentCount}
        skillCount={navSkillCount}
        user={user}
        onSignOut={signOut}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenExport={() => setShowExport(true)}
        onOpenRoleGroups={() => setShowRoleGroups(true)}
        canManageRoleGroups={isAdmin || isCommittee}
        onOpenUpload={() => setShowUpload(true)}
        canUploadFiles={canUploadFiles}
        canSeeTimeline={canSeeTimeline}
        canSeeUsage={canSeeUsage}
        canSeeWorkshop={canSeeWorkshop}
        isAdmin={isAdmin}
        canSeeDashboard={canSeeDashboard}
      />

      <ChatAssistant approvedAgents={agents} allAgents={allAgents} onOpenPreReg={() => setShowPreReg(true)} onOpenAgent={setSelectedAgent} />

      {activeTab === 'lib' && (
        <>
          <StatusLegend agents={filtered} actions={legendActions} onStatusClick={setSelectedStatus} selectedStatus={selectedStatus} />

          <ControlBar
            view={view} setView={setView}
            sort={sort} setSort={setSort}
            ownerOptions={ownerOptions} owner={owner} setOwner={handleSetOwner}
            roleOptions={roleOptions} role={role_} setRole={handleSetRole}
            tier={tier} setTier={setTier}
            type={type} setType={setType}
            reusableOptions={reusableOptions} reusable={reusable} setReusable={setReusable}
            hasEndpoint={hasEndpoint} setHasEndpoint={setHasEndpoint}
            onClear={clearFilters}
          />

          <div className="main-row">
            <Sidebar
              agents={agents}
              categoryOptions={schema.category || []}
              category={category} setCategory={handleSetCategory}
              stageOptions={schema.sdlcStage || []}
              stage={stage} setStage={handleSetStage}
              platformTools={platformTools} setPlatformTools={handleSetPlatformTools}
              myAI={myAI} onToggleMyAI={() => setMyAI((v) => !v)}
              isAdmin={isAdmin}
              pendingProposalCount={pendingProposalCount}
              onOpenProposals={() => setShowCategoryProposals(true)}
            />
            <div className="main">
              {agentsLoading ? (
                <div className="empty-state">Loading…</div>
              ) : (
                <CardGrid agents={filtered} allAgents={agents} view={view} sort={sort} onCardClick={setSelectedAgent} statsById={statsById} />
              )}
            </div>
          </div>
        </>
      )}

      {activeTab === 'sdlc' && (
        <SDLCTab
          agents={agents}
          search={search}
          onVisibleAgentsChange={setSdlcVisAgents}
          onAgentClick={setSelectedAgent}
          legendActions={legendActions}
          schema={schema}
        />
      )}

      {activeTab === 'dash' && canSeeDashboard && (
        <DashboardTab agents={agents} onAgentClick={setSelectedAgent} />
      )}

      {/* key=agent.id forces a full remount on every agent switch — without
          it, local edit-mode state (editing/editProgress/confirmingDeploy…)
          survives across agents and can render a stale edit form the newly
          selected agent isn't actually eligible for (2026-07-03 bug). */}
      <AgentDetailModal
        key={selectedAgent?.id || 'none'}
        agent={selectedAgent}
        allAgents={agents}
        onClose={() => setSelectedAgent(null)}
        user={user}
        userRole={role}
        isAdmin={isAdmin}
        onEditAgent={setEditingAgent}
        approveAreas={approveAreas}
        schema={schema}
      />

      {editingAgent && (
        <EditAgentModal
          agent={editingAgent}
          allAgents={agents}
          onClose={() => setEditingAgent(null)}
          onSaved={() => setSelectedAgent(null)}
          user={user}
          userRole={role}
          isAdmin={isAdmin}
          schema={schema}
          abilityOptions={abilityOptions}
          roleOptions={roleOptions}
          onAddRelatedRole={addRelatedRoles}
          lockProgress={isPairedSubSkill(editingAgent, agents)}
        />
      )}

      {showPreReg && (
        <PreRegModal
          onClose={() => setShowPreReg(false)}
          approvedAgents={agents}
          allAgents={allAgents}
          schema={schema}
          user={user}
          onSubmitted={() => {}}
          onAddRelatedRole={addRelatedRoles}
          onAddTeam={addTeams}
        />
      )}

      {showPending && canSubmitIdea && (
        <PendingApprovalModal
          pending={pending}
          deployRequests={parentDeployRequests}
          renameReqs={renameReqs}
          onClose={() => setShowPending(false)}
          user={user}
          userRole={role}
          isAdmin={isAdmin}
          isCommittee={isCommittee}
          approveAreas={approveAreas}
          agents={agents}
          schema={schema}
        />
      )}

      {showUsers && canManageUsers && (
        <UserManagementModal
          onClose={() => setShowUsers(false)}
          schema={schema}
          currentUid={user?.uid}
        />
      )}

      {showCategoryProposals && isAdmin && (
        <CategoryApprovalPanel onClose={() => setShowCategoryProposals(false)} user={user} schema={schema} />
      )}

      {showRoleGroups && (isAdmin || isCommittee) && (
        <RoleGroupManagerModal onClose={() => setShowRoleGroups(false)} agents={agents} schema={schema} isAdmin={isAdmin} />
      )}

      {showExport && (
        <ExportDataModal
          onClose={() => setShowExport(false)}
          // Export is the audit trail — archived entries must stay in it, with
          // an Archived column so a reader can tell them apart.
          approvedAgents={allAgents}
          user={user}
          role={role}
          isAdmin={isAdmin}
          isCommittee={isCommittee}
          approveAreas={approveAreas}
          schema={schema}
        />
      )}

      {showUpload && (
        <UploadEndpointFileModal
          onClose={() => setShowUpload(false)}
          // allAgents, not the filtered view: the modal applies its own
          // eligibility rule (deploy-approved + area) and must not inherit
          // whatever the user happens to have typed in the search box.
          agents={allAgents}
          role={role}
          isAdmin={isAdmin}
          approveAreas={approveAreas}
          user={user}
        />
      )}
    </div>
  );
}
