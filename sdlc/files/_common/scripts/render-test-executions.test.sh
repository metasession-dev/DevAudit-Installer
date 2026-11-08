#!/usr/bin/env bash
# render-test-executions.test.sh - Tests for render-test-executions.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/render-test-executions.sh"
[ -x "$HELPER" ] || chmod +x "$HELPER"

PASS=0
FAIL=0
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

assert_contains() {
  local desc="$1"
  local needle="$2"
  local haystack="$3"
  if printf '%s' "$haystack" | grep -Fq "$needle"; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    echo "    missing: $needle"
    echo "$haystack" | sed 's/^/    /'
    FAIL=$((FAIL + 1))
  fi
}

echo "=== render-test-executions.sh tests ==="

cat > "$WORK/first-class.json" <<'EOF'
{
  "testExecutions": [
    {
      "sourceRelease": "REQ-091",
      "sdlcStage": 2,
      "suiteKind": "quality_gate",
      "outcome": "failed",
      "workflowName": "Quality Gates",
      "workflowUrl": "https://github.com/example/repo/actions/runs/100",
      "externalRunId": "100",
      "externalRunAttempt": 1,
      "relatedEvidence": [{ "displayName": "quality-gates.json" }],
      "incidentReference": "#501",
      "startedAt": "2026-07-15T08:00:00Z",
      "completedAt": "2026-07-15T08:05:00Z"
    },
    {
      "sourceRelease": "REQ-091",
      "sdlcStage": 2,
      "suiteKind": "quality_gate",
      "outcome": "passed",
      "workflowName": "Quality Gates",
      "workflowUrl": "https://github.com/example/repo/actions/runs/101",
      "externalRunId": "101",
      "externalRunAttempt": 2,
      "relatedEvidence": [{ "displayName": "quality-gates-rerun.json" }],
      "remediationReference": "PR #507",
      "startedAt": "2026-07-15T09:00:00Z",
      "completedAt": "2026-07-15T09:07:00Z"
    },
    {
      "sourceRelease": "REQ-090",
      "sdlcStage": 4,
      "suiteKind": "uat",
      "outcome": "passed",
      "workflowName": "UAT Review",
      "workflowUrl": "https://portal.example/releases/req-090",
      "relatedEvidence": [{ "displayName": "uat-checklist.md" }],
      "startedAt": "2026-07-15T10:00:00Z",
      "completedAt": "2026-07-15T10:12:00Z"
    }
  ]
}
EOF

OUTPUT="$(bash "$HELPER" "$WORK/first-class.json")"
assert_contains "table is marked as generated (devaudit-installer#1016)" "<!-- generated-by: render-test-executions.sh journey-at " "$OUTPUT"
assert_contains "first-class heading rendered" "| Source Release | SDLC Stage | Execution | Suite | Outcome | Workflow / Run | Related Evidence | Incident / Remediation | Date |" "$OUTPUT"
assert_contains "stage label rendered" "| REQ-091 | 2 implement_test | #1 | quality_gate | failed | [Quality Gates](https://github.com/example/repo/actions/runs/100) (run 100, attempt 1) | quality-gates.json | #501 | 2026-07-15 08:05:00 |" "$OUTPUT"
assert_contains "ordinal increments within source release + stage" "| REQ-091 | 2 implement_test | #2 | quality_gate | passed | [Quality Gates](https://github.com/example/repo/actions/runs/101) (run 101, attempt 2) | quality-gates-rerun.json | PR #507 | 2026-07-15 09:07:00 |" "$OUTPUT"
assert_contains "different release/stage restarts numbering" "| REQ-090 | 4 uat_review | #1 | uat | passed | [UAT Review](https://portal.example/releases/req-090) | uat-checklist.md | None | 2026-07-15 10:12:00 |" "$OUTPUT"
assert_contains "first-class final assessment rendered" "Stage-scoped execution numbering is authoritative from first-class portal test execution records." "$OUTPUT"

cat > "$WORK/legacy.json" <<'EOF'
{
  "legacyCycles": [
    {
      "testCycleId": "287654321",
      "workflowName": "Legacy E2E"
    }
  ]
}
EOF

OUTPUT="$(bash "$HELPER" "$WORK/legacy.json")"
assert_contains "legacy grouping is ignored" "No first-class test execution records were returned by the portal." "$OUTPUT"

# devaudit-installer#1199: the output of `devaudit release status --json`
cat > "$WORK/release-status.json" <<'EOF'
{
  "project": "example-app",
  "version": "REQ-119",
  "releaseId": "rel-1",
  "status": "prod_review",
  "url": "https://portal.example/projects/example-app/releases/rel-1",
  "checks": [],
  "executions": [
    {
      "id": "c1",
      "source_release_id": "00000000-0000-0000-0000-000000000001",
      "sdlc_stage": 5,
      "cycle_kind": "e2e",
      "outcome": "passed",
      "workflow_name": "E2E Regression",
      "workflow_url": "https://github.com/example/repo/actions/runs/200",
      "external_run_id": "200",
      "external_run_attempt": 1,
      "incident_reference": null,
      "remediation_reference": null,
      "outcome_reason": null,
      "resolution_type": null,
      "started_at": "2026-11-08T08:00:00Z",
      "completed_at": "2026-11-08T08:30:00Z"
    },
    {
      "id": "c2",
      "source_release_id": "00000000-0000-0000-0000-000000000001",
      "sdlc_stage": 5,
      "cycle_kind": "e2e",
      "outcome": "failed",
      "workflow_name": "E2E Regression",
      "workflow_url": "https://github.com/example/repo/actions/runs/201",
      "external_run_id": "201",
      "external_run_attempt": 1,
      "incident_reference": null,
      "remediation_reference": "https://github.com/example/repo/issues/7",
      "outcome_reason": "2 specs failed",
      "resolution_type": "accepted_exception",
      "started_at": "2026-11-08T09:00:00Z",
      "completed_at": "2026-11-08T09:40:00Z"
    }
  ]
}
EOF

OUTPUT="$(bash "$HELPER" "$WORK/release-status.json")"
assert_contains "release status rows use the report version as the source release" "| REQ-119 | 5 production | #1 | e2e | passed | [E2E Regression](https://github.com/example/repo/actions/runs/200) (run 200, attempt 1) | None | None | 2026-11-08 08:30:00 |" "$OUTPUT"
assert_contains "a resolved failure shows its remediation, reason and resolution" "| REQ-119 | 5 production | #2 | e2e | failed | [E2E Regression](https://github.com/example/repo/actions/runs/201) (run 201, attempt 1) | None | https://github.com/example/repo/issues/7; 2 specs failed; resolved: accepted_exception | 2026-11-08 09:40:00 |" "$OUTPUT"

cat > "$WORK/release-status-empty.json" <<'EOF'
{ "version": "REQ-119", "executions": [] }
EOF
OUTPUT="$(bash "$HELPER" "$WORK/release-status-empty.json")"
assert_contains "an empty executions list renders the no-records row" "No first-class test execution records were returned by the portal." "$OUTPUT"

echo
echo "=== render-test-executions.test.sh: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
