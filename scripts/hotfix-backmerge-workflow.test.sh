#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/hotfix-backmerge.yml"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

if grep -q 'repos/${GITHUB_REPOSITORY}/actions/permissions/workflow' "$WORKFLOW"; then
  fail "workflow must not call the repository workflow-permissions endpoint with GITHUB_TOKEN"
fi

grep -q "Unable to create the reviewed hotfix back-merge PR" "$WORKFLOW" \
  || fail "workflow does not report PR creation failures"

grep -q "Allow GitHub Actions to create and approve pull requests" "$WORKFLOW" \
  || fail "workflow does not emit the actionable repository setting"

grep -q "gh pr create" "$WORKFLOW" \
  || fail "workflow no longer creates the reviewed back-merge PR"

echo "hotfix-backmerge workflow contract passed"
