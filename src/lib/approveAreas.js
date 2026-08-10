import { agentProcessIds, splitRoles, agentCategories } from './agentUtils';
import { isInternalOrExternal } from './tier';

// ── Approver Areas (2026-08-10) ──────────────────────────────────────
// Replaces the old "approve area = SDLC stage (+ 'Business')" scheme, which
// was too coarse to be actionable and left a third of the library unroutable.
//
// WHY THE CHANGE — measured against the real 243-agent library, not assumed:
//
//  1. Stage is the wrong axis. The Build stage alone spans SEVEN unrelated
//     process owners (Delivery Manager 6.x · Business Analyst 7.x · UX/UI +
//     UX Writer 8.x · Developer 9.x/10.x · DevOps/Platform CI-CD +
//     Environment · Security/Performance Pen-Test + Perf-Test · Data). One
//     "Build approver" had to sign off both copywriting and penetration
//     testing.
//  2. 79 agents (33%) were Internal with no sdlcStage at all, so the old
//     resolver returned [] for them — no scoped approver could see them at
//     all; only admin/committee fullAccess did.
//  3. Approver coverage was 5 people over 4 stages; Build (61 agents, the
//     largest), Initiation, Post Development and Business had nobody.
//
// The areas below are derived from `sdlcProcesses.owner` (~20 distinct
// real values) cross-checked against relatedRole frequency (54 distinct
// values) — i.e. from what the org actually does, not a guessed taxonomy.
//
// Areas are a DIFFERENT AXIS from `category`, deliberately:
//   category = "what is this agent about"  (user-facing browse/filter)
//   area     = "whose expertise approves it" (routing)
// They agree on most of them; the rest need the fallback chain below. Do not
// collapse them into one list — that would mean deleting Investment /
// Lending & Credit, which are real browse categories with 44 agents between
// them but are business verticals, not disciplines.
//
// 2026-08-10 (same day, follow-up): "Architecture & Engineering" split into
// "Architecture" (design-level: high-level design, tech-lead-owned estimation
// — processes 4.1/4.2) and "Development" (hands-on coding: processes 9.1,
// 10.1-10.4, and all of 14.x per an explicit decision that "Deployment" means
// the whole 14.x process range, not a role). Measured against the live
// library before splitting: of the 54 agents then resolving to the combined
// area, only 3 touched 4.1/4.2 (2 mixed-role, 1 pure architecture — role
// "SA"), 19 touched 9.1/10.x (100% Developer/Backend/Frontend/Tech-Lead/
// DevOps roles doing actual dev work — e.g. a "Tech Lead"-titled agent was
// mapped to 10.3 Code Review, a coding activity, so PROCESS_AREA is trusted
// over role title here), and 32 had no process mapping at all and fell
// through category. That last group is also where a real bug lived: category
// "Software Development" pointed straight at the combined area, so 6 of 7
// DevOps Engineer agents landed there instead of "Platform, DevOps &
// Operations" (where the 7th, resolved via role alone, correctly went) —
// same role, two different answers, because category ran before role and
// won first. Nulling CATEGORY_AREA['Software Development'] (see layer 5)
// forces all of them through the role layer now, fixing this as a side
// effect of the split rather than a separate task.
export const AREA_ORDER = [
  'Business & Product',
  'Governance, Risk & Procurement',
  'Delivery Management',
  'Business Analysis',
  'UX Research',
  'UI & Visual Design',
  'Content & UX Writing',
  'Architecture',
  'Development',
  'Quality & Testing',
  'Security',
  'Platform, DevOps & Operations',
  'Data & Analytics',
];

// ── Layer 1: process id → area (most authoritative) ──────────────────
// Keyed by the id `agentProcessIds()` produces: a numeric id ("2.2", "14.2A")
// or, for the free-text entries, the cleaned display string. Free-text ids
// that contain a slash are listed BOTH ways because sdlc-migrate.cjs
// sanitises "/"→"_" for the Firestore doc id while extractProcessId() does
// not — an agent can carry either spelling.
//
// 18 of the 57 processes have an EMPTY `owner` in Firestore (all of Post
// Development, plus CI/CD, Environment Provisioning, NFR, Pen Test ×3, Perf
// Test ×2, Data ×3), so those rows are assigned here by discipline rather
// than derived. That is the whole reason this table is explicit data instead
// of a lookup through sdlcProcesses.owner at runtime.
export const PROCESS_AREA = {
  // Initiation
  '1.1': 'Business & Product',                    // owner: Business
  '1.2': 'Business & Product',                    // owner: Business
  '1.3': 'Governance, Risk & Procurement',        // owner: Procurement
  '1.4': 'Governance, Risk & Procurement',        // owner: Legal & Compliance
  '1.5': 'Business & Product',                    // owner: Product Owner
  '1.6': 'Governance, Risk & Procurement',        // owner: Project Review Committee, BU Lead, Platform Lead
  // Discovery
  '2.1': 'Business Analysis',                     // owner: Product Owner, Business Analyst
  '2.2': 'Business Analysis',                     // owner: Business Analyst
  // Design
  '3.1': 'UX Research',                           // owner: UX/UI (UX Researcher)
  '3.2': 'UI & Visual Design',                    // owner: UX/UI
  '3.3': 'UI & Visual Design',                    // owner: UX/UI
  '4.1': 'Architecture',                          // owner: Tech Lead, Squad Lead
  '4.2': 'Architecture',                          // owner: Squad Lead, Developer
  '5.1': 'Data & Analytics',                      // owner: data
  'Data Requirement Gathering': 'Data & Analytics',       // owner empty
  'DevOps': 'Platform, DevOps & Operations',              // owner empty
  // Build
  '6.1': 'Delivery Management',                   // owner: Delivery Manager
  '6.2': 'Delivery Management',                   // owner: Delivery Manager
  '7.1': 'Business Analysis',                     // owner: Business Analyst
  '7.2': 'Business Analysis',                     // owner: Business Analyst
  '7.3': 'Business Analysis',                     // owner: Business Analyst
  '7.4': 'Business Analysis',                     // owner: Business Analyst
  '8.1': 'UI & Visual Design',                    // owner: UX/UI
  '8.2': 'Content & UX Writing',                  // owner: UX/UI (UX Writer)
  '9.1': 'Development',                           // owner: Developer
  '10.1': 'Development',                          // owner: Developer
  '10.2': 'Development',                          // owner: Developer
  '10.3': 'Development',                          // owner: Developer
  '10.4': 'Development',                          // owner: Developer
  'NFR Gathering': 'Quality & Testing',                                  // owner empty
  'Performance Test Scripting': 'Quality & Testing',                     // owner empty
  'Performance Test Execution': 'Quality & Testing',                     // owner empty
  'Penetration Test Scenario Development': 'Security',                   // owner empty
  'Penetration Test Execution': 'Security',                              // owner empty
  'Penetration Test Report': 'Security',                                 // owner empty
  'Environment Provisioning': 'Platform, DevOps & Operations',           // owner empty
  'CI/CD Pipeline Development': 'Platform, DevOps & Operations',         // owner empty
  'CI_CD Pipeline Development': 'Platform, DevOps & Operations',         // sanitised doc-id spelling
  'Data Development': 'Data & Analytics',                                // owner empty
  'Data Test Support': 'Data & Analytics',                               // owner empty
  // Test
  '11.1': 'Quality & Testing',                    // owner: Test Management
  '11.2': 'Quality & Testing',                    // owner: Test Management
  '11.3': 'Quality & Testing',                    // owner: Test Management
  '12.1': 'Quality & Testing',                    // owner: SIT
  '12.2': 'Quality & Testing',                    // owner: SIT
  '13.1': 'Quality & Testing',                    // owner: UAT
  '13.2': 'Quality & Testing',                    // owner: UAT
  // Deployment — all of 14.x routes to Development per an explicit 2026-08-10
  // decision that "Deployment" as a scope means the whole 14.x process range,
  // not a literal role (no agent currently uses a "Deployment" role at all).
  // Zero live agents hit any of these six today, so this is forward-looking
  // config, not a migration.
  '14.1': 'Development',                          // owner: Developer
  '14.2A': 'Development',                         // owner: Developer, Deployment, Platform Lead
  '14.2B': 'Development',                         // owner: PO
  '14.3A': 'Development',                         // owner: Developer, Deployment, Platform Lead
  '14.3B': 'Development',                         // owner: PO
  '14.4': 'Development',                          // owner: Deployment
  // Post Development — every one of these has an empty owner
  'Incident Management': 'Platform, DevOps & Operations',
  'Problem Management': 'Platform, DevOps & Operations',
  'E2E Monitoring': 'Platform, DevOps & Operations',
  'Capacity Planning': 'Platform, DevOps & Operations',
  'FinOps': 'Platform, DevOps & Operations',
  'Capacity Monitoring': 'Platform, DevOps & Operations',
  'Self Repairing': 'Platform, DevOps & Operations',
};

// ── Layer 2: role → area, for roles whose area has NO category ───────
// Security and Data & Analytics are the two areas with no `category`
// counterpart at the time this shipped. Without this layer the category
// layer below silently swallows them: `Guardrail Agent` (Security Engineer)
// was landing in Delivery Management, and `3.safety.md` (Security Engineer)
// in Architecture & Engineering, purely because their category won first.
// Once enough agents carry the new Security / Data & Analytics categories
// this layer becomes redundant, but it must outrank category until then.
export const ROLE_FIRST_AREA = {
  'Security Engineer': 'Security',
  'Data Analyst': 'Data & Analytics',
  'Business Intelligence Analyst': 'Data & Analytics',
  'Data Engineer': 'Data & Analytics',
};

// ── Layer 3: category → area ─────────────────────────────────────────
// Covers 243/243 agents (vs sdlcStage's 139/243), which is what makes the
// orphan backfill possible at all. `null` marks a category that legitimately
// spans more than one area — it must fall through to the role layer rather
// than pick a side:
//   Software Development   → Architecture vs Development vs Platform (this
//                            category alone can't tell a coder from an
//                            architect from a DevOps engineer — see the file
//                            header for the DevOps Engineer bug this caused
//                            before it was nulled out here, 2026-08-10)
//   Requirements & Product → Business Analysis vs Business & Product
//   DevOps & Performance   → Platform/DevOps vs Quality (Performance lives
//                            in Quality per the 2026-08-10 decision)
//   Orchestration & Automation → genuinely cross-cutting; its top roles
//                            (Operations 6, AI Creator 3, UAT 2, Delivery
//                            Manager 2, CRM Manager 2) show no dominant
//                            discipline at all.
export const CATEGORY_AREA = {
  'Compliance & Governance': 'Governance, Risk & Procurement',
  'Design & UI': 'UI & Visual Design',
  'UX Research': 'UX Research',
  'Writing & Content': 'Content & UX Writing',
  'Testing & QA': 'Quality & Testing',
  'Project & Delivery': 'Delivery Management',
  'Investment': 'Business & Product',        // business vertical → discipline
  'Lending & Credit': 'Business & Product',  // business vertical → discipline
  'Security': 'Security',                    // added 2026-08-10
  'Data & Analytics': 'Data & Analytics',    // added 2026-08-10
  'Software Development': null,              // nulled 2026-08-10 — see note above
  'Requirements & Product': null,
  'DevOps & Performance': null,
  'Orchestration & Automation': null,
};

// ── Layer 4: role → area (tiebreak + last resort) ────────────────────
// Keys are the raw values seen in /config/schema.relatedRole and on agent
// docs. Some real entries carry zero-width characters ("Dev Lead​"), so
// callers must strip those before lookup — normRole() below does it.
export const ROLE_AREA = {
  // Business & Product
  'Product Manager': 'Business & Product',
  'PO': 'Business & Product',
  'Product Owner': 'Business & Product',
  'Credit Analyst': 'Business & Product',
  'Investment Advisor': 'Business & Product',
  'CRM Manager': 'Business & Product',
  'Marketing': 'Business & Product',
  'Strategist': 'Business & Product',
  'SME': 'Business & Product',
  'Support': 'Business & Product',
  'Customer Support': 'Business & Product',
  'Support Manager': 'Business & Product',
  // Governance
  'Compliance Officer': 'Governance, Risk & Procurement',
  'CIO': 'Governance, Risk & Procurement',
  // Delivery
  'Delivery Manager': 'Delivery Management',
  // Business Analysis
  'BA': 'Business Analysis',
  'Business Analyst': 'Business Analysis',
  'SA': 'Business Analysis',
  'Analyst': 'Business Analysis',
  // UX Research
  'UX Researcher': 'UX Research',
  // UI & Visual Design
  'UI Designer': 'UI & Visual Design',
  'UX Designer': 'UI & Visual Design',
  'Product Designer': 'UI & Visual Design',
  'Visual Designer': 'UI & Visual Design',
  'Graphic Designer': 'UI & Visual Design',
  'Design System Engineer': 'UI & Visual Design',
  // Content & UX Writing
  'UX Writer': 'Content & UX Writing',
  'Copywriter': 'Content & UX Writing',
  'Content Strategist': 'Content & UX Writing',
  'Content Manager': 'Content & UX Writing',
  'Content Analyst': 'Content & UX Writing',
  // Architecture (design-level — split from Development 2026-08-10)
  'System Architect': 'Architecture',
  'Software Architect': 'Architecture',
  'Tech Lead': 'Architecture',
  'Dev Lead': 'Architecture',
  // Development (hands-on coding — split from Architecture 2026-08-10)
  'Developer': 'Development',
  'Backend Engineer': 'Development',
  'Frontend Engineer': 'Development',
  'Front-End Developer': 'Development',
  'Full Stack': 'Development',    // no live agent uses this yet — added proactively
  'Full-Stack': 'Development',    // spelling variant, same reason
  'AI Engineer': 'Development',
  'AI Creator': 'Development',
  // Quality & Testing (Performance lives here, not with Security; Reviewer
  // moved here 2026-08-10 — all 4 current holders pair it with QA Engineer)
  'Tester': 'Quality & Testing',
  'QA': 'Quality & Testing',
  'QA Engineer': 'Quality & Testing',
  'Reviewer': 'Quality & Testing',
  'Performance Engineer': 'Quality & Testing',
  'UAT': 'Quality & Testing',
  'UAT Test': 'Quality & Testing',
  'Test management': 'Quality & Testing',
  // Platform, DevOps & Operations
  'DevOps Engineer': 'Platform, DevOps & Operations',
  'Operations': 'Platform, DevOps & Operations',
  'System': 'Platform, DevOps & Operations',
  'System Administrator': 'Platform, DevOps & Operations',
};

// Platform internals (internalTool === true — ALPHA's own prompt fragments
// and tool skills, flagged by functions/flag-internal.cjs) are not any
// discipline's work. They are routed here rather than left area-less: an
// empty area list is exactly the invisibility bug this whole change exists
// to fix, so nothing should ever deliberately produce one.
export const INTERNAL_TOOL_AREA = 'Platform, DevOps & Operations';

// Real agent data contains zero-width joiners/spaces inside role names
// ("Dev Lead​", "AIPhbt - Employment certificate​"), which silently
// break exact-match lookups. Same character class extractProcessId() strips.
export function normRole(r) {
  return String(r || '').replace(/[​‌‍﻿]/g, '').trim();
}

export function isKnownArea(a) {
  return AREA_ORDER.includes(a);
}

// ── The resolver ─────────────────────────────────────────────────────
// Single source of truth for "who may approve this agent". Callers must use
// this and never re-derive an area inline — same rule as normalizeProgress()
// and getType(), and for the same reason: the old stage-based logic was
// duplicated nowhere, which is precisely why it stayed broken for 79 agents
// without anyone noticing.
//
// Lives here rather than in tier.js on purpose: it needs agentUtils helpers,
// and agentUtils already imports tier.js — putting it in tier.js would make
// tier.js ⇄ agentUtils circular. Import direction stays one-way:
//   approveAreas → agentUtils → tier,  approveAreas → tier
//
// Layers, first non-empty wins:
//   1. stored agent.approveArea       — a human/AI decision; always wins
//   2. internalTool === true          — platform internals, not a discipline
//   3. sdlcProcessMapping → PROCESS_AREA   — most authoritative signal
//   4. relatedRole → ROLE_FIRST_AREA  — Security/Data, which have no category
//   5. category → categoryAreaOverrides, falling back to CATEGORY_AREA
//   6. relatedRole → ROLE_AREA        — tiebreak for the 4 null categories
//   7. External with nothing else     — Business & Product
//
// `categoryAreaOverrides` (optional, {categoryName: areaName}) exists for
// categories that didn't exist when CATEGORY_AREA was written — every
// category approved through CategoryApprovalPanel AFTER 2026-08-10 requires
// the admin to pick an area at approval time (see that component), and the
// choice is stored at /config/schema.categoryAreaMap rather than requiring a
// code change + redeploy for each new category. CATEGORY_AREA stays the
// baked-in table for the categories that existed at ship time; the live
// config only ever ADDS entries on top, never removes the code-level ones.
// Callers that don't have schema loaded (or pass nothing) get CATEGORY_AREA
// alone — same behaviour as before this existed, never worse.
//
// Returns a de-duplicated, stable-sorted array. An agent may legitimately
// span two areas (15 do — e.g. the Figma skills are both design and
// engineering work); the caller-side check is an INTERSECTION, so two areas
// means "either area's approver may sign off", which is the existing
// semantic, not a new one.
export function agentApproveAreas(agent, categoryAreaOverrides) {
  if (!agent) return [];

  // 1. Stored decision. Filtered against AREA_ORDER so a stale value left
  //    over from a renamed area can't silently make an agent unroutable.
  const stored = Array.isArray(agent.approveArea) ? agent.approveArea.filter(isKnownArea) : [];
  if (stored.length) return [...new Set(stored)].sort();

  // 2. ALPHA's own prompt fragments and tool skills.
  if (agent.internalTool === true) return [INTERNAL_TOOL_AREA];

  const add = (set, v) => { if (v) set.add(v); };

  // 3. Process mapping.
  const byProcess = new Set();
  agentProcessIds(agent).forEach((id) => add(byProcess, PROCESS_AREA[normRole(id)]));
  if (byProcess.size) return [...byProcess].sort();

  const roles = splitRoles(agent.relatedRole).map(normRole);

  // 4. Roles whose area has no category counterpart yet.
  const byRoleFirst = new Set();
  roles.forEach((r) => add(byRoleFirst, ROLE_FIRST_AREA[r]));
  if (byRoleFirst.size) return [...byRoleFirst].sort();

  // 5. Category — live overrides checked first so a newer admin decision can
  //    supersede a category that also happens to be in the baked-in table
  //    (shouldn't normally happen, but the override should win if it does).
  const overrides = categoryAreaOverrides || {};
  const cats = agentCategories(agent);
  const byCategory = new Set();
  cats.forEach((c) => {
    const override = isKnownArea(overrides[c]) ? overrides[c] : null;
    add(byCategory, override || CATEGORY_AREA[c]);
  });
  // 'Software Development' is deliberately null (too coarse to pick a side —
  // see CATEGORY_AREA's comment) and is very often paired with a REAL
  // category like 'Design & UI' on the same agent (the Figma design-to-code
  // skill pack: 8 agents, confirmed against live data 2026-08-10). Left as a
  // plain short-circuit, that pairing would silently drop the Development
  // signal a Developer/Frontend Engineer role carries, even though role
  // layer 6 below would happily supply it — the ONLY reason it never runs is
  // that byCategory already has a hit from the other category. So when
  // 'Software Development' is present alongside a resolved category, merge
  // in the role layer here rather than waiting for a fallback that will
  // never fire. Scoped to this one category on purpose: other ambiguous
  // categories (Requirements & Product, DevOps & Performance, Orchestration
  // & Automation) were reviewed and left as pure fallbacks in the prior
  // round — broadening this to "any ambiguous category" would reopen agents
  // outside today's Architecture & Engineering split (confirmed by testing
  // the general form against live data: it also touched 7 unrelated VD/DE
  // and Workshop agents that were explicitly out of scope here).
  if (byCategory.size && cats.includes('Software Development')) {
    const combined = new Set(byCategory);
    roles.forEach((r) => add(combined, ROLE_AREA[r]));
    return [...combined].sort();
  }
  if (byCategory.size) return [...byCategory].sort();

  // 6. Role.
  const byRole = new Set();
  roles.forEach((r) => add(byRole, ROLE_AREA[r]));
  if (byRole.size) return [...byRole].sort();

  // 7. Customer-facing work with no other signal is a business call.
  if (isInternalOrExternal(agent) === 'External') return ['Business & Product'];

  return [];
}
