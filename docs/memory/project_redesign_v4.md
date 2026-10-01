---
name: project-redesign-v4
description: "UI redesign v4 approved 2026-10-01 (mockup only, not implemented) — link + locked decisions"
metadata:
  node_type: memory
  type: project
  originSessionId: 2edd8cdd-93e1-4469-bf2c-e0ca39b511f8
  modified: 2026-10-01T09:22:22.944Z
---

Design v4 of the AI Library UI redesign was **approved by the user on 2026-10-01**, to be implemented later ("เดี๋ยวเราจะกลับมาทำทีหลัง"). Nothing in the repo has changed yet.

Canvas: https://claude.ai/artifact/5iij2Zkz22eygg7EMyXSMk (v1–v3 are superseded drafts).

**Decisions locked through the v1→v4 feedback rounds:**
- **Header:** one shared header on every page (Library, SDLC, Use Case, Dashboard).
  - Row 1: logo, tabs, search, Agent/Skill counter chips (pill with a background and border), then the avatar + ☰ at the far top-right.
  - Row 2: that page's filters + Pending (inbox icon with a badge) + "+ New".
- **Filters:** stay as separate dropdowns, compact 28px pills with the label inside.
  - The active state uses a soft tint (#eef3ff / #c9d8ff / #3a64d8), not solid #2f6bff.
  - The primary button keeps #2f6bff.
- **Wording:** the button is "+ New". Never use the word "idea".
- **Icons:** minimal stroke icons with tooltips replace some text (detail actions, clear filter).
- **Detail modal:** has a Feedback & Review section below the details (average rating, distribution, latest reviews, "Rate this").
- **Register form:** Next → AI duplicate check → Submit. On high risk the footer offers "Back to edit" / "Submit anyway".
- **SDLC:**
  - Keeps the real board structure: two header rows, POST DEVELOPMENT merged, status-bordered cards with **no left stripe**, ◦●◆✓ count lines.
  - Has a Use Case view.
  - Filters and legend use the same pills as the Library.
- **Dashboard:** visuals stay **exactly the original**. The only addition is the shared header. The original solid `.dash-filterbar` and the `.dash-sev` "Fix" pill are kept.

**How to apply:** when implementing, start from this canvas and the real CSS tokens. See also [[feedback-english-headers]].
