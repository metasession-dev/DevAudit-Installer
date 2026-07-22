#!/usr/bin/env bash
# Regression checks for the canonical release-process documentation (#409).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLAYBOOKS="$ROOT/docs/release-playbooks"
WORKFLOWS="$ROOT/docs/change-workflows.md"
SKILL="$ROOT/sdlc/files/_common/skills/sdlc-implementer/SKILL.md"
E2E_SKILL="$ROOT/sdlc/files/_common/skills/e2e-test-engineer/SKILL.md"
UPDATE_WORKFLOW="$ROOT/sdlc/files/_common/workflows/devaudit-update-install.md"

failures=0

expect_contains() {
  local file="$1"
  local pattern="$2"
  if ! grep -Fq -- "$pattern" "$file"; then
    echo "FAIL: expected '$pattern' in ${file#$ROOT/}" >&2
    failures=$((failures + 1))
  fi
}

expect_absent() {
  local pattern="$1"
  if grep -RFn -- "$pattern" "$PLAYBOOKS" "$WORKFLOWS" >/dev/null; then
    echo "FAIL: stale protected-branch instruction '$pattern' found" >&2
    grep -RFn -- "$pattern" "$PLAYBOOKS" "$WORKFLOWS" >&2
    failures=$((failures + 1))
  fi
}

expect_contains "$PLAYBOOKS/README.md" "terminal green on its current head SHA"
expect_contains "$PLAYBOOKS/README.md" "repository_dispatch(release-closed)"
expect_contains "$PLAYBOOKS/README.md" "BUNDLED-CHANGES-REQ-XXX.json"
expect_contains "$PLAYBOOKS/README.md" "Submitting a release for UAT review is not the same thing as executing or"
expect_contains "$PLAYBOOKS/README.md" "scripts/record-uat-execution.sh"
expect_contains "$PLAYBOOKS/housekeeping-release.md" "Standalone housekeeping promotion"
expect_contains "$PLAYBOOKS/housekeeping-release.md" "STANDALONE-HOUSEKEEPING-vYYYY.MM.DD.json"
expect_contains "$PLAYBOOKS/housekeeping-release.md" "wait for the next tracked release"
expect_contains "$PLAYBOOKS/high-risk-release.md" "backmerge/*"
expect_contains "$PLAYBOOKS/low-risk-release.md" "render-test-executions.sh"
expect_contains "$WORKFLOWS" "Historical CI context by default"
expect_contains "$SKILL" "mandatory automated reconciliation"
expect_contains "$SKILL" "record Stage 4 UAT execution"
expect_contains "$E2E_SKILL" "Check release and execution provenance"
expect_contains "$E2E_SKILL" "must not relabel the source E2E run"
expect_contains "$UPDATE_WORKFLOW" "wait for terminal-green checks on the current PR SHA"
expect_contains "$UPDATE_WORKFLOW" "creates no tracked approval release"

if grep -Fq "auto-generate housekeeping release stubs" "$UPDATE_WORKFLOW"; then
  echo "FAIL: consumer update workflow still describes obsolete housekeeping release stubs" >&2
  failures=$((failures + 1))
fi

expect_absent "git push origin develop"
expect_absent "git push origin main"
expect_absent "git checkout main && git merge develop"
expect_absent "git checkout develop && git merge main"

if ! grep -Fq 'standalone-housekeeping-release.sh validate' "$ROOT/sdlc/files/_common/scripts/check-release-pr-scope.sh"; then
  echo "FAIL: release-scope integrity does not require a standalone declaration" >&2
  failures=$((failures + 1))
fi
if ! grep -Fq 'standalone-housekeeping-release.sh promote' "$ROOT/sdlc/files/ci/post-deploy-prod.yml.template"; then
  echo "FAIL: post-deploy does not promote validated standalone housekeeping releases" >&2
  failures=$((failures + 1))
fi

if [ "$failures" -gt 0 ]; then
  exit 1
fi

echo "release playbook contract: PASS"
