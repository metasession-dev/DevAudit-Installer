#!/usr/bin/env bash
# validate-test-summary.test.sh — Tests for validate-test-summary.sh.
#
# Builds a throwaway git repo per case, creates compliance evidence with
# crafted test-execution-summary.md files, runs the validator, and asserts
# on the exit code. Hermetic: runs inside mktemp'd directories that are
# torn down at the end.
#
# Usage:
#   ./scripts/validate-test-summary.test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/validate-test-summary.sh"
[ -x "$HELPER" ] || chmod +x "$HELPER"

PASS=0
FAIL=0

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Build a fresh git fixture with a commit referencing REQ-XXX.
# Sets up compliance/evidence/REQ-XXX/ directory.
# $1 = dir, $2 = REQ ID, $3 = summary file content (via stdin)
make_fixture() {
  local dir="$1" req="$2"
  rm -rf "$dir"
  mkdir -p "$dir"
  cd "$dir"
  git init -q --initial-branch=main
  git config user.email "test@example.com"
  git config user.name "test"

  # Create a base branch and a feature branch with a REQ commit
  echo "x" > f.txt
  git add f.txt
  git commit -q -m "initial"

  git checkout -q -b feature
  echo "y" > g.txt
  git add g.txt
  git commit -q -m "feat: [${req}] test change

Ref: ${req}"

  # Create evidence directory and RTM row
  mkdir -p "compliance/evidence/${req}"
  echo "| ${req} | #999 | HIGH | compliance/evidence/${req}/ | TESTED - PENDING SIGN-OFF | TBD | -- |" > compliance/RTM.md
  git add compliance/RTM.md
  git commit -q -m "docs: add RTM row for ${req}"

  # Write the test-execution-summary.md from stdin
  cat > "compliance/evidence/${req}/test-execution-summary.md"

  # Stay on feature branch so the validator sees the diff from main
}

# Run the validator against the fixture, capture exit code.
# $1 = fixture dir
run_validator() {
  local dir="$1"
  cd "$dir"
  local exit_code=0
  bash "$HELPER" main > /tmp/validate-test-summary-output.txt 2>&1 || exit_code=$?
  echo "$exit_code"
}

assert_exit() {
  local desc="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    echo "    want exit: $want"
    echo "    got exit:  $got"
    cat /tmp/validate-test-summary-output.txt | sed 's/^/    /'
    FAIL=$((FAIL + 1))
  fi
}

echo "=== validate-test-summary.sh tests ==="

# --- Case 1: Clean summary with PASS — should pass ---
D1="$WORK/case1"
make_fixture "$D1" "REQ-001" << 'EOF'
# Test Execution Summary — REQ-001

## Test design

**Layers planned:** unit, e2e
**Layers covered:** unit ✓, e2e ✓

## Gate Results

| Gate             | Result   | Details              |
| ---------------- | -------- | -------------------- |
| TypeScript       | PASS     | 0 errors             |
| E2E Tests        | PASS     | All specs green      |
| Unit Tests       | PASS     | 42 passed            |

**Final assessment:** All gates passed.
EOF
EXIT1=$(run_validator "$D1")
assert_exit "clean summary with PASS — should pass" 0 "$EXIT1"

# --- Case 2: Summary with 'deferred' — should fail ---
D2="$WORK/case2"
make_fixture "$D2" "REQ-002" << 'EOF'
# Test Execution Summary — REQ-002

## Test design

**Layers covered:** unit ✓, e2e deferred

## Gate Results

| Gate             | Result   | Details                                  |
| ---------------- | -------- | ---------------------------------------- |
| E2E Tests        | DEFERRED | Playwright browsers not installed locally |

**Final assessment:** All local gates passed. E2E deferred to CI.
EOF
EXIT2=$(run_validator "$D2")
assert_exit "summary with 'deferred' — should fail" 1 "$EXIT2"

# --- Case 3: Summary with 'Deferred to CI' — should fail ---
D3="$WORK/case3"
make_fixture "$D3" "REQ-003" << 'EOF'
# Test Execution Summary — REQ-003

**Final assessment:** All gates passed. E2E Deferred to CI.
EOF
EXIT3=$(run_validator "$D3")
assert_exit "summary with 'Deferred to CI' — should fail" 1 "$EXIT3"

# --- Case 4: Summary with 'browsers not installed' — should fail ---
D4="$WORK/case4"
make_fixture "$D4" "REQ-004" << 'EOF'
# Test Execution Summary — REQ-004

## Gate Results

| Gate             | Result   | Details                                  |
| ---------------- | -------- | ---------------------------------------- |
| E2E Tests        | SKIPPED  | Playwright browsers not installed locally |

**Final assessment:** E2E skipped — browsers not installed.
EOF
EXIT4=$(run_validator "$D4")
assert_exit "summary with 'browsers not installed' — should fail" 1 "$EXIT4"

# --- Case 5: Summary with NOT_NEEDED and rationale — should pass ---
D5="$WORK/case5"
make_fixture "$D5" "REQ-005" << 'EOF'
# Test Execution Summary — REQ-005

## Gate Results

| Gate             | Result       | Details                                    |
| ---------------- | ------------ | ------------------------------------------ |
| E2E Tests        | NOT_NEEDED   | Schema-only change, no UI surface           |

**Final assessment:** All gates passed. E2E not needed for this REQ.
EOF
EXIT5=$(run_validator "$D5")
assert_exit "summary with NOT_NEEDED and rationale — should pass" 0 "$EXIT5"

# --- Case 6: Summary with SKIPPED and rationale — should pass ---
D6="$WORK/case6"
make_fixture "$D6" "REQ-006" << 'EOF'
# Test Execution Summary — REQ-006

## Gate Results

| Gate             | Result       | Details                                    |
| ---------------- | ------------ | ------------------------------------------ |
| E2E Tests        | SKIPPED      | API-only change, no UI surface (operator-approved) |

**Final assessment:** All gates passed. E2E skipped — API-only change.
EOF
EXIT6=$(run_validator "$D6")
assert_exit "summary with SKIPPED and rationale — should pass" 0 "$EXIT6"

# --- Case 7: Summary with SKIPPED but no rationale — should fail ---
D7="$WORK/case7"
make_fixture "$D7" "REQ-007" << 'EOF'
# Test Execution Summary — REQ-007

## Gate Results

| Gate             | Result       | Details    |
| ---------------- | ------------ | ---------- |
| E2E Tests        | SKIPPED      |            |

**Final assessment:** All gates passed.
EOF
EXIT7=$(run_validator "$D7")
assert_exit "summary with SKIPPED but no rationale — should fail" 1 "$EXIT7"

# --- Case 8: No REQ references — should pass (skip) ---
D8="$WORK/case8"
rm -rf "$D8"
mkdir -p "$D8"
cd "$D8"
git init -q --initial-branch=main
git config user.email "test@example.com"
git config user.name "test"
echo "x" > f.txt
git add f.txt
git commit -q -m "initial"
git checkout -q -b feature
echo "y" > g.txt
git add g.txt
git commit -q -m "docs: update README"
EXIT8=$(run_validator "$D8")
assert_exit "no REQ references — should pass (skip)" 0 "$EXIT8"

# --- Case 9: No test-execution-summary.md — should pass (skip) ---
D9="$WORK/case9"
make_fixture "$D9" "REQ-009" << 'EOF'
# placeholder
EOF
rm "$D9/compliance/evidence/REQ-009/test-execution-summary.md"
EXIT9=$(run_validator "$D9")
assert_exit "no test-execution-summary.md — should pass (skip)" 0 "$EXIT9"

# --- Case 10: Summary with 'e2e deferred' in final assessment — should fail ---
D10="$WORK/case10"
make_fixture "$D10" "REQ-010" << 'EOF'
# Test Execution Summary — REQ-010

## Gate Results

| Gate             | Result   | Details         |
| ---------------- | -------- | --------------- |
| E2E Tests        | PASS     | All specs green |

**Final assessment:** All gates passed. E2E deferred to CI for critical tier.
EOF
EXIT10=$(run_validator "$D10")
assert_exit "summary with 'e2e deferred' in final assessment — should fail" 1 "$EXIT10"

echo ""
echo "=== Summary: $PASS pass / $FAIL fail ==="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
