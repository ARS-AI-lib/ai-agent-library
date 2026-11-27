#!/usr/bin/env bash
# Deploy the TEST environment: site wolfy-ai-library-test + Firestore rules for ai-agent-lib-test +
# a second copy of the Cloud Functions named test-<name> that read/write the test database.
# Never touches production hosting, rules, or functions. Usage:
#   scripts/deploy-test.sh [web|functions|rules|all]     (default: all)
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT=wolfy-481609
WHAT="${1:-all}"
CFG=firebase.test.json

prepare_functions() {
  rm -rf functions-test && mkdir functions-test
  rsync -a --exclude node_modules --exclude '*.cjs' --exclude '*.json' --exclude CLAUDE.md functions/ functions-test/
  cp functions/package.json functions/package-lock.json functions-test/
  cp functions/process-descriptions.json functions/eval-duplicate-cases.json functions-test/ 2>/dev/null || true
  cat > functions-test/.env <<ENV
DB_ID=ai-agent-lib-test
TEST_MODE=1
CANONICAL_ORIGIN=https://wolfy-ai-library-test.web.app
ENV
  ln -s ../functions/node_modules functions-test/node_modules   # local discovery only; Cloud Build installs its own
}

if [[ "$WHAT" == "rules" || "$WHAT" == "all" ]]; then
  firebase deploy --config $CFG --only firestore --project $PROJECT
fi
if [[ "$WHAT" == "functions" || "$WHAT" == "all" ]]; then
  prepare_functions
  firebase deploy --config $CFG --only functions:test --project $PROJECT
fi
if [[ "$WHAT" == "web" || "$WHAT" == "all" ]]; then
  npx vite build --mode test --outDir dist-test --emptyOutDir
  firebase deploy --config $CFG --only hosting --project $PROJECT
fi
