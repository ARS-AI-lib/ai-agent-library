---
name: feedback-machine-migration
description: Working environment moved to the company laptop 2026-08-05 — what git carries, what it never will, and why CLAUDE.md + docs/memory are now the handover mechanism
metadata:
  type: feedback
---

The working machine changed on 2026-08-05: from a personal Mac to a company laptop with an admin
lock. The move is complete and verified (clone → build → Firebase login → gcloud ADC → memory
restore → regression 11/11 → preview deploy → Claude Code answered a context-only question
correctly). The old machine is being retired.

**Why this matters beyond the move itself:** preparing it surfaced that ~2 weeks of work — the
entire semantic-search re-architecture — had never been committed, and `origin/main` still pointed
at a commit from 2026-07-22. Production was running code that existed in no repository, so anyone
who cloned and deployed would have silently rolled it back two weeks. `CLAUDE.md` was also sitting
*outside* the repo (in the parent folder) despite instructing that it belongs at the repo root, so a
fresh clone gave a new machine no project context at all.

**How to apply:**
- **A chat session does not survive a machine change.** Knowledge transfers only through
  `CLAUDE.md` and `docs/memory/` — that is what makes them load-bearing, not documentation nicety.
  Keep them current as work happens rather than at handover time.
- **Commit and push as work completes.** The gap here was not laziness about tidiness; it was a
  real single-point-of-failure on one disk, and it also meant git could not be trusted as the
  source of truth for what production runs.
- **`docs/memory/` is the durable original.** Claude Code only reads memory from
  `~/.claude/projects/<key>/memory/`, where `<key>` is the working-directory path with `/`
  replaced by `-` — so it differs on every machine and cannot point at the repo. Edit memory, then
  copy it back into `docs/memory/` and commit, or the next machine gets a stale copy.
- **`.env.local` never travels.** Vite inlines `VITE_*` at build time, so a missing one produces a
  bundle that builds fine but cannot log in — and deploying that breaks production. Recreate it
  from the Firebase Console instead of copying the file.
- The library's web config lives under the app registration named **`test-auth`** (not
  `portfolio`). `apiKey`/`messagingSenderId` are project-wide and identical across both apps —
  **`appId` is the only value that distinguishes them.** These are public-by-design (they ship in
  the deployed bundle); security comes from Firestore rules + authorized domains.
- Under an admin lock: `npm install` and `npx firebase-tools` need no elevation; `gcloud` installs
  into `$HOME`. Its installer offers to install Python 3.14 via `sudo` — **decline it**, the bundled
  Python is sufficient. Only the ADC-dependent scripts need gcloud; deploying does not.

See [[project-work-queue]] for what was actually built, and CLAUDE.md §19 for the step-by-step.
