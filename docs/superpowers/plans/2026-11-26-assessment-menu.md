# Assessment Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Admin/Committee edit the screening questionnaire, let Admin/Committee/Approver browse per-event assessment results (filters, group by owner, CSV), and let Admin archive past years.

**Architecture:** `src/lib/screening.js` becomes a pure engine over a config object (`/config/screening`, seeded from `DEFAULT_CONFIG`). Every registration/deploy request also writes one `/assessments` record (answers by stable option id + D snapshot); results are recomputed on read. Archive = callable that moves a past year's records into `/assessmentArchive/{year}/items` together with the config at that moment, so archived views recompute with the frozen config.

**Tech Stack:** React + Vite, Firestore (named DB `ai-agent-lib`), Cloud Functions v2 callables, node verify scripts (`loadEsm`), Firestore emulator for rules.

**Spec:** `docs/superpowers/specs/2026-11-26-assessment-menu-design.md`

## Global Constraints

- Roles: Settings = admin, committee · Results = admin, committee, approver · Archive = admin only.
- Archive only years `< current year` in Asia/Bangkok. Archived records never appear in normal Results.
- Edits recompute non-archived results only; never re-block or un-approve items.
- Blocking is per option: `blocksPre` (blocks registration), `blocksDeploy` (blocks deploy request).
- Period filter = user-picked start date – end date (inclusive), combinable with Year.
- Approver sees only records whose stored `approveArea` overlaps their own `approveAreas`.
- Labels English, explanations Thai (CLAUDE.md §6). CSV via `src/lib/csv.js` only.
- Functions deploy always scoped to the new callables; ask before every production deploy. Rules are published by the user via Console (named DB `ai-agent-lib`).
- **Ruling:** the archive stores answers + `configSnapshot` (not server-computed results) so the engine lives only in `src/lib/screening.js`; the archived view evaluates with the snapshot.

## Review Focus

1. A record answered before an option was deleted → shows "(removed option)", scores 0, no crash. → Task 1 test.
2. Legacy `agent.screening.answers` stored as option **indexes** (v1) → converted, same results as today. → Task 1 test.
3. Archiving the current year, or twice the same year → rejected / idempotent. → Task 5 test.
4. Approver with no areas → sees an empty list with a message, not a permission error. → Task 4 step.
5. Period end date must include records created that day (end-of-day inclusive). → Task 4 test.

---

### Task 1: Config-driven engine + migration of current callers

**Files:**
- Modify: `src/lib/screening.js` (whole module), `src/components/ScreeningQuestions.jsx`, `src/components/PreRegModal.jsx`, `src/components/AgentDetailModal.jsx`
- Test: `functions/verify-screening.cjs` (rewrite cases onto the new signatures)

**Interfaces:**
- Produces (`src/lib/screening.js`):
  - `DEFAULT_CONFIG: { version: 1, thresholds: { md: 7, hi: 14 }, questions: Question[] }` where `Question = { id, code, group, th, en, advice, stage: 'pre'|'deploy', options: Option[] }`, `Option = { id, th, en, score, fix: 'none'|'should'|'must', blocksPre: boolean, blocksDeploy: boolean }`. Seed = current bank data: question ids `'C1'..'C11'`, option ids `` `${qid}${letter}` `` (e.g. `'C7b'`); `advice` = old RECO text; C1–C9 `stage:'pre'`, C10–C11 `'deploy'`; `fix`: old `lv 'ต้องแก้'` → `'should'`, C11 b/c → `'must'`; `blocksPre`: C7b, C7c; `blocksDeploy`: C10b, C10c, C10d, C11b, C11c.
  - `normalizeAnswers(config, answers) -> { [qid]: optionId }` — numeric (legacy index) values mapped through `DEFAULT_CONFIG` question options; ids kept as is.
  - `evaluate(config, answers) -> { total, level, hits: string[], must: {item, why}[], should: {item, why}[] }` — `level` null until every pre question with any score > 0 is answered.
  - `preGate(config, answers)`, `deployGate(config, answers) -> { complete, blocked, reasons: string[] }` (reasons = `advice` of blocking questions)
  - `pendingRecheck(config, answers) -> qid[]` (pre questions answered with `fix !== 'none'`)
  - `stageResults(config, screening)`, `buildScreening(config, answers) -> { v: 2, answers, level, total, must, should }`
  - `questionsFor(config, stage) -> Question[]`, `optionOf(config, qid, optionId) -> Option | null`
- Consumes: none

- [ ] **Step 1:** Rewrite `functions/verify-screening.cjs` on the new signatures: keep every existing behaviour case (levels Low/Medium/High at 6/8/14, sheet-3 should/must per C6–C10, hits), plus: legacy index answers `{C4:3, C11:2}` give the same `total/level` as ids `{C4:'C4d', C11:'C11c'}`; answer pointing to a deleted option → treated as unanswered for gates, scores 0, label "(removed option)" via `optionOf` null; changing C4d score 8→2 in a copied config lowers `total` by 6; `blocksPre` on C6b makes `preGate` block; `deployGate` blocks on C11c and not on C11a
- [ ] **Step 2:** `node functions/verify-screening.cjs` → FAIL
- [ ] **Step 3:** Implement the engine; update `ScreeningQuestions` (props `config`, answers by id, radio value = option id), `PreRegModal` and `AgentDetailModal` (pass `config`; use `questionsFor`; `normalizeAnswers` when reading `agent.screening`) — config comes from Task 2's hook later; for now pass `DEFAULT_CONFIG`
- [ ] **Step 4:** verify → PASS; `npm run build` → success
- [ ] **Step 5:** Commit `refactor(screening): config-driven engine with stable option ids`

### Task 2: Settings — config doc, callable, seed, modal, menu

**Files:**
- Create: `src/hooks/useScreeningConfig.js`, `src/components/AssessmentSettingsModal.jsx`, `src/components/AssessmentMenuModal.jsx`, `functions/screeningConfigRules.js`, `functions/seed-screening-config.cjs`, `functions/verify-screening-config.cjs`
- Modify: `functions/index.js` (export `manageScreeningConfig`), `src/components/Nav.jsx` (☰ item "Assessment"), `src/App.jsx` (wire modal, roles, pass config to PreReg/Detail)

**Interfaces:**
- Consumes: `DEFAULT_CONFIG`, config shape (Task 1)
- Produces:
  - `useScreeningConfig() -> config` (live `/config/screening`, falls back to `DEFAULT_CONFIG`)
  - `validateScreeningConfig(cfg) -> string | null` in `functions/screeningConfigRules.js` (CommonJS): ≥1 question; unique question ids and option ids; every question ≥1 option; `stage ∈ {pre,deploy}`; `score` integer 0–100; `fix ∈ {none,should,must}`; booleans for block flags; `0 < thresholds.md < thresholds.hi`
  - callable `manageScreeningConfig({ action: 'save', config })` — roles admin/committee (pattern of `manageRoleGroups`, `functions/index.js:2065`), `requireCompanyUser`, rate limit, writes `/config/screening` with `version+1` and `history` arrayUnion `{by, at, summary}`; returns `{ version }`
  - New ids generated client-side as `q_<base36 time><rand>` / `o_<…>` and never reused

- [ ] **Step 1:** `functions/verify-screening-config.cjs` cases: DEFAULT_CONFIG valid (load via loadEsm); duplicate option id → error; empty options → error; score -1 / 101 → error; `md >= hi` → error
- [ ] **Step 2:** run → FAIL; implement `screeningConfigRules.js` → PASS
- [ ] **Step 3:** Callable + hook + seed script (`--apply` writes DEFAULT_CONFIG only if the doc is missing; dry-run default)
- [ ] **Step 4:** `AssessmentMenuModal` (two buttons: Settings for admin/committee, Results for admin/committee/approver → `window.location.href = '/assessments'`); ☰ "Assessment" shown to admin/committee/approver
- [ ] **Step 5:** `AssessmentSettingsModal`: thresholds; list of questions (code, Thai text, English, advice, stage); options (Thai, English, score, fix, Blocks registration, Blocks deploy); add/remove/move up-down for both; Save → callable; Thai confirm text that saving recomputes non-archived results
- [ ] **Step 6:** `npm run build`; browser (emulator): edit a score, save, reopen shows it; PreReg assessment step reflects a renamed option
- [ ] **Step 7:** Commit `feat(assessment): editable questionnaire (settings + callable)`

### Task 3: Assessment records + rules

**Files:**
- Create: `src/lib/assessments.js`
- Modify: `src/components/PreRegModal.jsx` (after the parent/starter doc is created), `src/components/AgentDetailModal.jsx` (`handleRequestDeploy`), `firestore.rules`
- Test: `functions/verify-assessments.cjs`, `functions/verify-assessment-rules.cjs` (emulator)

**Interfaces:**
- Consumes: `normalizeAnswers` (Task 1), `DECL_FIELDS` (`src/lib/declaration.js`)
- Produces (`src/lib/assessments.js`):
  - `assessmentRecord(agent, stage, answers, uid) -> { agentId, agentName, owner, approveArea, stage, answers, decl, createdBy, year }` (`decl` = the 6 fields `description, permittedDomains, prohibitedUses, tool, requiredSkills, llm`; `year` from Asia/Bangkok now; caller adds `createdAt: serverTimestamp()`)
  - `bangkokYear(date) -> number`

- [ ] **Step 1:** verify cases: record keys exactly as listed; `decl` copies the 6 fields ('' when missing); `bangkokYear(new Date('2026-12-31T18:00:00Z'))` → 2027
- [ ] **Step 2:** run → FAIL; implement → PASS
- [ ] **Step 3:** Write one `pre` record per registration (for Workflow skills: the Starter doc) and one `deploy` record per deploy request (parent only, not per cascaded child); fire-and-forget errors logged, never block the main write
- [ ] **Step 4:** Rules `match /assessments/{id}`: create if `isKnownUser()` and `createdBy == uid` and `keys().hasOnly([...record keys, 'createdAt'])` and `stage in ['pre','deploy']`; read if admin/committee, or approver and `resource.data.approveArea.hasAny(userApproveAreas())`; update/delete false. `match /assessmentArchive/{d=**}`: read, write false
- [ ] **Step 5:** Emulator suite: creator create ok; extra key denied; other uid denied; update denied; committee list all ok; approver query `where('approveArea','array-contains-any', mine)` ok; approver unfiltered list denied; any read of `/assessmentArchive` denied → PASS
- [ ] **Step 6:** Commit `feat(assessment): per-event records + rules`

### Task 4: Results page `/assessments`

**Files:**
- Create: `src/components/AssessmentResultsPage.jsx`, `src/styles/AssessmentResults.css` (prefix `.asr-`)
- Modify: `src/main.jsx` (route `/assessments`), `src/lib/assessments.js`
- Test: `functions/verify-assessments.cjs` (extend)

**Interfaces:**
- Consumes: Task 1 engine, Task 2 `useScreeningConfig`, Task 3 records
- Produces (`src/lib/assessments.js`):
  - `filterRecords(records, { year, from, to, owner, area }) -> records` — `from`/`to` are `YYYY-MM-DD`, inclusive, Bangkok day; empty filter = all
  - `groupByOwner(records) -> { owner, rows }[]` — rows newest first; groups ordered by their newest row
  - `recordCsv(config, records) -> { headers, rows }` — columns: Date, Owner, Agent/Skill, Stage, Level, Total, Must fix, Should fix, the 6 D labels, then one column per config question (code) with the answer text

- [ ] **Step 1:** verify cases: `to: '2026-11-26'` includes a record at 2026-11-26 23:30 Bangkok; year + period both applied; area filter matches any overlap; group order newest-first; CSV header list exact; removed option renders "(removed option)"
- [ ] **Step 2:** run → FAIL; implement → PASS
- [ ] **Step 3:** Page: role gate (admin/committee/approver; others "Access restricted"); query = all for admin/committee, `array-contains-any` own areas (≤30) for approver, message when approver has no areas; filters Year, Period (two date inputs), Owner, Area; grouped table; level badge; expandable row with D fields + every C answer; "Export CSV" via `downloadCsv`
- [ ] **Step 4:** `npm run build`; browser (emulator, seeded records): filters, grouping, CSV download, approver scope
- [ ] **Step 5:** Commit `feat(assessment): results page`

### Task 5: Archive (admin)

**Files:**
- Create: `functions/assessmentArchiveRules.js`, `functions/verify-assessment-archive.cjs`
- Modify: `functions/index.js` (callables `archiveAssessmentYear`, `listArchivedAssessments`), `src/components/AssessmentResultsPage.jsx` (tab "Archived")

**Interfaces:**
- Produces:
  - `checkArchiveYear(year, nowBangkokYear) -> string | null` (CommonJS): non-integer / `>= nowBangkokYear` → error
  - `archiveAssessmentYear({ year }) -> { archived: n }` (admin): copies every `/assessments` with `year == y` into `/assessmentArchive/{y}/items/{id}` in batches ≤ 400, deletes originals, then sets `/assessmentArchive/{y}` `{ archivedAt, archivedBy, count (cumulative), configSnapshot }` (configSnapshot set on first archive of the year); re-running moves any stragglers only
  - `listArchivedAssessments({ year? }) -> { years: number[], items?: record[], configSnapshot? }` (admin)

- [ ] **Step 1:** verify cases: current year rejected; future rejected; `2025` with now 2026 ok; `'2025'` string rejected
- [ ] **Step 2:** run → FAIL; implement rules module → PASS; implement callables
- [ ] **Step 3:** Archived tab (admin only): year list, "Archive year" button for past years with confirm, table + CSV using the record's `configSnapshot`
- [ ] **Step 4:** Emulator (functions emulator if available, else deploy-time check): archive 2025 → disappears from Results, appears in Archived
- [ ] **Step 5:** Commit `feat(assessment): yearly archive`

### Task 6: Docs + release prep

- [ ] **Step 1:** CLAUDE.md §39 (config doc, records, archive, roles, rules publish, scoped functions `manageScreeningConfig,archiveAssessmentYear,listArchivedAssessments`, seed command); update §37 (gates now per option)
- [ ] **Step 2:** All verify scripts + `npm run build` → PASS
- [ ] **Step 3:** Commit `docs: Assessment menu`
