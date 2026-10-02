---
name: project_redesign_v7
description: Redesign V7 SHIPPED to production 2026-10-02 (hosting only); backup + rollback commands
metadata:
  type: project
---
Redesign V7 went live 2026-10-02 via `hosting:clone <site>:v7-rc <site>:live` (both sites wolfy-ai-library + wolfy-481609). Live bundle index-BRkMncB7.js; previous live = index-CMOwpcGd.js.
Hosting only — no rules/functions/data changes. Git: main == origin/main at 2500acb, tags `prod-pre-v7` (old live code) and `prod-v7`.

**Rollback (~1 min):** `npx firebase-tools hosting:clone <site>:prod-backup <site>:live --project wolfy-481609` for both sites (prod-backup channels expire 2026-10-09), or Console → Hosting → release history → Rollback (no expiry), or rebuild from tag `prod-pre-v7`.

**Why:** user approved V7 after testing the v7-rc channel; asked for guaranteed rollback.
**How to apply:** further UI work goes on main now; branch redesign-v7 is merged.
