---
name: project-inbox-announcements
description: Inbox + announcements shipped live 2026-11-17 (rules + hosting only) — where the pieces live, rollback, and the git-push gotcha on this Mac
metadata:
  type: project
---
Inbox (Library page button) now carries: announcements from admin/committee targeted by level (`all` / `approvers` / `leads`), the user's own waiting/rejected requests (14 days), and a link to the approval queue. No email/Teams. LIVE on both sites since 2026-11-17; the user published the rules and posted a test announcement on production.

**Why:** the company wanted a non-email channel to users, and "waiting for approval" was buried in My Submissions.
**How to apply:** CLAUDE.md §36 is authoritative (audience table, rules, badge definition, verify scripts, rollback). `New announcement` lives in the ☰ menu (Admin section) — not in the Inbox. `allowedAudiences` (src/lib/inbox.js) must always equal `audienceOk` (firestore.rules). Run `functions/verify-inbox.cjs` and `functions/verify-inbox-rules.cjs` before any change.

**Git push on this Mac:** Keychain serves `tinnapatptm-ship-it` (no write access to ARS-AI-lib); push with `git -c credential.helper= -c credential.helper="!gh auth git-credential" push origin main` after `gh auth switch -u ARS-AI-lib`. See [[feedback_cloudshell_workflow]] for deploy rules (hosting backup channel first, never unscoped functions deploy).
