# Assessment menu (settings + results + archive) — design · and a quick badge fix

## Context
The screening assessment (CLAUDE.md §37) is hard-coded in `src/lib/screening.js` and each agent keeps only one
`screening` result, which the deploy request overwrites. The user wants leads to manage the questionnaire
themselves and to review and archive results over time.
They also flagged a small UI bug: the "Deploy rejected" badge sits **between** Update Progress and Request deploy.

## Step 0 — quick fix, deploy first (hosting only)
`src/components/AgentDetailModal.jsx:794-812`: render the deploy-status badge **after** the Request deploy
button inside `.v7-delivery-actions`. Then build and deploy hosting (the user already asked for this deploy).

## Decisions (user, 2026-11-26)
- ☰ menu **Assessment**, visible to Admin / Committee / Approver. Sub-menus:
  - **Assessment Settings** (Admin, Committee): add/remove/edit questions and options, edit option scores.
    Edits re-apply to every **non-archived** result.
  - **Assessment Results** (Admin, Committee, Approver):
    - grouped by owner, newest first
    - filters: year, period, owner, area
    - CSV export; shows the D fields and the C answers
  - **Archive** (Admin only):
    - archive results by **year**; the current year cannot be archived
    - query archived years and export them to CSV
    - archived results disappear from the normal Results view
- **Blocking is configured per option.** Each option can be flagged "blocks registration" and/or "blocks
  deploy request". This replaces the hard-coded C7/C10/C11 gates. The C4-dependent rule for C11 goes away.
- Approach **A**:
  - Questions live in Firestore `/config/screening`.
  - Results are one record per event in `/assessments`.
  - Results are recomputed on read.
  - An archive is a frozen yearly snapshot.

## My calls (marked for the user to check)
1. **One record per event.** Each registration writes 1 `pre` record and each deploy request writes 1
   `deploy` record. `agent.screening` stays as the latest answers for the gates and the queue.
2. **Period** = a custom **start date – end date** range picked by the user (user, 2026-11-26). It
   combines with the Year filter: both must match when both are set.
3. **Approvers** see only records whose stored `approveArea` overlaps their own. Admin/Committee see all.
   This follows the Usage page.
4. **Edits are display-only for the past.** Changing questions or scores recomputes level/must/should of
   non-archived records, but it never re-blocks or un-approves items.
5. **Default config is seeded from the current bank questionnaire.** Blocking flags in the seed:
   - registration: C7 "มี" and "ยังไม่ได้ตรวจ"
   - deploy request: C10 b/c/d, and C11 "ไม่ผ่าน"/"ยังไม่ทดสอบ"
6. **Option ids are stable** (`opt_xxx`, never reused). Answers are stored as option ids, not indexes, so
   deleting or reordering options cannot shift answers. An answer whose option was deleted shows as
   "(removed option)" and scores 0.
7. **A question's stage** (`pre` | `deploy`) is part of its config. The deploy step also re-asks `pre`
   questions answered with an option marked "should fix" (`recheck`), as today.
8. **Levels:** the thresholds (Low < 7 ≤ Medium < 14 ≤ High) are editable in Settings.

## Data model
- `/config/screening`:
  ```
  { version, thresholds:{md,hi},
    questions:[{ id, code, group, th, en, stage:'pre'|'deploy',
                 options:[{ id, th, en, score, fix:'none'|'should'|'must',
                            blocksPre:bool, blocksDeploy:bool }] }],
    history[] }
  ```
  Question order is the array order. `code` is display only.
- `/assessments/{id}`:
  ```
  { agentId, agentName, owner, approveArea[], stage:'pre'|'deploy', answers:{questionId: optionId},
    decl:{description, permittedDomains, prohibitedUses, tool, requiredSkills, llm},
    createdBy, createdAt, year }
  ```
  `decl` is a snapshot of D1–D6 at that moment.
- `/assessmentArchive/{year}`:
  ```
  { archivedAt, archivedBy, count, configSnapshot }
  ```
  - Subcollection `items/{id}`: the frozen record with the computed level/total/must/should and the
    question/option texts.
  - Archiving deletes the originals from `/assessments`.

## Code
- `src/lib/screening.js`: becomes the **engine over a config object**.
  - `evaluate(config, answers)`, `preGate`, `deployGate`, `pendingRecheck`, `stageResults`.
  - `DEFAULT_CONFIG` holds the bank data and is used as seed and fallback.
  - The verify suite reruns against `DEFAULT_CONFIG` plus the new blocking-flag cases.
- `src/hooks/useScreeningConfig.js`: live `/config/screening`, falling back to `DEFAULT_CONFIG`.
- **Callable `manageScreeningConfig`** (Admin/Committee) does `saveConfig` and appends to `history`.
  It validates ids, scores ≥ 0, ≥ 1 option per question and stage values. It follows the
  `manageRoleGroups` pattern.
- **Callable `archiveAssessmentYear`** (Admin; `year < current Bangkok year`) runs in batches:
  1. write the snapshot items
  2. delete the originals
  3. write the year doc
  It is idempotent per year.
- **Callable `listArchivedAssessments`** (Admin) reads `/assessmentArchive/{year}/items`.
- **Writes:** `PreRegModal` (on submit) and the `AgentDetailModal` deploy request each `addDoc` one
  `/assessments` record. Rules allow a creator create with `stage` + `createdBy == uid`, key whitelist, no
  update/delete.
- **Rules reads:**
  - admin/committee: all
  - approver: a query with `approveArea array-contains-any` own areas
  - `/assessmentArchive`: read false (callable only)
- **UI**
  - Nav ☰ "Assessment" opens a small chooser modal with **Settings** and **Results**. Each option is shown
    only to the roles allowed.
  - `AssessmentSettingsModal.jsx`: question list, then options with score, fix level and the two block
    checkboxes. Supports add, remove and reorder up/down. Save goes through the callable.
  - `/assessments` page `AssessmentResultsPage.jsx`, following `UsageReportPage`:
    - filters: Year, Period (start date – end date), Owner, Area
    - rows grouped by owner, newest first
    - columns: date, item, stage, level, must/should, D fields, then each C answer
  - CSV export via `src/lib/csv.js`.
  - Admin tab **Archived**: year picker, archive button for past years, archived table, CSV.

## Not in scope
Re-blocking already approved items · per-question edit history UI · migrating `agent.screening` of items
that were never assessed.

## Verification
- **Engine.** `node functions/verify-screening.cjs` reproduces the bank results on `DEFAULT_CONFIG` and adds
  config-edit cases: score change recomputes, a deleted option scores 0, and blocking flags drive the gates.
- **Rules.** The emulator suite covers create/list per role, the no-update rule and archive read denied.
- **Callables.** Offline verify for config validation and the year guard.
- **Browser on emulator.**
  - Settings: edit a score, then see Results recompute.
  - Results: filters, group, CSV.
  - Approver area scoping.
  - Archive a past year: it disappears from Results and shows up in the Archived tab.
- **Release.**
  1. User publishes rules.
  2. Scoped functions deploy (new callables only).
  3. Hosting.
  4. Seed `/config/screening` with a dry-run seed script, then `--apply`.
