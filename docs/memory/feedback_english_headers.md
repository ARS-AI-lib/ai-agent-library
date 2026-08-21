---
name: feedback-english-headers
description: Every form/section header and field label in the AI Agent Library must be English; only explanatory copy stays Thai
metadata:
  type: feedback
---

All `<label>` text, section headers, and button labels across the AI Agent
Library UI must be in English. Thai is allowed only for explanatory copy,
warnings, hints that read as sentences, and content pulled from real data
(agent names, reasons, error messages that quote a rule).

**Why:** the user corrected this explicitly (2026-08-20) after finding Thai
labels like "ช่องทางใช้งาน", "1. เลือก Agent / Skill", "อัปโหลดไฟล์" in the
progress-update dialog and the Attach Endpoint File modal — said this applies
"ทุกจุดในเว็บ" (every point in the site), not just those two screens.

**How to apply:** when adding or touching any form/modal, check every
`<label>`, section title, and button text — if it names a field or action
rather than explaining something, it must be English. Recorded in
[[project_work_queue]] and CLAUDE.md §6. When doing a broader UI pass, treat
this as a standing lint, not a one-off fix — sweep labels in the file being
touched even if the user didn't call out that specific string.
