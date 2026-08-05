---
name: feedback-cloudshell-workflow
description: Deploy is now direct from local Mac via npx firebase-tools — Cloud Shell retired (2026-07-22)
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 5b7ada72-a449-4ebc-b37a-4269b922e007
  modified: 2026-07-22T07:10:48.511Z
---

**SUPERSEDED 2026-07-22 — Cloud Shell is retired as the deploy source.** Deploy now happens DIRECTLY from the local Mac clone (`/Users/tinpato/Downloads/claude_AIApp/agent-library/`).

The single source of truth is now **local + git**: `origin = github.com/ARS-AI-lib/ai-agent-library`, branch `main`. On 2026-07-22 local was diff-verified byte-identical to the Cloud-Shell-deployed version (only difference was an uncompressed `public/wolfy-logo.png` in local — fixed by copying the 11KB live version), then committed + pushed so local == deployed == origin/main.

**Deploy (hosting):** `npm run build && npx firebase-tools deploy --only hosting --project wolfy-481609`
- `npx firebase-tools` works on this machine (no global install → sidesteps the admin lock that originally forced Cloud Shell). firebase CLI is logged in as `tinnapat.p@arise.tech`.
- targets `main` (site `wolfy-481609`) + `pretty` (site `wolfy-ai-library`) per `.firebaserc`.
- optional extra-safe: `npx firebase-tools hosting:channel:deploy <name> --project wolfy-481609` → temp preview URL that never touches live, then promote.

**Why:** the "admin lock, can't install locally" premise turned out false — the sibling Portfolio app (same Mac) already deploys locally via npx, and firebase-admin scripts run fine against prod here too. Removing the manual Cloud-Shell upload step was the user's explicit goal.

**⚠️ IRON RULE — shared GCP project `wolfy-481609` with the Portfolio app:** never run bare `firebase deploy` or `--only functions` — 6 functions are deployed (AI Lib: analyzeDuplicate, chatLibrary, send-approval-email · Portfolio: files, logProjectActivity, logTaskActivity) but local `functions/index.js` only has 2, so an unscoped deploy offers to DELETE the rest incl. Portfolio's. Scope functions deploys: `--only functions:analyzeDuplicate,chatLibrary`. Hosting is target-isolated (safe). Firestore rules still publish via Console (named DB `ai-agent-lib`).

- Build tool is Vite using `rolldown` — JSX syntax errors show as rolldown/oxc `[builtin:vite-transform]` errors, not Babel.
- See [[feedback-sdlctab-baseline]] for the file-protection rule, and CLAUDE.md §11 for the authoritative deploy workflow.
