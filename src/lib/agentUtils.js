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

export function fmtDate(d) {
  if (!d) return '';
  try {
    const dt = d?.toDate ? d.toDate() : new Date(d);
    if (isNaN(dt)) return String(d);
    return dt.toLocaleDateString('en-GB', { year: '2-digit', month: 'short', day: 'numeric' });
  } catch {
    return String(d);
  }
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

export function agentsOfSkill(skill) {
  return matchingAgentNames(skill);
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

// The full skill docs that are paired sub-skills of `agent` (for cascading
// writes from the parent). `agent` is expected to be an Agent, not a Skill.
export function pairedSubSkills(agent, allAgents) {
  if (!agent || getType(agent) !== 'agent') return [];
  return allAgents.filter((s) =>
    getType(s) === 'skill'
    && s.id !== agent.id
    && sameSubmitter(s, agent)
    && matchingAgentNames(s).includes(agent.agentName)
  );
}

// Is THIS skill a locked paired sub-skill of some Agent in the library?
export function isPairedSubSkill(skill, allAgents) {
  if (!skill || getType(skill) !== 'skill') return false;
  const parents = matchingAgentNames(skill);
  if (!parents.length) return false;
  return allAgents.some((a) =>
    getType(a) === 'agent'
    && sameSubmitter(skill, a)
    && parents.includes(a.agentName)
  );
}

export function relationshipLabel(agent, allAgents) {
  if (getType(agent) === 'skill') {
    const n = agentsOfSkill(agent).length;
    return n > 0 ? { count: n, label: n === 1 ? '1 Agent' : `${n} Agents` } : null;
  }
  const n = skillsOfAgent(agent, allAgents).length;
  return n > 0 ? { count: n, label: n === 1 ? '1 Skill' : `${n} Skills` } : null;
}

/**
 * Builds the predicate used by both the card grid and the counters —
 * mirrors `tOk()` from the original dashboard.
 */
export function buildAgentFilter({ type, owner, role, ability, tier, reusable, search }) {
  return (agent) => {
    if (type !== 'all' && getType(agent) !== type) return false;
    if (tier && tier.size > 0 && !tier.has(getTier(agent))) return false;
    if (owner && owner.size > 0 && !owner.has(agent.owner || '')) return false;
    if (role && role.size > 0) {
      const roles = splitRoles(agent.relatedRole);
      if (!roles.some((r) => role.has(r))) return false;
    }
    if (ability && ability.size > 0) {
      const abilities = Array.isArray(agent.coreAbility) ? agent.coreAbility : [agent.coreAbility];
      if (!abilities.some((a) => ability.has(a))) return false;
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
  // owner (department/team)
  const groups = uniq(agents.map((a) => a.owner || '')).sort();
  const byGroup = (g) => agents.filter((a) => (a.owner || '') === g);
  return { groups, byGroup };
}
