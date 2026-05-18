#!/usr/bin/env bash
# derive-release-version.test.sh — Tests for derive-release-version.sh.
#
# Builds a throwaway git repo per case, makes one crafted commit, runs
# the helper against it, asserts on the exact stdout. Hermetic: runs
# inside mktemp'd directories that are torn down at the end.
#
# Usage:
#   ./scripts/derive-release-version.test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/derive-release-version.sh"
[ -x "$HELPER" ] || chmod +x "$HELPER"

PASS=0
FAIL=0
TODAY="v$(date -u +%Y.%m.%d)"

# Build a fresh git fixture under $1, cd into it, then commit a file
# with the message passed as $2 (multi-line OK via heredoc-style strings).
make_fixture() {
  local dir="$1" msg="$2"
  rm -rf "$dir"
  mkdir -p "$dir"
  cd "$dir"
  git init -q --initial-branch=main
  git config user.email "test@example.com"
  git config user.name "test"
  echo "x" > f.txt
  git add f.txt
  git commit -q -m "$msg"
}

assert_eq() {
  local desc="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    echo "    want: $want"
    echo "    got:  $got"
    FAIL=$((FAIL + 1))
  fi
}

run_helper() {
  bash "$HELPER"
}

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "=== derive-release-version.sh tests ==="

# Each case: build fixture in its own dir, cd in, run helper, assert.
# No subshells around the assertion so the PASS/FAIL counters update.

# Case 1: subject tag
make_fixture "$WORK/c1" "[REQ-037] feat(kitchen): inventory CRUD"
assert_eq "subject [REQ-037] -> REQ-037" "REQ-037" "$(run_helper)"

# Case 2: body ref
make_fixture "$WORK/c2" "feat(kitchen): inventory CRUD

Some details.

Ref: REQ-037"
assert_eq "body Ref: REQ-037 -> REQ-037" "REQ-037" "$(run_helper)"

# Case 3: body lowercase
make_fixture "$WORK/c3" "chore: misc cleanup

ref: req-037"
assert_eq "body lowercase ref/req normalised -> REQ-037" "REQ-037" "$(run_helper)"

# Case 4: multi-REQ subject — first wins
make_fixture "$WORK/c4" "[REQ-037][REQ-038] feat: combined feature"
assert_eq "subject [REQ-037][REQ-038] -> REQ-037 (first)" "REQ-037" "$(run_helper)"

# Case 5: subject overrides body
make_fixture "$WORK/c5" "[REQ-037] feat: subject wins

Ref: REQ-099"
assert_eq "subject overrides body conflict -> REQ-037" "REQ-037" "$(run_helper)"

# Case 6: no tag — fallback to bare date
make_fixture "$WORK/c6" "chore: bump deps"
assert_eq "no tag -> bare date $TODAY" "$TODAY" "$(run_helper)"

echo ""
echo "=== Summary: $PASS pass / $FAIL fail ==="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
