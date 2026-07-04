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
export function canEditDetails(agent, user, isAdmin) {
  if (!user) return false;
  const ds = agent?.deploymentStatus || 'none';
  if (ds === 'requested' || ds === 'approved') return false;
  if (isAdmin) return true;
  const email = (user.email || '').toLowerCase();
  return !!(email && Array.isArray(agent?.creatorEmails) && agent.creatorEmails.some((e) => (e || '').toLowerCase() === email));
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
      const hay = `${agent.agentName || ''} ${agent.owner || ''}`.toLowerCase();
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
