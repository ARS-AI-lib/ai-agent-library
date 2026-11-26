# Forms & Assessment Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app's forms and the Assessment UI look modern and polished while keeping the V7 look (pill buttons, tint-blue selection, 36px/8px fields, IBM Plex Sans Thai Looped).

**Architecture:** A small shared stylesheet of form primitives (`src/styles/forms.css`, prefix `.fsec/.fhelp/.fopt/.ftype/.fsticky/.as-/.ast-`) loaded after `v7.css`; then the Registration form, Assessment questions, Request-deploy dialog and Assessment Settings are restructured to use it. No behaviour, data or rules change.

**Tech Stack:** React + Vite, plain CSS tokens from `theme.css`/`v7.css`.

**Spec:** the approved mockup `mockup-redesign.html` (repo root, 4 screens: registration, assessment questions, request deploy, assessment settings).

## Global Constraints

- Colours/shapes exactly as V7 (`v7.css`): buttons = pills (34/32px), primary `#2f6bff`, secondary `var(--sf2)`; selected state = tint (`--tint #eef3ff`, `--tint-bd #c9d8ff`, `--tint-fg #3a64d8`); fields 36px, 8px radius, hairline `--bd-soft`, focus ring `rgba(47,107,255,.10)`. Semantic reds/oranges (blocks / should-fix) stay as today.
- Reuse tokens only; no new colours. Dark mode must keep working (use `var(--…)`; no raw hex except the V7 hex already used in `v7.css`).
- Labels English, explanations Thai (CLAUDE.md §6). CSS prefix per area; never redefine `.sb .sh .sbar .sname .ttag`.
- Behaviour untouched: gates, validation, payloads, callables. Only markup/CSS (+ one pure helper).
- No deploy in this plan (the user paused deploys).

## Review Focus

1. Dark mode: tint/white surfaces must read in `data-theme="dark"`. → Task 1 browser check.
2. Narrow screens (≤ 768px): two-column grids collapse; sticky footer does not cover inputs. → Task 2 browser check at mobile preset.
3. A long form (Workflow type + 3 extra skills) keeps the footer reachable and the "Required fields n of N" correct. → Task 2 test of the helper.
4. The Assessment side panel updates live and never shows a stale level. → Task 3 browser check.
5. Settings: removing/adding options or questions keeps the selected question valid (no crash when the selected one is deleted). → Task 5 browser check.

---

### Task 1: Form primitives

**Files:**
- Create: `src/styles/forms.css`
- Modify: `src/main.jsx` (import after `v7.css`)

**Interfaces:**
- Produces CSS classes: `.fsec` (section) + `.fsec-h` (title + muted note + hairline), `.fhelp` (help line under a field), `.fopt` (Optional pill), `.ftype` / `.ftype-card(.on)` (4-up type cards), `.fsticky` (sticky bottom action bar with top hairline, full-bleed inside `.mbox`), `.fgrid` (2 columns, `.full` spans), `.fcount` (right-aligned counter in a label), `.mform .req { display:none }` (stars hidden inside `.mform`; optional fields get `.fopt`)

- [ ] **Step 1:** Write `forms.css` from the mockup's `.sec/.sec-h/.grid/.f .help/.opt/.types/.type/.mfoot` rules, rewritten onto V7 tokens
- [ ] **Step 2:** Import in `main.jsx`; `npm run build` → success
- [ ] **Step 3:** Commit `feat(ui): form primitives`

### Task 2: Registration form (PreRegModal)

**Files:**
- Modify: `src/components/PreRegModal.jsx` (form tab markup), `src/lib/registrationType.js`
- Test: `functions/verify-workflow.cjs`

**Interfaces:**
- Produces: `requiredFieldStatus(form, isWorkflow) -> { done: number, total: number }` in `src/lib/registrationType.js`. Required keys: `agentName, description, input, output, businessValue, owner, reusable, tool, requiredSkills` (strings, trimmed non-empty), `coreAbility` and `relatedRole` (Set/array non-empty) = 11; Workflow adds `workflowName` = 12. For Workflow `requiredSkills` is derived, so it counts as done when `form.skills.length >= 1`.

- [ ] **Step 1:** Test cases: empty form → `{0, 11}`; Workflow → total 12; whitespace-only name not counted; all filled → `done === total`; Workflow with a skill row counts `requiredSkills`
- [ ] **Step 2:** run → FAIL; implement → PASS
- [ ] **Step 3:** Restructure the form tab into sections: **What are you registering?** (Type cards `.ftype` replacing the `toggle2`; Workflow Name + Starter/Agent name + Scope), **What it does** (Description with `.fcount`, Input/Output, Ability/Role), **Scope of use** (Permitted Domains/Prohibited Uses with `.fopt` + `.fhelp`, Business Value), then the existing Reusable/HML/SDLC/Tool/LLM/Required Skills/Data Privacy blocks under **Details**, Additional Skills panel unchanged in logic. Add `mform` class to the `.mbox`; replace the `Hint` icons of the declaration fields by `.fhelp` lines
- [ ] **Step 4:** Replace the bottom `btn-group` of the form tab with a `.fsticky` bar: left "Required fields: n of N", right Clear + "Next: Assessment →"
- [ ] **Step 5:** `npm run build`; browser (emulator): all three types render, Workflow shows Workflow Name above Starter name, counter changes as fields fill, mobile preset has no horizontal scroll, dark mode readable
- [ ] **Step 6:** Commit `feat(ui): registration form redesign`

### Task 3: Assessment questions + result panel

**Files:**
- Modify: `src/components/ScreeningQuestions.jsx`, `src/styles/Screening.css` (rewrite), `src/components/PreRegModal.jsx` (assess tab), `src/components/AgentDetailModal.jsx` (deploy step 2)

**Interfaces:**
- Produces: `<ScreeningQuestions config questionIds answers onChange blockKey />` — `blockKey: 'blocksPre'|'blocksDeploy'`; a chosen option with that flag shows a red `.as-flag` under the question with the question's `advice`. `<ScreeningSide config answers />` — score, level pill, meter marker (thirds: Low/Medium/High; position from `thresholds`), "n of N answered" bar, Blocks / Must fix / Should fix list. Existing `ScreeningResult`, `ScreeningSummary` keep their names/props (Summary is unchanged)

- [ ] **Step 1:** Tiles: 2-column option grid, radio dot, score at the right in mono, tint when selected, red when the option blocks; question header = code chip + Thai title + English subline; group heading with "n / m answered"
- [ ] **Step 2:** `ScreeningSide` per above; layout `.as-wrap` (questions | 250px sticky side), collapses under 860px
- [ ] **Step 3:** Use in the Pre-Reg assess tab and the deploy dialog step 2 (`blockKey` accordingly); the old stacked `ScreeningResult` under the list is removed there
- [ ] **Step 4:** `npm run build`; browser: pick options → side panel score/level/meter update live; a blocking option shows the red flag and the Continue button text stays as today
- [ ] **Step 5:** Commit `feat(ui): assessment questions redesign`

### Task 4: Request deploy dialog

**Files:**
- Modify: `src/components/AgentDetailModal.jsx` (`confirmingDeploy` block)

- [ ] **Step 1:** Header with stepper, title, subtitle `<name> · T# Agent/Skill · Internal/External`; step 1 checklist as `.ftype`-style cards in two columns (tick box, label, `Required` pill instead of `*`), counter "n of m required ticked"; `.fsticky` footer (Cancel / Next →); step 2 uses Task 3's layout
- [ ] **Step 2:** `npm run build`; browser: tier T2/T4 lists render, Next disabled until required ticked
- [ ] **Step 3:** Commit `feat(ui): request deploy dialog redesign`

### Task 5: Assessment Settings

**Files:**
- Modify: `src/components/AssessmentSettingsModal.jsx`, `src/styles/Screening.css` (`.ast-*`)

- [ ] **Step 1:** Split layout: left nav (search, groups "Pre-assessment · n" / "Deploy assessment · n", row = code chip + Thai title + "blocks"/"n opts", selected = tint), right editor for the selected question; Level thresholds band (Low/Medium/High segments with the two number inputs); Options as 2-row cards (TH/EN inputs + delete; Score stepper −/+, Needs fixing pills No/Should/Must, Blocks registration / Blocks deploy switches); move up/down buttons stay (drag is out of scope)
- [ ] **Step 2:** Dirty tracking: compare draft with the loaded config (JSON); sticky bar "N unsaved changes" with Discard / Save changes; deleting the selected question selects its neighbour
- [ ] **Step 3:** `npm run build`; browser: edit a score → bar appears; add/delete question & option; selected-deleted case does not crash
- [ ] **Step 4:** Commit `feat(ui): assessment settings redesign`

### Task 6: Global polish + docs

**Files:** `src/styles/forms.css`, `src/components/EditAgentModal.jsx` (class names only), `CLAUDE.md`

- [ ] **Step 1:** Apply `mform` + `.fsticky` footer to the Edit form; label/help polish already global via Task 1
- [ ] **Step 2:** CLAUDE.md §40: primitives, where they are used, how to adopt them in another form
- [ ] **Step 3:** `npm run build` + all `verify-*` scripts; commit `docs: forms redesign`
