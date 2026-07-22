#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/hotfix-backmerge.yml"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

grep -q 'repos/${GITHUB_REPOSITORY}/actions/permissions/workflow' "$WORKFLOW" \
  || fail "workflow permission preflight endpoint is missing"

grep -q "can_approve_pull_request_reviews" "$WORKFLOW" \
  || fail "workflow does not inspect the Actions PR-creation setting"

grep -q "Allow GitHub Actions to create and approve pull requests" "$WORKFLOW" \
  || fail "workflow does not emit the actionable repository setting"

grep -q "gh pr create" "$WORKFLOW" \
  || fail "workflow no longer creates the reviewed back-merge PR"

echo "hotfix-backmerge workflow contract passed"
