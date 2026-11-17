# Inbox: announcements + my pending requests — design

Date: 2026-11-17 · Status: draft for approval (builder check done; user answered 2 open questions) · Repo: agent-library (AI Agent Library)

## 1. Intent and why

1. **A company → user channel that is not email.** Admin/committee need to tell users things
   (maintenance, new rules, workshop news) inside the web app. Email/Teams already exist for
   per-event notifications (CLAUDE.md "Microsoft Teams notifications"); the user explicitly does
   **not** want announcements to go that way.
2. **"Waiting for approval" must be easy to find.** Today it is only in *My Submissions*
   (☰ menu → `MySubmissionsModal`), which users don't find. It should live in the **Inbox** —
   the button they already see on the Library page.
3. **Level-scoped visibility.** Each user sees only what their role/ownership entitles them to.

## 2. Goals, non-goals, anti-goals

**Goals**
- Admin **and committee** create announcements targeted by level (user decision, option B):
  - `all` — every known user (user, workshop, staff, approver, committee, admin)
  - `approvers` — approver, staff, committee, admin
  - `leads` — committee, admin
- Inbox shows, per user: announcements they may read · their own items waiting for review ·
  their own deploy requests waiting · (approver+ only) the existing approval queue.
- Unread state per user, stored server-side (same on every device), drives the Inbox badge.

**Non-goals (this round)**
- Targeting a team (Owner) or individual people. (Can be added later as another `audience` kind.)
- Rich text/images/attachments in announcements. Plain text with line breaks; URLs auto-linked.
- Sending announcements by Teams/email.
- Replacing *My Submissions* — it stays as is.

**Anti-goals (would be a failure even if it "works")**
- A user can read an announcement outside their audience (must be enforced by Firestore rules,
  not only hidden in the UI).
- Status items that stay in the Inbox after the item was approved (stale messages).
- The Inbox badge showing a number that does not match what the Inbox lists (this exact bug class
  already happened twice — CLAUDE.md §29, `pendingQueue.js`).

## 3. Constraints (from the project)

- React + Vite SPA, Firestore named DB `ai-agent-lib`. Rules are published **manually by the user
  in the Console** and must be published **before** the hosting deploy that uses them.
- No new Cloud Function needed (decision: approach A). Hosting + rules only.
- Roles: `user, workshop, staff, approver, committee, admin` (`firestore.rules` helpers
  `isKnownUser`, `isCommittee`, `userRole()`).
- Labels/headers in English; Thai only for explanatory text (CLAUDE.md §6).
- Production deploys need explicit user approval each time; backup hosting to a channel first.

## 4. Approaches considered

| | Approach | Trade-off | Picked |
|---|---|---|---|
| A | Announcements as central docs `/announcements/{id}` with an `audience` field; rules gate reads by role. Per-user read state in `/users/{uid}/inbox/state`. Status items computed **live** from data the app already loads. | No functions; 1 write per announcement; late joiners still see active announcements; status can't go stale. Per-person targeting needs a later extension. | ✅ user picked |
| B | Fan-out copies per user via a Cloud Function; status messages written on submit/deploy request. | Simple per-user rules, per-person targeting free; but a new function, ~200 writes per announcement, late joiners miss old ones, edits/deletes must touch every copy, status messages go stale. | ✗ |
| C | One `/config` doc holding all announcements, filtered in the client. | Users outside the audience could still read it → violates level gating. | ✗ dropped |

## 5. Design (approach A)

### 5.1 Data

`/announcements/{autoId}`
| field | type | notes |
|---|---|---|
| `title` | string, 1–120 chars | |
| `body` | string, 1–5000 chars | plain text; `\n` kept; URLs rendered as links (client) |
| `audience` | `'all' \| 'approvers' \| 'leads'` | |
| `pinned` | bool | pinned first, then newest |
| `expiresAt` | Timestamp \| null | optional; client hides expired ones |
| `createdBy`, `createdByName` | string | uid + display name of author |
| `createdAt`, `updatedAt` | server timestamps | |

`/users/{uid}/inbox/state`
| field | type | notes |
|---|---|---|
| `readIds` | string[] | announcement ids this user opened. Client prunes ids that no longer exist / are expired when it writes, cap 300. |
| `updatedAt` | server timestamp | |

### 5.2 Firestore rules (new blocks)

```
function audienceOk(a) {
  return a == 'all' && isKnownUser()
    || a == 'approvers' && userRole() in ['approver','staff','committee','admin']
    || a == 'leads' && userRole() in ['committee','admin'];
}
match /announcements/{id} {
  allow read: if isSignedIn() && audienceOk(resource.data.audience);
  allow create: if isCommittee() && validAnnouncement() && request.resource.data.createdBy == request.auth.uid;
  allow update: if isCommittee() && validAnnouncement();
  allow delete: if isCommittee();
}
match /users/{uid}/inbox/{doc} {
  allow read, write: if isSignedIn() && request.auth.uid == uid;
}
```
- `validAnnouncement()` checks types/lengths above and `audience in [...]`.
- **List queries must constrain audience** so rules can prove every result is allowed:
  the client queries `where('audience', 'in', allowedAudiences(role))`. A query without that
  filter is rejected by rules — this is intended.
- `isCommittee()` already includes admin.

### 5.3 Client

**Shared pure module `src/lib/inbox.js`** (single source of truth, unit-testable):
- `allowedAudiences(role)` → array used for the query (mirror of `audienceOk`).
- `activeAnnouncements(list, now)` → drop expired, sort pinned → newest.
- `myRequestItems({ pending, allAgents, rejected, user, now })` → the user's OWN items whose
  `nextStep(a).tone === 'wait'` ("Waiting for review", "Deploy requested") **plus** their own
  rejected/withdrawn items from the last 14 days (shown with the reason, `nextStep` tone `bad`).
  `act` items ("Update progress", "Mark ready to use", "Request deploy") are **not** listed
  (user decision) — they stay in My Submissions and in the Teams/email alerts. Reuses `nextStep()`
  and `isMyAgent()` from `src/lib/mySubmissions.js`; no new status logic.
- `inboxBadgeCount({ unreadAnnouncements, approvalQueueCount })` = unread announcements + the
  approval-queue count **only for viewers who get the To-approve tab**. Own waiting/rejected items
  are never counted.

**Hook `useAnnouncements(role)`** — one onSnapshot listener in `App.jsx` (feeds badge + Inbox),
same pattern as the `renameRequests` listener.

**Hook `useInboxState(uid)`** — reads/writes `/users/{uid}/inbox/state`; `markRead(id)`,
`markAllRead()`.

**Inbox UI** — the existing Inbox button (`v7-inbox-btn`, `App.jsx`) opens a new
`InboxModal` with tabs (hidden when empty / not permitted):
```
┌ Inbox ─────────────────────────────────────────────────────┐
│ [All] [Announcements •2] [My requests 3] [To approve 5]     │
│ 📌 System maintenance 20 Nov 18:00   · Admin · New          │
│ ⏳ Fund Fact Sheet — Waiting for review       · 3 days       │
│ ⏳ Nok - CIO doc — Deploy requested            · 1 day        │
│ ✅ 5 items waiting for your approval →  (opens To approve)  │
└─────────────────────────────────────────────────────────────┘
```
- *Announcements*: click → expands body, marks read. Unread shown bold with a dot.
- *My requests*: waiting items + own rejected/withdrawn items (≤14 days, with reason). Rows
  link to `AgentDetailModal` (same as My Submissions). Rejected items need the same
  `createdBy == uid` query My Submissions already runs; the Inbox reuses it (one listener, opened
  with the Inbox, not at app start).
- *To approve*: shown only to approver-level viewers with a real queue: `fullAccess` (admin/
  committee) or an approver/staff with ≥1 item in their areas. Shows the count and a button that
  opens the **existing `PendingApprovalModal`** (no refactor of that modal; `?view=pending` deep
  link still opens it directly). **`pendingQueue.js` is not changed**, but the Inbox must not count
  the base-user fallback in `visiblePending` (own pending items when the viewer has no area match):
  the Inbox computes `approvalQueueCount` with `queueViewer`'s `fullAccess`/`areas` only and
  ignores that fallback, so own items are not counted twice (they live in *My requests*).
- *All*: announcements (unread first) + my requests + a one-line summary of the approval queue.

**Composer** — admin/committee open "New announcement" from the ☰ menu (Admin section; moved there on 2026-11-17 at the user's request — originally in the Inbox Announcements tab); edit stays on each announcement row inside the Inbox:
title, body, audience (radio: Everyone / Approvers and above / Admin & Committee), pin toggle,
optional expiry date. Edit/delete from the announcement's own row (author or any
admin/committee).

**Badge** = unread announcements + the approval-queue count for approver-level viewers.
**Waiting and rejected items are listed but not counted** — the user can't act on them, and
counting them would keep the badge permanently lit.

### 5.4 Tests / verification
- `src/lib/inbox.js` unit tests (node): audience mapping per role, expiry/sort, my-requests
  derivation against fixtures, badge arithmetic.
- Rules check in the emulator: user can't read `approvers`/`leads` docs; list query without the
  audience filter is denied; user/approver can't create; committee/admin can; a user can only
  read/write their own `inbox/state`.
- Browser (emulator): each role sees the right tabs; badge equals listed unread/actionable items.

### 5.5 Rollout
1. User publishes `firestore.rules` (Console, DB `ai-agent-lib`).
2. Backup hosting channel → deploy hosting → push.
3. Admin posts a first announcement to `leads` to try it, then to `all`.
No data migration, no functions deploy.

## 6. Decided by the user
- Approach A · audience levels (B: all / approvers / leads) · authors = admin **and** committee ·
  no email/Teams for announcements · status "waiting for approval" moves into the Inbox,
  level-gated · My Submissions stays · *My requests* lists waiting items only (action-needed
  items are not listed or counted) · rejected/withdrawn items **are** shown with their reason.

## 7. My calls (user may override)
- Plain text + auto-linked URLs, no rich text. Optional expiry; pinning.
- Authors: any admin/committee may edit or delete any announcement; `createdBy`/`createdAt`
  cannot change on update.
- Role → audience table: `all` = user, workshop, staff, approver, committee, admin;
  `approvers` = approver, staff, committee, admin; `leads` = committee, admin. A user with no
  role doc yet (`roleReady` false) does not subscribe and sees no announcements. The client
  `allowedAudiences(role)` must equal the rules' `audienceOk` exactly — a mismatch makes the whole
  `in` query fail, so the module test pins the table.
- Unread = active (not expired), not in `readIds`. Late joiners see still-active announcements as
  unread. Editing does not re-mark as unread (post a new one instead). `readIds` capped at 300.
- Rejected/withdrawn items stay in *My requests* for 14 days (my choice; user didn't specify).
- To-approve tab = button to the existing queue modal; no refactor of `PendingApprovalModal`.
- Waiting and rejected items are listed but not counted in the badge.

## 8. Left to the builder
- Exact component split/CSS (`.v7-` prefix, reuse existing modal + tab styles).
- Relative-time formatting, empty-state copy (Thai explanatory, English labels).
