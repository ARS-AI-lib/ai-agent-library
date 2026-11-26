# Screening Assessment + Deploy Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-Tier package checklist at deploy request (step 1), then the bank's screening questionnaire as a pre-assessment before the AI duplicate check (D1–D6 + C1–C9, blocks on C7) and a deployment assessment before a deploy request (C10–C11 + re-ask C6/C8/C9, blocks on C10/C11).

**Architecture:** One pure module `src/lib/screening.js` holds questions, scoring and both gates (ported from the reference HTML). A shared `ScreeningQuestions.jsx` renders any subset of questions. PreRegModal gets an Assessment step; AgentDetailModal's deploy confirm gets the deploy step; PendingApprovalModal shows the result. Result is stored on the agent doc as `screening`.

**Tech Stack:** React + Vite, Firestore (named DB `ai-agent-lib`), Node verify script via `loadEsm`.

**Spec:** `docs/superpowers/specs/2026-11-26-screening-assessment-design.md` (§ Deploy checklist added 2026-11-26)
Reference source to port: `~/Downloads/20261123_Skill_Library_Screening_sent.html` (`const DATA`, `RECO`, `evaluate()`), expected outputs: `~/Downloads/20261125_Skill_Library_Screening_sent_v3.xlsx` sheet 3.

## Global Constraints

- Levels: Low 0–6 · Medium 7–13 · High ≥14 (`TH = { hi: 14, md: 7 }`); "ปัจจัยหลัก" = option score ≥ 3.
- Question/option text and scores copied verbatim from the HTML; only "skill" → "Agent/Skill" in question text.
- Labels, headers, buttons in English; Thai only for explanations/question text (CLAUDE.md §6).
- ⛔ No inline copies of questions or gate logic outside `src/lib/screening.js`.
- No Cloud Functions change. Hosting deploy only after the user publishes `firestore.rules` via Console (named DB `ai-agent-lib`). Ask before every production deploy.
- CSS class prefix for new styles: `.scr-`.
- Deploy dialog look must match the existing app: reuse `mov`/`mbox`/`mtitle`/`msub`/`btn-row` classes and the `v7-step` stepper from PreRegModal; no new design language.

## Review Focus

1. Item with no `screening` (all 379 existing) requests deploy → must answer the full D1–D6 + C1–C11, not crash on `agent.screening === undefined`. → Task 1 test `deployGate on empty answers`, Task 4 handles `!agent.screening`.
2. Checklist for a tier with required items cannot be bypassed by Back/Next toggling → Task 5 step 2. Whitespace-only D1–D6 text → counts as empty. → Task 1 test.
3. C11 failed but C4 = "ไม่ดึงข้อมูลเพิ่ม" → should-fix, not must-fix, so deploy NOT blocked by C11 (C10 still applies). → Task 1 test.
4. Re-opening a pre-reg after editing the form → assessment answers kept (session), dup-check cache untouched. → Task 3 step.
5. Paired sub-skill deploy cascade → sub-skills get the parent's `screening` in the same write. → Task 4 step.

---

### Task 1: `screening.js` + verify script

**Files:**
- Create: `src/lib/screening.js`
- Test: `functions/verify-screening.cjs`

**Interfaces:**
- Produces:
  - `QUESTIONS: Array<{ g, code, th, en, type: 'decl'|'risk'|'ready', opts: null | Array<{ l, th, en, lv, sc }> }>` (D1–D6, C1–C11 in HTML order)
  - `DECL = ['D1'..'D6']`, `PRE_CODES = ['C1'..'C9']`, `DEPLOY_CODES = ['C10','C11']`, `RECHECK_CODES = ['C6','C8','C9']`
  - `RECO: Record<code, string>` (HTML `RECO`)
  - `answers` shape: `{ D1..D6: string, C1..C11: number /* option index */ }`
  - `evaluate(answers) -> { total, level: 'Low'|'Medium'|'High'|null, hits: string[], must: {item, why: string[]}[], should: {item}[] }` — port of HTML `evaluate()` incl. `MAND` C11 conditions
  - `preGate(answers) -> { complete: boolean, blocked: boolean, reasons: string[] }` — complete = every DECL trimmed non-empty and every PRE_CODE answered; blocked = C7 option `lv === 'ต้องแก้'`
  - `pendingRecheck(answers) -> string[]` — RECHECK_CODES whose option `lv !== 'ผ่าน'`
  - `deployGate(answers) -> { complete, blocked, reasons }` — complete = DECL + C1–C11 answered; blocked = C10 option `lv !== 'ผ่าน'` OR `evaluate().must` contains `C11`
  - `buildScreening(answers, stage: 'pre'|'deploy', prev?) -> { v: 1, decl, answers, level, total, must: string[], should: string[] }` (timestamps added by callers)

- [ ] **Step 1: Write the failing verify script** (loader = copy of `loadEsm` in `functions/verify-category-groups.cjs`). Cases:
  - every row of xlsx sheet 3: set all other answers to their pass option, set the row's answer, assert `must`/`should`/`hits` match the sheet (C11 rows split by C4 as in the sheet)
  - HTML `EXAMPLE` answers (`C1:2,C2:1,C3:0,C4:3,C5:0,C6..C11:0`) → `level === 'Medium'`, `total === 11`
  - all-pass answers → `level 'Low'`, `must []`, `should []`
  - `preGate`: missing D3 → `complete false`; D3 = `'   '` → `complete false`; C7 = 1 ("มี") → `blocked true`; C7 = 2 → `blocked true`; C6 = 1 → `blocked false`
  - `pendingRecheck({ ...pass, C6: 1, C9: 1 })` → `['C6','C9']`
  - `deployGate({})` → `complete false`, no throw
  - `deployGate`: C10 = 1 → blocked; C4 = 3 (web) + C11 = 2 → blocked; C4 = 0 + C11 = 1 → not blocked (should only)
- [ ] **Step 2:** `node functions/verify-screening.cjs` → FAIL (module missing)
- [ ] **Step 3:** Implement `src/lib/screening.js` with the interfaces above (data copied from HTML `DATA.creator`, `DATA.mand`, `RECO`)
- [ ] **Step 4:** `node functions/verify-screening.cjs` → all PASS
- [ ] **Step 5:** Commit `feat(screening): questionnaire module + verify`

### Task 2: `ScreeningQuestions.jsx` + result panel

**Files:**
- Create: `src/components/ScreeningQuestions.jsx`, `src/styles/Screening.css` (`.scr-` prefix, imported by the component)

**Interfaces:**
- Consumes: `QUESTIONS`, `evaluate`, `RECO` from Task 1
- Produces:
  - `<ScreeningQuestions codes={string[]} answers={object} onChange={(code, value) => void} />` — textarea for decl codes, radio group for option codes, grouped by `g` like the HTML `card()`; unanswered cards highlighted
  - `<ScreeningResult answers={object} />` — level badge, "⚠ Must fix" (`must` + why), "Main factors" (`hits`), "Should fix" (`should` with RECO + current answer)

- [ ] **Step 1:** Implement both components
- [ ] **Step 2:** `npm run build` → succeeds
- [ ] **Step 3:** Commit `feat(screening): question + result components`

### Task 3: Pre-assessment step in PreRegModal

**Files:**
- Modify: `src/components/PreRegModal.jsx` (tabs ~L820–838, form Submit button ~L1083 calls `runCheck`, addDoc payloads ~L540)

**Interfaces:**
- Consumes: `preGate`, `buildScreening`, `DECL`, `PRE_CODES` (Task 1); `ScreeningQuestions`, `ScreeningResult` (Task 2)

- [ ] **Step 1:** Add state `screeningAnswers` (`{}`), new step tab **"Assessment"** between "form" and "analysis" (`tab === 'assess'`); form "Submit" button now validates the form as today then `setTab('assess')` instead of `runCheck()`
- [ ] **Step 2:** Assess tab renders `ScreeningQuestions codes={[...DECL, ...PRE_CODES]}` + `ScreeningResult`; button **"Continue to Duplicate Check"** calls `runCheck()`, disabled unless `preGate(...).complete && !blocked`; when blocked show Thai message from `RECO.C7`
- [ ] **Step 3:** Both `addDoc` calls (parent + sub-skills) add `screening: { ...buildScreening(screeningAnswers, 'pre'), preAt: serverTimestamp() }`. Answers survive going back to the form tab (not reset in `runCheck`); reset only in the existing Clear/close handlers
- [ ] **Step 4:** `npm run build` → succeeds; browser (preview/emulator): C7 = "มี" → Continue disabled with message; all pass → duplicate check runs; submitted doc has `screening.level`
- [ ] **Step 5:** Commit `feat(screening): pre-assessment step before duplicate check`

### Task 4: `deployChecklist.js` + verify

**Files:**
- Create: `src/lib/deployChecklist.js`
- Test: `functions/verify-deploy-checklist.cjs`

**Interfaces:**
- Produces:
  - `CHECKLIST: Record<'T1'|'T2'|'T3'|'T4', Array<{ id: string, label: string, required: boolean }>>` — exactly the user's lists (`*` = required):
    - T1: readme* · template · no_secret*
    - T2: readme · template · rbac* · prompt_injection · guardrail · audit_log
    - T3: readme* · template · no_secret* · guardrail · pii*
    - T4: readme · template · rbac* · prompt_injection* · guardrail* · pii* · audit_log* · cab*
    - labels: "Read me / Instruction", "Template / Component file", "No secret / Real data", "Role-Based Access Control", "Prompt injection", "Guardrail", "PII screening", "Audit log", "CAB Approved"
  - `checklistFor(tier: string) -> Array<{id,label,required}>` (unknown tier → `[]`)
  - `checklistGate(tier: string, checked: string[]) -> { complete: boolean, missing: string[] }` — complete when every required id of that tier is in `checked`; ids not in the tier's list are ignored
  - `buildDeployChecklist(tier, checked) -> { tier, checked: string[] }` (only ids valid for the tier)

- [ ] **Step 1:** Write `functions/verify-deploy-checklist.cjs` (same `loadEsm` pattern): list lengths 3/6/5/8; required counts 2/1/3/6... assert per-tier required ids exactly as above; `checklistGate('T1', ['readme'])` → missing `['no_secret']`; all required checked → complete; extra/foreign ids ignored; `checklistGate('T9', [])` → complete true (no list)
- [ ] **Step 2:** `node functions/verify-deploy-checklist.cjs` → FAIL
- [ ] **Step 3:** Implement `src/lib/deployChecklist.js`
- [ ] **Step 4:** run verify → PASS
- [ ] **Step 5:** Commit `feat(deploy): per-tier package checklist module`

### Task 5: Deploy request dialog (checklist → assessment) + rules

**Files:**
- Modify: `src/components/AgentDetailModal.jsx` (`confirmingDeploy` dialog ~L1017, `handleRequestDeploy` ~L466; `tier` already at L149)
- Modify: `firestore.rules:168` (deploy-request `hasOnly` list)
- Test: `functions/verify-screening-rules.cjs`

**Interfaces:**
- Consumes: `checklistFor`, `checklistGate`, `buildDeployChecklist` (Task 4); `deployGate`, `pendingRecheck`, `buildScreening`, `DECL`, `PRE_CODES`, `DEPLOY_CODES` (Task 1); `ScreeningQuestions`, `ScreeningResult` (Task 2)

- [ ] **Step 1:** Dialog state `deployStep` (1|2), `deployChecked` (`string[]`), `deployAnswers` (init from `agent.screening?.answers` + `decl`, else `{}`). Header "Request deploy" + `msub` shows `T{n} · Agent|Skill · Internal|External`; a two-step stepper using the `v7-step` classes
- [ ] **Step 2:** Step 1 renders `checklistFor(tier)` as checkboxes (required ones marked `*`, Thai hint "ข้อที่มี * จำเป็นต้องมี"); **Next →** disabled until `checklistGate(tier, deployChecked).complete`
- [ ] **Step 3:** Step 2 = assessment: codes `!agent.screening ? [...DECL, ...PRE_CODES, ...DEPLOY_CODES] : [...pendingRecheck(prev), ...DEPLOY_CODES]`; "Request deploy" disabled unless `deployGate(deployAnswers).complete && !blocked`; Thai reasons shown; ← Back to step 1 keeps state. Widen `mbox` to `maxWidth: 640`
- [ ] **Step 4:** `patch` adds `deployChecklist: { ...buildDeployChecklist(tier, deployChecked), at: serverTimestamp() }` and `screening: { ...buildScreening(deployAnswers,'deploy',agent.screening), preAt: agent.screening?.preAt ?? serverTimestamp(), deployAt: serverTimestamp() }`; the `cascadeTargets` loop writes the same two fields to sub-skills (parent's tier/answers)
- [ ] **Step 5:** Add `'deployChecklist'` and `'screening'` to the `hasOnly([...])` list at `firestore.rules:168`
- [ ] **Step 6:** Rules emulator test `functions/verify-screening-rules.cjs` (pattern of `verify-inbox-rules.cjs`): creator deploy request with both fields → allowed; with another extra key → denied; non-creator → denied. Run: `npx firebase-tools emulators:exec --config firebase.rules-test.json --only auth,firestore --project wolfy-481609 "node functions/verify-screening-rules.cjs"` → PASS (needs Java, see CLAUDE.md §36)
- [ ] **Step 7:** `npm run build`; browser: T3 item → checklist blocks until readme/no_secret/pii ticked → assessment → C4 = web + C11 untested blocked; pass → request filed
- [ ] **Step 8:** Commit `feat(deploy): package checklist + assessment gate on deploy request`

### Task 6: Approver view, declaration display, docs

**Files:**
- Modify: `src/components/PendingApprovalModal.jsx` (row meta ~L466–530), `src/components/AgentDetailModal.jsx` (detail body)
- Modify: `CLAUDE.md` (new §37), `docs/SYSTEM-OVERVIEW.md`

**Interfaces:**
- Consumes: `agent.screening` (Task 1 `buildScreening`), `agent.deployChecklist` (Task 4), `CHECKLIST` labels, `QUESTIONS` for D labels

- [ ] **Step 1:** Pending rows (new + deploy queues): `Screening: <level>` badge + must/should codes when `agent.screening` exists; deploy-queue rows also list the ticked package items from `agent.deployChecklist`
- [ ] **Step 2:** AgentDetailModal: "Declaration" section listing D1–D6 (labels from `QUESTIONS`) when present
- [ ] **Step 3:** CLAUDE.md §37 (checklist per tier, gates, storage, rules publish, verify command, my-calls list from spec) + SYSTEM-OVERVIEW row
- [ ] **Step 4:** `npm run build` + `node functions/verify-screening.cjs` + `node functions/verify-deploy-checklist.cjs` → PASS
- [ ] **Step 5:** Commit `feat(screening): approver view + docs`

### Release (ask the user before each production step)
1. User publishes `firestore.rules` via Console (named DB `ai-agent-lib`)
2. `npm run build` → `firebase hosting:channel:deploy screening --project wolfy-481609` → user checks → `firebase deploy --only hosting --project wolfy-481609`
3. Verify live bundle hash on both sites; push command for the user
