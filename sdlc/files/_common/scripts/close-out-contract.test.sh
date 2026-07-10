#!/usr/bin/env bash
# close-out-contract.test.sh — Tests for the close-out marker helper.
#
# Usage:
#   ./scripts/close-out-contract.test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/close-out-contract.sh"

PASS=0
FAIL=0

assert_eq() {
  local desc="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    echo "        want: $want"
    echo "        got:  $got"
    FAIL=$((FAIL + 1))
  fi
}

assert_true() {
  local desc="$1"
  shift
  if "$@"; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    FAIL=$((FAIL + 1))
  fi
}

assert_false() {
  local desc="$1"
  shift
  if "$@"; then
    echo "  FAIL: $desc"
    FAIL=$((FAIL + 1))
  else
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  fi
}

echo "=== close-out-contract.sh tests ==="

assert_eq "branch prefix constant" "chore/close-out-" "$CLOSEOUT_BRANCH_PREFIX"
assert_eq "marker prefix constant" "Release-Closeout:" "$CLOSEOUT_MARKER_PREFIX"
assert_eq "closeout_marker emits structured line" "Release-Closeout: REQ-090" "$(closeout_marker REQ-090)"

assert_true "is_closeout_marker accepts canonical marker" is_closeout_marker "Release-Closeout: REQ-090"
assert_true "is_closeout_marker accepts extra whitespace" is_closeout_marker "Release-Closeout:    REQ-123"
assert_false "is_closeout_marker rejects wrong prefix" is_closeout_marker "Closeout: REQ-090"
assert_false "is_closeout_marker rejects short req ids" is_closeout_marker "Release-Closeout: REQ-9"
assert_false "is_closeout_marker rejects bare prose mention" is_closeout_marker "This closes REQ-090 after release."

assert_eq "closeout_marker_req extracts req id" "REQ-090" "$(closeout_marker_req "Release-Closeout: REQ-090")"
assert_eq "closeout_marker_req extracts first req id from mixed text" "REQ-111" "$(closeout_marker_req $'x\nRelease-Closeout: REQ-111\nmore')"
assert_eq "closeout_marker_req returns empty when marker absent" "" "$(closeout_marker_req "no marker here" || true)"

echo
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
