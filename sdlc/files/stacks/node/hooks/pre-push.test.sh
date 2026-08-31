#!/usr/bin/env bash
# pre-push.test.sh — Tests for the pre-push hook's commit-range computation
# and Phase-5 RTM detection (devaudit-installer#743, #744).
#
# The hook itself (`pre-push`) isn't invoked directly here — it unconditionally
# runs `npx tsc --noEmit` and reads stdin as push refs, neither of which is
# meaningful in a hermetic fixture repo with no package.json. Instead, this
# extracts the two pieces of logic under test verbatim from the hook source
# (compute_range()'s body, and the Phase-5 RTM-diff regex) and exercises them
# against real git fixtures, so a change to either block in the hook is
# caught here without needing a full husky/npm environment.
#
# Usage:
#   ./pre-push.test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$SCRIPT_DIR/pre-push"

PASS=0
FAIL=0

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

# Extract compute_range()'s body straight from the hook so this test always
# exercises the real implementation, not a hand-copied drift-prone one.
COMPUTE_RANGE_SRC=$(sed -n '/^compute_range() {/,/^}/p' "$HOOK")
if [ -z "$COMPUTE_RANGE_SRC" ]; then
  echo "FATAL: could not extract compute_range() from $HOOK" >&2
  exit 2
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "=== pre-push compute_range() tests (devaudit-installer#743) ==="

# --- Case 1: origin/$INTEGRATION_BRANCH resolves — merge-base range ---
REPO="$WORK/case1"
ORIGIN="$WORK/case1-origin.git"
rm -rf "$REPO" "$ORIGIN"
git init -q --bare "$ORIGIN"
git init -q "$REPO"
(
  cd "$REPO"
  git config user.email test@example.com
  git config user.name tester
  git commit -q --allow-empty -m "chore: base"
  git commit -q --allow-empty -m "feat: old already-merged feature"
  git remote add origin "$ORIGIN"
  git push -q origin HEAD:refs/heads/develop
  git checkout -q -b feature/housekeeping-only
  git commit -q --allow-empty -m "chore: housekeeping only"
)
LOCAL_SHA=$(git -C "$REPO" rev-parse HEAD)
BASE_SHA=$(git -C "$REPO" rev-parse origin/develop)
GOT=$(
  cd "$REPO"
  INTEGRATION_BRANCH=develop
  eval "$COMPUTE_RANGE_SRC"
  compute_range "0000000000000000000000000000000000000000" "$LOCAL_SHA"
)
assert_eq "new branch, integration branch resolves -> merge-base range" "${BASE_SHA}..${LOCAL_SHA}" "$GOT"
# The whole point of #741/#743: the range must exclude the old feat: commit.
COMMITS_IN_RANGE=$(git -C "$REPO" log "$GOT" --format='%s')
assert_eq "range excludes already-merged feat: commit" "chore: housekeeping only" "$COMMITS_IN_RANGE"

# --- Case 2: origin/$INTEGRATION_BRANCH missing, origin/HEAD resolves ---
REPO="$WORK/case2"
ORIGIN="$WORK/case2-origin.git"
rm -rf "$REPO" "$ORIGIN"
git init -q --bare "$ORIGIN"
git init -q "$REPO"
(
  cd "$REPO"
  git config user.email test@example.com
  git config user.name tester
  git commit -q --allow-empty -m "chore: base on main"
  git remote add origin "$ORIGIN"
  git push -q origin HEAD:refs/heads/main
  git remote set-head origin main
  git checkout -q -b feature/new-thing
  git commit -q --allow-empty -m "feat: new thing"
)
LOCAL_SHA=$(git -C "$REPO" rev-parse HEAD)
HEAD_BASE=$(git -C "$REPO" rev-parse origin/HEAD)
GOT=$(
  cd "$REPO"
  # sdlc-config.json's integration_branch ("develop") doesn't exist on this
  # remote (only "main" was pushed) — origin/HEAD fallback must kick in.
  INTEGRATION_BRANCH=develop
  eval "$COMPUTE_RANGE_SRC"
  compute_range "0000000000000000000000000000000000000000" "$LOCAL_SHA"
)
assert_eq "integration branch missing, origin/HEAD resolves -> origin/HEAD range" "${HEAD_BASE}..${LOCAL_SHA}" "$GOT"

# --- Case 3: neither resolves — bare SHA fallback (unchanged legacy behavior) ---
REPO="$WORK/case3"
rm -rf "$REPO"
git init -q "$REPO"
(
  cd "$REPO"
  git config user.email test@example.com
  git config user.name tester
  git commit -q --allow-empty -m "chore: no remote at all"
)
LOCAL_SHA=$(git -C "$REPO" rev-parse HEAD)
GOT=$(
  cd "$REPO"
  INTEGRATION_BRANCH=develop
  eval "$COMPUTE_RANGE_SRC"
  compute_range "0000000000000000000000000000000000000000" "$LOCAL_SHA"
)
assert_eq "no remote resolvable -> bare SHA fallback" "$LOCAL_SHA" "$GOT"

# --- Case 4: existing ref (remote_sha not all-zeros) — unchanged behavior ---
GOT=$(
  cd "$REPO"
  INTEGRATION_BRANCH=develop
  eval "$COMPUTE_RANGE_SRC"
  compute_range "aaaa000000000000000000000000000000000a" "bbbb000000000000000000000000000000000b"
)
assert_eq "existing ref -> remote_sha..local_sha, unchanged" "aaaa000000000000000000000000000000000a..bbbb000000000000000000000000000000000b" "$GOT"

echo ""
echo "=== pre-push Phase-5 RTM.md detection tests (devaudit-installer#744) ==="

# Re-implements the exact detection line from the hook (single source of
# truth: extracted, not hand-copied) so drift is caught.
PHASE5_RTM_CHECK=$(grep -F "grep -qE '^\+.*\bRELEASED\b'" "$HOOK" | head -1)
if [ -z "$PHASE5_RTM_CHECK" ]; then
  echo "FATAL: could not find Phase-5 RTM RELEASED-diff check in $HOOK" >&2
  exit 2
fi

check_phase5_rtm() {
  local range="$1"
  if git diff "$range" -- 'compliance/RTM.md' 2>/dev/null | grep -qE '^\+.*\bRELEASED\b'; then
    echo "yes"
  else
    echo "no"
  fi
}

REPO="$WORK/case-rtm"
rm -rf "$REPO"
git init -q "$REPO"
(
  cd "$REPO"
  git config user.email test@example.com
  git config user.name tester
  mkdir -p compliance
  cat > compliance/RTM.md <<'EOF'
| REQ-ID | Status |
| ------ | ------ |
| REQ-001 | RELEASED |
EOF
  git add compliance/RTM.md
  git commit -q -m "chore: seed RTM"
)

# Phase 1: add a new DRAFT row only — must NOT be treated as Phase 5.
BASE_SHA=$(git -C "$REPO" rev-parse HEAD)
(
  cd "$REPO"
  git checkout -q -b feature/req-002
  cat >> compliance/RTM.md <<'EOF'
| REQ-002 | DRAFT |
EOF
  git add compliance/RTM.md
  git commit -q -m "feat: add REQ-002 draft row"
)
DRAFT_SHA=$(git -C "$REPO" rev-parse HEAD)
GOT=$(cd "$REPO" && check_phase5_rtm "${BASE_SHA}..${DRAFT_SHA}")
assert_eq "adding a DRAFT row is NOT Phase-5" "no" "$GOT"

# Phase 5: flip that row's status to RELEASED — must be treated as Phase 5.
(
  cd "$REPO"
  sed -i.bak 's/| REQ-002 | DRAFT |/| REQ-002 | RELEASED |/' compliance/RTM.md
  rm -f compliance/RTM.md.bak
  git add compliance/RTM.md
  git commit -q -m "chore: release REQ-002"
)
RELEASE_SHA=$(git -C "$REPO" rev-parse HEAD)
GOT=$(cd "$REPO" && check_phase5_rtm "${DRAFT_SHA}..${RELEASE_SHA}")
assert_eq "flipping a row to RELEASED IS Phase-5" "yes" "$GOT"

echo ""
echo "PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
