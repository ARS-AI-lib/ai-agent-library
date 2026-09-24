// Role → Role group mapping for the Dashboard's "Role Coverage" view
// (2026-09-23).
//
// ── Where this comes from ──
// The `Role group` column of
//   https://docs.google.com/spreadsheets/d/1gp7Nn5c5QVHqcoRqTIYXPqC_prvV6Wl_B4PWFrI2VbQ
// That sheet's `Role` column is NOT a single role — it is an agent's whole
// `relatedRole` array joined with "; " (e.g. "UX Designer; UI Designer; UX
// Writer"), and each whole combination was hand-assigned a group. Two rows
// disagree with each other for that reason ("BA; PO" → Product owner but
// "PO; BA" → Business Analyst), and four rows have a blank Role with a group
// typed in by hand. So the sheet cannot be used as-is: this file is the
// per-role map derived from it, which is what the app can actually apply to
// one `relatedRole` entry at a time.
//
// ── Keys are normalized, not raw ──
// Keys go through aliasKey() (normRole + lowercase + no spaces/hyphens/dots). Real data carries zero-width
// characters — the sheet itself contains 'Dev Lead​' — so a raw-value map
// silently drops 'Dev Lead' while looking correct in the source. normRole()
// strips those; lowercasing absorbs the Operations/operations style drift.
//
// ── Roles the sheet has no row for ──
// The sheet covers 34 of the 54 role values in use; the rest were added by
// analogy (2026-09-23) and several were then re-decided by the user
// (2026-09-24) — see the alias table below, which is now the authority.

// ── An agent counts in EVERY group its roles map to ──
// A skill tagged ['UX Designer','UI Designer'] really is available to both
// roles, so excluding it from either card would answer "how many AI does my
// role have?" wrongly. Picking one winner would depend on array order, which
// is arbitrary — and the sheet contradicts itself on exactly that. This also
// matches groupAgents(agents, 'role') in agentUtils.js, so the Dashboard and
// the Library agree. The consequence is that the card totals sum to MORE than
// the number of documents; the view states that on screen.
import { splitRoles } from './agentUtils';
import { normRole } from './approveAreas';

// Display order / the authoritative group list — cards render in this order.
// Row-major 5x3, corrected 2026-09-23 to match the approved mock exactly
// (row1: UX/UI, Software Engineer, Product owner, Operations, Support function
//  row2: SIT, Business Users, Business Analyst, DevOps Engineer, Delivery Manager
//  row3: System, UAT, System Architect, Analyst, Security Engineer)
export const ROLE_GROUP_ORDER = [
  'UX/UI',
  'Software Engineer',
  'Product owner',
  'Operations',
  'Support function',
  'SIT',
  'Business Users',
  'Business Analyst',
  'DevOps Engineer',
  'Delivery Manager',
  'System',
  'UAT',
  'System Architect',
  'Analyst',
  'Security Engineer',
];

// Card headings. The KEY stays the sheet's value because that is what the
// mapping and every count are keyed on — only the rendered text changes.
// Renaming the keys would detach the whole table.
export const ROLE_GROUP_LABEL = {
  Operations: 'Operation',
  'Support function': 'Support Function',
  'Product owner': 'Product Owner',
  SIT: 'SIT-Tester',
  UAT: 'UAT-Tester',
};

export function roleGroupLabel(group) {
  return ROLE_GROUP_LABEL[group] || group;
}

// Alias table: every spelling that means the same role, grouped under the
// sheet's group key. Matching is EXACT after aliasKey() folds case, spaces,
// hyphens, dots and underscores ("Front-End Developer" = "frontend developer")
// — never substring: a "contains Dev" rule would send "DevOps Engineer" to
// Software Engineer. A new spelling that shows up in the data must be added
// here explicitly (the Dashboard shows it as missing from every card until then).
//
// ── Groups the user defined on 2026-09-24 (override the sheet) ──
//   Product owner    = PO, Product Owner, Product Manager
//   Delivery Manager = DM, Delivery/Project Manager, PM, Scrum, Scrum Master,
//                      Agile Practitioner (+ Lead) — project management work
//   UAT              = QA, QA Engineer, UAT, Quality Assessment (+ UAT Test,
//                      Test management from the sheet, Reviewer moved here)
//   SIT              = Tester, SIT
//   Software Engineer= Dev, Developer, Programmer, Fullstack, Backend,
//                      Frontend, Tech Coach, Software Engineer (+ the sheet's
//                      AI Engineer / Dev Lead / Tech Lead / SA / Performance Engineer)
// "PM" is Project Manager here by the user's decision; Product Manager is only
// matched by its full name.
const RAW = {
  'UX/UI': ['UX Designer', 'UX Writer', 'UI Designer', 'UX Researcher', 'Product Designer', 'Visual Designer', 'Graphic Designer', 'Design System Engineer', 'Copywriter'],
  'Software Engineer': [
    'Software Engineer', 'Dev', 'Developer', 'Programmer', 'Programer',
    'Fullstack', 'Full Stack Engineer', 'Full Stack Developer',
    'Backend', 'Backend Engineer', 'Backend Developer',
    'Frontend', 'Frontend Engineer', 'Front-End Developer',
    'Tech Coach', 'Tech Lead', 'Dev Lead', 'AI Engineer', 'Performance Engineer', 'SA',
  ],
  'Product owner': ['PO', 'Product Owner', 'Product Manager'],
  'Delivery Manager': ['Delivery Manager', 'DM', 'Project Manager', 'PM', 'Scrum', 'Scrum Master', 'Agile Practitioner', 'Agile Practitioner Lead'],
  UAT: ['QA', 'QA Engineer', 'UAT', 'UAT Test', 'Quality Assessment', 'Test management', 'Reviewer'],
  SIT: ['Tester', 'SIT'],
  Analyst: ['Analyst', 'Credit Analyst', 'Data Analyst', 'Business Intelligence Analyst'],
  'Business Analyst': ['BA'],
  'Business Users': ['CIO', 'Compliance Officer', 'Content Analyst', 'Content Manager', 'CRM Manager', 'Investment Advisor', 'Strategist', 'Content Strategist'],
  'DevOps Engineer': ['DevOps Engineer'],
  Operations: ['Operations'],
  'Security Engineer': ['Security Engineer'],
  'Support function': ['AI Creator', 'Customer Support', 'Marketing', 'Support', 'Support Manager', 'SME'],
  System: ['System', 'System Administrator'],
  'System Architect': ['System Architect', 'Software Architect'],
};

// normRole() strips the zero-width characters real data carries ('Dev Lead​');
// the rest folds the spelling variants listed above onto one key.
const aliasKey = (r) => normRole(r).toLowerCase().replace(/[\s\-_.]+/g, '');

export const ROLE_GROUP = (() => {
  const out = {};
  Object.entries(RAW).forEach(([group, roles]) => roles.forEach((r) => {
    const k = aliasKey(r);
    if (out[k] && out[k] !== group) throw new Error(`roleGroups: "${r}" is listed under both ${out[k]} and ${group}`);
    if (k) out[k] = group;
  }));
  return out;
})();

/** The group of one raw `relatedRole` entry, or undefined. */
export function roleGroupOf(role) {
  return ROLE_GROUP[aliasKey(role)];
}

/**
 * Every role group an agent belongs to, deduped. Uses splitRoles() so the
 * array form (209 docs) and the legacy comma/slash string form (65 docs) are
 * handled by the one function that owns that rule.
 */
export function roleGroupsOf(agent) {
  return [...new Set(splitRoles(agent?.relatedRole).map(roleGroupOf).filter(Boolean))];
}

// ── Config-driven groups (2026-09-24) ─────────────────────────────────
// Since Role Group Management, /config/roleGroups is the source of truth:
// { groups: [{ key, label, roles, definition }] } in card order. Everything
// above is now only the FALLBACK used until that doc loads (or if it is ever
// missing) — the seed script wrote exactly these values. Read groups through
// useRoleGroups() + buildRoleGroupIndex(); do not add groups here.
export const FALLBACK_ROLE_GROUPS = ROLE_GROUP_ORDER.map((key) => ({
  key,
  label: roleGroupLabel(key),
  roles: RAW[key] || [],
}));

/** Lookup helpers for one group list (config or fallback). */
export function buildRoleGroupIndex(groups) {
  const list = Array.isArray(groups) && groups.length ? groups : FALLBACK_ROLE_GROUPS;
  const byRole = {};
  const labels = {};
  list.forEach((g) => {
    labels[g.key] = g.label || g.key;
    (g.roles || []).forEach((r) => { const k = aliasKey(r); if (k && !byRole[k]) byRole[k] = g.key; });
  });
  const order = list.map((g) => g.key);
  return {
    groups: list,
    order,
    has: (key) => order.includes(key),
    labelOf: (key) => labels[key] || key,
    groupOfRole: (role) => byRole[aliasKey(role)],
    groupsOf: (agent) => [...new Set(splitRoles(agent?.relatedRole).map((r) => byRole[aliasKey(r)]).filter(Boolean))],
  };
}
