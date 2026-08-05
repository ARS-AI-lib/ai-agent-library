---
name: project-progress-update-feature-design
description: "Design decisions for the upcoming \"update progress\" feature on AI Agent Library agents (approveArea permission model + createdBy backfill) — not yet implemented"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5b7ada72-a449-4ebc-b37a-4269b922e007
---

Next-round feature (deferred from 2026-06-30 grill-me session, UI-only round shipped first): allow admin / approver / creator to update `launchDate` + `devProgress` on an agent via a button in `AgentDetailModal`, with `developmentPhase` auto-derived from `devProgress` via fixed thresholds:
- 0% → Not Start, 1–10% → To Do, 11–89% → In Progress, 90–99% → Pilot, 100% (max, can't exceed) → Ready to Use.

**Why:** Progress was previously stuck reading 0% (separate bug, already fixed in [[feedback-sdlctab-baseline]] follow-up). User wants a real edit workflow now, scoped to the people who should be trusted to touch it — not a free-for-all editor permission.

**Design agreed so far:**
- Permission to update progress = `admin` OR `agent.approvedBy === uid` OR `agent.createdBy === uid`.
- `approvedBy` field does not exist yet — `PendingApprovalModal.jsx`'s `handleApprove()` needs to start writing `approvedBy: uid` on approval. Only agents approved *after* this ships will have it; no retroactive backfill possible (nobody tracked who approved older items).
- Approval itself becomes **area-scoped**: a `/users/{uid}` doc gets a new `approveAreas: string[]` field listing which SDLC process groups that person may approve. An agent's process group is looked up via a new `group` field to be added on `sdlcProcesses` docs (does not exist yet — currently only `stage`/`owner`).
- Confirmed `group` values (8 total): `Business`, `Initiation`, `Discovery`, `Design`, `Build`, `Test`, `Deployment`, `Post Development`. `Business` is always the group whenever an agent is customer-facing / Tier T2 or T3 (per user's exact words: "จะเป็นค่านี้แน่นอน ในกรณีที่เป็น customer facing, T2, T3").
- `createdBy` (uid) is currently only set for agents created via `PreRegModal.jsx` (new agents going forward). The 144 legacy agents migrated from the old Sheet have no `createdBy` at all.
- User will manually supply a name→uid mapping for the 144 legacy agents ("เอาบัญชีของ creator คนแรก ที่อยู่ใน value มาใส่" — when `creator` holds multiple names, use the first one). I owe the user instructions for finding each person's UID: **Firebase Console → Authentication → Users tab** lists each signed-in user with their UID in a column (copyable). Only users who have actually signed in at least once will appear there — anyone who hasn't logged in yet has no UID to backfill against.

**How to apply:** Before starting this feature, do NOT implement `approveAreas` UI or the `createdBy` backfill script speculatively — both are blocked on data only the user can supply (the `group` field values are confirmed above, but the actual per-user `approveAreas` assignments and the name→uid mapping table are not yet in hand). Ask for that data first, then: (1) add `group` to `sdlcProcesses` docs, (2) add `approveAreas` to `/users` docs + wire `PendingApprovalModal` to filter by it and write `approvedBy`, (3) write the `createdBy` backfill script using the supplied mapping, (4) build the actual update-progress button/modal/Firestore-write logic with the threshold-based `developmentPhase` derivation. See [[feedback-sdlctab-baseline]] for file-protection rules when touching `SDLCTab.jsx`.
