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
// Keys are `normRole(value).toLowerCase()`. Real data carries zero-width
// characters — the sheet itself contains 'Dev Lead​' — so a raw-value map
// silently drops 'Dev Lead' while looking correct in the source. normRole()
// strips those; lowercasing absorbs the Operations/operations style drift.
//
// ── The 19 roles the sheet has no row for ──
// Measured against live Firestore: the sheet covers 34 of the 54 role values in
// use, leaving 24 docs in no group at all and the Product owner card empty
// (the sheet has the group but no `PO` row). Each addition below is inferred
// from a combination the sheet DOES map, never invented:
//   UI Designer, UX Researcher, Product Designer, Visual Designer,
//   Graphic Designer, Design System Engineer, Copywriter → UX/UI
//     ("UX Designer; UI Designer; UX Writer" → UX/UI puts all design/writing
//      tokens in one group)
//   QA Engineer, Reviewer → Software Engineer  ("QA Engineer; Reviewer" → SE)
//   PO, Product Manager → Product owner        (group exists, token missing)
//   QA → SIT                                   ("Tester" → SIT)
//   Front-End Developer, Full Stack Engineer → Software Engineer
//   Software Architect → System Architect
//   Agile Practitioner Lead → Delivery Manager
//   Business Intelligence Analyst → Analyst    (Data/Credit Analyst → Analyst)
//   SME → Support function                     ("AI Creator; SME" → Support function)
//   Content Strategist → Business Users        (Content Analyst/Manager → Business Users)
// Result: 0 unmapped roles, 0 docs without a group, 15 groups.
//
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

// Display order / the authoritative group list. Cards are sorted by count at
// render time; this is the tie-breaker and the reference list.
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

const RAW = {
  // ── from the sheet, single-role rows ──
  'UX/UI': ['UX Designer', 'UX Writer'],
  'Software Engineer': ['AI Engineer', 'Backend Engineer', 'Dev Lead', 'Developer', 'Frontend Engineer', 'Performance Engineer', 'SA', 'Tech Lead'],
  Analyst: ['Analyst', 'Credit Analyst', 'Data Analyst'],
  'Business Analyst': ['BA'],
  'Business Users': ['CIO', 'Compliance Officer', 'Content Analyst', 'Content Manager', 'CRM Manager', 'Investment Advisor', 'Strategist'],
  'Delivery Manager': ['Delivery Manager'],
  'DevOps Engineer': ['DevOps Engineer'],
  Operations: ['Operations'],
  'Security Engineer': ['Security Engineer'],
  SIT: ['Tester'],
  'Support function': ['AI Creator', 'Customer Support', 'Marketing', 'Support', 'Support Manager'],
  System: ['System', 'System Administrator'],
  'System Architect': ['System Architect'],
  UAT: ['Test management', 'UAT', 'UAT Test'],
  // ── added here (see header) ──
  __added: {
    'UX/UI': ['UI Designer', 'UX Researcher', 'Product Designer', 'Visual Designer', 'Graphic Designer', 'Design System Engineer', 'Copywriter'],
    'Software Engineer': ['QA Engineer', 'Reviewer', 'Front-End Developer', 'Full Stack Engineer'],
    'Product owner': ['PO', 'Product Manager'],
    SIT: ['QA'],
    'System Architect': ['Software Architect'],
    'Delivery Manager': ['Agile Practitioner Lead'],
    Analyst: ['Business Intelligence Analyst'],
    'Support function': ['SME'],
    'Business Users': ['Content Strategist'],
  },
};

const key = (r) => normRole(r).toLowerCase();

export const ROLE_GROUP = (() => {
  const out = {};
  const add = (group, roles) => roles.forEach((r) => { if (key(r)) out[key(r)] = group; });
  Object.entries(RAW).forEach(([group, roles]) => { if (group !== '__added') add(group, roles); });
  Object.entries(RAW.__added).forEach(([group, roles]) => add(group, roles));
  return out;
})();

/** The single role of one raw `relatedRole` entry, or undefined. */
export function roleGroupOf(role) {
  return ROLE_GROUP[key(role)];
}

/**
 * Every role group an agent belongs to, deduped. Uses splitRoles() so the
 * array form (209 docs) and the legacy comma/slash string form (65 docs) are
 * handled by the one function that owns that rule.
 */
export function roleGroupsOf(agent) {
  return [...new Set(splitRoles(agent?.relatedRole).map(roleGroupOf).filter(Boolean))];
}
