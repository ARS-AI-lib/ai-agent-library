---
name: project-backlog-decisions-20260704
description: "2026-07-04 — three backlog items explicitly cut/closed: Connections migration, UID backfill, Owner auto-fill. Don't re-propose."
metadata:
  type: project
  originSessionId: 5b7ada72-a449-4ebc-b37a-4269b922e007
---

Three items from the older backlog (see [[project_work_queue]] and
CLAUDE.md §10) were explicitly closed by the user on 2026-07-04 — do not
re-surface these as open work unless the user brings them up again:

**1. Connections (129 pairs) migration into Firestore — cut.**
Reason: the AI duplicate-detection Cloud Function (`analyzeDuplicate`) already
covers the overlap-analysis need this was meant to serve; a separate static
Connections dataset is redundant.

**2. UID backfill for remaining users — cut, confirmed not needed.**
Reason (confirmed correct by me): new agent/skill docs get `createdBy` =
`user.uid` automatically at submit time (PreRegModal), so nothing to backfill
going forward. Permission checks (`canUpdateProgress`, `canEditDetails`,
`isMyAgent`) all key off `creatorEmails` (email) as the primary check —
`createdBy`/uid is only a fallback for pre-creatorEmails legacy docs, and
those 141 legacy docs already got `creatorEmails` backfilled in an earlier
session. Uid backfill isn't blocking anything.

**3. Owner field auto-fill from login credential — cut.**
Reason: the user's own team affiliation isn't stable/permanent enough for a
"suggest owner from your past creator history" heuristic to be reliable —
someone can move teams. The Owner field's existing tooling (ComboInput
autocomplete against existing owners + free typing for a brand-new team, plus
the newer directory/creator-picker search) is judged sufficient on its own;
no auto-fill/auto-suggest layer needed on top.

**How to apply:** If a future session's backlog summary or grill-me pass
surfaces these three again, don't re-open the design discussion — just note
they're closed per this decision, unless the user explicitly reopens one.
