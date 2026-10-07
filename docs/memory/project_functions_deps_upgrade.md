---
name: project_functions_deps_upgrade
description: Deferred 2026-10-07 - deploy patched functions deps together with the firebase-admin 14 / firebase-functions 7 upgrade (one round, not two)
metadata:
  type: project
---
`npm audit fix` was committed + pushed 2026-10-07 (69bc8c1) and the WEB part is live (hosting, index-srKWEKz6.js). The FUNCTIONS part is NOT deployed: production functions still run the old express/qs/proxy-addr/body-parser/grpc-js/busboy.

User decision 2026-10-07: do not deploy functions for the patches alone; do it ONCE together with the firebase-admin 12->14.5 and firebase-functions 5->7.4 upgrade (breaking; also clears the last high, node-forge).

Why low urgency: checked the code - no `trust proxy`/`req.ip`/`x-forwarded`, no `onRequest`, no multipart; all 17 onCall + 2 onSchedule + 1 task fn authenticate by Firebase Auth token, so the critical proxy-addr (IP spoofing) is not reachable.

**How to apply:** when that upgrade is started - run `npx firebase-tools functions:list` first, deploy by explicit name only (project is shared with Portfolio/Vote; never unscoped), test callables for real, keep the old release for rollback. Remaining audit after audit fix: web 4 high (firebase client, wait for upstream patch; NEVER `npm audit fix --force` - it suggests downgrading firebase to v9), functions 10.
