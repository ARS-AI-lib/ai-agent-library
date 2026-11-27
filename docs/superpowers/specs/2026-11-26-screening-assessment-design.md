# Skill/Agent Screening Assessment — design

## Context
The bank's screening questionnaire (`~/Downloads/20261125_Skill_Library_Screening_sent_v3.xlsx`
+ reference tool `20261123_Skill_Library_Screening_sent.html`) must become part of the library:
creators declare what an item is for and answer risk/readiness questions **before** the AI
duplicate check, and testing questions **before** a deploy request. Goal: stop items with
embedded sensitive data from entering, and stop untested items from being deployed.

## Decisions (user, 2026-11-26)
- Applies to **every type** (Agent, Skill, Agent+Skill). Question wording says "skill" → use
  neutral "Agent/Skill".
- **Split into 2 stages:**
  1. **Pre-assessment** (Pre-Reg form, after the form tab, before duplicate check):
     D1–D6 declarations (free text, all required) + C1–C9.
     **Blocks only on C7** = embedded data "มี" or "ยังไม่ได้ตรวจ" → cannot continue.
     C6/C8/C9 answers marked "ต้องแก้" are **saved** and **asked again at deploy request**.
  2. **Deployment assessment** (deploy request confirm in AgentDetailModal): C10–C11
     + re-ask C6/C8/C9 that were not "ผ่าน". **Blocks when C10/C11 fail** (definition below).
- Scoring/level copied exactly from the HTML (Accenture D0): sum of option scores,
  Low 0–6 · Medium 7–13 · High ≥14; "ปัจจัยหลัก" = options with score ≥3.

## Approaches considered
- **A (chosen):** questionnaire data as one shared module, rendered as a new step in
  existing modals; result stored on the agent doc; gates enforced in the client, same as the
  duplicate-check block (`src/lib/dupBlock.js`).
- B: separate `/assessments` collection + callable that enforces gates server-side — stronger
  but answers are self-declared anyway, and it doubles the write paths. Rejected for v1.
- C: link out to the HTML tool and ask for a PDF upload — no data, no gating. Rejected.

## Design
**`src/lib/screening.js` (single source, ⛔ no inline copies):** the `DATA.creator` question
list, option scores/`lv`, `RECO` texts and the `MAND` C11 conditions ported verbatim from the
HTML (only "skill"→"Agent/Skill" in wording). Pure functions:
- `evaluate(answers)` → `{ level, total, hits, must[], should[] }` (port of HTML `evaluate`).
- `preGate(answers)` → `{ complete, blocked, reasons }` — complete = D1–D6 non-empty + C1–C9
  answered; blocked = C7 ∈ {มี, ยังไม่ได้ตรวจ}.
- `deployGate(answers)` → `{ complete, blocked, reasons }` — blocked if C10 ≠ "ทดสอบครบทุกด้าน
  ผ่าน" **or** C11 is "ต้องแก้" per HTML `MAND` (C4 reads docs/web and C11 not passed).
- `pendingRecheck(answers)` → which of C6/C8/C9 to re-ask at deploy.

**Stored on agent doc:** `screening: { v:1, decl:{D1..D6}, answers:{C1..C11}, level, total,
must[], should[], preAt, deployAt }`. Written at create (PreRegModal, parent + new sub-skills
from the same form) and updated in the deploy request write (+ cascade to sub-skills).

**UI**
- PreRegModal: new tab **"Assessment"** between form and analysis. "Analyze" (dup check) is
  disabled until `preGate` complete and not blocked; C7 block shows the RECO text. Result panel
  shows level, ปัจจัยหลัก, ควรแก้ (as in HTML result page). Labels English, explanations Thai (§6).
- AgentDetailModal deploy confirm: shows C10, C11 and any C6/C8/C9 to re-ask; confirm button
  disabled while `deployGate` blocked. Items with no stored screening (all 379 existing) answer
  the **full** D1–D6 + C1–C11 here on first deploy request.
- PendingApprovalModal: level badge + must/should list for approvers (new + deploy queues).
- AgentDetailModal: show D1–D6 as "Declaration" (xlsx: "แนะนำให้เพิ่มในประกาศของคนสร้าง").

**firestore.rules:** add `'screening'` to the deploy-request `hasOnly` list (line ~168). Check
create rule allows the new key. ⚠ Rules must be published via Console before hosting deploy.

## My calls (please check)
1. C10 "ทดสอบบางด้าน" also blocks deploy (all non-pass C10 options are "ต้องแก้" in the HTML).
2. Re-asked C6/C8/C9 that still fail at deploy do **not** block — recorded for the approver.
3. One assessment per submission; new sub-skills in the same form inherit it.
4. Gates are client-side (same trust model as the duplicate block and deploy request today).
5. Existing items are not back-filled; they answer everything at their next deploy request.
6. Questionnaire 2 (user confirmation U1) is out of scope — it belongs to adoption, not registration.

## Not in scope
Server-side enforcement · re-assessment on edit · Questionnaire 2 · CSV/PDF export from the HTML.

## Verification
- `functions/verify-screening.cjs` (loadEsm `screening.js`): reproduce every row of xlsx sheet 3
  (each answer → alert / should / ปัจจัยหลัก) + HTML example (expected Medium) + gate cases.
- `npm run build`; browser on emulator/preview channel: new item blocked by C7; passes to dup
  check; deploy request blocked by C11 with C4=web; approver sees level.
- Deploy order: publish rules (user, Console) → hosting (preview channel first). No functions change.
- Update CLAUDE.md (new §37) + SYSTEM-OVERVIEW.

## Deploy checklist (added 2026-11-26)
At **Request deploy**, step 1 shows a per-Tier checkbox list of what the package contains
(T from `getTier()`); items marked `*` are required before Next. Step 2 = the deployment
assessment above. Lists (user): T1 readme* template no_secret* · T2 readme template rbac*
prompt_injection guardrail audit_log · T3 readme* template no_secret* guardrail pii* ·
T4 readme template rbac* prompt_injection* guardrail* pii* audit_log* cab*.
Stored as `deployChecklist: { tier, checked[], at }` with the request; cascades to sub-skills
with the parent's values; shown to the approver. Rules: add `deployChecklist` next to
`screening` in the deploy-request `hasOnly`. UI reuses the existing `mov`/`mbox` dialog and the
`v7-step` stepper. Checklist ("what is in the package") and C7/C11 ("was it tested") are
separate on purpose; overlapping items are not merged.

## Change 2026-11-26 (user, mid-implementation): D1–D6 move into the registration form
D1–D6 are no longer assessment questions. They are form fields: D1 = `description`, D4 = `tool`,
D6 = `llm` (existing, relabelled Permitted Tools / Models Tested); D2/D3/D5 = new `permittedDomains`,
`prohibitedUses`, `requiredSkills`. All required. `screening.decl` is removed. Existing items that lack
the empty ones fill them in the Request-deploy dialog (rules `hasOnly` widened accordingly).
