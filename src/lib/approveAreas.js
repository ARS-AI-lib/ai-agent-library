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
// 2026-08-10 (third revision, same day): "Quality & Testing" split into "SIT"
// and "QA", with its load/performance and code-quality work reassigned to
// Development and Security. Testing is not one discipline here — the org runs
// distinct teams per phase, and the `owner` field on the 31 agents that were
// in the combined area proves it cleanly: SIT-TQM 13 · arise-perf 6 · PQA 5 ·
// arise-reviewer 4 · Digital Experience Team 2 · Development 1. Rules:
//   Load/Performance test, Unit test*, Code scan*, IVT  → Development
//   SIT, Unit test*                                      → SIT
//   UAT, PQA, QA, PVT*                                   → QA
//   PVT* when tied directly to PO/BU                     → Business & Product
//   Pen test, Code scan*                                 → Security
// (* = decided per-agent from its details/input/output, not by name alone —
// e.g. `tester (QA)` sits on process 11.2 but its owner is "Development" and
// its output is unit/e2e test files, so it is Development, not SIT.)
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
  'SIT',
  'QA',
  'Security',
  'Platform, DevOps & Operations',
  'SRE & Reliability',
  'Incident & Problem Management',
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
  'NFR Gathering': 'Development',                                        // owner empty; NFR is the requirement side of load/perf → Development
  'Performance Test Scripting': 'Development',                           // owner empty; load/perf test → Development
  'Performance Test Execution': 'Development',                           // owner empty; load/perf test → Development
  'Penetration Test Scenario Development': 'Security',                   // owner empty
  'Penetration Test Execution': 'Security',                              // owner empty
  'Penetration Test Report': 'Security',                                 // owner empty
  'Environment Provisioning': 'Platform, DevOps & Operations',           // owner empty
  'CI/CD Pipeline Development': 'Platform, DevOps & Operations',         // owner empty
  'CI_CD Pipeline Development': 'Platform, DevOps & Operations',         // sanitised doc-id spelling
  'Data Development': 'Data & Analytics',                                // owner empty
  'Data Test Support': 'Data & Analytics',                               // owner empty
  // Test — 11.x is nominally "Test Management" in sdlcProcesses, but every
  // live agent on those three processes is owned by the SIT-TQM team and
  // carries the "Tester" role, so it routes to SIT rather than QA.
  '11.1': 'SIT',                                  // owner: Test Management (run by SIT-TQM here)
  '11.2': 'SIT',                                  // owner: Test Management (run by SIT-TQM here)
  '11.3': 'SIT',                                  // owner: Test Management (run by SIT-TQM here)
  '12.1': 'SIT',                                  // owner: SIT
  '12.2': 'SIT',                                  // owner: SIT
  '13.1': 'QA',                                   // owner: UAT
  '13.2': 'QA',                                   // owner: UAT
  // Deployment — "Deployment" as a scope means the whole 14.x process range
  // (2026-08-10), not a literal role; no agent uses a "Deployment" role.
  // REVISED later the same day: IVT stays Development, but PVT (14.2B/14.3B)
  // moved to QA — PVT is a user-acceptance-flavoured verification, and its
  // sdlcProcesses owner is "PO". A PVT agent tied DIRECTLY to PO/BU work
  // belongs in Business & Product instead; that is a per-agent call made from
  // its details, so it is a stored-approveArea override rather than a table
  // entry here. Zero live agents hit any of these six today — forward-looking
  // config, not a migration.
  '14.1': 'Development',                          // owner: Developer
  '14.2A': 'Development',                         // owner: Developer, Deployment, Platform Lead — IVT
  '14.2B': 'QA',                                  // owner: PO — PVT
  '14.3A': 'Development',                         // owner: Developer, Deployment, Platform Lead — IVT
  '14.3B': 'QA',                                  // owner: PO — PVT
  '14.4': 'Development',                          // owner: Deployment
  // Post Development (2026-08-10) — every one of these has an empty owner in
  // sdlcProcesses and ZERO live agents today, so these rows are pure
  // forward-looking config, split along the ITIL/SRE line the org actually
  // staffs: "keep it healthy and within budget" vs "something broke".
  // Platform, DevOps & Operations keeps the build-and-ship side (CI/CD,
  // Environment Provisioning, DevOps, 14.4 CAB) rather than run-the-service.
  'E2E Monitoring': 'SRE & Reliability',
  'Capacity Planning': 'SRE & Reliability',
  'Capacity Monitoring': 'SRE & Reliability',
  'Self Repairing': 'SRE & Reliability',
  'FinOps': 'SRE & Reliability',
  'Incident Management': 'Incident & Problem Management',
  'Problem Management': 'Incident & Problem Management',
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
// orphan backfill possible at all.
//
// REALIGNED 2026-08-10. As areas were split (Architecture/Development,
// SIT/QA, and the post-dev pair) the category list drifted badly out of step:
// five categories had to be nulled as "too coarse to pick a side", and they
// happened to be the five LARGEST (Software Development 81, Testing & QA 36,
// Requirements & Product 25, Orchestration & Automation 25, DevOps &
// Performance 20) — i.e. the resolver's most-used layer had become its least
// decisive. Six areas had no category at all.
//
// The list is now built on one rule: **every category maps to exactly one
// area, and there are no nulls.** Two kinds of category exist —
//   • discipline — 1:1 with an area; answers "what kind of work is this"
//   • business vertical — the bank's actual products; all route to
//     Business & Product, and exist because people browse by product
// A category that cannot satisfy the one-area rule does not belong in the
// list: 'Orchestration & Automation' was retired for exactly that reason
// (its agents were spread across 8 areas and 23 of its 25 already carried a
// second, more meaningful category), and 'Testing & QA' was replaced by the
// SIT/QA pair it had been masking.
//
// Consequence worth knowing: because there are no nulls, the category layer
// is now fully decisive and the MERGE_ROLE_CATEGORIES workaround that layer 5
// needed while they existed has been removed (see the resolver below).
export const CATEGORY_AREA = {
  // ── Discipline: 1:1 with an area ──
  'Compliance & Governance': 'Governance, Risk & Procurement',
  'Project & Delivery': 'Delivery Management',
  'Requirements & Product': 'Business Analysis',
  'UX Research': 'UX Research',
  'Design & UI': 'UI & Visual Design',
  'Writing & Content': 'Content & UX Writing',
  'Architecture': 'Architecture',                              // added 2026-08-10
  'Software Development': 'Development',                       // now unambiguous: Architecture split out
  'SIT': 'SIT',                                                // added 2026-08-10
  'QA': 'QA',                                                  // added 2026-08-10
  'Security': 'Security',
  'DevOps & Platform': 'Platform, DevOps & Operations',        // renamed from 'DevOps & Performance'
  'SRE & Reliability': 'SRE & Reliability',                    // added 2026-08-10
  'Incident Management': 'Incident & Problem Management',      // added 2026-08-10
  'Data & Analytics': 'Data & Analytics',
  // ── Business verticals: the bank's products, all approved by Business ──
  'Investment': 'Business & Product',
  'Lending & Credit': 'Business & Product',
  'NEXT': 'Business & Product',                                // added 2026-08-10
  'เป๋าตัง & เป๋าตุง': 'Business & Product',                      // added 2026-08-10
  'CLIX': 'Business & Product',                                // added 2026-08-10
  'Core bank': 'Business & Product',                           // added 2026-08-10
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
  // Performance Engineer and Reviewer both moved OUT of testing 2026-08-10:
  // every live holder of either is doing developer-facing work (the
  // Performance Engineer agents output "Load Test Scripts" from code, the
  // Reviewer agents take a Pull Request and output review comments), and
  // load/perf test + code scan both route to Development under the split.
  'Performance Engineer': 'Development',
  'Reviewer': 'Development',
  // SIT — "Tester" is the SIT-TQM team's role here (15 of 15 live holders),
  // not a generic testing title.
  'Tester': 'SIT',
  // QA — user-acceptance side (UAT/PQA/PVT).
  'QA': 'QA',
  'QA Engineer': 'QA',
  'UAT': 'QA',
  'UAT Test': 'QA',
  'Test management': 'QA',
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
  // (A MERGE_ROLE_CATEGORIES workaround used to sit here: while 'Software
  // Development' and 'Testing & QA' were nulled, an agent carrying one of
  // them alongside a real category short-circuited before the role layer and
  // silently lost the signal its role held. The 2026-08-10 category realign
  // removed every null, so the category layer is decisive on its own and the
  // workaround was deleted rather than left to rot — an agent with cats
  // ['Design & UI','Software Development'] now resolves to
  // ['Development','UI & Visual Design'] straight from this table.)
  if (byCategory.size) return [...byCategory].sort();

  // 6. Role.
  const byRole = new Set();
  roles.forEach((r) => add(byRole, ROLE_AREA[r]));
  if (byRole.size) return [...byRole].sort();

  // 7. Customer-facing work with no other signal is a business call.
  if (isInternalOrExternal(agent) === 'External') return ['Business & Product'];

  return [];
}
