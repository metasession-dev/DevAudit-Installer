#!/usr/bin/env bash
# generate-bundled-changes.test.sh — Tests for generate-bundled-changes.sh.
#
# Builds a throwaway git repo per case, crafts commits with mixed types,
# runs the helper against it, asserts on the stdout content. Hermetic:
# runs inside mktemp'd directories that are torn down at the end.
#
# Usage:
#   ./scripts/generate-bundled-changes.test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/generate-bundled-changes.sh"
[ -x "$HELPER" ] || chmod +x "$HELPER"

PASS=0
FAIL=0

TMPDIR_BASE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_BASE"' EXIT

# Build a fresh git fixture with an initial commit.
make_fixture() {
  local dir="$1"
  rm -rf "$dir"
  mkdir -p "$dir"
  cd "$dir"
  git init -q --initial-branch=main
  git config user.email "test@example.com"
  git config user.name "test"
  echo "x" > f.txt
  git add f.txt
  git commit -q -m "feat: initial commit [REQ-001]"
}

# Add a commit with a given message.
add_commit() {
  local msg="$1"
  echo "$(date +%s%N)" >> f.txt
  git add f.txt
  git commit -q -m "$msg"
}

assert_contains() {
  local desc="$1" want="$2" got="$3"
  if echo "$got" | grep -qF "$want"; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    echo "    want (substring): $want"
    echo "    got:"
    echo "$got" | sed 's/^/      /'
    FAIL=$((FAIL + 1))
  fi
}

assert_not_contains() {
  local desc="$1" want="$2" got="$3"
  if echo "$got" | grep -qF "$want"; then
    echo "  FAIL: $desc"
    echo "    should not contain: $want"
    echo "    got:"
    echo "$got" | sed 's/^/      /'
    FAIL=$((FAIL + 1))
  else
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  fi
}

# ─── Test 1: Mixed commits — only housekeeping types in output ─────
echo "Test 1: mixed commits filter to housekeeping only"
DIR1="$TMPDIR_BASE/test1"
make_fixture "$DIR1"
add_commit "chore: sync DevAudit templates from v0.1.69 to v0.1.70 [skip ci]"
add_commit "docs: update API reference for /bookings endpoint"
add_commit "feat: add booking widget [REQ-042]"
add_commit "chore: bump eslint 9.0.5 to 9.0.6"
add_commit "fix: resolve null pointer in booking service [REQ-042]"
# Tag the initial commit as the "since" ref
SINCE=$(git rev-list --max-parents=0 HEAD)
OUTPUT=$(bash "$HELPER" "$SINCE" "REQ-042" 2>&1 || true)
assert_contains "housekeeping chore: sync in output" "chore: sync DevAudit templates" "$OUTPUT"
assert_contains "housekeeping docs: update in output" "docs: update API reference" "$OUTPUT"
assert_contains "housekeeping chore: bump eslint in output" "chore: bump eslint" "$OUTPUT"
assert_not_contains "feat commit excluded" "feat: add booking widget" "$OUTPUT"
assert_not_contains "fix commit excluded" "fix: resolve null pointer" "$OUTPUT"
assert_contains "header present" "## Bundled Changes" "$OUTPUT"
assert_contains "version in header" "REQ-042" "$OUTPUT"
assert_contains "core tracked release field present" "**Core tracked release:**" "$OUTPUT"
assert_contains "absorbed non-release work field present" "**Absorbed non-release work:**" "$OUTPUT"
assert_contains "reviewer impact field present" "**Reviewer impact:**" "$OUTPUT"
assert_contains "reference field present" "**Reference:**" "$OUTPUT"
echo

# ─── Test 2: No housekeeping commits ────────────────────────────────
echo "Test 2: no housekeeping commits — empty summary"
DIR2="$TMPDIR_BASE/test2"
make_fixture "$DIR2"
add_commit "feat: add feature A [REQ-010]"
add_commit "fix: fix bug B [REQ-010]"
SINCE=$(git rev-list --max-parents=0 HEAD)
OUTPUT=$(bash "$HELPER" "$SINCE" "REQ-010" 2>&1 || true)
assert_contains "no housekeeping message" "No housekeeping commits found" "$OUTPUT"
echo

# ─── Test 3: All housekeeping types captured ────────────────────────
echo "Test 3: all housekeeping commit types captured"
DIR3="$TMPDIR_BASE/test3"
make_fixture "$DIR3"
add_commit "ci: update workflow timeout"
add_commit "build: bump node version to 22"
add_commit "test: add unit test for booking"
add_commit "revert: remove experimental feature"
add_commit "style: fix formatting in utils"
add_commit "perf: optimize query in booking"
add_commit "refactor: extract validation logic"
SINCE=$(git rev-list --max-parents=0 HEAD)
OUTPUT=$(bash "$HELPER" "$SINCE" "REQ-030" 2>&1 || true)
assert_contains "ci: type captured" "ci: update workflow timeout" "$OUTPUT"
assert_contains "build: type captured" "build: bump node version" "$OUTPUT"
assert_contains "test: type captured" "test: add unit test for booking" "$OUTPUT"
assert_contains "revert: type captured" "revert: remove experimental feature" "$OUTPUT"
assert_contains "style: type captured" "style: fix formatting" "$OUTPUT"
assert_contains "perf: type captured" "perf: optimize query" "$OUTPUT"
assert_contains "refactor: type captured" "refactor: extract validation" "$OUTPUT"
echo

# ─── Test 4: No commits since ref ───────────────────────────────────
echo "Test 4: no commits since ref — empty summary"
DIR4="$TMPDIR_BASE/test4"
make_fixture "$DIR4"
SINCE=$(git rev-parse HEAD)
OUTPUT=$(bash "$HELPER" "$SINCE" "REQ-001" 2>&1 || true)
assert_contains "no commits message" "No housekeeping commits found" "$OUTPUT"
echo

# ─── Test 5: Invalid ref ────────────────────────────────────────────
echo "Test 5: invalid ref — error exit"
DIR5="$TMPDIR_BASE/test5"
make_fixture "$DIR5"
set +e
OUTPUT=$(bash "$HELPER" "nonexistent-ref" "REQ-001" 2>&1)
RC=$?
set -e
if [ "$RC" -ne 0 ]; then
  echo "  PASS: non-zero exit code for invalid ref"
  PASS=$((PASS + 1))
else
  echo "  FAIL: expected non-zero exit code for invalid ref"
  FAIL=$((FAIL + 1))
fi
echo

# ─── Test 6: Scoped commit types (chore(deps)) ─────────────────────
echo "Test 6: scoped housekeeping commits captured"
DIR6="$TMPDIR_BASE/test6"
make_fixture "$DIR6"
add_commit "chore(deps): bump eslint from 9.0.5 to 9.0.6"
add_commit "ci(workflow): update timeout to 30 minutes"
SINCE=$(git rev-list --max-parents=0 HEAD)
OUTPUT=$(bash "$HELPER" "$SINCE" "REQ-050" 2>&1 || true)
assert_contains "scoped chore(deps) captured" "chore(deps): bump eslint" "$OUTPUT"
assert_contains "scoped ci(workflow) captured" "ci(workflow): update timeout" "$OUTPUT"
echo

# ─── Test 7: Missing since-ref argument ────────────────────────────
echo "Test 7: missing since-ref argument — error exit"
DIR7="$TMPDIR_BASE/test7"
make_fixture "$DIR7"
set +e
OUTPUT=$(bash "$HELPER" 2>&1)
RC=$?
set -e
if [ "$RC" -ne 0 ]; then
  echo "  PASS: non-zero exit code for missing argument"
  PASS=$((PASS + 1))
else
  echo "  FAIL: expected non-zero exit code for missing argument"
  FAIL=$((FAIL + 1))
fi
echo

echo "=== Summary: ${PASS} pass / ${FAIL} fail ==="
[ "$FAIL" -eq 0 ]
