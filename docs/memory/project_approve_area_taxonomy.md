---
name: project-approve-area-taxonomy
description: Approve Area = 16-discipline approver routing taxonomy replacing SDLC-stage scoping; single source of truth + the rules around it
metadata:
  type: project
---

Approver scoping is **Approve Area (16 disciplines)**, NOT SDLC stage. Shipped
2026-08-10, hardened 2026-08-11. The old scheme (`approveAreas` = SDLC stage +
`'Business'`) left 79 of ~240 agents visible to no approver at all, and made a
single "Build approver" responsible for both UX copy and penetration testing.

**Single source of truth: `src/lib/approveAreas.js`** — `AREA_ORDER` (16) and
`agentApproveAreas(agent, categoryAreaOverrides)`, a 7-layer fallback chain
(stored `approveArea` → `internalTool` → process → role-first → category →
role → External default). Never re-derive an area inline; Node scripts must
load this module via the `loadEsm()` trick in `functions/backfill-approve-area.cjs`
rather than copying the tables. Same anti-drift rule as `normalizeProgress`.

Key constraints that are easy to get wrong:
- **Only admin + staff may edit `agent.approveArea`** (`canEditApproveArea`),
  deliberately narrower than `canEditSDLC` — an approver setting it would be
  self-assigning their own queue. It is written as its OWN `updateDoc` so
  `affectedKeys()` matches its own firestore.rules branch.
- **Staff can archive, but only within their own areas** (`staffAreaMatch`).
  Area scoping is UI-side; rules check role only.
- **Scope (Internal/External) is independent of SDLC participation.** Writing
  SDLC fields as `[]` when scope is External silently destroyed data — fixed.
  "Customer facing" means *a customer interacts with the agent at runtime with
  no human review*, not "its output eventually ships to customers"; the latter
  reading makes nearly every Build-stage agent External and destroys the axis.

Full detail lives in CLAUDE.md §20 (and §21 use-case catalog, §22 internalTool).
See also [[project-work-queue]].
