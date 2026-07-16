#!/usr/bin/env bash
# render-test-cycles.test.sh — Tests for render-test-cycles.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/render-test-cycles.sh"
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

echo "=== render-test-cycles.sh tests ==="

cat > "$WORK/first-class.json" <<'EOF'
{
  "cycles": [
    {
      "sourceRelease": "REQ-091",
      "sdlcStage": 2,
      "cycleKind": "quality_gate",
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
      "cycleKind": "quality_gate",
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
      "cycleKind": "uat",
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
assert_contains "first-class heading rendered" "| Source Release | SDLC Stage | Cycle | Kind | Outcome | Workflow / Run | Related Evidence | Incident / Remediation | Date |" "$OUTPUT"
assert_contains "stage label rendered" "| REQ-091 | 2 implement_test | #1 | quality_gate | failed | [Quality Gates](https://github.com/example/repo/actions/runs/100) (run 100, attempt 1) | quality-gates.json | #501 | 2026-07-15 08:05:00 |" "$OUTPUT"
assert_contains "ordinal increments within source release + stage" "| REQ-091 | 2 implement_test | #2 | quality_gate | passed | [Quality Gates](https://github.com/example/repo/actions/runs/101) (run 101, attempt 2) | quality-gates-rerun.json | PR #507 | 2026-07-15 09:07:00 |" "$OUTPUT"
assert_contains "different release/stage restarts numbering" "| REQ-090 | 4 uat_review | #1 | uat | passed | [UAT Review](https://portal.example/releases/req-090) | uat-checklist.md | None | 2026-07-15 10:12:00 |" "$OUTPUT"
assert_contains "first-class final assessment rendered" "Stage-scoped cycle numbering is authoritative from first-class portal cycle records." "$OUTPUT"

cat > "$WORK/legacy.json" <<'EOF'
{
  "legacyCycles": [
    {
      "testCycleId": "287654321",
      "workflowName": "Legacy E2E",
      "workflowUrl": "https://github.com/example/repo/actions/runs/287654321",
      "relatedEvidence": [{ "fileName": "e2e-results.json" }, { "fileName": "screenshot.png" }],
      "notes": "grouped from uploaded evidence only",
      "date": "2026-07-14T18:30:00Z"
    }
  ]
}
EOF

OUTPUT="$(bash "$HELPER" "$WORK/legacy.json")"
assert_contains "legacy fallback note rendered" "Legacy portal fallback — first-class cycle records unavailable; grouped by uploaded evidence" "$OUTPUT"
assert_contains "legacy row rendered" "| Legacy grouped evidence | legacy grouping | 287654321 | legacy | unknown | [Legacy E2E](https://github.com/example/repo/actions/runs/287654321) | e2e-results.json, screenshot.png | grouped from uploaded evidence only | 2026-07-14 18:30:00 |" "$OUTPUT"
assert_contains "legacy final assessment rendered" "Legacy grouping was used because the portal did not expose first-class cycle records." "$OUTPUT"

echo
echo "=== render-test-cycles.test.sh: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
