#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/hotfix-backmerge.yml"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

grep -q 'repos/${GITHUB_REPOSITORY}/actions/permissions/workflow' "$WORKFLOW" \
  || fail "workflow does not preflight the repository Actions PR setting"

preflight_line="$(grep -n 'can_approve_pull_request_reviews' "$WORKFLOW" | head -n1 | cut -d: -f1)"
push_line="$(grep -n 'git push --force-with-lease' "$WORKFLOW" | head -n1 | cut -d: -f1)"
if [ "$preflight_line" -ge "$push_line" ]; then
  fail "workflow must verify PR creation policy before pushing a temporary branch"
fi

grep -q "Unable to create the reviewed hotfix back-merge PR" "$WORKFLOW" \
  || fail "workflow does not report PR creation failures"

grep -q "Allow GitHub Actions to create and approve pull requests" "$WORKFLOW" \
  || fail "workflow does not emit the actionable repository setting"

grep -q "gh pr create" "$WORKFLOW" \
  || fail "workflow no longer creates the reviewed back-merge PR"

grep -q 'git push origin --delete "$BACKMERGE_BRANCH"' "$WORKFLOW" \
  || fail "workflow does not clean up the temporary branch after PR creation failure"

echo "hotfix-backmerge workflow contract passed"
