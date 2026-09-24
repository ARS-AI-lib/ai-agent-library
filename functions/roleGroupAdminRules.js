// Role Group Management (2026-09-24) — pure rules for the manageRoleGroups
// callable and the seed script. No Firestore / Vertex here, so
// verify-role-group.cjs can exercise every branch offline.
//
// /config/roleGroups is the source of truth for the group list:
//   { groups: [{ key, label, roles: [string], definition }], updatedAt, updatedBy }
// Array order = card order on the Dashboard. `key` never changes after
// creation (it is what agent.roleGroup stores); only `label` is editable.

// Seed = the groups as they were hard-coded until 2026-09-24 (roleGroups.js
// alias table + card labels + the per-group definitions from the v5 prompt).
// After seeding, edits happen in the UI; this list is only the starting point
// and the fallback when the config doc is missing.
const DEFAULT_ROLE_GROUPS = [
  { key: 'UX/UI', label: 'UX/UI', roles: ['UX Designer', 'UX Writer', 'UI Designer', 'UX Researcher', 'Product Designer', 'Visual Designer', 'Graphic Designer', 'Design System Engineer', 'Copywriter'], definition: 'designers, UX writers, UX researchers' },
  { key: 'Software Engineer', label: 'Software Engineer', roles: ['Software Engineer', 'Dev', 'Developer', 'Programmer', 'Programer', 'Fullstack', 'Full Stack Engineer', 'Full Stack Developer', 'Backend', 'Backend Engineer', 'Backend Developer', 'Frontend', 'Frontend Engineer', 'Front-End Developer', 'Tech Coach', 'Tech Lead', 'Dev Lead', 'AI Engineer', 'Performance Engineer', 'SA'], definition: 'developers of any stack, tech leads, AI engineers building software' },
  { key: 'Product owner', label: 'Product Owner', roles: ['PO', 'Product Owner', 'Product Manager'], definition: 'PO / product managers' },
  { key: 'Operations', label: 'Operation', roles: ['Operations'], definition: 'back-office document processing' },
  { key: 'Support function', label: 'Support Function', roles: ['AI Creator', 'Customer Support', 'Marketing', 'Support', 'Support Manager', 'SME'], definition: 'customer support, SME, marketing, AI creators AND customer-facing chatbots / conversational agents that serve bank customers' },
  { key: 'SIT', label: 'SIT-Tester', roles: ['Tester', 'SIT'], definition: 'system-integration testing; in this organisation the "Tester" role is the SIT-TQM team, so test-case/automation/defect tools for Testers are SIT' },
  { key: 'Business Users', label: 'Business Users', roles: ['CIO', 'Compliance Officer', 'Content Analyst', 'Content Manager', 'CRM Manager', 'Investment Advisor', 'Strategist', 'Content Strategist'], definition: 'business-side staff (investment, CRM, content, compliance)' },
  { key: 'Business Analyst', label: 'Business Analyst', roles: ['BA'], definition: 'BA writing requirements, epics, user stories' },
  { key: 'DevOps Engineer', label: 'DevOps Engineer', roles: ['DevOps Engineer'], definition: 'CI/CD, deployment, infrastructure' },
  { key: 'Delivery Manager', label: 'Delivery Manager', roles: ['Delivery Manager', 'DM', 'Project Manager', 'PM', 'Scrum', 'Scrum Master', 'Agile Practitioner', 'Agile Practitioner Lead'], definition: 'project, delivery, scrum management' },
  { key: 'System', label: 'System', roles: ['System', 'System Administrator'], definition: 'platform-internal tools with no human end user' },
  { key: 'UAT', label: 'UAT-Tester', roles: ['QA', 'QA Engineer', 'UAT', 'UAT Test', 'Quality Assessment', 'Test management', 'Reviewer'], definition: 'QA / user-acceptance / quality audits / PVT' },
  { key: 'System Architect', label: 'System Architect', roles: ['System Architect', 'Software Architect'], definition: 'solution/system architecture, API/HLD design' },
  { key: 'Analyst', label: 'Analyst', roles: ['Analyst', 'Credit Analyst', 'Data Analyst', 'Business Intelligence Analyst'], definition: 'credit, data, BI analysts' },
  { key: 'Security Engineer', label: 'Security Engineer', roles: ['Security Engineer'], definition: 'security' },
];

// Same fold as roleGroups.js aliasKey(): case, spaces, hyphens, dots, underscores.
const aliasKey = (r) => String(r || '').replace(/[​-‍﻿]/g, '').trim().toLowerCase().replace(/[\s\-_.]+/g, '');
const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Normalise + validate a full group list. Returns { groups } or { error }. */
function validateGroups(input) {
  if (!Array.isArray(input) || !input.length) return { error: 'At least one group is required.' };
  const keys = new Set();
  const labels = new Set();
  const roleOwner = new Map();
  const groups = [];
  for (const g of input) {
    const key = clean(g?.key, 60);
    const label = clean(g?.label, 60);
    const definition = clean(g?.definition, 400);
    if (!key) return { error: 'Group key is missing.' };
    if (!label) return { error: `Group "${key}" needs a label.` };
    if (!definition) return { error: `Group "${label}" needs a definition for AI.` };
    if (keys.has(key)) return { error: `Duplicate group key "${key}".` };
    if (labels.has(label.toLowerCase())) return { error: `Duplicate group name "${label}".` };
    keys.add(key);
    labels.add(label.toLowerCase());
    const roles = [];
    const seen = new Set();
    for (const r of Array.isArray(g.roles) ? g.roles : []) {
      const name = clean(r, 80);
      const k = aliasKey(name);
      if (!k || seen.has(k)) continue;
      if (roleOwner.has(k)) return { error: `Role "${name}" is already in group "${roleOwner.get(k)}".` };
      roleOwner.set(k, label);
      seen.add(k);
      roles.push(name);
    }
    groups.push({ key, label, roles, definition });
  }
  return { groups };
}

/** Stable key for a new group: slug of its label, made unique. */
function newGroupKey(label, existing) {
  const base = clean(label, 60) || 'Group';
  let key = base;
  let i = 2;
  const taken = new Set(existing.map((g) => g.key));
  while (taken.has(key)) key = `${base} ${i++}`;
  return key;
}

/**
 * Apply one management action to the current group list. Pure: returns
 * { groups, moves?: {from,to}, error? }. Agent writes are the caller's job.
 */
function applyAction(current, action) {
  const groups = current.map((g) => ({ ...g, roles: [...(g.roles || [])] }));
  const find = (k) => groups.findIndex((g) => g.key === k);
  switch (action?.type) {
    case 'upsertGroup': {
      const g = action.group || {};
      if (g.key && find(g.key) >= 0) {
        groups[find(g.key)] = { ...groups[find(g.key)], label: g.label, roles: g.roles, definition: g.definition };
      } else {
        groups.push({ key: newGroupKey(g.label, groups), label: g.label, roles: g.roles, definition: g.definition });
      }
      return validateGroups(groups);
    }
    case 'reorder': {
      const keys = Array.isArray(action.keys) ? action.keys : [];
      if (keys.length !== groups.length || !groups.every((g) => keys.includes(g.key))) {
        return { error: 'Reorder must list every group exactly once.' };
      }
      return validateGroups(keys.map((k) => groups[find(k)]));
    }
    case 'deleteGroup': {
      const i = find(action.key);
      if (i < 0) return { error: 'Group not found.' };
      if (groups.length === 1) return { error: 'Cannot delete the last group.' };
      if (!action.moveTo || action.moveTo === action.key || find(action.moveTo) < 0) {
        return { error: 'Choose another existing group to move its items to.' };
      }
      groups.splice(i, 1);
      const res = validateGroups(groups);
      return res.error ? res : { ...res, moves: { from: action.key, to: action.moveTo } };
    }
    default:
      return { error: 'Unknown action.' };
  }
}

/** Items a Re-classify may clear: AI-set only — anything a person moved stays. */
function reclassifyTargets(agents, key) {
  return agents.filter((a) => a.roleGroup === key && a.roleGroupSource !== 'admin'
    && a.approvalStatus === 'approved' && !a.archived);
}

module.exports = { DEFAULT_ROLE_GROUPS, aliasKey, validateGroups, newGroupKey, applyAction, reclassifyTargets };
