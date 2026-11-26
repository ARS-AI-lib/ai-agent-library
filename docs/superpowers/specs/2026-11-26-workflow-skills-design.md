# Workflow skills — design (2026-11-26)

## Intent
Some skills only work as a chain: a **Starter skill** kicks off and other skills continue the
job. Today the only way to register that is "Agent+Skill", which forces an Agent on top that does
not exist, or the free-text "Required Skills" field (screening D5), which links nothing. The user
wants a third registration Type, **Workflow skills**: a named workflow item whose members are a
Starter skill plus at least one more skill, with progress and deploy flowing down the same way
Agent+Skill does.

## Decisions (user)
- Type label: **"Workflow skills"**.
- The workflow is **its own item** (own name/description), separate from the Starter skill.
- Form: fill the workflow fields → **Starter skill** (required) → **+ Add Skill**, **at least 1
  more** (≥ 2 member skills in total). Same row UI as Agent+Skill.
- Progress update and deploy request **cascade exactly like Agent+Skill**.
- Approach **A** (chosen over adding a 3rd `getType()` value): a workflow is a special Skill.

## Approaches
- **A (chosen): special Skill.** Parent doc has Skill flags (`aiAgent:false, skillMd:true`) plus
  `isWorkflow: true`. `getType()` keeps returning `'skill'`, so the 20+ files that branch on
  agent/skill keep working; Tier is T1/T3 by scope automatically. A new `isWorkflow()` helper,
  the cascade/pairing functions and `agentTypeLabel()` learn about it.
- B: `getType()` returns a 3rd value `'workflow'`. Clearer everywhere, but every agent/skill
  check (card classes `isag`/`issk`, Dashboard counts, filters, chat) must be revisited or it
  silently misbehaves. Rejected — risk without user-visible gain.

## Data model
- **Workflow (parent):** `{ aiAgent:false, skillMd:true, isWorkflow:true, childSkillIds:[starterId, ...] }`
  + all the usual form fields. `childSkillIds` order **is** the step order; index 0 = Starter.
  Uses the existing doc-ID link from §27 (survives renames; supports linking existing skills).
- **Member skills:** normal Skill docs. New ones also get `matchingAgent = <workflow name>`
  (same as Agent+Skill children, so name-based paths such as rename approval keep working).
- **`requiredSkills`** (screening D5) on the workflow is filled automatically with the member
  skill names in order, read-only in the form for this Type.
- Builder: pre-generate member doc refs (`doc(collection(db,'agents'))`) so the parent is created
  in one write with `childSkillIds` already set.

## Behaviour changes (single places)
- `src/lib/tier.js` or `agentUtils.js`: `isWorkflow(agent) = agent?.isWorkflow === true`.
- `pairedSubSkills`, `isPairedSubSkill`, `cascadeTargets` (src/lib/agentUtils.js): a parent may be
  `getType()==='agent'` **or** `isWorkflow()`. For a workflow parent, members come from
  `childSkillIds` (the workflow itself is a Skill, so it must never be treated as its own child or
  as a member of another workflow).
- `agentTypeLabel()` returns `'Workflow skills'` for workflows. Every UI label of the type goes
  through it.
- Port in `functions/delayAlertRules.js` (`isPairedSubSkill`) updated to match —
  `verify-delay-alerts.cjs --live` fails on drift. ⚠ This is a **functions deploy**
  (`delayAlertsMon`, `sendDelayDigest`, scoped).

## Display
- **Card:** badge `T1 Workflow skills` / `T3 Workflow skills` (skill colours), plus a small
  "N skills" note in the card body.
- **Detail (workflow):** "Skills" row lists members in order: `1. X (Starter) → 2. Y → 3. Z`,
  each clickable like the existing related list.
- **Detail (member skill):** "Workflow" row with the workflow name; progress/deploy controls
  locked with the existing sub-skill message (same as Agent+Skill children).
- **TYPE filter:** Agent / Skill / Workflow skills (Skill keeps meaning "Skill", workflows
  included only under Workflow skills); filter chip label from `agentTypeLabel`.
- **Pending queue / deploy queue:** only the workflow row (members de-duplicated as today).
- Dashboard/Timeline/chat: no new widgets; they count workflows as Skills via `getType()`.

## Screening & deploy (from the screening feature on the same branch)
- One pre-assessment for the whole submission; members inherit it (as Agent+Skill sub-skills do).
- Request deploy on the workflow: checklist by the workflow's Tier (T1/T3), cascade to members
  with each member's own tier/declaration (the cascade fix already in place).

## Non-goals (v1)
- Editing a workflow's members or order from the Edit form; drag-to-reorder.
- Converting an existing Agent+Skill or Skill into a workflow.
- Nesting (a workflow as a member of another workflow).

## Constraints
- English labels / Thai explanations (CLAUDE.md §6). Reuse `SkillRow` + `validateSkillRows`.
- `firestore.rules`: create has no key whitelist (no change); member pending/approval paths
  unchanged. Verify the creator `childSkillIds` branch is not needed at create time.

## Existing skills as members (user)
Allowed, same as Agent+Skill: an approved, non-archived skill can be picked as Starter or member.
It is then locked and receives the cascade like any member, through `cascadeTargets` — which
already skips a member further along than the workflow (higher progress, or deploy-approved while
the workflow is not), so finished work is never dragged backwards.

## Settled after builder check
- **Approval** (answered by the code): approving/rejecting the workflow moves its pending new
  members with it — `findCascadeSiblings` in PendingApprovalModal matches `matchingAgent` + same
  `createdBy`, which new members carry. No partly-approved workflow from the queue.
- **Membership is by `childSkillIds` only** for workflow parents (my call): no name/submitter
  heuristic, so unrelated skills that share a `matchingAgent` value cannot slip in and the step
  order is exact. `matchingAgent` on new members exists only for approval and rename paths.
- **One workflow per skill** (my call): a skill already in a workflow, or already paired under an
  Agent, is not offered in the member picker. Detail shows a single "Workflow" row.
- **Groundwork:** build on branch `feat/screening-assessment` head (`a6128eb`).
- **Release:** includes a scoped functions deploy (`delayAlertsMon`, `sendDelayDigest`) for the
  `delayAlertRules.js` port — asked for at release time like every production deploy.

## Left to the builder
Exact placement of the "N skills" note; whether `isWorkflow` lives in `tier.js` or
`agentUtils.js`; the wording of the Starter section hint.
