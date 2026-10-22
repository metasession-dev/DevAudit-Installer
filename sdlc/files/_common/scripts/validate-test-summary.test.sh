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

## Accepted skips

| Spec | Test | REQ/AC | Classification | Resolution attempted | Approved by | Rationale |
| ------ | ------ | -------- | --------------- | --------------------- | ------------- | ---------- |
| e2e/foo.spec.ts | "AC1: bar dialog" | REQ-006/AC1 | intentional_non_applicability | N/A — API-only change | operator | API-only change, no UI surface |

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

# --- Case 11: NOT_NEEDED without rationale — should fail ---
D11="$WORK/case11"
make_fixture "$D11" "REQ-011" << 'EOF'
# Test Execution Summary — REQ-011

## Gate Results

| Gate             | Result       | Details    |
| ---------------- | ------------ | ---------- |
| E2E Tests        | NOT_NEEDED   |            |

**Final assessment:** All gates passed.
EOF
EXIT11=$(run_validator "$D11")
assert_exit "summary with NOT_NEEDED but no rationale — should fail" 1 "$EXIT11"

# --- Case 12: SKIPPED with ## Accepted skips section and valid rows — should pass (devaudit-installer#279) ---
D12="$WORK/case12"
make_fixture "$D12" "REQ-012" << 'EOF'
# Test Execution Summary — REQ-012

## Gate Results

| Gate             | Result       | Details                                    |
| ---------------- | ------------ | ------------------------------------------ |
| E2E Tests        | SKIPPED      | API-only change, no UI surface (operator-approved) |

## Accepted skips

| Spec | Test | REQ/AC | Classification | Resolution attempted | Approved by | Rationale |
| ------ | ------ | -------- | --------------- | --------------------- | ------------- | ---------- |
| e2e/foo.spec.ts | "AC3: bar dialog" | REQ-012/AC3 | intentional_non_applicability | N/A — API-only change | operator | API-only change, no UI surface |

**Final assessment:** All gates passed. E2E skipped — API-only change.
EOF
EXIT12=$(run_validator "$D12")
assert_exit "SKIPPED with ## Accepted skips section and valid rows — should pass" 0 "$EXIT12"

# --- Case 13: SKIPPED without ## Accepted skips section — should fail (devaudit-installer#279) ---
D13="$WORK/case13"
make_fixture "$D13" "REQ-013" << 'EOF'
# Test Execution Summary — REQ-013

## Gate Results

| Gate             | Result       | Details                                    |
| ---------------- | ------------ | ------------------------------------------ |
| E2E Tests        | SKIPPED      | API-only change, no UI surface (operator-approved) |

**Final assessment:** All gates passed. E2E skipped — API-only change.
EOF
EXIT13=$(run_validator "$D13")
assert_exit "SKIPPED without ## Accepted skips section — should fail" 1 "$EXIT13"

# --- Case 14: SKIPPED with ## Accepted skips but no table rows — should fail (devaudit-installer#279) ---
D14="$WORK/case14"
make_fixture "$D14" "REQ-014" << 'EOF'
# Test Execution Summary — REQ-014

## Gate Results

| Gate             | Result       | Details                                    |
| ---------------- | ------------ | ------------------------------------------ |
| E2E Tests        | SKIPPED      | API-only change, no UI surface (operator-approved) |

## Accepted skips

| Spec | Test | REQ/AC | Classification | Resolution attempted | Approved by | Rationale |
| ------ | ------ | -------- | --------------- | --------------------- | ------------- | ---------- |

**Final assessment:** All gates passed. E2E skipped — API-only change.
EOF
EXIT14=$(run_validator "$D14")
assert_exit "SKIPPED with ## Accepted skips but no table rows — should fail" 1 "$EXIT14"

# --- Case 15: SKIPPED with accepted-skip rows missing Approved by — should fail (devaudit-installer#279) ---
D15="$WORK/case15"
make_fixture "$D15" "REQ-015" << 'EOF'
# Test Execution Summary — REQ-015

## Gate Results

| Gate             | Result       | Details                                    |
| ---------------- | ------------ | ------------------------------------------ |
| E2E Tests        | SKIPPED      | API-only change, no UI surface (operator-approved) |

## Accepted skips

| Spec | Test | REQ/AC | Classification | Resolution attempted | Approved by | Rationale |
| ------ | ------ | -------- | --------------- | --------------------- | ------------- | ---------- |
| e2e/foo.spec.ts | "AC3: bar dialog" | REQ-015/AC3 | intentional_non_applicability | N/A — API-only change |  | API-only change, no UI surface |

**Final assessment:** All gates passed. E2E skipped — API-only change.
EOF
EXIT15=$(run_validator "$D15")
assert_exit "SKIPPED with accepted-skip rows missing Approved by — should fail" 1 "$EXIT15"

# --- Case 16: 'not yet a CI run' surviving into the release PR — should fail (devaudit-installer#607) ---
D16="$WORK/case16"
make_fixture "$D16" "REQ-016" << 'EOF'
# Test Execution Summary — REQ-016

## Gate Results

| Gate             | Result   | Details         |
| ---------------- | -------- | --------------- |
| E2E Tests        | PASS     | All specs green |

## Test executions

| Source  | Kind | Outcome | Workflow / run                    |
| ------- | ---- | ------- | ---------------------------------- |
| REQ-016 | unit | passed  | Local Vitest — not yet a CI run    |

**Final assessment:** All gates passed.
EOF
EXIT16=$(run_validator "$D16")
assert_exit "'not yet a CI run' surviving into release PR — should fail" 1 "$EXIT16"

# --- Case 17: 'CI run: not yet available' surviving into the release PR — should fail (devaudit-installer#607) ---
D17="$WORK/case17"
make_fixture "$D17" "REQ-017" << 'EOF'
# Test Execution Summary — REQ-017

## Gate Results

| Gate             | Result   | Details         |
| ---------------- | -------- | --------------- |
| E2E Tests        | PASS     | All specs green |

## Evidence locations

- CI run: not yet available — this evidence pack is being compiled ahead of the integration PR being opened

**Final assessment:** All gates passed.
EOF
EXIT17=$(run_validator "$D17")
assert_exit "'CI run: not yet available' surviving into release PR — should fail" 1 "$EXIT17"

# --- Case 18: 'Production promotion remains blocked' surviving into the release PR — should fail (devaudit-installer#607) ---
D18="$WORK/case18"
make_fixture "$D18" "REQ-018" << 'EOF'
# Test Execution Summary — REQ-018

## Gate Results

| Gate             | Result   | Details         |
| ---------------- | -------- | --------------- |
| E2E Tests        | PASS     | All specs green |

**Final assessment:** Code and automated verification are complete. Production promotion remains blocked on the same items every tracked REQ needs.
EOF
EXIT18=$(run_validator "$D18")
assert_exit "'Production promotion remains blocked' surviving into release PR — should fail" 1 "$EXIT18"

# --- Case 19: clean, fully-refreshed summary — should pass (devaudit-installer#607) ---
D19="$WORK/case19"
make_fixture "$D19" "REQ-019" << 'EOF'
# Test Execution Summary — REQ-019

## Gate Results

| Gate             | Result   | Details         |
| ---------------- | -------- | --------------- |
| E2E Tests        | PASS     | All specs green |

## Test executions

| Source  | Kind | Outcome | Workflow / run                                                             |
| ------- | ---- | ------- | ---------------------------------------------------------------------------- |
| REQ-019 | e2e  | passed  | [Quality Gates](https://github.com/example/example/actions/runs/12345)      |

**Final assessment:** Code and automated verification are complete. This release has shipped to production.
EOF
EXIT19=$(run_validator "$D19")
assert_exit "clean, fully-refreshed summary — should pass" 0 "$EXIT19"


# --- devaudit-installer#1016: failure integrity -------------------------------
TRIAGE_OK='## E2E failures & triage

| Spec / check | Source | Classification | Evidence | Disposition | Reference |
| --- | --- | --- | --- | --- | --- |
| e2e/critical/webhook-idempotency-replay.spec.ts | CI 36659647566/1 | flake | 5 isolated re-runs pass | Fix | #910 |
| e2e/critical/dashboard-revenue.spec.ts | local | seed-data gap | seed missing | Accepted exception | compliance/evidence/REQ-020/accepted-e2e-failure-dashboard-revenue.md |
| e2e/critical/express-order-report.spec.ts | local | test bug | wrong selector | Deferral | https://github.com/acme/app/issues/911 |
'

assert_output_contains() {
  local desc="$1" needle="$2"
  if grep -Fq -- "$needle" /tmp/validate-test-summary-output.txt; then
    echo "  PASS: $desc"; PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (missing: $needle)"; sed 's/^/    /' /tmp/validate-test-summary-output.txt; FAIL=$((FAIL + 1))
  fi
}

# --- Case 20: a failed execution with no triage table — should fail ---
D20="$WORK/case20"
make_fixture "$D20" "REQ-020" << 'EOF'
# Test Execution Summary — REQ-020

## Gate Results

| Gate | Result | Details |
| ---- | ------ | ------- |
| E2E Tests | PASS | 286 passed, 3 failed |
EOF
EXIT20=$(run_validator "$D20")
assert_exit "failed execution recorded without a triage table — should fail" 1 "$EXIT20"
assert_output_contains "names the missing triage table" "E2E failures & triage"

# --- Case 21: 'known unrelated flakes' asserted without evidence — should fail ---
D21="$WORK/case21"
make_fixture "$D21" "REQ-021" << 'EOF'
# Test Execution Summary — REQ-021

## Gate Results

| Gate | Result | Details |
| ---- | ------ | ------- |
| E2E Tests | PASS (with known unrelated flakes) | 286 passed, 3 failed |
EOF
EXIT21=$(run_validator "$D21")
assert_exit "'known unrelated flakes' with no triage — should fail" 1 "$EXIT21"

# --- Case 22: failures fully triaged (fix / accepted exception / deferral) — should pass ---
D22="$WORK/case22"
make_fixture "$D22" "REQ-020" << EOF
# Test Execution Summary — REQ-020

## Gate Results

| Gate | Result | Details |
| ---- | ------ | ------- |
| E2E Tests | PASS | 286 passed, 3 failed (all triaged below) |

$TRIAGE_OK
EOF
EXIT22=$(run_validator "$D22")
assert_exit "every failure triaged with classification, disposition and reference — should pass" 0 "$EXIT22"

# --- Case 23: invalid classification — should fail ---
D23="$WORK/case23"
make_fixture "$D23" "REQ-023" << 'EOF'
# Test Execution Summary — REQ-023

| Gate | Result | Details |
| ---- | ------ | ------- |
| E2E Tests | PASS | 1 failed |

## E2E failures & triage

| Spec / check | Source | Classification | Evidence | Disposition | Reference |
| --- | --- | --- | --- | --- | --- |
| e2e/a.spec.ts | CI 1/1 | probably fine | none | Fix | #5 |
EOF
EXIT23=$(run_validator "$D23")
assert_exit "triage row with an invalid classification — should fail" 1 "$EXIT23"

# --- Case 24: accepted exception without a record reference — should fail ---
D24="$WORK/case24"
make_fixture "$D24" "REQ-024" << 'EOF'
# Test Execution Summary — REQ-024

| Gate | Result | Details |
| ---- | ------ | ------- |
| E2E Tests | PASS | 1 failed |

## E2E failures & triage

| Spec / check | Source | Classification | Evidence | Disposition | Reference |
| --- | --- | --- | --- | --- | --- |
| e2e/a.spec.ts | CI 1/1 | flake | re-ran | Accepted exception | TBD |
EOF
EXIT24=$(run_validator "$D24")
assert_exit "accepted exception with a placeholder reference — should fail" 1 "$EXIT24"

# --- Case 25: row with no disposition (unresolved failure under PASS) — should fail ---
D25="$WORK/case25"
make_fixture "$D25" "REQ-025" << 'EOF'
# Test Execution Summary — REQ-025

| Gate | Result | Details |
| ---- | ------ | ------- |
| E2E Tests | PASS | 1 failed |

## E2E failures & triage

| Spec / check | Source | Classification | Evidence | Disposition | Reference |
| --- | --- | --- | --- | --- | --- |
| e2e/a.spec.ts | CI 1/1 | flake | re-ran | Unresolved | #5 |
EOF
EXIT25=$(run_validator "$D25")
assert_exit "unresolved failure under a PASS gate — should fail" 1 "$EXIT25"

# --- Case 26: no failures at all and no stamp — passes, with a refresh warning ---
D26="$WORK/case26"
make_fixture "$D26" "REQ-026" << 'EOF'
# Test Execution Summary — REQ-026

| Gate | Result | Details |
| ---- | ------ | ------- |
| E2E Tests | PASS | 120 passed, 0 failed |
EOF
EXIT26=$(run_validator "$D26")
assert_exit "no failures, no stamp (grandfathered) — should pass" 0 "$EXIT26"
assert_output_contains "warns that the CI-as-of stamp is missing" "no 'CI as of:"

# --- Case 27/28/29: new-format ("CI as of") summaries are held to the stricter rules ---
D27="$WORK/case27"
make_fixture "$D27" "REQ-027" << 'EOF'
# Test Execution Summary — REQ-027

CI as of: 36659647566/2 @ 389bf6f0123456789

| Gate | Result | Details |
| ---- | ------ | ------- |
| E2E Tests | PASS | 120 passed, 0 failed |

## Test executions

| Source | Kind | Outcome |
| ------ | ---- | ------- |
| REQ-027 | e2e | passed |
EOF
EXIT27=$(run_validator "$D27")
assert_exit "stamped summary with a hand-typed executions table — should fail" 1 "$EXIT27"
assert_output_contains "names the generated-table requirement" "generated-by: render-test-executions.sh"

D28="$WORK/case28"
make_fixture "$D28" "REQ-028" << 'EOF'
# Test Execution Summary — REQ-028

CI as of: 36659647566/2 @ 389bf6f0123456789

| Gate | Result | Details |
| ---- | ------ | ------- |
| E2E Tests | PASS | 120 passed, 0 failed |

## Test executions

<!-- generated-by: render-test-executions.sh journey-at 2026-10-17T10:00:00Z -->
| Source | Kind | Outcome |
| ------ | ---- | ------- |
| REQ-028 | e2e | passed |
EOF
EXIT28=$(run_validator "$D28")
assert_exit "stamped summary with the generated table — should pass" 0 "$EXIT28"

cd "$D28"
EXIT28B=0
DEVAUDIT_PR_HEAD_SHA=aaaaaaaa00000000000000000000000000000000 bash "$HELPER" main > /tmp/validate-test-summary-output.txt 2>&1 || EXIT28B=$?
assert_exit "stamped summary older than the release PR head — should fail" 1 "$EXIT28B"
assert_output_contains "tells the author to regenerate" "regenerate the summary"
cd "$D28"
EXIT28C=0
DEVAUDIT_PR_HEAD_SHA=389bf6f0123456789aaaaaaaaaaaaaaaaaaaaaaa bash "$HELPER" main > /tmp/validate-test-summary-output.txt 2>&1 || EXIT28C=$?
assert_exit "stamp matching the PR head (stamp abbreviated) — should pass" 0 "$EXIT28C"

# --- Case 29: reconciliation against the CI results ---
PWJSON_FAIL="$WORK/results-fail.json"
cat > "$PWJSON_FAIL" << 'EOF'
{"stats":{"unexpected":1},"suites":[{"title":"critical","specs":[{"file":"e2e/critical/webhook-idempotency-replay.spec.ts","ok":false}],"suites":[]}]}
EOF
D29="$WORK/case29"
make_fixture "$D29" "REQ-029" << 'EOF'
# Test Execution Summary — REQ-029

| Gate | Result | Details |
| ---- | ------ | ------- |
| E2E Tests | PASS | 3 failed |

## E2E failures & triage

| Spec / check | Source | Classification | Evidence | Disposition | Reference |
| --- | --- | --- | --- | --- | --- |
| e2e/critical/dashboard-revenue.spec.ts | CI 36659647566/1 | flake | re-ran | Fix | #5 |
EOF
cd "$D29"
EXIT29=0
E2E_RESULTS_JSON="$PWJSON_FAIL" E2E_RUN_ID=36659647566 E2E_RUN_ATTEMPT=1 bash "$HELPER" main > /tmp/validate-test-summary-output.txt 2>&1 || EXIT29=$?
assert_exit "summary names a different spec than CI failed — should fail" 1 "$EXIT29"
assert_output_contains "reports the untriaged CI failure" "webhook-idempotency-replay.spec.ts"

# --- #1081: the SDLC's own deferred vocabulary is not a gate state ---
D30="$WORK/case30"
make_fixture "$D30" "REQ-030" << 'EOF'
# Test Execution Summary — REQ-030

## Test design

**Layers planned:** unit
**Layers covered:** unit ✓

E2E: @e2e-deferred: static pages only, no UI-facing behaviour to drive.
Risks: @risk-deferred: LOW risk, none worth registering.
Release intent: deferred-to-next is NOT set for this requirement.

## Gate Results

| Gate             | Result   | Details              |
| ---------------- | -------- | -------------------- |
| TypeScript       | PASS     | 0 errors             |
| Unit Tests       | PASS     | 42 passed            |

**Final assessment:** All gates passed.
EOF
EXIT30=$(run_validator "$D30")
assert_exit "@e2e-deferred, @risk-deferred and deferred-to-next are not gate states (#1081) — should pass" 0 "$EXIT30"

D31="$WORK/case31"
make_fixture "$D31" "REQ-031" << 'EOF'
# Test Execution Summary — REQ-031

**Layers covered:** unit ✓, e2e ✓

E2E: @e2e-deferred: no UI.
The smoke tier is deferred.

## Gate Results

| Gate             | Result   | Details              |
| ---------------- | -------- | -------------------- |
| Unit Tests       | PASS     | 42 passed            |

**Final assessment:** All gates passed.
EOF
EXIT31=$(run_validator "$D31")
assert_exit "an exempt tag does not hide a bare 'deferred' on another line (#1081) — should fail" 1 "$EXIT31"
assert_output_contains "reports the offending line" "The smoke tier is deferred."
if grep -Fq -- "E2E: @e2e-deferred: no UI." /tmp/validate-test-summary-output.txt; then
  echo "  FAIL: does not report the exempt tag line"; FAIL=$((FAIL + 1))
else
  echo "  PASS: does not report the exempt tag line"; PASS=$((PASS + 1))
fi

D32="$WORK/case32"
make_fixture "$D32" "REQ-032" << 'EOF'
# Test Execution Summary — REQ-032

**Layers covered:** unit ✓

Gate Results: E2E: DEFERRED  (upper case) and @RISK-DEFERRED is exempt.

**Final assessment:** All gates passed.
EOF
EXIT32=$(run_validator "$D32")
assert_exit "a bare upper-case DEFERRED still fails (#1081) — should fail" 1 "$EXIT32"

echo ""
echo "=== Summary: $PASS pass / $FAIL fail ==="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
