#!/usr/bin/env bash
# validate-commits.test.sh — Fixture-based tests for validate-commits.sh.
#
# Covers the relaxed "exactly one active tracked release" behavior:
# implementation commits without REQ tags downgrade to warnings only when
# release context is unambiguous; otherwise they remain hard errors.
#
# Usage:
#   ./scripts/validate-commits.test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VALIDATOR="$SCRIPT_DIR/validate-commits.sh"
[ -x "$VALIDATOR" ] || chmod +x "$VALIDATOR"

PASS=0
FAIL=0

make_fixture() {
  local dir="$1" subject="$2" body="${3:-}"
  rm -rf "$dir"
  mkdir -p "$dir"
  cd "$dir"
  git init -q --initial-branch=main
  git config user.email "test@example.com"
  git config user.name "test"
  echo "base" > base.txt
  git add base.txt
  git commit -q -m "chore: base"

  git checkout -q -b feature
  echo "feature" > app.ts
  git add app.ts
  if [ -n "$body" ]; then
    git commit -q -m "$subject" -m "$body"
  else
    git commit -q -m "$subject"
  fi
}

run_validator() {
  set +e
  OUT_FILE=$(mktemp)
  bash "$VALIDATOR" main > "$OUT_FILE" 2>&1
  LAST_EXIT=$?
  set -e
}

assert_exit() {
  local desc="$1" want="$2"
  if [ "$LAST_EXIT" = "$want" ]; then
    echo "  PASS: $desc (exit=$LAST_EXIT)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (want=$want, got=$LAST_EXIT)"
    sed 's/^/    /' "$OUT_FILE"
    FAIL=$((FAIL + 1))
  fi
}

assert_grep() {
  local desc="$1" pattern="$2" want_match="$3"
  local found=0
  if grep -qE "$pattern" "$OUT_FILE"; then
    found=1
  fi
  if [ "$found" = "$want_match" ]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (want match=$want_match, got=$found, pattern=$pattern)"
    sed 's/^/    /' "$OUT_FILE"
    FAIL=$((FAIL + 1))
  fi
}

WORKDIR=$(mktemp -d -t validate-commits-test-XXXX)
trap 'rm -rf "$WORKDIR"' EXIT

echo "=== validate-commits.sh tests ==="

# Case 1: one active pending ticket makes a missing-REQ implementation
# commit a warning, not a hard failure.
echo "Case 1: single active pending release downgrades missing REQ to warning"
make_fixture "$WORKDIR/case1" "feat: implement kitchen workflow" "Co-Authored-By: Test <test@example.com>"
mkdir -p compliance/pending-releases
cat > compliance/pending-releases/RELEASE-TICKET-REQ-123.md <<'EOF'
# Release Ticket: REQ-123
EOF
git add compliance/pending-releases
git commit -q --amend --no-edit
run_validator
assert_exit "single active pending release exits 0" 0
assert_grep "warning emitted for missing REQ with one active release" 'WARNING .*one active tracked release \(REQ-123\)' 1
assert_grep "no hard error for missing requirement" "ERROR .*implementation commit but cites no requirement" 0

# Case 2: ambiguous pending release context keeps the missing-REQ path as
# a hard error.
echo "Case 2: two active pending releases keep missing REQ as hard error"
make_fixture "$WORKDIR/case2" "feat: implement kitchen workflow" "Co-Authored-By: Test <test@example.com>"
mkdir -p compliance/pending-releases
cat > compliance/pending-releases/RELEASE-TICKET-REQ-123.md <<'EOF'
# Release Ticket: REQ-123
EOF
cat > compliance/pending-releases/RELEASE-TICKET-REQ-124.md <<'EOF'
# Release Ticket: REQ-124
EOF
git add compliance/pending-releases
git commit -q --amend --no-edit
run_validator
assert_exit "ambiguous pending releases exits 1" 1
assert_grep "hard error emitted when active context is ambiguous" "ERROR .*implementation commit but cites no requirement" 1

# Case 3: no pending ticket, but exactly one active RTM row in the
# accepted statuses also downgrades to a warning.
echo "Case 3: RTM fallback with one active row downgrades missing REQ to warning"
make_fixture "$WORKDIR/case3" "fix: recover already-merged history" "Co-Authored-By: Test <test@example.com>"
mkdir -p compliance
cat > compliance/RTM.md <<'EOF'
# RTM
| REQ-ID  | Title | Status                    |
| ------- | ----- | ------------------------- |
| REQ-200 | Done  | APPROVED - DEPLOYED       |
| REQ-201 | Live  | TESTED - PENDING SIGN-OFF |
EOF
git add compliance/RTM.md
git commit -q --amend --no-edit
run_validator
assert_exit "single active RTM row exits 0" 0
assert_grep "warning emitted for RTM fallback context" 'WARNING .*one active tracked release \(REQ-201\)' 1
assert_grep "no hard error under single RTM fallback context" "ERROR .*implementation commit but cites no requirement" 0

# Case 4: zero active context remains a hard error.
echo "Case 4: no active release context keeps missing REQ as hard error"
make_fixture "$WORKDIR/case4" "perf: tune kitchen workflow" "Co-Authored-By: Test <test@example.com>"
run_validator
assert_exit "no active context exits 1" 1
assert_grep "hard error emitted without any active release context" "ERROR .*implementation commit but cites no requirement" 1

# Case 5: leading REQ prefix is accepted before the Conventional Commit type.
echo "Case 5: leading REQ prefix before type is accepted"
make_fixture "$WORKDIR/case5" "[REQ-123] fix(reports): map dynamic category reports" "Co-Authored-By: Test <test@example.com>"
run_validator
assert_exit "leading REQ prefix exits 0" 0
assert_grep "no conventional-commit error for leading REQ prefix" "Not Conventional Commits format" 0
assert_grep "no missing-requirement error for leading REQ prefix" "implementation commit but cites no requirement" 0

# Case 6: malformed leading REQ prefixes remain invalid.
echo "Case 6: malformed leading REQ prefix is rejected"
make_fixture "$WORKDIR/case6" "[REQ-12] fix: invalid short req prefix" "Co-Authored-By: Test <test@example.com>"
run_validator
assert_exit "malformed leading REQ prefix exits 1" 1
assert_grep "malformed prefix is not treated as conventional" "Not Conventional Commits format" 1

echo
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
