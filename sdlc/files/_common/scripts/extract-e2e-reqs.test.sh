#!/usr/bin/env bash
# extract-e2e-reqs.test.sh — tests for extract-e2e-reqs.sh (devaudit-installer#1201).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/extract-e2e-reqs.sh"
[ -x "$HELPER" ] || chmod +x "$HELPER"

PASS=0
FAIL=0
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    echo "    expected: $expected"
    echo "    actual:   $actual"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== extract-e2e-reqs.sh tests ==="

printf '%s' '{"suites":[{"title":"[REQ-066][AC1] a","specs":[{"title":"x REQ-007 and REQ-119","tests":[{"annotations":[{"description":"REQ-007"}]}]}]}]}' > "$WORK/ok.json"
assert_eq "REQs in titles and annotations, sorted and de-duplicated" \
  "REQ-007 REQ-066 REQ-119" "$(bash "$HELPER" "$WORK/ok.json" | paste -sd' ' -)"

printf '%s' '{"suites":[]}' > "$WORK/none.json"
assert_eq "a file naming no REQ prints nothing" "" "$(bash "$HELPER" "$WORK/none.json")"

printf '%s' 'not json' > "$WORK/bad.json"
assert_eq "an invalid file prints nothing and exits 0" "" "$(bash "$HELPER" "$WORK/bad.json")"
assert_eq "a missing file prints nothing and exits 0" "" "$(bash "$HELPER" "$WORK/absent.json")"

if bash "$HELPER" >/dev/null 2>&1; then
  assert_eq "no argument is a usage error" "1" "0"
else
  assert_eq "no argument is a usage error" "1" "1"
fi

echo ""
echo "Passed: $PASS  Failed: $FAIL"
[ "$FAIL" -eq 0 ]
