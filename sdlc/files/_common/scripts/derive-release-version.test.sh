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

# Case 7: a prose REQ mention earlier in the body must NOT beat the Ref:
# line. Regression for the META-JOBS misattribution where "target close:
# REQ-002" caused gate evidence to land on a REQ-002 release instead of
# the real Ref: REQ-001.
make_fixture "$WORK/c7" "chore(sdlc): accept dep advisories

Dependency advisories accepted under R-001; target close: REQ-002.

Ref: REQ-001"
assert_eq "prose REQ-002 before Ref: REQ-001 -> REQ-001" "REQ-001" "$(run_helper)"

# Case 8: a "Merge pull request" commit carries the PR title (with its
# bracketed [REQ-XXX] tag) in the BODY, not the subject, and no Ref: line.
# Must resolve from the body bracket, not fall through to the date.
# Regression for REQ-002 landing on a phantom v<date> release after a
# feature->develop PR merge.
make_fixture "$WORK/c8" "Merge pull request #7 from metasession-dev/feat/req-002

chore(deps): [REQ-002] dependency hardening — close R-001"
assert_eq "merge-commit body [REQ-002] -> REQ-002" "REQ-002" "$(run_helper)"

# Case 9 (DevAudit-Installer#92): a chore: sync commit has no REQ tag in
# its message but a pending release ticket exists on disk. Must attribute
# to the REQ from that ticket instead of falling through to the bare date.
# Regression for REQ-051 / REQ-052 gate evidence landing on phantom date
# releases when a `chore: devaudit update to 0.1.x` commit landed between
# the feature merge and the release-PR open on wawagardenbar-app.
make_fixture "$WORK/c9" "chore: devaudit update to 0.1.27"
mkdir -p compliance/pending-releases
cat > compliance/pending-releases/RELEASE-TICKET-REQ-051.md <<'TICKET'
# Release Ticket: REQ-051

**Status:** TESTED - PENDING SIGN-OFF
TICKET
assert_eq "chore: sync + single pending ticket REQ-051 -> REQ-051" "REQ-051" "$(run_helper)"

# Case 10: a chore: sync commit with MULTIPLE pending tickets — ambiguous,
# stays at the bare-date fallback (don't guess between them).
make_fixture "$WORK/c10" "chore: devaudit update to 0.1.27"
mkdir -p compliance/pending-releases
cat > compliance/pending-releases/RELEASE-TICKET-REQ-051.md <<'TICKET'
# Release Ticket: REQ-051
TICKET
cat > compliance/pending-releases/RELEASE-TICKET-REQ-052.md <<'TICKET'
# Release Ticket: REQ-052
TICKET
assert_eq "chore: sync + two pending tickets -> bare date $TODAY" "$TODAY" "$(run_helper)"

# Case 11: a chore: sync commit + no compliance/pending-releases dir at
# all — still falls back to the bare date (the directory may be missing
# for projects that haven't started their first tracked release yet).
make_fixture "$WORK/c11" "chore: devaudit update to 0.1.27"
assert_eq "chore: sync + no pending dir -> bare date $TODAY" "$TODAY" "$(run_helper)"

# Case 12: a feat: commit with a [REQ-XXX] tag in the subject AND a
# pending ticket for a DIFFERENT REQ. Subject wins (step 1 returns
# before step 4 fires).
make_fixture "$WORK/c12" "[REQ-099] feat: in-flight feature for a different REQ"
mkdir -p compliance/pending-releases
cat > compliance/pending-releases/RELEASE-TICKET-REQ-051.md <<'TICKET'
# Release Ticket: REQ-051
TICKET
assert_eq "subject [REQ-099] beats pending REQ-051 -> REQ-099" "REQ-099" "$(run_helper)"

echo ""
echo "=== Summary: $PASS pass / $FAIL fail ==="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
