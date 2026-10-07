# Workshop — Full Reference

> Last updated: 2026-09-18. Covers everything built across the 2026-09-16,
> 2026-09-17, and 2026-09-18 rounds. This is the standalone `/workshop` page —
> a live-facilitation board layered on top of the same SDLC catalog the main
> Agent Library uses, built for running an internal ideation/workshop event
> where teams pitch and develop new Agent/Skill ideas.

---

## 1. What it is, in one paragraph

`/workshop` is a separate SPA route (not nested inside the main `App.jsx`,
routed directly by `src/main.jsx`) that shows the same 58-process SDLC board
as `SDLCTab.jsx`, but instead of tracking real agents, each process card can
be "tagged" with team-submitted stickers representing a proposed Agent/Skill
idea. Each sticker carries a status (Idea → Dev → Review → Done) that the
owning team advances over the course of the workshop, and once an idea hits
Done, it can be submitted straight into the real Agent Library through the
existing Pre-Registration flow — the one deliberate, sanctioned bridge
between this isolated feature and the main product.

---

## 2. The non-negotiable isolation rule (read this first)

**No action on the Workshop page may affect the main Library's features or
data**, except the one explicit exception below. Concretely:

- No Workshop rule or write path ever touches `/agents`, `/sdlcProcesses`,
  `/sdlcUseCases`, or `/config/schema` (read is fine — see §7 for the exact
  reads it does).
- The **one sanctioned exception**: the "Register for AI Library" link (§5.6)
  opens the real `PreRegModal` and writes into the real `/agents` collection
  via the exact same `approvalStatus: 'pending'` approval queue the main
  Library's own "+ New" button uses. Nothing about that pipeline is bypassed,
  duplicated, or given special treatment — same component, same rules, same
  approval process. A workshop participant clicking it is doing the identical
  thing a main-Library user does clicking "+ New".
- Workshop's own collections (`workshopTeams`, `workshopIdeas`,
  `ideationStickers`, `pendingRoleGrants`, `config/workshopTeamCounter`) are
  entirely new/isolated — nothing pre-existing was repurposed.

---

## 3. Roles

Defined in `src/components/UserManagementModal.jsx:22`:
```js
const ROLES = ['user', 'workshop', 'staff', 'approver', 'committee', 'admin'];
```

| Role | Main Library access | Workshop access |
|---|---|---|
| `user` | base tier | **none** — cannot see or open `/workshop` |
| `workshop` | identical to `user` (nothing more) | full participant: view board, add/edit/delete own stickers, advance status on own team's ideas |
| `staff` | export-only widening over `user` | same as `workshop`, plus: edit/delete **any** sticker, advance status on **any** idea |
| `approver` | approve/reject scoped to own areas | same as `workshop` (view + add), no special Workshop powers |
| `committee` | everything except user-mgmt | staff-equivalent on Workshop (edit/delete any sticker) |
| `admin` | everything | staff-equivalent **plus** the only role that can open Team & User Management (create/rename/delete teams, manage membership) |

Two role-list constants inside `WorkshopPage.jsx` control this:
```js
const WORKSHOP_VIEW_ROLES = ['admin', 'committee', 'staff', 'workshop'];
const WORKSHOP_TAG_ROLES  = ['admin', 'committee', 'staff', 'workshop'];
const isStaffPlus = ['admin', 'committee', 'staff'].includes(role);
const isAdmin = role === 'admin';
```
`approver` and `user` are deliberately absent from both lists — an `approver`
can use the main Library normally but has no special Workshop capability
beyond what `user` already lacks (they simply can't see the page at all,
same as `user`).

---

## 4. Data model

### 4.1 `workshopTeams/{id}`
```js
{
  name: string,              // plain numeral for the 18 official teams ("1".."18"),
                              // free text for anything admin creates later
  number: string,            // 2-digit zero-padded ("01".."18"), shown on stickers
  members: string[],         // Firebase Auth UIDs — the permission source of truth
  memberNames: {             // uid -> display name, decorative only, never read
    [uid]: string            // for permission decisions
  },
  createdBy: string,         // uid, or 'migration' for script-created teams
  createdByName: string,
  createdAt: Timestamp,
}
```
- **Numbering**: claimed via a shared counter transaction (`config/workshopTeamCounter.next`,
  see §4.3), never hand-assigned, so two simultaneous "create team" actions
  can't collide.
- **Membership is UID-keyed, not email-keyed** — every permission check
  (`canAdvanceStatus` client-side, the status-transition rule server-side)
  compares against `request.auth.uid`/`user.uid`, the only stable identity
  Firestore Auth actually gives at request time. Email is only used as the
  *lookup key* before someone has ever logged in (§6).
- **Creation**: any `workshop`+ role could create a team as of 2026-09-16
  (implicit, via submitting a sticker with a brand-new team name). As of
  2026-09-17 this path is **closed in the UI** — the Add Sticker form's Team
  field is a pick-only autocomplete (§5.5) — but the underlying
  `firestore.rules` `allow create` is still technically open to any
  `workshop`+ role for defense-in-depth reasons (not yet tightened to
  admin-only; see §9 "Known follow-up").
- **Rename/delete/membership**: admin-only (`isAdmin()`), both in
  `firestore.rules` and gated by the UI (only `admin` sees the "Team & User
  Management" icon button at all).

### 4.2 `workshopIdeas/{ideaId}` — the sticker
```js
{
  processId: string,         // SDLC process id, e.g. "1.1"
  team: string,              // denormalized team NAME (for display + the
                              // existing rename-cascade batch-rewrite)
  teamId: string,            // workshopTeams doc id — the real relationship,
                              // used for the team-membership permission check
  ideaName: string,          // field name unchanged since 2026-09-16, but its
                              // MEANING changed to "Skill short description"
                              // as of 2026-09-17 (max 100 chars)
  status: 'idea' | 'dev' | 'qa' | 'done',  // 'qa' displays as "Review" in the
                              // UI (label-only rename, the stored value and
                              // all rules logic still use 'qa')
  skillName: string,         // only set once status becomes 'done' — the
                              // name entered in the inline "mark as Done" form
  createdBy: string,         // uid
  createdByName: string,
  createdAt: Timestamp,
  updatedAt: Timestamp,      // set on any edit or status change
  // Legacy fields from the pre-2026-09-17 pain/improvement design, still
  // present on OLD docs, no longer written by new create/edit and no longer
  // read by the Workshop-tab render path:
  kind: 'pain' | 'improvement',
  useCaseId: string | null,
  useCaseName: string | null,
}
```
- **Status pipeline** (`idea → dev → qa → done`): strictly sequential, one
  step at a time, no skipping, no reverting — enforced in `firestore.rules`
  (the real boundary), mirrored in the UI (`StatusProgressBar` only renders
  the *immediate next* circle as clickable).
- **The `done` transition is special**: clicking it doesn't write immediately
  — it reveals an inline required "Skill name" field first. Only submitting
  that (non-empty) writes `status: 'done'` and `skillName` together in one
  update.
- **Cap**: uncapped as of 2026-09-17 (was 3-per-process-card in the original
  2026-09-16 design).
- **Team rename cascade**: when admin renames a team, every `workshopIdeas`
  doc whose `team` string matches the old name is batch-rewritten to the new
  name (`renameTeam()` in `WorkshopPage.jsx`) — this is why `team` (the
  string) is kept alongside `teamId` rather than being replaced by it.

### 4.3 `config/workshopTeamCounter`
```js
{ next: number }
```
A single shared counter, incremented via a Firestore transaction every time
a team is created (`claimNextTeamNumber()`), whether that's the implicit
sticker-submission path or the admin's explicit "+ Add team" button. This is
the **only** place team numbers are assigned — never hand-computed elsewhere,
including in the one-off backfill script, which duplicates the transaction
logic in plain Admin-SDK form (client SDK and Admin SDK have different
transaction APIs, so it can't literally `require()` the client function) but
is commented as "must stay in sync."

### 4.4 `ideationStickers/{id}` — the Ideation tab (hidden, not deleted)
```js
{ processId: string, kind: 'pain' | 'improvement', createdBy: string, createdAt: Timestamp }
```
A separate, anonymous, uncapped sticker type — plain colored dots with no
team/name attached, hover-reveal instant-delete (no confirm dialog by
design). **This whole feature is fully built and still works**, but its nav
tab button was removed as of 2026-09-17 per explicit request ("hide, don't
delete — not ready to use yet"). `activeTab` state can still technically
become `'ideation'` if forced (e.g. via devtools), and the entire
add/delete/render pipeline still functions if it does — this was a deliberate
design choice so the feature isn't lost, just inaccessible via UI.

### 4.5 `pendingRoleGrants/{emailLower}` — first-login provisioning
```js
{
  role: 'workshop' | 'staff',
  teamNumber: string | null,   // zero-padded, only set when role === 'workshop'
  email: string,
  createdAt: Timestamp,
  createdBy: 'backfill-workshop-roster.cjs',
}
```
Written only by the roster backfill script, for any roster row whose email
had no `/users` doc yet (i.e., someone who has never logged into the app).
**Fully closed to every client** (`allow read, write: if false`) — consumed
only by the `claimPendingRoleGrant` Cloud Function, which deletes the grant
once claimed. See §6 for the full first-login flow.

---

## 5. Page structure & components (`src/components/WorkshopPage.jsx`)

### 5.1 Nav bar
- **Brand** ("AI Agent Library / Powered by Wolfy") is clickable →
  `window.location.href = '/'`, returning to the main Library. This was a
  deliberate 2026-09-17 addition so Workshop feels like part of the same app
  rather than a dead-end.
- **Tabs**: `Workshop` | `Use Cases` (Ideation tab button removed, see §4.4).
- **Search box** (Use Cases tab only): as of 2026-09-18, restyled to be
  pixel-for-pixel identical to the main Library's own nav search
  (`.ws-search`/`.ws-search-wrap`/`.ws-search-inp`, same pill shape, same
  inline magnifying-glass SVG, `flex:1` positioning between the tabs and the
  trailing icon/chip group, hidden under 700px) — it was previously an ugly
  full-width box in the page body. **Filtering logic itself never changed**:
  `buildAgentFilter({ type: 'all', search })` from `src/lib/agentUtils.js`,
  hiding entire non-matching `UCCard`s (not just rows within a card). Note
  the `type: 'all'` is load-bearing — `buildAgentFilter`'s type check is
  `type !== 'all' && ...`, so omitting `type` entirely (`undefined`) fails
  every single agent; this was a real bug shipped and fixed same-day.
- **Admin-only icon button** (people/user-management SVG, reused from
  `UserManagementModal.jsx`'s own icon) opens Team & User Management (§5.7).
  Visible only when `role === 'admin'` — note this is a *tighter* gate than
  `isStaffPlus`, which is why it uses its own `isAdmin` const rather than
  reusing the existing one (that one still gates sticker edit/delete
  elsewhere and was deliberately left untouched).
- **Chips**: live Agent/Skill counts (same `getType()` classification as the
  main Library).
- **No avatar/user info** — removed 2026-09-17, was previously showing the
  signed-in user's photo/initial.

### 5.2 Workshop tab — the SDLC board
Forked layout constants from `SDLCTab.jsx` (not imported — deliberately a
separate, read-mostly copy so the production board can never regress from
Workshop work): `STAGE_COLOR`, `GROUPS` (Discovery/Development/After
Development), `ALL_STAGES`. Each process card (`ProcessCard`) shows:
- Process id/name, optional expandable description.
- A live status breakdown of real agents mapped to that process
  (`agentsForProcess`), reusing `agentStatus`/`ST_DEF`/`progressBucket` from
  `src/lib/status.js` — this is a **read**, not a write, of main-Library data.
- The sticker row for that process (see §5.3).

### 5.3 Sticker rendering (`WorkshopStickers`)
- A filled circle showing the team's **2-digit number** (looked up live from
  `teams` state by `idea.teamId` — never duplicated onto the idea doc itself).
- Color comes from `STATUS_COLOR` keyed by the idea's `status`:
  `idea:#f03a16` (red), `dev:#fad42d` (yellow), `qa:#a1e312` (green,
  displayed as "Review"), `done:#1aacf0` (blue).
- Click opens `StickerDetailPopup`.
- The "+ Add sticker" trigger is a small dashed-grey circle, visible to any
  `workshop`+ participant, uncapped.

### 5.4 Sticker detail popup (`StickerDetailPopup`)
Shows: a larger copy of the sticker's own colored circle (top-left), Team
name, Skill short description, a 4-step `StatusProgressBar` (§5.4.1), and —
only once `status === 'done'` — a "Register for AI Library →" link (§5.6).
Edit (✎) / Delete (🗑) icon buttons appear bottom-right, gated by
`canEditIdea`/`canDeleteIdea` = `isStaffPlus || (creator === self)`.

#### 5.4.1 `StatusProgressBar`
Four connected circles (Idea/Dev/Review/Done). Only the circle immediately
after the current status is ever clickable — clicking `dev`/`qa` advances
immediately; clicking the `done` target reveals an inline required "Skill
name" text field with Save/Cancel, and only Save actually writes
`status:'done'` + `skillName` together.

`canAdvanceStatus(idea)` — who may click:
```js
isStaffPlus || idea.createdBy === user.uid ||
  (teams.find(t => t.id === idea.teamId)?.members || []).includes(user.uid)
```
i.e. staff+, the idea's own creator, or **any admin-added member of that
idea's team** — this last clause is why `workshopTeams.members` exists at
all: someone other than the original submitter can do the actual dev/review
work and advance the sticker.

`handleAdvanceStatus` writes **only** `{status, updatedAt}` or
`{status, skillName, updatedAt}` — never spreads other fields, because the
`firestore.rules` status-transition branch requires
`affectedKeys().hasOnly(['status','skillName','updatedAt'])` exactly.

### 5.5 Add/Edit Sticker form (`AddIdeaModal`)
Current (2026-09-18) field set, all-English labels:
- **Team**: type-to-filter autocomplete (`ComboInput`, non-readOnly for
  filtering, but with `hideAddHint` set so it never shows a misleading
  "+ Add \"x\"" suggestion). **Must resolve to an exact existing team name**
  — `handleSubmit` explicitly rejects any typed value with no case-insensitive
  match ("Please select an existing team from the list."). Team creation is
  **admin-only**, exclusively through the Team & User Management panel's
  "+ Add team" control — there is no way to create a team from this form
  anymore (as of 2026-09-17/18; originally, in the 2026-09-16 design, typing
  a new name here would auto-create a team).
- **Skill short description**: single-line text, `maxLength={100}`, with an
  italic example hint shown above the field and a live `n/100` counter below
  it.
- Removed entirely from the original design: the pain/improvement `kind`
  radio (replaced by the status pipeline) and the "link to a Use Case"
  picker (`useCaseId`/`useCaseName`).

### 5.6 "Register for AI Library" bridge
Clicking the link on a `done` sticker calls `openPreRegForIdea(idea)`:
```js
setPreRegPrefill({ agentName: idea.skillName, description: idea.ideaName, owner: idea.team });
setShowPreReg(true);
```
This mounts the **real** `PreRegModal` (same component the main Library's
"+ New" button uses), pre-filled via a new optional `prefill` prop added to
`PreRegModal.jsx`:
```js
const [form, setForm] = useState(() => ({ ...EMPTY_FORM, ...(prefill || {}) }));
```
`schema`/`onAddRelatedRole`/`onAddTeam` are sourced from `useConfigSchema()`
— the same read/grow-only hook the main `App.jsx` already uses — newly
imported into `WorkshopPage.jsx` for this purpose. This is read/grow-only
shared infrastructure, not a violation of the isolation rule.

**Known friction, not a bug**: `PreRegModal.validate()` enforces a
100-character *minimum* on Description; a prefilled description coming from
the 100-char-*capped* short-description field can land right at or under that
minimum and fail validation on submit. The participant has to expand the
text inside the already-open modal. This is intentional — Workshop doesn't
pad or silently work around it.

Ask ALPHA (`ChatAssistant`) is also mounted — Use Cases tab only — wired to
the same shared `showPreReg`/`preRegPrefill` state (its own "register" click
resets `preRegPrefill` to `null` so it always opens blank, no bleed-over from
a sticker-triggered prefill).

### 5.7 Team & User Management (`TeamUserManagerModal`, admin-only)
- **Team list**: each row shows `#number — name`, with Rename / Delete /
  "Members (N)" controls.
- **"+ Add team"**: an inline text input + button at the top of the modal,
  calling `handleAddTeam(name)` — rejects (throws) on a duplicate name rather
  than silently reusing the existing team (unlike the tolerant
  `ensureTeam()` used internally for sticker submission's team resolution).
  Both paths funnel through one shared `createTeamDoc(name)` helper so the
  counter-claiming logic (§4.3) is never duplicated.
- **Member management**: expand a team to see chips of current members
  (name + × to remove) and an autocomplete (`ComboInput`, built from a
  `${displayName || email} (${email})` display string, resolved back to the
  matching user object on Add — email is always unique so this is a stable
  1:1 key even if two people share a display name).
- **User source**: a `/users` listener scoped to only run while this modal is
  open (mirrors `UserManagementModal.jsx`'s own scoping pattern), filtered
  client-side to `['workshop','staff','committee','admin']` roles.
- **No self-serve joining** — this was an explicit design decision: a user
  picking a team when submitting a sticker does *not* make them a member of
  that team. Membership is 100% admin-curated.

### 5.8 Use Cases tab
Groups `sdlcUseCases` by stage (joined through `sdlcProcesses.stage` — a
**read** of main-Library data), rendering `UCCard`s. Each card:
- Shows any `workshopIdeas` linked via `useCaseId` (legacy field — new
  stickers as of 2026-09-17 don't set this, so this only surfaces stickers
  created before that round).
- Shows the real agents/skills mapped to that use case (`agentsForUC`) as
  clickable rows — clicking opens the **real** `AgentDetailModal`
  (`isAdmin={false}`, `onEditAgent={undefined}` — deliberately read-only, so
  workshop participants can inspect existing agents/skills to avoid
  proposing duplicates, but can never edit the main Library from here).
- Whole cards (including zero-agent "No agent/skill yet" ones) disappear
  when the search box doesn't match any of that card's agents.

### 5.9 Theme
Forces light mode for the page's lifetime via a mount/unmount effect that
patches `document.documentElement.dataset.theme`, restoring whatever was
there before on unmount. Never touches the `agentlib-theme` localStorage key
that `useTheme.js` manages — the user's global theme preference elsewhere in
the app is completely unaffected.

---

## 6. First-login provisioning & the roster backfill

### 6.1 The roster
A Google Sheet (`Team,Fullname (English),Email,Level`) maintained by the
admin: 18 numbered teams at `Level=Workshop`, plus a `Level=Staff` list, ~196
people total, all `@arise.tech`/`@infinitaskt.com`.

### 6.2 One-off script: `functions/backfill-workshop-roster.cjs`
Fetches the sheet **live** at run time (never committed to the repo — it's
personal data). Dry-run by default, `--apply` to write. For each row:
- **Existing `/users` doc** (matched by email, in-memory map from a single
  `.get()`, no `.where()` query — this repo's established convention):
  force-sets `role` to exactly what the sheet says, **even if that downgrades
  an existing higher role** (a locked, explicit decision — not a bug; the
  dry-run output flags `⚠ DOWNGRADE` lines for human review before
  `--apply`). Workshop-level rows also get their uid added to the matching
  team's `members`/`memberNames` (batched per team). Staff-level rows never
  touch team membership.
- **No existing doc** (never logged in): writes a `pendingRoleGrants` doc
  instead.
- Also ensures `workshopTeams` docs for numbers 3–18 exist (teams "1"/"2"
  were pre-existing test teams from earlier manual QA and are reused as-is —
  no rename, just member backfill).
- **Protected admin emails are skipped entirely**, never touched regardless
  of sheet content (see §8).

Result of the run actually applied: 18 teams total, 58 existing users'
roles corrected (0 downgrades needed that run), 51 users joined to their
team, 139 pending grants queued.

### 6.3 First-login flow (`src/hooks/useAuth.js`)
When a signed-in, allowed-domain user has no `/users/{uid}` doc yet:
```js
httpsCallable(getFunctions(undefined, 'asia-southeast1'), 'claimPendingRoleGrant')()
  .catch(() => setDoc(ref, { role: 'user', email, displayName, approveAreas: [], createdAt: serverTimestamp() }))
  .catch(() => { /* settle to no-access */ });
```
The callable is tried first; **any failure falls back to the exact original
direct `setDoc(role:'user', ...)`** — a Cloud Function outage can never block
login.

### 6.4 The callable: `claimPendingRoleGrant` (`functions/index.js`)
1. If the caller's email is a protected admin email (§8): force-provision as
   `admin` immediately, done.
2. Else, look up `pendingRoleGrants/{emailLower}`.
   - **No grant**: create `/users/{uid}` with `role:'user'` — today's exact
     default, unchanged.
   - **Grant found**: write `/users/{uid}` with the granted role, then (if
     `role==='workshop'` and a team number is set) look up the matching
     `workshopTeams` doc by `number` and `arrayUnion` the uid into `members`
     + set `memberNames.<uid>`, **then** delete the grant.
3. **Ordering matters**: the grant is deleted *last*, only after both writes
   have been attempted. A genuine error on the team-join (as opposed to
   "team doc not found," which fails soft) is allowed to propagate *before*
   the delete, so the grant survives for a harmless retry on the next login
   instead of silently losing the intended team membership. A concurrent
   double-login race is benign (`arrayUnion` + `merge:true` are both
   idempotent).

---

## 7. What Workshop reads from the main Library (never writes)

| Collection | Why |
|---|---|
| `sdlcProcesses` | board layout (58 process cards) |
| `sdlcUseCases` | Use Cases tab content |
| `agents` (via `useApprovedAgents`) | agent/skill counts, per-process status breakdown, Use Cases tab agent rows, search |
| `/config/schema` (via `useConfigSchema`) | feeds the real `PreRegModal`'s dropdowns when the Register bridge is used |

All of the above are **reads only** (or, for `useConfigSchema`'s
`addRelatedRoles`/`addTeams`, grow-only writes that only ever fire from
*inside* the real `PreRegModal` itself during the Register bridge — i.e. the
exact same write a main-Library submission would make, not a Workshop-specific
write path).

---

## 8. Guaranteed admin: `tinnapat.p@arise.tech`

Added 2026-09-18 after the roster backfill raised the question "what stops
this account from ever losing admin?" The system guarantees **at least one
admin always exists** by guaranteeing this one specific account can never be
demoted, rather than doing dynamic last-admin counting (which Firestore
rules can't do cheaply).

- **`firestore.rules`** (`/users/{uid}` — the real boundary):
  ```
  allow update: if isAdmin()
    && !(resource.data.email == 'tinnapat.p@arise.tech' && request.resource.data.role != 'admin');
  ```
  Blocks *any* write, including by the account itself, that would set its
  role to anything but `admin`.
- **`functions/protectedAdmins.js`** — shared Node-side list
  (`PROTECTED_ADMIN_EMAILS`), required by both:
  - `functions/backfill-workshop-roster.cjs` — skips this email entirely,
    logging a notice, regardless of what any future sheet says.
  - `claimPendingRoleGrant` — force-provisions as `admin` on first login
    regardless of any grant on file (relevant only if the account were ever
    deleted and had to re-provision).
- **`src/components/UserManagementModal.jsx`** — disables the role dropdown
  for this row with a "🔒 Always admin" label, purely as a UI reflection of
  the rule (doesn't prevent an attempt, just doesn't invite one that would be
  rejected anyway).

Rules syntax can't `require()` a JS module, so the email literal is
duplicated by hand across these four places — an explicitly accepted
exception to this project's usual single-source-of-truth convention, for the
same reason `functions/index.js` keeps its own fallback copies of things like
`VERTICAL_CATEGORIES` that can't be imported from `src/lib/`.

---

## 9. Known follow-ups (not yet done, flagged during implementation)

- `workshopTeams`'s `allow create` rule is still open to any `workshop`+
  role at the rules level, even though the UI no longer exercises that path
  (team creation is admin-only in the UI as of 2026-09-17). Tightening this
  to `isAdmin()` for full consistency was suggested but not yet actioned.
- Legacy `workshopIdeas` fields (`kind`, `useCaseId`, `useCaseName`) still
  exist on pre-2026-09-17 docs and are read in one place (Use Cases tab's
  linked-sticker display via `useCaseId`) — new stickers never populate this,
  so that display will only ever show old stickers going forward.
- The old `config/workshopSchema.team` doc (superseded by the `workshopTeams`
  collection back in the 2026-09-16 round) is still sitting in Firestore,
  unused — deliberately left in place rather than deleted, to avoid touching
  a `/config/*` path outside this feature's owned scope.

---

## 10. File map

| File | Role |
|---|---|
| `src/components/WorkshopPage.jsx` | Everything — the whole page, all sub-components (`WorkshopStickers`, `IdeationStickers`, `StatusProgressBar`, `StickerDetailPopup`, `AddIdeaModal`, `TeamUserManagerModal`) |
| `src/styles/WorkshopPage.css` | All `.ws-` scoped styles |
| `src/components/PreRegModal.jsx` | +`prefill` prop (the Register bridge) |
| `src/components/ComboInput.jsx` | +`hideAddHint` prop (Workshop's Team field) |
| `src/components/UserManagementModal.jsx` | Protected-admin UI guard |
| `src/hooks/useAuth.js` | First-login → `claimPendingRoleGrant` call + fallback |
| `functions/index.js` | `claimPendingRoleGrant` callable |
| `functions/protectedAdmins.js` | Shared protected-admin-email list (Node side) |
| `functions/backfill-workshop-roster.cjs` | One-off roster backfill (already run) |
| `functions/migrate-workshop-teams.cjs` | One-off: old `config/workshopSchema.team` → `workshopTeams` (2026-09-16, already run) |
| `functions/backfill-workshop-team-number.cjs` | One-off: assigned `number` to pre-existing teams (2026-09-16, already run) |
| `functions/backfill-workshop-idea-teamid.cjs` | One-off: backfilled `teamId`/`status` on pre-2026-09-17 idea docs (already run) |
| `firestore.rules` | `workshopTeams`, `workshopIdeas`, `ideationStickers`, `config/workshopTeamCounter`, `pendingRoleGrants` blocks, plus the protected-admin guard on `/users` |

---

## 11. Deploy reminders (standing project rules that apply here)

- `firestore.rules` changes **must be published via Firebase Console** (named
  DB `ai-agent-lib` dropdown) — never via CLI, per this project's standing
  rule (a past incident shipped hosting without publishing matching rules and
  silently broke a feature for days).
- Cloud Function deploys must be **scoped to the exact function changed**
  (`--only functions:claimPendingRoleGrant`) — this GCP project is shared
  with the unrelated Portfolio app, and an unscoped `firebase deploy` would
  offer to delete every function not in this repo's local `functions/index.js`.
- Hosting deploys are safe by default (target-isolated per `.firebaserc`).
