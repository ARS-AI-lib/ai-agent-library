import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { useApprovedAgents, usePendingAgents, useDeploymentRequests } from './hooks/useAgents';
import { useConfigSchema } from './hooks/useConfigSchema';
import { buildAgentFilter, uniq, splitRoles, isMyAgent } from './lib/agentUtils';
import { getType } from './lib/tier';
import { ALLOWED_DOMAINS_LABEL } from './lib/firebase';
import { agentStatus } from './lib/status';
import { hasDirectoryToken, syncDirectoryToFirestore } from './lib/directory';

import Nav from './components/Nav';
import StatusLegend from './components/StatusLegend';
import ControlBar from './components/ControlBar';
import CardGrid from './components/CardGrid';
import AgentDetailModal from './components/AgentDetailModal';
import PreRegModal from './components/PreRegModal';
import PendingApprovalModal from './components/PendingApprovalModal';
import ChatAssistant from './components/ChatAssistant';
import UserManagementModal from './components/UserManagementModal';
import ExportDataModal from './components/ExportDataModal';
import EditAgentModal from './components/EditAgentModal';
import SDLCTab from './components/SDLCTab';

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

function LoginScreen({ onSignIn, error }) {
  return (
    <div className="signin-page">
      <div className="signin-bgpattern" aria-hidden="true" />
      <div className="signin-card">
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>AI Agent Library</h1>
        {error && <div className="msg error" style={{ maxWidth: 380 }}><span className="dot" style={{ background: '#ea4335' }} />{error}</div>}
        <button className="signin-google-btn" onClick={onSignIn}>
          <GoogleGlyph />
          Sign in with Google
        </button>
        <p className="signin-domain-hint">เข้าสู่ระบบด้วยบัญชี {ALLOWED_DOMAINS_LABEL}</p>
      </div>
      <div className="signin-footer">
        <span>Copyright © 2026 Arise by Infinitas Co., Ltd. All rights reserved.</span>
        <span className="signin-footer-brand">Powered by Wolfy<img className="signin-footer-logo" src="/wolfy-logo.png" alt="Wolfy" /></span>
      </div>
    </div>
  );
}

export default function App() {
  const { user, role, approveAreas, loading, roleReady, domainError, canSubmitIdea, isAdmin, isCommittee, canManageUsers, signIn, signOut } = useAuth();
  // Gate agent subscriptions on the role doc existing — avoids a permanent
  // permission-denied race on a brand-new user's first login (see useAgents).
  const { agents, loading: agentsLoading } = useApprovedAgents(!!role);
  const { pending } = usePendingAgents(!!role);
  const { deployRequests } = useDeploymentRequests(!!role);
  const { schema } = useConfigSchema();

  // Admin-only, once-per-login directory sync (see src/lib/directory.js):
  // piggybacks on the admin's own Google OAuth token (captured at sign-in) to
  // pull the Workspace directory and cache it in Firestore for everyone else
  // to read — no-op (silently) for non-admins or if the token's unavailable.
  const directorySyncedRef = useRef(false);
  useEffect(() => {
    if (!isAdmin || !user || directorySyncedRef.current || !hasDirectoryToken()) return;
    directorySyncedRef.current = true;
    syncDirectoryToFirestore().catch(() => {});
  }, [isAdmin, user]);

  const [search, setSearch] = useState('');
  const [view, setView] = useState('by-role');
  const [owner, setOwner] = useState(new Set());
  const [role_, setRole_] = useState(new Set());
  const [ability, setAbility] = useState(new Set());
  const [tier, setTier] = useState(new Set());
  const [type, setType] = useState('all');
  const [reusable, setReusable] = useState(new Set());
  const [selectedStatus, setSelectedStatus] = useState(new Set());

  const [selectedAgent, setSelectedAgent] = useState(null);
  const [showPreReg, setShowPreReg] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [myAI, setMyAI] = useState(false);
  const [editingAgent, setEditingAgent] = useState(null);
  const [activeTab, setActiveTab] = useState('lib');
  const [signInError, setSignInError] = useState('');
  const [sdlcVisAgents, setSdlcVisAgents] = useState([]);

  const ownerOptions = useMemo(() => uniq(agents.map((a) => a.owner)).sort(), [agents]);
  const roleOptions = useMemo(() => uniq(agents.flatMap((a) => splitRoles(a.relatedRole))).sort(), [agents]);
  const abilityOptions = useMemo(
    () => uniq(agents.flatMap((a) => (Array.isArray(a.coreAbility) ? a.coreAbility : [a.coreAbility]))).sort(),
    [agents]
  );
  const reusableOptions = useMemo(
    () => uniq(agents.map((a) => a.reusable).filter(Boolean)).sort(),
    [agents]
  );

  const filtered = useMemo(() => {
    let pred = buildAgentFilter({ type, owner, role: role_, ability, tier, reusable, search });
    let result = agents.filter(pred);
    if (selectedStatus.size > 0) {
      result = result.filter((a) => selectedStatus.has(agentStatus(a)));
    }
    if (myAI) {
      result = result.filter((a) => isMyAgent(a, user));
    }
    return result;
  }, [agents, type, owner, role_, ability, tier, reusable, search, selectedStatus, myAI, user]);

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
          {(pending.length + deployRequests.length) > 0 && <span className="btn-legend-badge">{pending.length + deployRequests.length}</span>}
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
    setView('by-role');
    setOwner(new Set());
    setRole_(new Set());
    setAbility(new Set());
    setTier(new Set());
    setType('all');
    setReusable(new Set());
    setSelectedStatus(new Set());
    setSearch('');
  }

  async function handleSignIn() {
    setSignInError('');
    try {
      await signIn();
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
        myAI={myAI}
        onToggleMyAI={() => setMyAI((v) => !v)}
        onOpenExport={() => setShowExport(true)}
      />

      <ChatAssistant approvedAgents={agents} onOpenPreReg={() => setShowPreReg(true)} onOpenAgent={setSelectedAgent} />

      {activeTab === 'lib' && (
        <>
          <StatusLegend agents={filtered} actions={legendActions} onStatusClick={setSelectedStatus} selectedStatus={selectedStatus} />

          <ControlBar
            view={view} setView={setView}
            ownerOptions={ownerOptions} owner={owner} setOwner={setOwner}
            roleOptions={roleOptions} role={role_} setRole={setRole_}
            abilityOptions={abilityOptions} ability={ability} setAbility={setAbility}
            tier={tier} setTier={setTier}
            type={type} setType={setType}
            reusableOptions={reusableOptions} reusable={reusable} setReusable={setReusable}
            onClear={clearFilters}
          />

          <div className="main">
            {agentsLoading ? (
              <div className="empty-state">Loading…</div>
            ) : (
              <CardGrid agents={filtered} allAgents={agents} view={view} onCardClick={setSelectedAgent} />
            )}
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
        />
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
        isAdmin={isAdmin || isCommittee}
        onEditAgent={setEditingAgent}
      />

      {editingAgent && (
        <EditAgentModal
          agent={editingAgent}
          onClose={() => setEditingAgent(null)}
          onSaved={() => setSelectedAgent(null)}
          user={user}
          abilityOptions={abilityOptions}
          roleOptions={roleOptions}
        />
      )}

      {showPreReg && (
        <PreRegModal
          onClose={() => setShowPreReg(false)}
          approvedAgents={agents}
          schema={schema}
          user={user}
          onSubmitted={() => {}}
        />
      )}

      {showPending && canSubmitIdea && (
        <PendingApprovalModal
          pending={pending}
          deployRequests={deployRequests}
          onClose={() => setShowPending(false)}
          user={user}
          isAdmin={isAdmin}
          isCommittee={isCommittee}
          approveAreas={approveAreas}
          agents={agents}
        />
      )}

      {showUsers && canManageUsers && (
        <UserManagementModal
          onClose={() => setShowUsers(false)}
          schema={schema}
          currentUid={user?.uid}
        />
      )}

      {showExport && (
        <ExportDataModal
          onClose={() => setShowExport(false)}
          approvedAgents={agents}
          user={user}
          role={role}
          isAdmin={isAdmin}
          isCommittee={isCommittee}
          approveAreas={approveAreas}
        />
      )}
    </div>
  );
}
