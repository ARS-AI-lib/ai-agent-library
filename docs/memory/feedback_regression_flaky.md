---
name: feedback-regression-flaky
description: functions/regression.cjs returns ~16/17 with a rotating failure even with no code change — always run a baseline before blaming your edit
metadata:
  type: feedback
---

`node functions/regression.cjs` (the ALPHA chat suite) is non-deterministic:
it commonly returns 16/17, and **which** case fails changes between runs of
the *same* code. Measured 2026-08-20: two baseline runs with an unmodified
`chatPrompt.js` each failed 1/17 — different cases each time — while the
modified prompt scored 17/17 on the next run.

**Why:** every case is a live Vertex/Gemini call. The checks use regexes over
free-form Thai prose (e.g. the Tier case strips negated mentions of
"ระดับความสำคัญ" then flags leftovers), so ordinary wording variation trips
them.

**How to apply:** when a prompt edit appears to break a case, `git stash` the
prompt, re-run to get a baseline, then restore and re-run — do NOT conclude
"my change broke it" from a single run, and do NOT chase a green 17/17 by
editing the prompt toward the regex. Report the honest picture (e.g. "17/17
this run; baseline also flakes at 16/17"). Related: [[project_chat_assistant_requirements]].
