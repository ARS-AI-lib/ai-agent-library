---
name: feedback-team-derivation
description: "Locked decision — \"My Team's AI\" derives team membership by matching the creator name field against owner, NOT creatorEmails. Do not re-ask."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 5b7ada72-a449-4ebc-b37a-4269b922e007
---

For "My Team's AI" (which team(s) a user belongs to), match the free-text
`creator` name field against `owner` (Team) within the same agent record —
NOT `creatorEmails`. A user can belong to multiple teams (appears as creator
on agents under multiple owners). `creator` can be edited by an admin later,
so this match must be re-derived live from current data every time (no
caching/memoizing a stale team assignment) — see [[project_work_queue]].

**Why:** The user explicitly chose this twice (2026-07-03) after I flagged
what looked like a contradiction with the `creatorEmails`-based approach used
elsewhere (security rules, "My AI" permission checks, directory picker). It
is NOT a contradiction — it's two different questions:
- "Is this MY agent?" (personal ownership/permission) → `creatorEmails`
  contains the user's email — reliable, already powers `canUpdateProgress()`
  and the Firestore security rules.
- "What team(s) am I in?" (team derivation for "My Team's AI") → match
  `creator` (name) against `owner` — the user's explicit choice, accepting
  the typo/name-drift risk this carries, specifically so admins can hand-fix
  team membership by editing the `creator` name field without touching
  security-relevant `creatorEmails`.

**How to apply:** When building any feature that needs "what team is this
user on" (My Team's AI, dashboards, future role/scoping), reuse the
name↔owner match — do not silently switch it to `creatorEmails` for
"consistency." When building anything that needs "does this user own/created
this specific agent," use `creatorEmails`. Don't re-ask the user to choose
between these two again — this file is the answer.
