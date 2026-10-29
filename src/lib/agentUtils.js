import { getType, getTier } from './tier';

export function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

// Who may edit launchDate/devProgress on an agent: admin, whoever approved
// it, or any of the agent's creators. `creatorEmails` (array, can hold more
// than one person) is the primary check — it's populated straight from the
// Creator/Team-member picker at submit time, so it needs no UID/login
// backfill at all. `createdBy`/`approvedBy` are uids and stay as a fallback
// for docs where creatorEmails hasn't been backfilled yet.
export function canUpdateProgress(agent, user, isAdmin) {
  if (!user) return false;
  if (isAdmin) return true;
  const uid = user.uid;
  const email = (user.email || '').toLowerCase();
  if (email && Array.isArray(agent?.creatorEmails) && agent.creatorEmails.some((e) => (e || '').toLowerCase() === email)) return true;
  if (agent?.createdBy && agent.createdBy === uid) return true;
  if (agent?.approvedBy && agent.approvedBy === uid) return true;
  return false;
}

// Who may edit the broader detail set (name/description/scope/ability/role/
// creator/reusable/hml/launchDate/devProgress) on an already-approved agent:
// admin, or any of the agent's creators (creatorEmails). The deploy-request
// lock applies to EVERYONE, admin included — no bypass — since it's a
// workflow freeze (record under deploy review), not a permission check.
// Checked first, before the admin/creator branch. `rejected` (and `none`)
// stay editable — only `requested`/`approved` lock it (2026-07-03, revised
// same day to close the admin-bypass gap found in testing).
export function canEditDetails(agent, user, userRole, isAdmin) {
  if (!user) return false;
  const ds = agent?.deploymentStatus || 'none';
  if (ds === 'requested' || ds === 'approved') return false;
  // Tier A (2026-07-xx): staff/committee may edit the NON-sensitive detail
  // set (name/description/scope/ability/role/reusable/hml/input/output/
  // compatibleAgents) — but NOT launch date, progress, or creator. Those
  // sensitive fields stay Tier B (canUpdateProgress: admin/owner/creator/
  // approver), enforced both in EditAgentModal's payload and firestore.rules.
  if (userRole === 'staff' || userRole === 'committee') return true;
  // Tier B identities can also edit details (superset).
  return canUpdateProgress(agent, user, isAdmin);
}

// Who may edit the 3 SDLC metadata fields (sdlcStage/sdlcProcessMapping/
// useCase) on a doc that isn't under deploy review (2026-07-xx): the registrant
// (createdBy), or anyone with the staff/approver/admin role. Deliberately a
// DIFFERENT set from Tier A details — it EXCLUDES committee and creator-by-
// email (per explicit request). Enforced client-side (locks the fields) and in
// firestore.rules (dedicated sdlc branch).
export function canEditSDLC(agent, user, userRole, isAdmin) {
  if (!user) return false;
  const ds = agent?.deploymentStatus || 'none';
  if (ds === 'requested' || ds === 'approved') return false;
  if (isAdmin || userRole === 'staff' || userRole === 'approver') return true;
  return !!(agent?.createdBy && agent.createdBy === user.uid);
}

// Who may see/edit Approve Area on the Edit form (2026-08-11): admin or
// staff ONLY — narrower than canEditSDLC (which also allows approver and the
// agent's own createdBy). Approve Area decides who gets to approve/deploy an
// agent, so letting an approver or the submitter set their own routing would
// let either self-assign into (or out of) their own approval queue. Deploy
// freeze (deploymentStatus requested/approved) still applies the same as the
// rest of the SDLC group — checked by the caller via canEditSDLC's freeze,
// not duplicated here.
export function canEditApproveArea(userRole, isAdmin) {
  return !!(isAdmin || userRole === 'staff');
}

// Who may see/edit Category on the Edit form (2026-08-17): **admin only** —
// narrower even than canEditApproveArea (admin + staff). Category is normally
// AI-assigned at submit and is deliberately not hand-typed: it drives the
// sidebar browse shortcuts AND feeds layer 5 of agentApproveAreas(), so a
// free-for-all would let anyone re-route their own approval.
//
// The edit control this gates is a pick-from-list MultiSelect, never a
// free-add TagMultiSelect: an admin may re-file an agent under an EXISTING
// category but may not invent a name. New names still arrive only via the
// AI's proposed_new_category -> categoryProposals -> CategoryApprovalPanel
// flow, which is what keeps the taxonomy curated.
export function canEditCategory(userRole, isAdmin) {
  return !!isAdmin;
}

// Who may edit Owner on the Edit form (2026-09-23): **admin only, and only
// while the agent is not yet Ready to Use**.
//
// "Ready to Use" here is the badge the user actually sees on the card — the
// 'ru' bucket, which is devProgress >= 100 and nothing else. It is NOT
// deploymentStatus === 'approved' (the Tier A freeze): the two diverge, and
// the rule the user asked for is the one written on the card.
//
// Owner is free text, so this is deliberately a ComboInput over the owner
// names already in the library rather than a MultiSelect over an enum —
// unlike category, owner has never lived in /config/schema.
//
// No firestore.rules change backs this: the isAdmin() branch on /agents
// already allows any field, so the gate is UI-side, same posture as the
// approve/archive area scoping in §20.
export function canEditOwner(isAdmin, agent) {
  return !!isAdmin && normalizeProgress(agent?.devProgress) < 100;
}

// Ready-to-Use post-freeze exception (2026-07-22): canEditDetails() above
// freezes EVERY Tier A field once deploymentStatus is 'approved' — correct
// for the sensitive/structural fields, but it also blocks Description and
// Endpoint, which legitimately need touch-ups after go-live (e.g. adding the
// real endpoint link once the agent is actually live). Admin or the agent's
// creator(s) — NOT a bare approver, NOT staff/committee — may edit just those
// two fields, and only once deploymentStatus is 'approved' specifically
// (NOT 'requested': still under active review, stays fully frozen like
// everything else). Narrower than canUpdateProgress on purpose.
export function canEditReadyToUseFields(agent, user, isAdmin) {
  if (!user) return false;
  if (agent?.deploymentStatus !== 'approved') return false;
  if (isAdmin) return true;
  return isMyAgent(agent, user) || !!(agent?.createdBy && agent.createdBy === user.uid);
}

// ── Ready-to-Use actor test (2026-08-19) ──────────────────────────────
// "May this person flip the agent to 100%, and edit its endpoint / uploaded
// file?" — creator, an approver/staff whose Approve Area matches, or admin.
//
// ⚠️ PRESENTATION ONLY. The authority is functions/agentReadyRules.js
// (checkAgentActor), because the markAgentReady / attachEndpointFile callables
// are reachable by any signed-in user who knows their name. This exists so the
// UI doesn't offer a button that the server will refuse.
//
// `agentAreas` is passed in already resolved (the caller runs
// agentApproveAreas()) rather than resolved here, because approveAreas.js
// imports agentProcessIds/splitRoles/agentCategories FROM this module —
// importing it back would make the cycle real. Every call site already has the
// resolved list to hand for its own area checks.
//
// One deliberate asymmetry from the server: callers resolve through the full
// 7-layer chain while the server reads the STORED approveArea only (it cannot
// run that resolver). Stored is layer 1 and wins whenever present, and every
// deploy-approved agent has one, so the two agree today. If they ever diverge
// the client is the more permissive of the two — the safe direction, since the
// server still refuses.
export function canMarkAgentReady(agent, user, userRole, isAdmin, approveAreas, agentAreas) {
  if (!user || !agent) return false;
  if (isAdmin) return true;
  if (isMyAgent(agent, user)) return true;
  if (agent.createdBy && agent.createdBy === user.uid) return true;
  if (userRole !== 'approver' && userRole !== 'staff') return false;
  const mine = Array.isArray(approveAreas) ? approveAreas : [];
  if (!mine.length) return false;
  return (agentAreas || []).some((ar) => mine.includes(ar));
}

// Who may DECIDE a rename request — narrower on purpose: the creator files the
// request, so letting them approve it too would make the approval meaningless.
// Staff are excluded as well; approving a rename is an approver act, matching
// who decides deployment requests. Mirrors checkRenameDecider() server-side.
export function canDecideRename(userRole, isAdmin, approveAreas, agentAreas) {
  if (isAdmin) return true;
  if (userRole !== 'approver') return false;
  const mine = Array.isArray(approveAreas) ? approveAreas : [];
  if (!mine.length) return false;
  return (agentAreas || []).some((ar) => mine.includes(ar));
}

// "Is this MY agent?" (personal ownership, e.g. for the "My AI" filter/export)
// — reliable identity check via creatorEmails, same field the security rules
// and canUpdateProgress() already trust. NOT the same question as "what team
// am I on" — see isUserOnTeam() below for why those two use different fields.
export function isMyAgent(agent, user) {
  const email = (user?.email || '').toLowerCase();
  if (!email) return false;
  return Array.isArray(agent?.creatorEmails) && agent.creatorEmails.some((e) => (e || '').toLowerCase() === email);
}

// Team membership is derived by matching the free-text `creator` name field
// against `owner` (Team) on the SAME record — deliberately NOT creatorEmails.
// This is a locked decision (2026-07-03, see memory: feedback_team_derivation)
// — a user can be on multiple teams, and an admin can hand-fix membership by
// editing `creator` without touching security-relevant creatorEmails. Always
// derive fresh from the live agents list (no caching a stale team set).
export function deriveUserTeams(agents, displayName) {
  const name = (displayName || '').trim().toLowerCase();
  if (!name) return [];
  const owners = new Set();
  agents.forEach((a) => {
    const creators = splitRoles(a.creator).map((c) => c.toLowerCase());
    if (creators.includes(name) && a.owner) owners.add(a.owner);
  });
  return [...owners];
}

// relatedRole can be multi-value (array) or a comma/slash separated string —
// normalize to a flat array of trimmed role names.
export function splitRoles(role) {
  if (!role) return [];
  if (Array.isArray(role)) return role.map((r) => String(r).trim()).filter(Boolean);
  return String(role)
    .split(/[,/]/)
    .map((r) => r.trim())
    .filter(Boolean);
}

// sdlcProcessMapping stores a display string like "2.2 High-Level User Story
// Development" — extract just the leading process id (e.g. "2.2") for
// joining against sdlcProcesses.id. Moved here from SDLCTab.jsx (2026-07-02)
// once a second consumer (query_library chat skill) needed the same logic.
export function extractProcessId(s) {
  if (!s) return '';
  const t = String(s).replace(/[​‌‍﻿]/g, '').replace(/\s+/g, ' ').trim();
  const m = t.match(/^(\d+\.\d+[A-Za-z]?)\b/);
  return m ? m[1] : t;
}

export function agentProcessIds(agent) {
  if (!agent?.sdlcProcessMapping) return [];
  return String(agent.sdlcProcessMapping).split(',').map(extractProcessId).filter(Boolean);
}

// useCase (2026-07-22: single string -> multi-select array). Same
// String(...).split(',') trick as agentProcessIds — String(anArray) auto-joins
// with commas, so this reads correctly whether `agent.useCase` is the legacy
// single string (no migration needed for the ~144 pre-existing docs) or the
// new array. Single source of truth for every place that reads useCase.
export function agentUseCaseNames(agent) {
  if (!agent?.useCase) return [];
  return String(agent.useCase).split(',').map((s) => s.trim()).filter(Boolean);
}

// category (2026-08 sidebar shortcuts): array of string, one agent can belong
// to more than one domain (e.g. Figma Code Connect → Design & UI + Software
// Development). Assigned by AI at submit time / backfill, never hand-typed —
// see agent-skill-structured-horizon plan. Mirrors the agentUseCaseNames
// pattern (String(...).split(',') would also work for the legacy shape, but
// category was never stored as a comma string, so a plain array guard is
// enough — no legacy format to bridge).
export function agentCategories(agent) {
  return Array.isArray(agent?.category) ? agent.category.filter(Boolean) : [];
}

// sdlcStage on an agent doc is a multi-select array (form field), distinct
// from the /config/schema.sdlcStage OPTIONS list — this just reads the
// agent's own value defensively (some legacy docs may have missed migration).
export function agentStages(agent) {
  return Array.isArray(agent?.sdlcStage) ? agent.sdlcStage.filter(Boolean) : [];
}

// "4.1 High-Level Design" for a process with a real numeric SDLC id, but just
// "Performance Test Scripting" (no duplication) for the ~18 /sdlcProcesses
// docs added without one, where `id` was back-filled equal to `name` (2026-07
// data gap, not a code bug) — `${p.id} ${p.name}` would otherwise show the
// name twice for those. Single source of truth for every process-picker label.
export function processLabel(p) {
  if (!p) return '';
  const id = (p.id || '').trim();
  const name = (p.name || '').trim();
  if (!id || id.toLowerCase() === name.toLowerCase()) return name;
  return `${id} ${name}`.trim();
}

// devProgress is stored as a plain number since the 2026-07-02 migration —
// the old string format ("90%") is kept as a defensive fallback only, in
// case any doc was missed. Single source of truth (2026-07-06 improve pass):
// previously copy-pasted into useAgents.js, timeline.js and EditAgentModal.jsx.
export function normalizeProgress(raw) {
  const num = typeof raw === 'number' ? raw : parseInt(String(raw || '').replace('%', ''), 10);
  return isNaN(num) ? 0 : num;
}

// Parses a Firestore Timestamp / date string / Date into a plain JS Date, or
// null on anything unparseable. fmtDate and sortAgents share this rather than
// each re-deriving their own — launchDate alone carries 3 live shapes
// (Timestamp, a legacy "M/D/YYYY" string, and null/missing), so this is
// exactly the kind of parsing that drifts if copy-pasted (CLAUDE.md §6).
export function toJsDate(v) {
  if (!v) return null;
  try {
    const dt = v?.toDate ? v.toDate() : new Date(v);
    return isNaN(dt) ? null : dt;
  } catch {
    return null;
  }
}

export function fmtDate(d) {
  if (!d) return '';
  const dt = toJsDate(d);
  return dt ? dt.toLocaleDateString('en-GB', { year: '2-digit', month: 'short', day: 'numeric' }) : String(d);
}

// Card-grid sort control (2026-08-20 grilling session — locked decisions):
//   · applies WITHIN each VIEW group (Owner/Role/Ability), not instead of it
//   · Create/Launch Date default newest-first
//   · an agent with no Launch Date always sorts LAST regardless of direction
//     — it hasn't launched, so there is nothing to rank it by
//   · Name uses a locale compare (agent names mix Thai and English)
export const SORT_OPTIONS = [
  ['created', 'Create Date'],
  ['name', 'Name'],
  ['launch', 'Launch Date'],
];

export function sortAgents(agents, sortKey) {
  if (sortKey === 'created') {
    return [...agents].sort((a, b) => (toJsDate(b.createdAt)?.getTime() || 0) - (toJsDate(a.createdAt)?.getTime() || 0));
  }
  if (sortKey === 'launch') {
    return [...agents].sort((a, b) => {
      const da = toJsDate(a.launchDate);
      const db = toJsDate(b.launchDate);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return db.getTime() - da.getTime();
    });
  }
  return [...agents].sort((a, b) => (a.agentName || '').localeCompare(b.agentName || '', undefined, { sensitivity: 'base' }));
}

// `endpoint` (2026-07-22) is free text typed by a creator that we then render
// as a clickable link — so it MUST be sanitised at the point of rendering, not
// trusted from Firestore. Anything other than http/https (notably
// `javascript:` and `data:`) is rejected outright rather than "cleaned", since
// a permissive parse of a hostile scheme is exactly how these become XSS.
// A bare host ("wolfy-ai-library.web.app/x") is the common human input, so it
// gets an https:// prefix instead of being thrown away.
// Returns '' when there is nothing safe to link to — callers treat '' as
// "no endpoint" and render plain text / no icon.
export function safeEndpointUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.href;
  } catch {
    return '';
  }
}

// Short, readable label for an endpoint link (host + first path segment) so a
// long internal URL doesn't blow out the detail-modal layout.
export function endpointLabel(raw) {
  const href = safeEndpointUrl(raw);
  if (!href) return '';
  try {
    const u = new URL(href);
    const seg = u.pathname.split('/').filter(Boolean)[0];
    return seg ? `${u.host}/${seg}${u.pathname.split('/').filter(Boolean).length > 1 ? '/…' : ''}` : u.host;
  } catch {
    return href;
  }
}

// matchingAgent can be a comma-separated string or an array of agent names.
export function matchingAgentNames(agent) {
  const m = agent?.matchingAgent;
  if (!m) return [];
  if (Array.isArray(m)) return m.map((s) => String(s).trim()).filter(Boolean);
  return String(m)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function skillsOfAgent(agent, allAgents) {
  return allAgents
    .filter((s) => getType(s) === 'skill' && matchingAgentNames(s).includes(agent.agentName))
    .map((s) => s.agentName);
}

// Parent agents of a skill, by name. Union of the two link kinds (2026-09-30):
// matchingAgent (a stored NAME) and parent.childSkillIds (a doc ID — the one
// the Edit form writes). Reading only matchingAgent left ID-linked skills with
// an empty "Agent" row. With `allAgents`, names that no longer resolve (a
// renamed/removed parent) are dropped instead of shown as if they existed.
export function agentsOfSkill(skill, allAgents) {
  const names = matchingAgentNames(skill);
  if (!Array.isArray(allAgents) || !allAgents.length) return names;
  const live = new Set(allAgents.map((a) => a.agentName));
  const byId = allAgents.filter((a) => getType(a) === 'agent' && childSkillIdList(a).includes(skill?.id)).map((a) => a.agentName);
  return [...new Set([...names.filter((n) => live.has(n)), ...byId])];
}

// ── Paired sub-skill lock (2026-07-06) ───────────────────────────────
// A skill that was registered AS PART OF an Agent (Agent+Skill flow) is
// "locked" to that parent: it can't request deploy or edit progress on its
// own — its progress, launch date and deploy status all cascade from the
// parent Agent so the pair always moves together. matchingAgent pointing at
// the parent is required either way (an AI-suggested matchingAgent can point
// a standalone skill at an unrelated approved agent by name — that must stay
// independent). On top of that we need a "same submission batch" signal, and
// we accept EITHER same createdBy (uid) OR same creator (display name) —
// not createdBy alone. Some pairs (e.g. entries added via a Firestore
// console/script edit, or where the two docs' createdBy wasn't backfilled
// identically) have a blank/mismatched createdBy but an identical creator
// name; requiring only createdBy silently failed to lock/cascade those pairs
// (found 2026-07-06 testing the ALPHA chat assistant + capability_search
// pair). creator is the same free-text field relationshipLabel/deriveUserTeams
// already trust for identity, so this isn't a new trust boundary.
function sameSubmitter(a, b) {
  // OR, not "trust createdBy exclusively when present": two docs can each have
  // a createdBy yet differ (registered in separate sessions, or one backfilled
  // and one not) while still being the same person's paired submission. So a
  // createdBy match confirms the pair, but a createdBy MISMATCH must still fall
  // through to the creator-name check rather than reject outright (this was the
  // silent cascade failure found 2026-07-06: identical creator, different uid).
  if (a?.createdBy && b?.createdBy && a.createdBy === b.createdBy) return true;
  const ca = (a?.creator || '').trim().toLowerCase();
  const cb = (b?.creator || '').trim().toLowerCase();
  return !!ca && ca === cb;
}

// ── Explicit link (2026-08-20) ───────────────────────────────────────
// `agent.childSkillIds` is a list of skill DOC IDs the parent explicitly
// linked. It exists because the name+sameSubmitter heuristic below cannot
// express a deliberate cross-team link: measured on live data, a typical
// standalone skill passes sameSubmitter against only 1 of 53 agents (some
// against 0). Linking someone else's skill therefore LOOKED linked while
// every cascade silently did nothing.
//
// Two deliberate properties:
//   · Doc IDs, not names — unlike matchingAgent, this survives a rename, so
//     it does not inherit the detach-on-rename fragility (CLAUDE.md §25).
//   · Stored on the PARENT, not the child. firestore.rules Tier B gates on
//     isOwnerCreatorOrApprover(resource.data) of the doc being WRITTEN, so
//     one team cannot write onto another team's skill doc — and a
//     deploy-approved child is frozen outright. The parent always owns its
//     own doc, and multi-parent falls out for free (several agents may list
//     the same skill id), which is what "add a parent, never steal" needs.
export function childSkillIdList(agent) {
  return Array.isArray(agent?.childSkillIds) ? agent.childSkillIds.filter(Boolean) : [];
}

// The full skill docs that are paired sub-skills of `agent` (for cascading
// writes from the parent). `agent` is expected to be an Agent, not a Skill.
//
// UNION of the explicit link and the original heuristic — never a
// replacement. 51 existing pairings across 20 parents predate childSkillIds
// and have none, so dropping the heuristic would detach every one of them.
export function pairedSubSkills(agent, allAgents) {
  if (!agent || getType(agent) !== 'agent') return [];
  const linked = new Set(childSkillIdList(agent));
  return allAgents.filter((s) =>
    getType(s) === 'skill'
    && s.id !== agent.id
    && (
      linked.has(s.id)
      || (sameSubmitter(s, agent) && matchingAgentNames(s).includes(agent.agentName))
    )
  );
}

// Is THIS skill a locked paired sub-skill of some Agent in the library?
export function isPairedSubSkill(skill, allAgents) {
  if (!skill || getType(skill) !== 'skill') return false;
  const parents = matchingAgentNames(skill);
  return allAgents.some((a) => {
    if (getType(a) !== 'agent') return false;
    if (childSkillIdList(a).includes(skill.id)) return true;
    return parents.length > 0 && sameSubmitter(skill, a) && parents.includes(a.agentName);
  });
}

// ── Type label (2026-08-20) ──────────────────────────────────────────
// The single answer to "what type is this", so the card, the approval queue
// and the Edit form stop disagreeing.
//
// Before this, PendingApprovalModal read the raw aiAgent/skillMd flags while
// the card read getType(), and the 22 CSV-imported docs carrying BOTH flags
// therefore showed "Agent + Skill" in the queue and "AGENT" on the card.
// "Agent+Skill" now means exactly one thing everywhere — an Agent that has
// linked child skills — which is also what the Edit form's Type selector
// sets. getType()/getTier() keep their two-value meaning on purpose: tier
// must not shift for those 22 docs.
export function agentTypeLabel(agent, allAgents = []) {
  if (getType(agent) === 'skill') return 'Skill';
  return pairedSubSkills(agent, allAgents).length > 0 ? 'Agent+Skill' : 'Agent';
}

// ── Cascade guard (2026-08-20) ───────────────────────────────────────
// Which children a parent's progress/deploy write may actually touch.
//
// Linking an EXISTING skill means the child can be further along than the
// parent: of the 129 linkable standalone skills, 18 sit at 100% and 55 have
// their own endpoint. Cascading a fresh parent's 0% over those would erase
// finished work, so a child ahead of the parent is skipped rather than
// dragged backwards. Lives here, next to pairedSubSkills, so the five
// cascade call sites share one definition instead of five comparisons.
export function cascadeTargets(agent, allAgents) {
  const parentProgress = normalizeProgress(agent?.devProgress);
  const parentDeployed = (agent?.deploymentStatus || 'none') === 'approved';
  return pairedSubSkills(agent, allAgents).filter((s) => {
    if (normalizeProgress(s.devProgress) > parentProgress) return false;
    // A child already through deploy approval is likewise not dragged back by
    // a parent that has not been approved itself.
    if ((s.deploymentStatus || 'none') === 'approved' && !parentDeployed) return false;
    return true;
  });
}

export function relationshipLabel(agent, allAgents) {
  if (getType(agent) === 'skill') {
    const n = agentsOfSkill(agent, allAgents).length;
    return n > 0 ? { count: n, label: n === 1 ? '1 Agent' : `${n} Agents` } : null;
  }
  const n = skillsOfAgent(agent, allAgents).length;
  return n > 0 ? { count: n, label: n === 1 ? '1 Skill' : `${n} Skills` } : null;
}

/**
 * Builds the predicate used by both the card grid and the counters —
 * mirrors `tOk()` from the original dashboard.
 */
export function buildAgentFilter({ type, owner, role, tier, reusable, hasEndpoint, category, stage, platformTools, externalSkills, search }) {
  return (agent) => {
    if (type !== 'all' && getType(agent) !== type) return false;
    // Platform Tools shortcut (2026-08 sidebar) reuses the existing
    // internalTool flag (flag-internal.cjs) rather than a new field.
    if (platformTools && agent.internalTool !== true) return false;
    // External Skills: derived from the externalSource flag, never from category
    // (category routes approvers; this flag is user-set).
    if (externalSkills && agent.externalSource !== true) return false;
    // Category shortcut (2026-08 sidebar): OR within the selected categories,
    // same as role below — this whole predicate ANDs across groups.
    if (category && category.size > 0) {
      const cats = agentCategories(agent);
      if (!cats.some((c) => category.has(c))) return false;
    }
    if (stage && stage.size > 0) {
      const stages = agentStages(agent);
      if (!stages.some((s) => stage.has(s))) return false;
    }
    // "Has a usable link" toggle. Uses safeEndpointUrl rather than a bare
    // truthiness check so the filter agrees with what the UI actually renders —
    // an entry whose endpoint is present but unusable (a javascript:/data: URL
    // that safeEndpointUrl rejects, or whitespace) shows no link on the card,
    // so it must not pass a filter that promises one.
    if (hasEndpoint && !safeEndpointUrl(agent.endpoint)) return false;
    if (tier && tier.size > 0 && !tier.has(getTier(agent))) return false;
    if (owner && owner.size > 0 && !owner.has(agent.owner || '')) return false;
    if (role && role.size > 0) {
      const roles = splitRoles(agent.relatedRole);
      if (!roles.some((r) => role.has(r))) return false;
    }
    if (reusable && reusable.size > 0 && !reusable.has(agent.reusable || '')) return false;
    if (search) {
      const q = search.toLowerCase();
      const coreAbility = Array.isArray(agent.coreAbility) ? agent.coreAbility.join(' ') : (agent.coreAbility || '');
      const hay = `${agent.agentName || ''} ${agent.owner || ''} ${agent.description || ''} ${coreAbility} ${agent.relatedRole || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };
}

/**
 * Groups a filtered agent list by one of 'owner' | 'role' | 'ability'.
 * Role is multi-value, so an agent can appear under more than one group —
 * matches the original "By Role" view behaviour.
 */
export function groupAgents(agents, key) {
  if (key === 'role') {
    const groups = uniq(agents.flatMap((a) => splitRoles(a.relatedRole))).sort();
    const byGroup = (g) => agents.filter((a) => splitRoles(a.relatedRole).includes(g));
    return { groups, byGroup };
  }
  if (key === 'ability') {
    const groups = uniq(agents.flatMap((a) => (Array.isArray(a.coreAbility) ? a.coreAbility : [a.coreAbility]))).sort();
    const byGroup = (g) =>
      agents.filter((a) => (Array.isArray(a.coreAbility) ? a.coreAbility : [a.coreAbility]).includes(g));
    return { groups, byGroup };
  }
  // category (2026-08-20 — new default view): a mix of discipline + product
  // (§23), multi-valued, so an agent can land in more than one group —
  // same shape as role/ability.
  if (key === 'category') {
    const groups = uniq(agents.flatMap((a) => agentCategories(a))).sort();
    const byGroup = (g) => agents.filter((a) => agentCategories(a).includes(g));
    return { groups, byGroup };
  }
  // owner (department/team)
  const groups = uniq(agents.map((a) => a.owner || '')).sort();
  const byGroup = (g) => agents.filter((a) => (a.owner || '') === g);
  return { groups, byGroup };
}

// ── Decorative category colour (2026-08-08 redesign) ────────────────────
// Sidebar category rows carry a small colour dot purely for scanability.
// Categories are dynamic (/config/schema.category grows as admins approve
// proposals), so the colour CANNOT come from the option's index — approving
// one new category would re-colour every row below it, and users navigate
// this list by remembered colour position.
//
// A hash of the name is stable for the life of that name instead. Collisions
// are fine and expected: the dot is a scanning aid next to a text label, not
// an identifier. Returns a --c1..--c6 token, never a raw hex, so the ramp
// stays theme-aware (see theme.css).
export function categoryColor(name) {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return `var(--c${(Math.abs(h) % 6) + 1})`;
}

/**
 * Owner team names must be at least 2 characters (2026-10-04: a stray "8"
 * got into /config/schema.team). Single source of truth for the form checks
 * and for useConfigSchema.addTeams().
 */
export const MIN_TEAM_NAME = 2;
export function isValidTeamName(name) {
  return String(name ?? '').trim().length >= MIN_TEAM_NAME;
}

/** Case/space/zero-width-insensitive name key. Mirrors the Portfolio adoption
 *  rule (functions/portfolioAdoptionRules.js foldName) so both features fold
 *  names the same way. */
export function foldName(name) {
  return String(name || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Folded names of approved Library items that appear EXACTLY ONCE in the
 *  given list. A name shared by 2+ docs is ambiguous and is left out, so no
 *  sticker is ever starred for the wrong item. */
export function libraryStarNames(agents) {
  const count = new Map();
  for (const a of agents || []) {
    const key = foldName(a && a.agentName);
    if (!key) continue;
    count.set(key, (count.get(key) || 0) + 1);
  }
  const out = new Set();
  for (const [key, n] of count) if (n === 1) out.add(key);
  return out;
}

/** A Workshop sticker is starred only when it is Done AND its skill name
 *  matches exactly one Library item (Workshop library star, 2026-10-29). */
export function isLibraryStar(idea, starNames) {
  if (!idea || idea.status !== 'done') return false;
  const key = foldName(idea.skillName);
  return !!key && !!starNames && starNames.has(key);
}
