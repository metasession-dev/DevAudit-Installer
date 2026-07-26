#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/hotfix-backmerge.yml"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

if grep -q 'actions/permissions/workflow' "$WORKFLOW"; then
  fail "workflow must not query the admin-only Actions permissions endpoint with GITHUB_TOKEN"
fi

grep -q '^  contents: write$' "$WORKFLOW" \
  || fail "workflow does not declare contents write permission"

grep -q '^  pull-requests: write$' "$WORKFLOW" \
  || fail "workflow does not declare pull-request write permission"

grep -q "Unable to push.*for hotfix back-merge" "$WORKFLOW" \
  || fail "workflow does not report branch push failures"

grep -q "Unable to create the reviewed hotfix back-merge PR" "$WORKFLOW" \
  || fail "workflow does not report PR creation failures"

grep -q "Allow GitHub Actions to create and approve pull requests" "$WORKFLOW" \
  || fail "workflow does not emit the actionable repository setting"

grep -q "gh pr create" "$WORKFLOW" \
  || fail "workflow no longer creates the reviewed back-merge PR"

grep -q 'git push origin --delete "$BACKMERGE_BRANCH"' "$WORKFLOW" \
  || fail "workflow does not clean up the temporary branch after PR creation failure"

echo "hotfix-backmerge workflow contract passed"
