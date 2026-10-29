#!/usr/bin/env bash
set -euo pipefail
test "$VITE_FIREBASE_PROJECT_ID" = demo-acadea
test "$FIRESTORE_EMULATOR_HOST" = 127.0.0.1:8080
test "$FIREBASE_AUTH_EMULATOR_HOST" = 127.0.0.1:9099
test "$FIREBASE_STORAGE_EMULATOR_HOST" = 127.0.0.1:9199
test -z "${GOOGLE_APPLICATION_CREDENTIALS:-}"
test -z "${FIREBASE_SERVICE_ACCOUNT_JSON:-}"
export ACADEA_E2E_PASSWORD="$(openssl rand -hex 32)"
echo "::add-mask::$ACADEA_E2E_PASSWORD"
cleanup() {
  result=$?
  trap - EXIT
  node scripts/offlineStagingFixture.mjs cleanup || result=1
  exit "$result"
}
trap cleanup EXIT
node scripts/offlineStagingFixture.mjs prepare
npx playwright test e2e/offline-staging-authenticated.spec.ts --workers=1 --retries=0 --output=playwright-results
