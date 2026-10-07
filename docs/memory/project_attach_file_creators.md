---
name: project_attach_file_creators
description: 2026-10-07 base-'user' creators see Attach Endpoint File again (own items only) + new file.updated notification; supersedes the V7 hide
metadata:
  type: project
---
Shipped 2026-10-07 (functions:notifyEvent + hosting, commit bcc4fe5).

- The ☰ Attach Endpoint File menu shows for role `user` only when they created ≥1 deploy-approved item; the picker lists only their own items. Other roles unchanged. This reverses the 2026-10-01 V7 decision that hid it from `user`.
- One predicate for menu + picker: `canAttachFileTo()` in `src/lib/endpointFiles.js` (client mirror of `checkUploadPermission`/`checkAgentActor`; edit both together).
- New event `file.updated`: creators + area approvers (`approverOverride` applies), uploader excluded (email from the auth token), sub-skills included, only within 10 min of upload. Fired from the menu upload only, never for identical re-uploads (`unchanged`), never in the 100% flow (that sends `agent.ready`).
- Same day: `link.requested`/`link.decided` added to the client `TYPES` in `src/lib/notify.js`; they had been silently dropped (0 rows in /mailLog; feature unused so far).

**Why:** the user wanted creators to publish new versions of their own skill files and have creators + area approvers told.
**How to apply:** do not re-hide the menu from `user`; keep `TYPES` in notify.js equal to `EVENT_TYPES` in functions/notifyRules.js. Related: [[project_redesign_v7]].
