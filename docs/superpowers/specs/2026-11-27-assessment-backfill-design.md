# Assessment backfill for existing Pilot / Ready-to-Use items — design

## Context
New registrations must pass the screening assessment (CLAUDE.md §37/§39). The 362 live items that predate it have
**no assessment** (measured 2026-11-27: Ready to Use 155, Pilot 80, In Progress/To Do 127).
- Items below Pilot are already covered: the deploy dialog asks C1–C11 when an item has no stored screening
  (`questionsToAsk`) and blocks per option — no change needed.
- Pilot + Ready to Use (~235) are never asked by any flow. This feature collects their assessment once, outside the
  main menus, and keeps risky live items visible until fixed.

## Decisions (user, 2026-11-27)
- **Two separate URLs in the existing SPA**, not in any menu:
  - `/assessment-backfill` — admin + committee only (setup, send, track, CSV)
  - `/assess` — the creator's page opened from the message link (one page lists all of that creator's items)
- **Scope:** live items (approved, not archived) at Pilot or Ready to Use with no completed assessment.
  Paired sub-skills / workflow members are covered by their parent (answer once).
- **Send:** admin sets a **Due date**, picks channels (Inbox / Teams / Email), sends **one message per creator** listing
  all their items with a link each. "Send test to me" first. Re-send to those not done (after due date too) from the page.
- **Multi-creator items:** first creator to submit completes it; later visitors see "ประเมินแล้วโดย {name} เมื่อ {date}"
  with the result, read-only.
- **What is asked:** declaration fields that are still empty (D) + all questions C1–C11 (pre + deploy stages).
  Saved like a normal assessment (`/assessments` records + `agent.screening`) so it appears in Assessment Results.
- **"Not pass" (ไม่ผ่าน):**
  - T1 (Skill + Internal): any chosen option with `blocksPre` or `blocksDeploy`
  - T2/T3/T4: blocking option **or** level High
  - Read from the live `/config/screening` (same thresholds/flags as new items).
- **On not pass:** email + Teams immediately to Admin, Committee, Approver of the area, and every creator:
  "Agent/Skill นี้ไม่ผ่าน assessment ให้รีบแก้ไข".
  - Approver side goes **only to tinnapat.p@arise.tech for now** via a new switch
    `/config/mail.assessmentApproverOverride` (removing it later sends to real approvers — no redeploy).
    Admin/Committee/creators receive it for real.
- **Library display:** a Ready-to-Use item that did not pass shows its endpoint link **red** with a warning icon +
  tooltip "รายการนี้ยังไม่ผ่าน assessment อาจมีความเสี่ยงจากการใช้งาน".
- **Re-assessment:** the creator of a not-passed item can request it → answers again → goes to a new **Assessment** queue
  in the Pending window (5th section) → Approver of the area (or Admin) Accepts (pass, red removed, everyone told) or
  Rejects with a reason (stays red, creator told). Counted in the Inbox/Pending badge.
- **Dates:** keep `firstAssessedAt` and `lastAssessedAt` separately.
- **CSV:** every item in scope with status **Pass / Not pass / Not done**, tier, level, blocking items, creators,
  first/last assessed dates, due date.

## Data model
- `agent.assessment = { status: 'pass'|'fail'|'pending_review', firstAssessedAt, lastAssessedAt, lastBy, failReasons[] }`
  - written only by callables (Admin SDK); rules unchanged for clients
- `/assessmentCampaigns/{id} = { dueDate, channels[], createdBy, createdAt, sends:[{at, by, recipients}] }`
- `/users/{uid}/inbox` gets per-person messages, or a small `/inboxMessages` collection with `toUid` — builder's call,
  following the existing Inbox read-state pattern (`useInboxState`)
- `/assessmentReviews/{id}` = re-assessment requests (answers, previous result, status, decidedBy, reason)

## Code (reuse first)
- **Engine:** `src/lib/screening.js` (`evaluate`, `buildScreening`, option flags) + `src/lib/tier.js` `getTier()`;
  new pure `backfillVerdict(config, answers, tier)` in a new `src/lib/assessmentBackfill.js` (single source for "not pass").
  Port to functions with a `verify-*.cjs --live` drift check (pattern: `delayAlertRules.js`).
- **UI:** reuse `ScreeningQuestions` / `ScreeningSide`, declaration fields from `src/lib/declaration.js`, forms.css
  primitives; route switch in `src/main.jsx` (same pattern as `/usage`, `/assessments`).
- **Callables** (each calls `requireCompanyUser`):
  - `backfillList` (admin/committee) — items in scope + status + creators
  - `backfillSend` (admin/committee) — campaign + per-creator messages; Teams/email through existing
    `mailer.js` `teams-flow` transport; one message per creator
  - `backfillSubmit` (creator of the item) — refuses if already completed; writes `/assessments`, `agent.screening`,
    `agent.assessment`; on fail sends the not-pass notification
  - `requestReassessment` / `decideReassessment` (area approver or admin; reuses `agentReadyRules.checkAgentActor`-style
    checks on stored `approveArea`)
- **Notifications:** new event types in `functions/notifyRules.js` (`assessment.request`, `assessment.failed`,
  `assessment.review`, `assessment.decided`) + keep `src/lib/notify.js` `TYPES` equal to `EVENT_TYPES`.
- **Pending queue:** `src/lib/pendingQueue.js` gets the 5th queue and its badge count; `PendingApprovalModal.jsx` section.
- **Library:** endpoint link red + tooltip in the card/detail where the endpoint link renders (`AgentDetailModal`, cards).

## Rollout
Build and test on the **test site** first (`scripts/deploy-test.sh`, test DB already seeded; set test
`/config/mail` allowRecipients to the user only). Then: rules (if any) via Console → scoped functions deploy of the new
callables only → hosting. Ask before every production deploy.

## Verification
- `verify-assessment-backfill.cjs`: verdict rules (T1 blocking-only vs T2–T4 blocking-or-High), scope selection
  (Pilot/RU, sub-skills folded into parent), one message per creator, already-completed refusal, date fields.
- Emulator/test site: send to self → open link → submit pass and fail → red link + tooltip → request re-assessment →
  approve/reject in Pending → badge counts → CSV contents.

## Not in scope
Changing the gate for new registrations; items below Pilot (already gated at deploy request); automatic
un-publishing of failed items.
