#!/usr/bin/env bash
# generate-housekeeping-release-ticket.test.sh — Tests for the housekeeping
# release-ticket generator's markdown table output contract.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/generate-housekeeping-release-ticket.sh"
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

make_fixture() {
  local dir="$1"
  mkdir -p "$dir"
  cd "$dir"
  git init -q --initial-branch=main
  git config user.email "test@example.com"
  git config user.name "test"
  echo "x" > f.txt
  git add f.txt
  git commit -q -m "docs: initial commit"
  printf '{ "typecheck": "PASS", "sast": "PASS", "dependency_audit": "PASS", "e2e": "PASS", "test_report": "PASS" }\n' > gate-outcomes.json
}

echo "Test 1: generated markdown uses spaced separators and carries pipe-escape guidance"
DIR1="$TMPDIR_BASE/test1"
make_fixture "$DIR1"
OUTPUT=$(bash "$HELPER" "v2026.07.14" 2>&1)
assert_contains "pipe-escape guidance emitted" 'escape literal pipe characters in cell' "$OUTPUT"
assert_contains "spaced separator in test evidence table" '| --- | --- | --- |' "$OUTPUT"
assert_contains "spaced separator in sign-off table" '| --- | --- | --- | --- |' "$OUTPUT"
assert_contains "spaced separator in audit trail table" '| ------ | -------- | ------- | ------- |' "$OUTPUT"
assert_not_contains_regex "no compact separators remain" '^\|[-:|]+\|$' "$OUTPUT"
echo

echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
