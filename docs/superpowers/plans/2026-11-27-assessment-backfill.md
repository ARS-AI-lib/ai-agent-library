# Assessment Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect a one-time assessment for every live Pilot / Ready-to-Use item, flag failed live items, and route re-assessments through approvers.

**Architecture:** All decisions (scope, pass/fail, recipients, permissions, message text) live in one pure CommonJS module `functions/assessmentBackfillRules.js`, tested offline and against the real `src/lib` engine for drift. Callables in `functions/index.js` do every write (Admin SDK). Two new SPA routes (`/assess`, `/assessment-backfill`) plus small hooks into the Library, Inbox and Pending queue read the stored `agent.assessment`.

**Tech Stack:** React + Vite, Firestore named DB, Cloud Functions v2 (asia-southeast1), existing `mailer.js` teams-flow transport.

**Spec:** `docs/superpowers/specs/2026-11-27-assessment-backfill-design.md`

## Global Constraints

- Labels/headers/buttons English; Thai only for explanations and data (CLAUDE.md §6).
- Every new callable starts with `requireCompanyUser(request)` (CLAUDE.md "Company-account gate").
- Server never trusts client-sent verdicts, recipients or creator status — it re-reads the agent doc.
- Creator identity = `creatorEmails` first, `createdBy` fallback (reuse `isAgentCreator` in `functions/agentReadyRules.js`).
- Approver-side recipients of every new event = `/config/mail.assessmentApproverOverride` when non-empty, else real area approvers (`areaApprovers` in `notifyRules.js`). Admin + committee are always real.
- Keep `TYPES` in `src/lib/notify.js` equal to `EVENT_TYPES` in `functions/notifyRules.js`.
- New pending queue must be counted in both `pendingBadgeCount` and `inboxQueueCount`.
- CSS: forms.css / V7 tokens only; class prefix `.abf-`.
- Develop and verify on the test site (`scripts/deploy-test.sh`); production deploy only after the user says so (scoped `--only functions:<new names>`).

## Review Focus

1. Two creators submit the same item at the same time → exactly one wins; the second gets "already completed" (Task 2 transaction test).
2. Agent with no creator email (only `createdBy`, or none) → appears in the admin table as "No creator email", never silently dropped from the send count (Task 1 `creatorDigests` test).
3. Item whose `/config/screening` changed after it was answered (option deleted) → verdict treats the missing answer as unanswered and the submit is refused as incomplete, not saved as pass (Task 1 test).
4. Re-sending after the due date → only creators with at least one `not_done` item are messaged; done items never re-appear in a message (Task 1 `creatorDigests` test).
5. Ready-to-Use item at `pending_review` → link stays red until an approver accepts (Task 7 test).

---

### Task 1: Rules module (scope, verdict, digests, permissions, message)

**Files:**
- Create: `functions/assessmentBackfillRules.js`, `functions/verify-assessment-backfill.cjs`

**Interfaces:**
- Produces (CommonJS exports):
  - `evaluateAnswers(config, answers) -> { complete:boolean, total:number, level:'Low'|'Medium'|'High'|null, blocking:string[] /* question codes */ }` — port of `evaluate` + per-option `blocksPre||blocksDeploy`; answers are `{questionId: optionId}`; an id not in config = unanswered.
  - `backfillVerdict({ config, answers, tier }) -> { pass:boolean, level, total, reasons:string[] }` — fail when `blocking.length > 0`, or (`tier !== 'T1'` and `level === 'High'`). `reasons` = blocking codes, plus `'High'` when that caused it.
  - `backfillStatus(agent, config, all) -> 'pass'|'fail'|'pending_review'|'not_done'` — `agent.assessment.status` if set; else if `agent.screening?.deployAt` → verdict of `screening.answers`; else `'not_done'`.
  - `inBackfillScope(agent, all) -> boolean` — approved, not archived, `normalizeProgress >= 90`, not `isPairedSubSkill(agent, all)`. Port `normalizeProgress`/`isPairedSubSkill`/`getTier` from `functions/delayAlertRules.js` (re-export, don't duplicate).
  - `creatorDigests(rows) -> { digests:[{ email, items:[{ id, name, phase }] }], noEmail:[agentId] }` — rows = `[{ agent, status }]`; only `status === 'not_done'`; one digest per lower-cased email.
  - `canSubmit(agent, user) -> null | errorText` (creator only), `canDecideReview(agent, user) -> null | errorText` (admin, or approver whose `approveAreas` overlap stored `agent.approveArea`).
  - `notPassRecipients(agent, users, cfg) -> string[]` — admins + committee + approver side (override rule in Global Constraints) + creators, de-duplicated.
  - `renderBackfillMessage({ displayName, items, dueDate, appUrl }) -> { subject, text, html, cardLines, link }` — copy below.
- Message copy (exact):
  - subject `ขอความร่วมมือทำ Assessment ของ Agent/Skill ภายใน {dueDate}`
  - body: `เรียน คุณ{displayName}` / `AI Agent Library เพิ่มแบบประเมินความเสี่ยง (Assessment) สำหรับ Agent/Skill ทุกตัว งานที่ใช้งานอยู่แล้วก่อนมีแบบประเมินนี้จึงต้องประเมินย้อนหลังหนึ่งครั้ง คุณเป็น Creator ของรายการต่อไปนี้:` / numbered `{name} · {Pilot|Ready to Use} → {appUrl}/assess?agent={id}` / `ใช้เวลาประมาณ 5 นาทีต่อรายการ (11 ข้อ แบบเลือกตอบ) กรุณาทำให้เสร็จภายใน {dueDate}` / `หากรายการใดไม่ได้อยู่ในความดูแลของคุณแล้ว ตอบกลับอีเมลนี้เพื่อแจ้งได้เลย` / `ขอบคุณครับ` / `ทีม AI Agent Library`. dueDate format `15 Dec 2026` (en-GB, Asia/Bangkok). Use `frameHtml`/`salutation` from `functions/messageFrame.js` for html.

- [ ] **Step 1: Write the failing tests** in `verify-assessment-backfill.cjs` (same `eq` style as `verify-screening.cjs`; load the module with `require`, and `src/lib/screening.js` + `src/lib/tier.js` with `loadEsm`):
  - `T1 + blocking option → fail, reasons ['C7']`; `T1 + High only → pass`; `T2 + High only → fail, reasons ['High']`; `T4 all-pass → pass`
  - drift: for 200 random answer sets on `DEFAULT_CONFIG`, `evaluateAnswers(...).total/level` equals `screening.evaluate(...).total/level`; tier port equals `getTier` on every live-shaped fixture
  - deleted option id → `complete === false`
  - scope: progress 89 → false; 90 → true; archived → false; paired sub-skill → false; `"95%"` string → true
  - status: `assessment.status:'fail'` wins over screening; screening with `deployAt` + C7 blocking → `'fail'`; nothing → `'not_done'`
  - digests: two items same creator (case-different emails) → 1 digest with 2 items; done item excluded; agent with only `createdBy` → in `noEmail`
  - permissions: non-creator `canSubmit` → error; approver outside area `canDecideReview` → error; admin → null
  - recipients: override `['x@arise.tech']` replaces approvers but admins/committee/creators remain; empty override → real approvers
  - message: subject contains `15 Dec 2026`; text contains each `/assess?agent=` link once
- [ ] **Step 2:** `node functions/verify-assessment-backfill.cjs` → FAIL (module missing)
- [ ] **Step 3:** Implement `functions/assessmentBackfillRules.js` to the interfaces above
- [ ] **Step 4:** `node functions/verify-assessment-backfill.cjs` → all pass
- [ ] **Step 5:** Commit `feat(backfill): rules module + verify`

### Task 2: Callables

**Files:**
- Modify: `functions/index.js` (append section "Assessment backfill"), `functions/notifyRules.js` (`EVENT_TYPES` += `assessment.failed`, `assessment.review`, `assessment.decided`), `src/lib/notify.js` (`TYPES` same), `functions/mailer.js` (`loadConfig` exposes `assessmentApproverOverride`, default `[]`)
- Test: extend `functions/verify-assessment-backfill.cjs` with the transaction helper test; `functions/verify-notify.cjs` still passes

**Interfaces:**
- Consumes: Task 1 exports; `sendMail(db, {to, subject, text, html, title, link, cardLines, ctaLabel})`; `requireCompanyUser`; `/config/screening` (fallback `DEFAULT` config via `functions/screeningConfigRules.js`).
- Produces (callable name → request → response):
  - `backfillList` (admin/committee) `{}` → `{ rows:[{ id, name, tier, phase, owner, creators:string[], status, level, reasons, firstAssessedAt, lastAssessedAt }], campaign }`
  - `backfillSend` (admin/committee) `{ dueDate:'YYYY-MM-DD', channels:['inbox','teams','email'], testOnly:boolean }` → `{ sent, skippedNoEmail, recipients }`. `testOnly` sends one digest built from the caller's own items (or the first digest) to the caller only. Writes/merges `/assessmentCampaigns/current` `{ dueDate, channels, sends: arrayUnion({at, by, count, testOnly}) }`; inbox channel writes `/inboxMessages/{auto}` `{ toEmail, title, body, link, kind:'assessment-backfill', createdAt }`. timeoutSeconds 540; deliveries sequential.
  - `backfillMyItems` (any company user) `{}` → `{ items:[{ id, name, tier, phase, status, doneBy, doneAt, missingDecl:[field] }], dueDate }` — items where caller is creator and `inBackfillScope`.
  - `backfillSubmit` (creator) `{ agentId, answers, decl, mode:'backfill'|'review' }` → `{ status:'pass'|'fail'|'pending_review', level, reasons }`.
    - In one transaction: re-read agent; `mode:'backfill'` refuses with `already-exists` "รายการนี้ประเมินแล้ว" when `backfillStatus !== 'not_done'`; refuses incomplete answers.
    - Writes `agent.screening` (v2 shape, `deployAt` = now), `agent.assessment = { status, firstAssessedAt (keep existing), lastAssessedAt: now, lastBy: email, reasons }`, missing declaration fields only, and one `/assessments` record per stage (`pre`, `deploy`) like the existing client write.
    - `mode:'review'` (allowed only when status is `'fail'`): writes `/assessmentReviews/{auto}` `{ agentId, agentName, approveArea, answers, decl, verdict, previous:{status, reasons}, requestedBy, createdAt, status:'pending' }`, sets `assessment.status:'pending_review'`, notifies `assessment.review` to the approver side; agent screening is not changed until accepted.
    - On `fail` (backfill mode) → `sendMail` to `notPassRecipients` with subject `Agent/Skill "{name}" ไม่ผ่าน Assessment — กรุณาแก้ไขโดยด่วน`.
  - `decideReassessment` (`canDecideReview`) `{ reviewId, decision:'accept'|'reject', reason }` → `{ ok }`. Accept: apply the review's answers/decl as in backfill submit with status from its verdict (`pass` expected; a fail verdict cannot be accepted → error), `lastAssessedAt` = now. Reject (reason ≥ 5 chars): `assessment.status:'fail'`. Both notify `assessment.decided` to creators (+ everyone from `notPassRecipients` on accept).
- [ ] **Step 1:** Add test `submit transaction: second submit after first → already-exists` using a pure helper `applySubmit(agentData, input, now) -> { patch, records, status }` exported from Task 1's module (the callable wraps it in `db.runTransaction`); run → FAIL
- [ ] **Step 2:** Implement `applySubmit` + the callables; `node --check functions/index.js`
- [ ] **Step 3:** `node functions/verify-assessment-backfill.cjs` and `node functions/verify-notify.cjs` → pass
- [ ] **Step 4:** Commit `feat(backfill): callables + notifications`

### Task 3: Firestore rules + inbox messages

**Files:**
- Modify: `firestore.rules`; Create: `functions/verify-backfill-rules.cjs` (emulator, pattern of `verify-inbox-rules.cjs`)

- [ ] **Step 1:** Rules tests: `/inboxMessages` read only when `resource.data.toEmail == request.auth.token.email` (list query `where('toEmail','==',email)` allowed, unfiltered list denied), client write denied; `/assessmentCampaigns` read admin/committee, write denied; `/assessmentReviews` read approver-or-above or `resource.data.requestedBy == request.auth.uid`, write denied; agent `assessment` field not writable by a creator update
- [ ] **Step 2:** Run with emulator (command in CLAUDE.md §36) → FAIL; implement rules → PASS (also rerun `verify-inbox-rules.cjs`, `verify-assessment-rules.cjs`)
- [ ] **Step 3:** Commit `feat(backfill): rules`

### Task 4: Inbox messages for a person

**Files:**
- Create: `src/hooks/useInboxMessages.js`; Modify: `src/lib/inbox.js`, `src/components/InboxModal.jsx`, `src/App.jsx` (badge), `functions/verify-inbox.cjs`

**Interfaces:**
- Produces: `useInboxMessages(email) -> { messages:[{id,title,body,link,createdAt}] }`; `inbox.js` `unreadMessages(messages, readIds)` using read ids `msg:{id}`; `inboxBadgeCount({ unreadCount, queueCount, unreadMessages })` adds them.
- [ ] **Step 1:** verify-inbox cases: `unreadMessages` honours `msg:` prefix; badge = announcements + messages + queue
- [ ] **Step 2:** FAIL → implement; InboxModal shows a "Messages" section above Announcements (title, body with `splitLinks`, link button "Open"), marking read like announcements → PASS; `npm run build`
- [ ] **Step 3:** Commit `feat(backfill): per-person inbox messages`

### Task 5: Creator page `/assess`

**Files:**
- Create: `src/components/AssessBackfillPage.jsx`, `src/styles/AssessBackfill.css`; Modify: `src/main.jsx` (route `/assess`)

**Interfaces:**
- Consumes: `backfillMyItems`, `backfillSubmit`; `ScreeningQuestions` (`blockKey="blocksDeploy"`, all question ids), `ScreeningSide`, `DECL_FIELDS`/labels from `src/lib/declaration.js`; `useScreeningConfig()`; `goToField` from `src/lib/formFocus.js`.
- Behaviour: header chips = caller's items (done ✓ / current / todo), `?agent=` preselects, `?review=1` submits with `mode:'review'`; done-by-others shows `ประเมินแล้วโดย {doneBy} เมื่อ {date}` read-only with result; Due date chip; only missing declaration fields shown (Required: Permitted Tools, Required Skills as today); "Submit and next" moves to next not-done item; a fail result shows `ผลประเมินไม่ผ่าน — ระบบแจ้งผู้เกี่ยวข้องแล้ว กรุณาแก้ไขและขอประเมินใหม่`; not a creator of `?agent` → message, no form.
- [ ] **Step 1:** `npm run build`; on the test site/emulator: open `/assess?agent=<id>` as creator, submit pass, open as second creator → done message; submit fail → fail notice
- [ ] **Step 2:** Commit `feat(backfill): creator assessment page`

### Task 6: Admin page `/assessment-backfill`

**Files:**
- Create: `src/components/AssessmentBackfillPage.jsx`; `src/lib/assessmentBackfill.js` (client helpers); Modify: `src/main.jsx`; test `functions/verify-assessment-backfill.cjs` (client helper cases via `loadEsm`)

**Interfaces:**
- Produces in `src/lib/assessmentBackfill.js`: `backfillCsv(rows, dueDate) -> string` (headers `Agent/Skill, Tier, Phase, Owner, Creators, Status, Level, Reasons, First assessed, Last assessed, Due date`; Status label map `pass→Pass, fail→Not pass, pending_review→Not pass (review pending), not_done→Not done`; cells via `src/lib/csv.js`), `summarize(rows) -> { items, done, notDone, noEmail }`.
- Behaviour: gate admin/committee (others see "Access restricted"); KPI cards; Send setup (Due date default +14 days, channels checkboxes, "Preview message" opens rendered text from the server via `backfillSend {testOnly:true}`'s returned preview — or a `preview:true` flag returning `renderBackfillMessage` output without sending; "Send test to me"; primary "Send to N creators" = not-done creators, confirm dialog with N); table with search + status filter; "Download CSV".
- [ ] **Step 1:** CSV + summarize tests (status labels, comma/quote escaping, formula-prefix guard) → FAIL → implement → PASS
- [ ] **Step 2:** Page; `npm run build`; test site: preview, send test to self (test DB `/config/mail.allowRecipients` = user only)
- [ ] **Step 3:** Commit `feat(backfill): admin setup page + CSV`

### Task 7: Library warning + re-assessment request + Pending queue

**Files:**
- Modify: `src/lib/assessmentBackfill.js` (`assessmentWarning(agent) -> string|null`), `src/components/AgentCard.jsx`, `src/components/AgentDetailModal.jsx`, `src/lib/pendingQueue.js`, `src/lib/inbox.js`, `src/components/PendingApprovalModal.jsx`, `src/App.jsx` (subscribe `/assessmentReviews` status pending, pass to badge + modal), `src/styles/forms.css` (`.abf-risk`)
- Test: `functions/verify-assessment-backfill.cjs`, `functions/verify-inbox.cjs`

**Interfaces:**
- `assessmentWarning(agent)` → `'รายการนี้ยังไม่ผ่าน assessment อาจมีความเสี่ยงจากการใช้งาน'` when `normalizeProgress(agent.devProgress) >= 100` and `assessment.status` ∈ {`fail`,`pending_review`}, else null.
- `visibleAssessmentReviews(reviews, agents, v)` (admin all; approver by stored area overlap; committee none — same as rename), counted in `pendingBadgeCount(..., reviews)` and `inboxQueueCount(..., reviews)` (add trailing param, default `[]`).
- Detail modal: creator of a `fail` item sees "Request re-assessment" → `/assess?agent={id}&review=1`.
- Pending modal: section "Assessment" — name (opens detail), requested by, previous vs new level/reasons, Accept / Reject (reason required) → `decideReassessment`.
- [ ] **Step 1:** Tests: warning only at 100% and fail/pending_review (Review Focus 5); queue visibility + badge counts include reviews → FAIL → implement → PASS
- [ ] **Step 2:** UI; `npm run build`; test site end-to-end: fail → red link + tooltip → request → Pending shows it, badge +1 → accept → red gone
- [ ] **Step 3:** Commit `feat(backfill): risk link, re-assessment queue`

### Task 8: Release prep + docs

**Files:** `CLAUDE.md` (§41), `functions/seed-test-db.cjs` (copy `assessmentCampaigns`/`assessmentReviews`/`inboxMessages` skipped; set test `/config/mail.assessmentApproverOverride`)

- [ ] **Step 1:** CLAUDE.md §41: scope, verdict rule, switch `assessmentApproverOverride` (currently `['tinnapat.p@arise.tech']`; remove to reach real approvers), routes, callables, release order
- [ ] **Step 2:** Run every `verify-*.cjs` touched + `npm run build`; `scripts/deploy-test.sh all`; full walk-through on the test site
- [ ] **Step 3:** Commit `docs: assessment backfill`; then ask the user before production: Console rules publish → `firebase deploy --only functions:backfillList,backfillSend,backfillMyItems,backfillSubmit,decideReassessment,notifyEvent` → set `/config/mail.assessmentApproverOverride = ['tinnapat.p@arise.tech']` → hosting

---

## Addendum (user requests 2026-11-27, after Task 2) — execute order: 3, 4, **9, 10**, 5, 6, 7, 8

### Task 9: Results display fixes

**Files:** Modify `src/lib/assessments.js`, `src/components/AssessmentResultsPage.jsx`, `functions/verify-assessments.cjs`

**Interfaces:**
- `combineByAgent` rows gain `preAnswered:boolean` = at least one `stage==='pre'` question has an answer (from the merged answers, not from the existence of a `pre` record). `hasPre` stays (record exists).
- `clipText(text, max = 250) -> string` exported from `src/lib/assessments.js`: trims; when longer than `max`, returns first `max` characters + `…`; otherwise unchanged.
- Results table "Pre-assessment" cell shows `preScore` when `preAnswered`, else `—`. Declaration block in the expanded row shows `clipText(description, 250)`. CSV (`agentCsv`) keeps the FULL description.
- Reason: items registered before the assessment existed answer C1–C11 in one go at deploy, so only a `deploy` record exists; their Pre column wrongly showed `—` although C1–C9 were answered.

- [ ] **Step 1:** tests: record set with only a deploy record containing C1–C9 answers → `preAnswered === true` and `preScore` equals the pre-stage total; deploy record with no pre answers → `preAnswered === false`; `clipText` 250 chars unchanged, 251 → 250 chars + `…`, empty/undefined → `''`; CSV description not clipped.
- [ ] **Step 2:** FAIL → implement → PASS; `npm run build`
- [ ] **Step 3:** Commit `fix(assessment): pre score from answers, clip long description`

### Task 10: Declaration fields always required, with a "none" checkbox

**Files:** Create `src/components/DeclField.jsx`; Modify `src/lib/declaration.js`, `src/components/PreRegModal.jsx`, `src/components/EditAgentModal.jsx`, `src/components/AgentDetailModal.jsx` (deploy dialog missing-declaration inputs), `firestore.rules`, `functions/verify-declaration.cjs`, `functions/verify-screening-rules.cjs`

**Interfaces:**
- `DECL_FIELDS` entries all `required: true`, each with `none` (exact phrases, user-approved "short phrase per field"): `permittedDomains` → `ไม่จำกัด domain`; `prohibitedUses` → `ไม่มีข้อห้าม`; `tool` → `ไม่ใช้ tool`; `requiredSkills` → `ไม่ต้อง`; `llm` → `ยังไม่ได้ทดสอบ`.
- `isNoneValue(key, value) -> boolean` (trim + exact match to that field's `none`); `missingDeclaration(agent)` now lists any of the five that is empty (so older items are forced to fill them wherever it is used: deploy request, `/assess`, Edit Save).
- `DeclField({ field, value, onChange, error })`: label with red `*`, a checkbox labelled with the field's `none` phrase, and a text input. Checked → value = `none` phrase and the input is hidden; unchecked → input shown, and if the value was the none phrase it is cleared; empty + unchecked is invalid. Checkbox state is derived from `isNoneValue`, nothing extra is stored.
- New and Edit forms: all four fields (Permitted Domains, Prohibited Uses, Permitted Tools, Models Tested) use `DeclField` and are validated required (message `ใส่ {label} (หรือติ๊ก "{none}")`; add the labels to the `goToField` mapping in each form). Required Skills keeps its current behaviour (derived for Workflow) but is also required in Edit.
- Edit form: shows the five fields for roles that may edit the agent's details; Save is blocked while any is empty ("forced at the next step they touch" — user ruling). Sub-skills inherit from the parent as today.
- Deploy dialog: the missing-declaration inputs use `DeclField`.
- `firestore.rules`: add `permittedDomains`, `prohibitedUses`, `requiredSkills`, `tool`, `llm` to the Tier A and Tier B detail-edit `hasOnly` lists (they already exist in the deploy-request branch). ⚠️ needs a Console publish at release (named DB `ai-agent-lib`).

- [ ] **Step 1:** tests: `isNoneValue` per field; `missingDeclaration` returns all five when empty and none when each holds either text or its none phrase; rules emulator cases: creator Tier B edit of `tool`+`llm`+`permittedDomains`+`prohibitedUses`+`requiredSkills` allowed, other field combined → denied, non-owner denied
- [ ] **Step 2:** FAIL → implement helpers + component + rules → PASS (`verify-declaration.cjs`, rules suite on the emulator per CLAUDE.md §36)
- [ ] **Step 3:** wire the forms; `npm run build`; browser check on the test site: tick/untick hides/shows input, empty submit scrolls to the field, Edit Save blocked on an old item until filled
- [ ] **Step 4:** Commit `feat(declaration): all five fields required with none checkbox`
