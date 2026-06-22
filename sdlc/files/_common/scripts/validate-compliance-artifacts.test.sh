#!/usr/bin/env bash
# validate-compliance-artifacts.test.sh — fixture-based tests for #232
# hardenings (regex tightening, no-RTM-row skip, SUPERSEDED handling).
#
# Builds a throwaway git repo per case, populates compliance/ files,
# runs validate-compliance-artifacts.sh against it, asserts on the exit
# code and selected log lines.
#
# Usage:
#   ./scripts/validate-compliance-artifacts.test.sh
#
# The script is hermetic: it does NOT touch the host repo; everything
# runs inside a mktemp'd directory that's torn down at the end. Suitable
# for CI invocation, no extra deps beyond bash + git + grep.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VALIDATOR="$SCRIPT_DIR/validate-compliance-artifacts.sh"
[ -x "$VALIDATOR" ] || chmod +x "$VALIDATOR"

PASS=0
FAIL=0

# --- helpers ---

# Build a fresh git fixture under $1 and cd into it. Initial commit on
# a `base` branch, then a single feature commit on `feature` whose body
# the caller seeds via the second argument.
make_fixture() {
  local dir="$1" feat_msg="$2"
  rm -rf "$dir"
  mkdir -p "$dir"
  cd "$dir"
  git init -q --initial-branch=base
  git config user.email "test@example.com"
  git config user.name "test"
  mkdir -p compliance/pending-releases compliance/approved-releases compliance/superseded-releases compliance/evidence
  printf '# RTM\n\n| ID | Description | Status |\n| --- | --- | --- |\n' > compliance/RTM.md
  git add . && git commit -q -m "init"
  git checkout -q -b feature
  echo "feature change" > feature.txt
  git add . && git commit -q -m "feat: feature commit

$feat_msg"
}

# Run the validator against the current fixture's HEAD vs base. Captures
# stdout to $OUT_FILE and exit code to $EXIT_CODE_VAR.
run_validator() {
  set +e
  OUT_FILE=$(mktemp)
  bash "$VALIDATOR" base > "$OUT_FILE" 2>&1
  LAST_EXIT=$?
  set -e
}

assert_grep() {
  local desc="$1" pattern="$2" want_match="$3"
  if grep -qE "$pattern" "$OUT_FILE"; then
    found=1
  else
    found=0
  fi
  if [ "$found" = "$want_match" ]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (want match=$want_match, got=$found, pattern=$pattern)"
    echo "  --- output ---"
    sed 's/^/  /' "$OUT_FILE"
    echo "  ---"
    FAIL=$((FAIL + 1))
  fi
}

assert_exit() {
  local desc="$1" want="$2"
  if [ "$LAST_EXIT" = "$want" ]; then
    echo "  PASS: $desc (exit=$LAST_EXIT)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (want=$want, got=$LAST_EXIT)"
    echo "  --- output ---"
    sed 's/^/  /' "$OUT_FILE"
    echo "  ---"
    FAIL=$((FAIL + 1))
  fi
}

WORKDIR=$(mktemp -d -t validate-compliance-test-XXXX)
trap 'rm -rf "$WORKDIR"' EXIT

# --- case 1: REQ-0XX placeholder is ignored (\d{3,} regex) ---

echo "Case 1: REQ-0XX placeholder doesn't create phantom REQ-0"
make_fixture "$WORKDIR/case1" "Ref: REQ-0XX/test-scope.md (placeholder for sub-REQs)"
run_validator
assert_grep "no phantom REQ-0 surfaced" '^Requirements found in PR commits: REQ-0\b' 0
assert_grep "skip-validation message present" 'No REQ-XXX references found' 1
assert_exit "validator exits 0 on placeholder-only commit body" 0
cd "$WORKDIR"

# --- case 2: REQ-099 mentioned but absent from RTM → INFO + skip ---

echo "Case 2: forward-reference REQ skipped when RTM row absent"
make_fixture "$WORKDIR/case2" "Ref: REQ-099 (this is a forward-reference, no RTM row)"
run_validator
assert_grep "INFO line emitted for forward-reference" 'INFO: REQ-099 is referenced.*no RTM row' 1
assert_grep "no ERROR for missing evidence dir" 'ERROR: Evidence directory missing.*REQ-099' 0
assert_exit "validator exits 0 when only forward-references present" 0
cd "$WORKDIR"

# --- case 3: SUPERSEDED RTM status is accepted ---

echo "Case 3: SUPERSEDED RTM status passes"
make_fixture "$WORKDIR/case3" "Ref: REQ-030"
# RTM with SUPERSEDED status; full evidence + ticket present
{
  echo '# RTM'
  echo
  echo '| ID | Description | Status |'
  echo '| --- | --- | --- |'
  echo '| REQ-030 | Replaced by REQ-031 | SUPERSEDED by REQ-031 |'
} > compliance/RTM.md
mkdir -p compliance/evidence/REQ-030
echo "scope" > compliance/evidence/REQ-030/test-scope.md
echo "plan" > compliance/evidence/REQ-030/test-plan.md
touch compliance/pending-releases/RELEASE-TICKET-REQ-030.md
git add . && git commit -q --amend --no-edit
run_validator
assert_grep "RTM SUPERSEDED accepted" 'OK: RTM status is SUPERSEDED' 1
assert_exit "validator exits 0 with SUPERSEDED RTM status" 0
cd "$WORKDIR"

# --- case 4: SUPERSEDED ticket location is accepted ---

echo "Case 4: superseded-releases/ ticket location accepted"
make_fixture "$WORKDIR/case4" "Ref: REQ-031"
{
  echo '# RTM'
  echo
  echo '| ID | Description | Status |'
  echo '| --- | --- | --- |'
  echo '| REQ-031 | Successor of REQ-030 | SUPERSEDED by REQ-032 |'
} > compliance/RTM.md
mkdir -p compliance/evidence/REQ-031
echo "scope" > compliance/evidence/REQ-031/test-scope.md
echo "plan" > compliance/evidence/REQ-031/test-plan.md
# Only the superseded location — neither pending- nor approved-releases.
touch compliance/superseded-releases/RELEASE-TICKET-REQ-031.md
git add . && git commit -q --amend --no-edit
run_validator
assert_grep "ticket in superseded-releases/ accepted" 'OK: Release ticket exists' 1
assert_grep "no missing-ticket ERROR" 'ERROR: Release ticket missing' 0
assert_exit "validator exits 0 with SUPERSEDED ticket location" 0
cd "$WORKDIR"

# --- case 7: duplicate ticket in pending + approved → ERROR + exit 1 ---
#
# Regression for devaudit-installer#193: a stale pending copy left behind
# after close-out (carried back by a stale-branch merge) must be caught
# here with an actionable message, not silently pass and poison the
# evidence-completeness gate downstream (#192).

echo "Case 7: duplicate ticket in pending + approved directories fails"
make_fixture "$WORKDIR/case7" "Ref: REQ-077"
{
  echo '# RTM'
  echo
  echo '| ID | Description | Status |'
  echo '| --- | --- | --- |'
  echo '| REQ-077 | Duplicate ticket test | TESTED - PENDING SIGN-OFF |'
} > compliance/RTM.md
mkdir -p compliance/evidence/REQ-077
echo "scope" > compliance/evidence/REQ-077/test-scope.md
echo "plan" > compliance/evidence/REQ-077/test-plan.md
echo "summary" > compliance/evidence/REQ-077/test-execution-summary.md
# Ticket in BOTH pending and approved — the duplicate
touch compliance/pending-releases/RELEASE-TICKET-REQ-077.md
touch compliance/approved-releases/RELEASE-TICKET-REQ-077.md
git add . && git commit -q --amend --no-edit
run_validator
assert_grep "duplicate-ticket ERROR emitted" 'ERROR: RELEASE-TICKET-REQ-077 exists in more than one release directory' 1
assert_grep "no OK for duplicate ticket" 'OK: Release ticket exists' 0
assert_exit "validator exits 1 on duplicate ticket" 1
cd "$WORKDIR"

# --- case 5: bare-filename reference resolves to file at depth ≥2 ---
#
# Regression for the broken `compgen -G "**/$TF"` search: bash globstar
# is off by default, so `**` only matched depth-1 paths. A test plan
# referencing a bare filename (e.g. `inventory-service.list-by-kind.test.ts`)
# whose actual file lived at `__tests__/services/...` was reported as
# missing even though it existed. Fix uses `find -name` instead.

echo "Case 5: bare-filename reference resolves to depth-2 test file"
make_fixture "$WORKDIR/case5" "Ref: REQ-200"
{
  echo '# RTM'
  echo
  echo '| ID | Description | Status |'
  echo '| --- | --- | --- |'
  echo '| REQ-200 | Bare-filename ref test | IN PROGRESS |'
} > compliance/RTM.md
mkdir -p compliance/evidence/REQ-200
echo "scope" > compliance/evidence/REQ-200/test-scope.md
# Plan references the file by BARE filename (no directory prefix).
{
  echo '# Test Plan — REQ-200'
  echo
  echo '| AC | Test | Notes |'
  echo '| --- | --- | --- |'
  echo '| AC1 | `foo-service.list-by-kind.test.ts` | unit test |'
} > compliance/evidence/REQ-200/test-plan.md
# Actual test file lives at depth 2.
mkdir -p __tests__/services
echo "// stub" > __tests__/services/foo-service.list-by-kind.test.ts
echo "summary" > compliance/evidence/REQ-200/test-execution-summary.md
touch compliance/pending-releases/RELEASE-TICKET-REQ-200.md
git add . && git commit -q --amend --no-edit
run_validator
assert_grep "depth-2 bare filename resolved" 'OK: All test files referenced in test-plan.md exist' 1
assert_grep "no missing-test ERROR" 'ERROR: Test file referenced in test-plan.md not found' 0
assert_exit "validator exits 0 with depth-2 bare-filename reference" 0
cd "$WORKDIR"

# --- case 6: a future REQ mentioned only in commit prose is ignored ---
# Regression for the META-JOBS REQ-002 false positive: scraping the whole
# commit body pulled in `REQ-002` from "target close: REQ-002" and then
# ERRORed on its missing evidence dir even though REQ-002 hadn't started.
# Only `[REQ-XXX]` subject tags and `Ref:` lines count as under-change.
echo "Case 6: future REQ mentioned only in prose is not validated"
make_fixture "$WORKDIR/case6" "Implements the access-control boundary.

Dependency advisories accepted under R-001; target close: REQ-002.

Ref: REQ-001"
# REQ-002 HAS an RTM row (the trap) but no evidence dir; REQ-001 is the real
# Ref but has no RTM row, so it INFO-skips. Old code would ERROR on REQ-002.
{
  echo '# RTM'
  echo
  echo '| ID | Description | Status |'
  echo '| --- | --- | --- |'
  echo '| REQ-002 | Dependency hardening (not started) | PLANNED |'
} > compliance/RTM.md
git add . && git commit -q -m "chore: seed RTM with future REQ-002 row"
run_validator
assert_grep "REQ-002 not pulled in from prose" 'Requirements found in PR commits:.*REQ-002' 0
assert_grep "no evidence-dir ERROR for prose-only REQ-002" 'ERROR: Evidence directory missing.*REQ-002' 0
assert_exit "validator exits 0 when future REQ is only prose-mentioned" 0
cd "$WORKDIR"

# --- summary ---

echo
echo "=== validate-compliance-artifacts.test.sh: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
