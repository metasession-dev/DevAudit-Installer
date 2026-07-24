#!/usr/bin/env bash
# generate-security-summary.test.sh — Tests for the security-summary
# generator's markdown table output contract.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/generate-security-summary.sh"
[ -x "$HELPER" ] || chmod +x "$HELPER"

PASS=0
FAIL=0

assert_contains() {
  local desc="$1" want="$2" got="$3"
  if printf '%s' "$got" | grep -qF "$want"; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    echo "    want: $want"
    FAIL=$((FAIL + 1))
  fi
}

assert_not_contains_regex() {
  local desc="$1" pattern="$2" got="$3"
  if printf '%s' "$got" | grep -qE "$pattern"; then
    echo "  FAIL: $desc"
    echo "    unexpected pattern: $pattern"
    FAIL=$((FAIL + 1))
  else
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  fi
}

TMPDIR_BASE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_BASE"' EXIT

DIR1="$TMPDIR_BASE/test1"
mkdir -p "$DIR1"
cd "$DIR1"
printf '{ "results": [] }\n' > sast-results.json
printf '{ "vulnerabilities": {} }\n' > dependency-audit.json
printf '{ "sast": "PASS", "dependency_audit": "PASS" }\n' > gate-outcomes.json

echo "Test 1: generated markdown uses spaced separators and carries pipe-escape guidance"
OUTPUT=$(bash "$HELPER" "REQ-321" 2>&1)
assert_contains "pipe-escape guidance emitted" 'escape literal pipe characters in cell' "$OUTPUT"
assert_contains "spaced separator in access-control table" '| --- | --- | --- |' "$OUTPUT"
assert_contains "spaced separator in sign-off table" '| --- | --- | --- | --- |' "$OUTPUT"
assert_not_contains_regex "no compact separators remain" '^\|[-:|]+\|$' "$OUTPUT"
echo

DIR2="$TMPDIR_BASE/test2"
mkdir -p "$DIR2"
cd "$DIR2"
printf '{ "results": [] }\n' > sast-results.json
printf '{ "vulnerabilities": { "postcss": { "severity": "high" } } }\n' > dependency-audit.json
printf '{ "sast": "PASS", "dependency_audit": "PASS" }\n' > gate-outcomes.json
cat > dependency-risk-evaluation.json <<'JSON'
{
  "schemaVersion": 1,
  "accepted": [
    {
      "advisoryId": "GHSA-fixture",
      "package": "postcss",
      "vulnerableVersion": "8.4.31",
      "introducedBy": "next@16.2.11",
      "acceptance": {
        "expiresAt": "2026-12-31",
        "approvedBy": "reviewer@example.test",
        "remediationIssue": "https://github.com/example/repo/issues/1"
      }
    }
  ],
  "unresolved": []
}
JSON

echo "Test 2: accepted dependency risk is identified in generated evidence"
OUTPUT=$(bash "$HELPER" "REQ-322" 2>&1)
assert_contains "accepted advisory emitted" "Accepted GHSA-fixture" "$OUTPUT"
assert_contains "accepted risk owner emitted" "owner reviewer@example.test" "$OUTPUT"
assert_contains "accepted risk remediation emitted" "https://github.com/example/repo/issues/1" "$OUTPUT"
echo

echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
