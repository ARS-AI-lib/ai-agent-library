# Inbox: Announcements + My Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Library's Inbox button into a per-user Inbox that carries admin/committee announcements (level-targeted, no email/Teams), the user's own waiting/rejected requests, and a link to the approval queue for approvers.

**Architecture:** Announcements are central docs in `/announcements` gated by `audience` in Firestore rules; per-user read state lives in `/users/{uid}/inbox/state`. "My requests" is computed live from data the app already loads (`nextStep()` from `mySubmissions.js`), so it can never go stale. All testable logic lives in a new pure module `src/lib/inbox.js` (same single-source pattern as `pendingQueue.js`), proven by `functions/verify-inbox.cjs` loaded through `loadEsm`; rules are proven in the Firestore emulator by `functions/verify-inbox-rules.cjs`. No Cloud Functions.

**Tech Stack:** React 19 + Vite, Firebase JS SDK v12 (Firestore named DB `ai-agent-lib`), plain JS modules, Node verify scripts.

**Spec:** `docs/superpowers/specs/2026-11-17-inbox-announcements-design.md`

## Global Constraints

- Labels English, Thai only for explanatory text (CLAUDE.md §6). Exact strings — tabs: `'All'`, `'Announcements'`, `'My requests'`, `'To approve'`; composer: `'New announcement'`, `'Title'`, `'Message'`, `'Audience'`, audience options `'Everyone'` / `'Approvers and above'` / `'Admin & Committee'`, `'Pin to top'`, `'Expires (optional)'`, `'Post'`, `'Save changes'`, `'Delete'`.
- Audience → role table (verbatim from spec §7): `all` = user, workshop, staff, approver, committee, admin · `approvers` = approver, staff, committee, admin · `leads` = committee, admin · no/unknown role = none. The client `allowedAudiences(role)` MUST equal the rules' `audienceOk` — a mismatch makes the whole `in` query fail.
- Limits: title 1–120 chars, body 1–5000 chars, `readIds` ≤ 300, rejected/withdrawn items shown for 14 days.
- Authors: admin **and** committee (`isCommittee()` already includes admin). `createdBy`/`createdAt` immutable on update.
- Rules: read optional fields with `.get(field, default)`, never dot access (CLAUDE.md §9). Rules are published by the **user** in the Console (DB `ai-agent-lib`) **before** the hosting deploy that uses them. Never deploy or push without the user's explicit confirmation — prepare commands, the user runs them.
- Hosting + rules only: no `functions/index.js` change, no `pendingQueue.js` change.
- New CSS goes in `src/styles/v7.css` under `body.v7`, prefix `.v7-inbox-` / `.v7-ann-`. Do not redefine any `theme.css` class; do not touch other files' CSS.
- Edit files in place; never append with `>>` (CLAUDE.md §6).
- Commits land on `main`; each message ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Announcement text is rendered as plain text nodes (never `dangerouslySetInnerHTML`); only `http(s)://` URLs become links.

## Review Focus

1. **Untrusted announcement text** — `<script>`, HTML tags and a `javascript:`/`data:` URL in the body must render as inert text; only `http://`/`https://` URLs are linked. Task 1 (`splitLinks` test) + Task 3 (render as text nodes).
2. **Viewer with no role yet** (`role` undefined/`workshop`-less, `roleReady` false): `allowedAudiences` returns `[]`, and Firestore rejects an empty `in` list — the hook must skip the query, not call it. Task 1 + Task 3.
3. **Expiry edges** — `expiresAt` in the past or exactly `now` → hidden; `null`/missing → shown; both Firestore `Timestamp` and `Date` accepted. Task 1.
4. **Read-state hygiene** — `readIds` holding ids of deleted/expired announcements is pruned on write and capped at 300 keeping the newest; a late joiner sees all still-active announcements as unread. Task 1 + Task 3.
5. **Paired sub-skills and undated rejected items in "My requests"** — a parent with 7 children must be ONE waiting row (children excluded via `isPairedSubSkill`); a rejected item with neither `rejectedAt` nor `updatedAt` is excluded rather than shown forever. Task 1.

---

### Task 1: Pure Inbox logic (`src/lib/inbox.js`) + `functions/verify-inbox.cjs`

**Files:**
- Create: `src/lib/inbox.js`
- Create: `functions/verify-inbox.cjs`

**Interfaces:**
- Consumes: `toJsDate`, `isMyAgent`, `isPairedSubSkill` (`src/lib/agentUtils.js`); `nextStep(a, now)` (`src/lib/mySubmissions.js`); `visiblePending`, `visibleDeployRequests`, `visibleRenameRequests`, `visibleLinkRequests`, `queueAreaEmptyForApprover` (`src/lib/pendingQueue.js`; do not modify it).
- Produces (all `export`ed from `src/lib/inbox.js`):
  - `AUDIENCES = ['all','approvers','leads']`, `AUDIENCE_LABEL = { all:'Everyone', approvers:'Approvers and above', leads:'Admin & Committee' }`, `REJECTED_WINDOW_DAYS = 14`, `READ_IDS_CAP = 300`
  - `allowedAudiences(role: string|null|undefined): string[]`
  - `canPostAnnouncements(role: string|null|undefined): boolean` — committee/admin
  - `activeAnnouncements(list: Announcement[], now?: number): Announcement[]` — drops expired, pinned first then `createdAt` newest first
  - `unreadAnnouncements(active: Announcement[], readIds: Iterable<string>): Announcement[]`
  - `pruneReadIds(readIds: Iterable<string>, knownIds: Iterable<string>, cap?: number): string[]` — keeps only ids in `knownIds`, then the last `cap` of them
  - `validateAnnouncement(d: {title, body, audience}): string | null` — Thai error text or `null`
  - `splitLinks(text: string): Array<{ text: string, href?: string }>`
  - `myRequestItems({ pending, allAgents, rejected, user, now }): Array<{ agent, step }>` — `step` = `nextStep(agent, now)`
  - `inboxQueueCount(pending, deployRequests, renameReqs, agents, v): number`
  - `showToApprove(v, queueCount): boolean`
  - `inboxBadgeCount({ unreadCount, queueCount }): number`

- [ ] **Step 1: Write the failing test script `functions/verify-inbox.cjs`**

Use the repo's `loadEsm` (copy from `functions/backfill-approve-area.cjs:35-45`) and load the **real** modules in dependency order, injecting deps exactly like that script: `tier.js` → `agentUtils.js` (inject `getType`,`getTier`) → `approveAreas.js` (inject `agentProcessIds`,`splitRoles`,`agentCategories`,`isInternalOrExternal`) → `mySubmissions.js` (inject `normalizeProgress`,`toJsDate`,`fmtDate`) → `pendingQueue.js` (inject `agentApproveAreas`,`isPairedSubSkill`,`canDecideRename`) → `inbox.js` (inject the names it imports). Use the `eq(actual, expected, msg)` style of `verify-usage-page.cjs`; exit code 1 on any failure. Named cases (assert exactly these):
  - `allowedAudiences`: `'user'`→`['all']`, `'workshop'`→`['all']`, `'staff'`/`'approver'`→`['all','approvers']`, `'committee'`/`'admin'`→`['all','approvers','leads']`, `undefined`/`null`/`''`/`'bogus'`→`[]` (Review Focus 2).
  - `canPostAnnouncements`: true only for `committee`,`admin`.
  - `activeAnnouncements`: expired (`expiresAt` < now) hidden; `expiresAt === now` hidden; `null` and missing kept; `Date` and `{toDate()}` Timestamp both work; pinned-first then newest-first order (Review Focus 3).
  - `unreadAnnouncements`: respects a `Set` and an array; late-joiner (empty `readIds`) → all active are unread.
  - `pruneReadIds`: ids not in `knownIds` dropped; 305 known ids → 300 kept, the **last** 300 (Review Focus 4).
  - `validateAnnouncement`: empty/whitespace title → message; 121-char title → message; 5001-char body → message; bad audience → message; valid → `null`.
  - `splitLinks('see https://a.com/x, ok')` → `[{text:'see '},{text:'https://a.com/x',href:'https://a.com/x'},{text:', ok'}]`; `'<script>alert(1)</script> javascript:alert(1) data:text/html,x'` → every segment has **no** `href`; `'http://a.b'` linked; trailing `.`/`,`/`)` not swallowed into the URL (Review Focus 1).
  - `myRequestItems`: only the viewer's items (`creatorEmails`, case-insensitive); a pending item and a `deploymentStatus:'requested'` item → included with `step.tone==='wait'`; an `act`-tone item (past launchDate) and a `mute`/`ok` item → **excluded**; a parent with 7 paired children (via `childSkillIds`) → exactly 1 row; rejected within 14 days (by `rejectedAt`, else `updatedAt`) → included with `step.tone==='bad'`; rejected 15 days ago → excluded; rejected with neither date → excluded (Review Focus 5); duplicates by `id` between `pending`/`allAgents`/`rejected` collapse to one.
  - `inboxQueueCount`: with `v = queueViewer({isAdmin:false,isCommittee:false,role:'user',approveAreas:[],uid:'u1',email:'u@x'})` and one own pending item → `0` (the base-user fallback is not counted); `fullAccess` viewer with 2 pending + 1 deploy request → 3; approver whose area matches 1 of 3 pending → 1; approver with areas but nothing matching → `0` (fallback ignored).
  - `showToApprove`: `fullAccess` → true even with count 0; non-full with count 0 → false; count > 0 → true.
  - `inboxBadgeCount({unreadCount:2,queueCount:3})` → 5; `{unreadCount:0,queueCount:0}` → 0.

- [ ] **Step 2: Run it to confirm it fails**

Run: `node functions/verify-inbox.cjs`
Expected: FAIL (cannot load `src/lib/inbox.js` / functions undefined).

- [ ] **Step 3: Implement `src/lib/inbox.js` with the signatures above**

Approach notes (the signature + tests fix the rest): `inboxQueueCount` = `hasAreaMatch ? visiblePending(...).length : 0` plus `visibleDeployRequests(...)`, `visibleRenameRequests(...)`, `visibleLinkRequests([...agents, ...pending], v)` lengths, where `hasAreaMatch = v.fullAccess || (v.areas.size > 0 && !queueAreaEmptyForApprover(pending, v))` — this is how the own-submission fallback is excluded without touching `pendingQueue.js`. `splitLinks` uses one regex `/https?:\/\/[^\s<>"']+/g`, then strips trailing `.,;:!?)` back into the following text segment. Header comment must say these functions mirror `firestore.rules` `audienceOk` and must change together.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node functions/verify-inbox.cjs && node --check src/lib/inbox.js`
Expected: every line `✓`, final exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/inbox.js functions/verify-inbox.cjs
git commit -m "feat(inbox): pure inbox logic + verify script

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Firestore rules + emulator rules test

**Files:**
- Modify: `firestore.rules` (add two blocks next to `/users`; helpers next to the other role helpers near the top of `match /databases/{database}/documents`)
- Create: `functions/verify-inbox-rules.cjs`
- Create: `firebase.rules-test.json` (emulator-only config; do **not** edit `firebase.json`)

**Interfaces:**
- Consumes: existing rule helpers `isSignedIn()`, `isKnownUser()`, `isCommittee()`, `userRole()`.
- Produces: the rules contract Tasks 3–4 rely on:
  - `match /announcements/{id}`: `read` if `isSignedIn() && audienceOk(resource.data.audience)`; `create` if `isCommittee() && validAnnouncement() && request.resource.data.createdBy == request.auth.uid`; `update` if `isCommittee() && validAnnouncement()` and `createdBy`/`createdAt` unchanged; `delete` if `isCommittee()`.
  - `validAnnouncement()`: keys `hasAll(['title','body','audience','pinned','expiresAt','createdBy','createdByName','createdAt','updatedAt'])` and `hasOnly` the same list; `title is string` 1–120; `body is string` 1–5000; `audience in ['all','approvers','leads']`; `pinned is bool`; `expiresAt == null || expiresAt is timestamp`.
  - `audienceOk(a)`: `a == 'all' && isKnownUser()` || `a == 'approvers' && userRole() in ['approver','staff','committee','admin']` || `a == 'leads' && userRole() in ['committee','admin']`.
  - `match /users/{uid}/inbox/{docId}`: read/write only when `isSignedIn() && request.auth.uid == uid`; writes require `keys().hasOnly(['readIds','updatedAt'])`, `readIds is list`, `readIds.size() <= 300`.
  - **List-query contract:** the app lists with `where('audience','in', allowedAudiences(role))`. This task must establish whether the emulator accepts that query for each role.

- [ ] **Step 1: Write the failing emulator test `functions/verify-inbox-rules.cjs`**

Approach: start emulators with `firebase.rules-test.json` (`{"firestore":[{"database":"ai-agent-lib","rules":"firestore.rules"}],"auth":{},"emulators":{"auth":{"port":9099},"firestore":{"port":8080},"singleProjectMode":true}}` — adjust to whatever the installed CLI accepts for a named database), seed `/users/{uid}` docs (roles `user`,`approver`,`staff`,`committee`,`admin`) and one announcement per audience with the Admin SDK (`FIRESTORE_EMULATOR_HOST`), then act as each role through the **client** SDK (`firebase` from root `node_modules`) signed in with the Auth emulator's fake Google credential (see `src/hooks/useAuth.js` `signIn(testEmail)`; email must be `@arise.tech` and `email_verified: true` or `isSignedIn()` rejects it). Named checks:
  - read-by-id: `user` can read the `all` doc, is denied `approvers` and `leads`; `approver` and `staff` read `all`+`approvers`, denied `leads`; `committee`/`admin` read all three; an `@gmail.com` verified user and an unverified `@arise.tech` user are denied everything.
  - **list queries** `where('audience','in', allowedAudiences(role))` (import the audience table from `src/lib/inbox.js` via `loadEsm`, no copy) succeed for every role and return only the permitted docs; an **unfiltered** `getDocs(collection)` is denied for `user`.
  - create: `committee` and `admin` can create a valid doc; `approver`/`user` denied; missing `createdByName`, 121-char title, 5001-char body, `audience:'everyone'`, an extra unknown field, and `createdBy` ≠ own uid → each denied.
  - update: `committee` can edit another author's doc; changing `createdBy` or `createdAt` → denied; delete by `committee` allowed, by `approver` denied.
  - own inbox state: a user can read/write `/users/{self}/inbox/state` with `{readIds:[…], updatedAt}`; reading/writing another user's → denied; 301 ids → denied; extra key → denied.
  Print `✓`/`✗` per check, exit 1 on any failure.

- [ ] **Step 2: Run it against the current rules to confirm failure**

Run: `firebase emulators:exec --config firebase.rules-test.json --only auth,firestore --project wolfy-481609 "node functions/verify-inbox-rules.cjs"` (use the global `firebase` binary, CLAUDE.md §11; Java is `~/.local/jdk-21*` per `docs/MOVE-TO-NEW-MACHINE.md` §2 — export `JAVA_HOME`).
Expected: FAIL — announcements/inbox reads denied because no rule exists yet (default deny).

- [ ] **Step 3: Add the helpers and the two `match` blocks to `firestore.rules` exactly as specified in Interfaces → Produces**

Keep every optional-field read on `.get()`. Note in a comment above `audienceOk` that it mirrors `allowedAudiences` in `src/lib/inbox.js`.

- [ ] **Step 4: Re-run the emulator test**

Same command. Expected: all checks `✓`.
**Contingency:** if the three list-query checks for `approver`/`staff`/`committee`/`admin` are denied while read-by-id passes, Firestore cannot prove the `in` query against the OR rule. Then keep the rules, change the list contract to **one query per allowed audience** (`where('audience','==', a)`), make this test run those per-audience queries instead, and record the decision in the commit message — Task 3's hook must implement whichever form passes here.

- [ ] **Step 5: Run the app-wide rule sanity checks**

Run: `firebase emulators:exec --config firebase.rules-test.json --only auth,firestore --project wolfy-481609 "node functions/verify-inbox-rules.cjs" && node --check functions/verify-inbox-rules.cjs`
Expected: exit 0. (There is no repo-wide rules test suite; do not add one.)

- [ ] **Step 6: Commit**

```bash
git add firestore.rules functions/verify-inbox-rules.cjs firebase.rules-test.json
git commit -m "feat(inbox): firestore rules for announcements + per-user inbox state

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Hooks, Inbox modal (read-only) and App wiring

**Files:**
- Create: `src/hooks/useAnnouncements.js`, `src/hooks/useInboxState.js`, `src/hooks/useMyRejected.js`
- Create: `src/components/InboxModal.jsx`
- Modify: `src/App.jsx` (Inbox button at ~line 384–392; modal mounts near line 646; badge computation near line 297), `src/components/MySubmissionsModal.jsx` (use `useMyRejected`), `src/styles/v7.css`, `functions/seed-emulator.cjs`

**Interfaces:**
- Consumes: `allowedAudiences`, `activeAnnouncements`, `unreadAnnouncements`, `pruneReadIds`, `splitLinks`, `myRequestItems`, `inboxQueueCount`, `showToApprove`, `inboxBadgeCount`, `AUDIENCE_LABEL` (Task 1); the list-query form fixed in Task 2; `db` from `src/lib/firebase.js`; `queueViewer` ctx `queueViewerCtx` already built in `App.jsx`.
- Produces:
  - `useAnnouncements(role: string|null, enabled: boolean): { announcements: Announcement[], loading: boolean }` — attaches only when `enabled && allowedAudiences(role).length > 0` (Review Focus 2); `permission-denied`/error → `[]`; sorting is client-side (no composite index).
  - `useInboxState(uid: string|null, enabled: boolean): { readIds: Set<string>, ready: boolean, markRead(id: string, knownIds: string[]): void, markAllRead(ids: string[]): void }` — reads/writes `users/{uid}/inbox/state` with `setDoc(..., { merge: true })`, always through `pruneReadIds`.
  - `useMyRejected(uid: string|null): Agent[]` — the existing query from `MySubmissionsModal.jsx:56-64` (`where('createdBy','==',uid)`, filter `approvalStatus === 'rejected'`), extracted unchanged; `MySubmissionsModal` now calls it.
  - `<InboxModal>` props: `{ user, role, isAdmin, isCommittee, announcements, readIds, onMarkRead(id), onMarkAllRead(), allAgents, pending, deployRequests, renameReqs, queueViewerCtx, onOpenAgent(agent), onOpenQueue(), onClose(), canPost, onCompose?(), onEditAnnouncement?(a) }` (the last three are wired in Task 4; accept and ignore here).

- [ ] **Step 1: Seed emulator data and write the browser verification checklist**

Extend `functions/seed-emulator.cjs` with 4 announcements — one per audience, one pinned, one already expired (`expiresAt` yesterday), body of one containing `<b>x</b> https://example.com/page and javascript:alert(1)` — plus a pending item, a deploy-requested item and a rejected item (within and beyond 14 days) created by the emulator `emu.user` account. The three emulator roles already exist (`tinnapat.p@arise.tech` admin, `emu.approver@arise.tech`, `emu.user@arise.tech`).

- [ ] **Step 2: Implement the three hooks to the signatures above**

Mirror the retry-on-permission-denied pattern in `useAgents.js` only if Task 2 showed the first listen can race the role doc; otherwise a plain `onSnapshot` with error → `[]` is enough. `useMyRejected` is a straight extraction.

- [ ] **Step 2b: Implement `InboxModal.jsx`**

Modal shell like `MySubmissionsModal` (`.mov open` / `.mbox`, `useEscapeKey`), tabs using the existing `.v7-inbox-filter` buttons with count chips. Tabs and rules: `All`; `Announcements` (unread count chip); `My requests` (count chip); `To approve` rendered only when `showToApprove(queueViewerCtx, queueCount)`. Announcements: pinned first, unread rows bold with a dot, click expands the body and calls `onMarkRead(id)`; a "Mark all read" button calls `onMarkAllRead()`. Body is rendered by mapping `splitLinks(body)` to text nodes and `<a href target="_blank" rel="noopener noreferrer">` only for segments with `href` (Review Focus 1). My requests: rows from `myRequestItems({ pending, allAgents, rejected: useMyRejected(user.uid), user })` showing status pill (`step.text`), age, and for `bad` the `step.hint` reason; click → `onOpenAgent(agent)`. To approve: the queue count and a `Open approval queue` button → `onOpenQueue()`. `All` = unread announcements, then my requests, then a one-line queue summary when `showToApprove`. Empty states are explanatory Thai text. `rejected` listener runs only while the modal is mounted.

- [ ] **Step 3: Wire `App.jsx`**

Add `const [showInbox, setShowInbox] = useState(false)`. Call `useAnnouncements(role, roleReady)` and `useInboxState(user?.uid, roleReady)` once in `App`; compute `unread = unreadAnnouncements(activeAnnouncements(announcements), readIds)`, `queueCount = inboxQueueCount(pending, parentDeployRequests, renameReqs, agents, queueViewerCtx)`, `inboxCount = inboxBadgeCount({ unreadCount: unread.length, queueCount })`. The Inbox button now opens `InboxModal` (`setShowInbox(true)`), shows `inboxCount` in `.v7-badge` and the aria-label `Inbox, N unread`. `onOpenQueue` closes the Inbox and sets `showPending(true)`. The existing `?view=pending` deep-link effect and `PendingApprovalModal` mount are unchanged. `pendingCount`/`pendingBadgeCount` is no longer used by the button — keep the import only if still used elsewhere (search first).

- [ ] **Step 4: Add `.v7-ann-*` styles**

In `src/styles/v7.css` under `body.v7`: unread dot, pinned marker, announcement row/expanded body (pre-wrap), status pill reuse of existing `.status-pill` classes. Check dark mode via existing tokens only.

- [ ] **Step 5: Verify**

Run: `node --check src/lib/inbox.js && npm run build` → Expected: build passes, no new lint errors in touched files (`npm run lint`).
Browser (emulators + `npm run dev`, as in `docs/MOVE-TO-NEW-MACHINE.md` §2; sign in with each emulator role) — confirm and screenshot:
  - `emu.user`: tabs `All`, `Announcements`, `My requests` only; sees the `all` announcement, **not** the `approvers`/`leads`/expired ones; the `<b>` and the `javascript:` text appear as plain text, `https://example.com/page` is a link; My requests shows the pending + deploy-requested rows and the within-14-days rejected row with its reason, not the 15-day one; no `To approve` tab; badge = unread announcements only.
  - `emu.approver`: also sees the `approvers` announcement; `To approve` appears only if they have a queue item.
  - admin: sees all three audiences; `To approve` present.
  - Opening an announcement lowers the badge, survives a reload (`readIds` persisted), and "Mark all read" zeroes it.
  - A user doc without a role (delete the role field in the emulator UI) → no console errors, Inbox shows only My requests/empty state.

- [ ] **Step 6: Commit**

```bash
git add src/hooks src/components/InboxModal.jsx src/App.jsx src/components/MySubmissionsModal.jsx src/styles/v7.css functions/seed-emulator.cjs
git commit -m "feat(inbox): Inbox modal with announcements, my requests, to-approve

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Announcement composer, edit, pin and delete

**Files:**
- Create: `src/components/AnnouncementComposer.jsx`, `src/lib/announcements.js`
- Modify: `src/components/InboxModal.jsx`, `src/App.jsx` (pass `canPost`/handlers), `src/styles/v7.css`

**Interfaces:**
- Consumes: `validateAnnouncement`, `canPostAnnouncements`, `AUDIENCES`, `AUDIENCE_LABEL` (Task 1); the rules contract (Task 2); `<InboxModal>` props `canPost`, `onCompose`, `onEditAnnouncement` (Task 3).
- Produces (`src/lib/announcements.js`, all return a Promise and write with `serverTimestamp()`):
  - `createAnnouncement(user, { title, body, audience, pinned, expiresAt: Date|null }): Promise<string>` — writes every key listed in the rules' `validAnnouncement()` (`createdBy` = `user.uid`, `createdByName` = `user.displayName || user.email`, `createdAt`/`updatedAt` = `serverTimestamp()`); returns the new id.
  - `updateAnnouncement(id, { title, body, audience, pinned, expiresAt }): Promise<void>` — `updateDoc` of those five fields + `updatedAt` only; never touches `createdBy`/`createdAt`.
  - `deleteAnnouncement(id): Promise<void>`

- [ ] **Step 1: Write the failing check — extend `functions/verify-inbox-rules.cjs`**

Add checks that use the exact payload shape `createAnnouncement`/`updateAnnouncement` will send (build it with a small shared constant mirrored in the script and annotate "keep equal to src/lib/announcements.js"): committee `create` with `expiresAt: null` passes; with a `Timestamp` passes; `update` with only the five editable fields + `updatedAt` passes and a payload that omits `expiresAt` on create is denied.

- [ ] **Step 2: Run it** (same `emulators:exec` command as Task 2) — Expected: PASS already if Task 2 rules are right; if any new check fails, fix the rules or the payload constant before continuing.

- [ ] **Step 3: Implement `src/lib/announcements.js`** with the three signatures above, and `AnnouncementComposer.jsx`

Composer: modal opened from a `New announcement` button shown in the Announcements tab when `canPost`. Fields/labels exactly as in Global Constraints; audience as a radio group; character counters for title (120) and message (5000); inline error from `validateAnnouncement` (Thai explanatory text); `Post` disabled while saving; on success close and the new row appears via the live listener. Edit mode (opened from a row's `Edit` action, visible when `canPost`) prefills and shows `Save changes` and a `Delete` button that asks a confirm sentence first; pin is toggled inside the composer. Failure uses `failMsg('ส่งประกาศ', e)` from `src/lib/copy.js`.

- [ ] **Step 4: Wire `InboxModal`/`App.jsx`**

`canPost = canPostAnnouncements(role)`; `onCompose`/`onEditAnnouncement` open the composer. Authors see exactly what everyone in that audience sees — an expired announcement is hidden for authors too (YAGNI; to re-use or remove one, post/edit before it expires).

- [ ] **Step 5: Verify**

Run: `npm run build && node functions/verify-inbox.cjs` → Expected: pass.
Browser (emulators): as admin post one announcement per audience (one pinned, one with an expiry date tomorrow, one with an invalid 121-char title to see the inline error); confirm `emu.user` sees only `Everyone`, `emu.approver` sees `Approvers and above` too; edit a title and see it change live for the other session; delete one and see it disappear and its id pruned from `readIds` on the next read action; a plain user and an approver see no `New announcement` button.

- [ ] **Step 6: Commit**

```bash
git add src/components/AnnouncementComposer.jsx src/lib/announcements.js src/components/InboxModal.jsx src/App.jsx src/styles/v7.css functions/verify-inbox-rules.cjs
git commit -m "feat(inbox): announcement composer with edit, pin, expiry and delete

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Docs and release checklist

**Files:**
- Modify: `CLAUDE.md` (new numbered section after the last one, written like §34/§35), `docs/memory/` only if a durable preference emerged

**Interfaces:**
- Consumes: everything above.
- Produces: the written handover + the exact release commands for the user.

- [ ] **Step 1: Write the CLAUDE.md section "Inbox + announcements (2026-11-17, rules + hosting)"**

Cover: audience table and the rule that `allowedAudiences` ⇔ `audienceOk` change together; the list-query form chosen in Task 2; that "My requests" = waiting + rejected ≤14 days and that action-needed items are deliberately excluded; that the Inbox badge ignores the base-user own-submission fallback (`inboxQueueCount`), `pendingQueue.js` untouched; key files and the two verify scripts (`verify-inbox.cjs`, `verify-inbox-rules.cjs`); the known limitations (no per-team/per-person targeting, plain text only).

- [ ] **Step 2: Final verification and release hand-off**

Run: `node functions/verify-inbox.cjs && firebase emulators:exec --config firebase.rules-test.json --only auth,firestore --project wolfy-481609 "node functions/verify-inbox-rules.cjs" && npm run build && git status --short` → Expected: all pass, clean tree except pre-existing untracked files.
Then present to the user (do **not** run): (1) publish `firestore.rules` in the Console for database `ai-agent-lib`; (2) once the user confirms, back up hosting to a `prod-backup-inbox` channel for both sites, `npm run build`, `firebase deploy --only hosting --project wolfy-481609`, verify the live bundle hash, `git push origin main`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: inbox + announcements section

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
