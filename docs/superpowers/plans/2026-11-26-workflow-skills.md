# Workflow skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the registration Type "Workflow skills": a named Skill-class item whose members are a Starter skill plus ≥1 more skill, with progress/deploy cascading like Agent+Skill.

**Architecture:** A workflow is a Skill doc with `isWorkflow: true` and ordered `childSkillIds`. `getType()` is unchanged (`'skill'`). Pairing/cascade helpers in `src/lib/agentUtils.js` learn that a parent may be an Agent **or** a workflow (workflow members come from `childSkillIds` only). The Pre-Reg form reuses the Agent+Skill row UI; display goes through `agentTypeLabel()`.

**Tech Stack:** React + Vite, Firestore, node verify scripts via `loadEsm`.

**Spec:** `docs/superpowers/specs/2026-11-26-workflow-skills-design.md`

## Global Constraints

- UI labels in English; Thai only for explanations (CLAUDE.md §6). Type label is exactly **"Workflow skills"**.
- ⛔ Type/pairing logic only in `src/lib/agentUtils.js` (+ its port `functions/delayAlertRules.js`); no inline `isWorkflow` checks of raw flags in components — call `isWorkflow()`.
- `getType()` / `getTier()` unchanged. Workflow = Skill flags (`aiAgent:false, skillMd:true`) so Tier is T1/T3 by scope.
- Workflow membership = `childSkillIds` only (no `matchingAgent`/submitter heuristic). One workflow per skill; skills already paired/linked elsewhere are not offered.
- No firestore.rules change (create has no key whitelist). Functions deploy (scoped `delayAlertsMon,sendDelayDigest`) only at release, after asking.
- Build on branch `feat/screening-assessment`.

## Review Focus

1. Workflow parent must never appear as a member of itself or of another workflow, and a skill in a workflow must not be offered for a second workflow/Agent. → Task 1 tests.
2. An Agent+Skill parent and a plain Agent behave exactly as before (51 existing pairings). → Task 1 regression cases + `verify-child-links.cjs`.
3. Submit with < 2 skill rows, or an unfilled Starter row → blocked with a clear message. → Task 2.
4. A workflow whose member is an existing skill further along → `cascadeTargets` skips it (unchanged guard). → Task 1 test.
5. Type filter "Skill" must not silently include workflows. → Task 1 test.

---

### Task 1: Library logic + verify script + delay-alert port

**Files:**
- Modify: `src/lib/agentUtils.js` (pairedSubSkills ~L442, isPairedSubSkill ~L456, skillsOfAgent ~L367, agentsOfSkill ~L378, agentTypeLabel ~L477, relationshipLabel ~L503, buildAgentFilter ~L516)
- Modify: `functions/delayAlertRules.js` (`isPairedSubSkill` ~L96)
- Test: `functions/verify-workflow.cjs`

**Interfaces:**
- Produces (all exported from `src/lib/agentUtils.js`):
  - `isWorkflow(agent) -> boolean` — `agent?.isWorkflow === true && getType(agent) === 'skill'`
  - `workflowMembers(workflow, allAgents) -> Agent[]` — docs in `childSkillIds` order (missing ids skipped); `[]` for non-workflow
  - `workflowOf(skill, allAgents) -> Agent | null` — the workflow whose `childSkillIds` contains `skill.id`
  - `pairedSubSkills(parent, all)` — parent is Agent (unchanged behaviour) **or** workflow (= `workflowMembers`)
  - `isPairedSubSkill(skill, all)` — also true when a workflow lists the skill; a workflow itself is never a sub-skill of another workflow
  - `agentTypeLabel(agent, all)` — `'Workflow skills'` for workflows
  - `buildAgentFilter({ type })` — `type === 'workflow'` ⇒ `isWorkflow`; `type === 'skill'` ⇒ skill and **not** workflow

- [ ] **Step 1:** Write `functions/verify-workflow.cjs` (loader pattern of `verify-child-links.cjs`; read it first for how `agentUtils.js` is loaded with injected `getType/getTier/normalizeProgress` deps). Cases: workflow W (`isWorkflow`, `childSkillIds:['s1','s2']`) with s1,s2 skills → `workflowMembers` returns [s1,s2] in that order; order reversed in the array → reversed result; unknown id skipped; `pairedSubSkills(W)` equals members and ignores a third skill whose `matchingAgent` equals W's name and same creator; `isPairedSubSkill(s1)` true, unrelated skill false, `isPairedSubSkill(W, all)` false; `workflowOf(s2)` is W; `agentTypeLabel(W)` `'Workflow skills'`, plain skill `'Skill'`, Agent with children `'Agent+Skill'`, plain Agent `'Agent'`; `buildAgentFilter({type:'skill',...})(W)` false and `(plainSkill)` true; `type:'workflow'` true only for W; `cascadeTargets(W)` skips a member at higher progress; regression: an Agent with name-matched child still pairs by heuristic.
- [ ] **Step 2:** `node functions/verify-workflow.cjs` → FAIL
- [ ] **Step 3:** Implement the helpers above in `src/lib/agentUtils.js`; port the same `isWorkflow`-aware logic into `functions/delayAlertRules.js` `isPairedSubSkill`
- [ ] **Step 4:** `node functions/verify-workflow.cjs` → all PASS; also `node functions/verify-child-links.cjs` and `node functions/verify-delay-alerts.cjs --live` → PASS (drift check)
- [ ] **Step 5:** Commit `feat(workflow): library helpers + delay-alert port`

### Task 2: Pre-Reg form — "Workflow skills" type

**Files:**
- Modify: `src/components/PreRegModal.jsx` (type toggle ~L911, `validate()` ~L292, `typeToFlags` ~L109, member creation ~L691, parent payload flags ~L458, skills panel ~L1118, requiredSkills field)
- Modify: `src/components/SkillRow.jsx` (header text ~L31; `validateSkillRows` ~L182)

**Interfaces:**
- Consumes: `isWorkflow`, `pairedSubSkills`, `childSkillIdList` (Task 1)
- Produces: `SkillRow` prop `label?: string` (default `Skill #${index + 1}`); form type value `'Workflow skills'`

- [ ] **Step 1:** Type toggle options `['Agent','Skill','Agent+Skill','Workflow skills']`; selecting Workflow skills seeds **2** empty skill rows (Starter + one)
- [ ] **Step 2:** `typeToFlags('Workflow skills')` → `{ aiAgent:false, skillMd:true }`; parent payload adds `isWorkflow: true` only for this type
- [ ] **Step 3:** Skills panel shown for `Agent+Skill` and `Workflow skills`; for workflows title "Workflow skills", row 1 `label="Starter skill"`, rows 2+ `label="Skill #n"`; `canRemove` only while rows > 2; **+ Add Skill** unchanged. `excludeIds` for existing-skill picker additionally excludes skills already listed in any parent's `childSkillIds` or already pairing (use `isPairedSubSkill`) when type is Workflow skills
- [ ] **Step 4:** `validate()`: for Workflow skills require `form.skills.length >= 2` ("Workflow ต้องมี Starter skill และอีกอย่างน้อย 1 skill") then `validateSkillRows`
- [ ] **Step 5:** `requiredSkills` for Workflow skills is read-only and shows the member names in order (existing links resolved via `allAgents`); written to the parent and inherited as today; the required-field check uses the derived value
- [ ] **Step 6:** Member creation block runs for both types; order preserved in `childIds` → `childSkillIds` update unchanged
- [ ] **Step 7:** `npm run build` → success; browser (emulator): pick Workflow skills → 2 rows with "Starter skill" label, remove disabled at 2 rows, requiredSkills read-only
- [ ] **Step 8:** Commit `feat(workflow): Workflow skills type in the registration form`

### Task 3: Display — card, detail, filter, queue

**Files:**
- Modify: `src/components/AgentCard.jsx` (badge ~L63, `ac` class), `src/components/AgentDetailModal.jsx` (related row ~L164/L854, deploy dialog subtitle), `src/components/ControlBar.jsx` (TYPES ~L23), `src/App.jsx` (type chip label ~L391), `src/components/PendingApprovalModal.jsx` and `src/components/MySubmissionsModal.jsx` / `AgentListTable.jsx` (any raw type text — use `agentTypeLabel`)

**Interfaces:**
- Consumes: `agentTypeLabel`, `workflowMembers`, `workflowOf`, `isWorkflow` (Task 1)

- [ ] **Step 1:** Card badge text `T1 Workflow skills` / `T3 Workflow skills` (skill colours kept); card shows "N skills" via `workflowMembers(...).length` (pass `allAgents`, already a prop)
- [ ] **Step 2:** Detail of a workflow: row "Skills" listing `1. Name (Starter) → 2. … → 3. …`, each name opens the member like the existing related list; detail of a member: row "Workflow" = `workflowOf(...).agentName` and the existing locked-progress message
- [ ] **Step 3:** ControlBar TYPES `['all','All'],['agent','Agent'],['skill','Skill'],['workflow','Workflow skills']`; App chip label via a small map (`agent→Agent, skill→Skill, workflow→Workflow skills`)
- [ ] **Step 4:** Deploy dialog subtitle and queue rows use `agentTypeLabel` (grep remaining `'Skill' : 'Agent'` ternaries)
- [ ] **Step 5:** `npm run build`; browser: seed a workflow + 2 members in the emulator, check card, detail (both sides), filter chips
- [ ] **Step 6:** Commit `feat(workflow): card, detail, filter display`

### Task 4: Docs

**Files:** Modify `CLAUDE.md` (new §38), `docs/SYSTEM-OVERVIEW.md`

- [ ] **Step 1:** CLAUDE.md §38: data model, helpers, form rules, display, release notes (functions deploy of `delayAlertsMon,sendDelayDigest`), non-goals; SYSTEM-OVERVIEW "in release" line
- [ ] **Step 2:** `node functions/verify-workflow.cjs && node functions/verify-screening.cjs` (run separately) → PASS; `npm run build`
- [ ] **Step 3:** Commit `docs: Workflow skills`
