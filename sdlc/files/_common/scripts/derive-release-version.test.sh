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

# Case 13 (DevAudit-Installer#95): step-4-bis. No subject/body tag,
# no pending ticket, but RTM.md has exactly one IN PROGRESS row.
# Attribute to that REQ. Tests the zero-ceremony fallback that
# survives chore/docs/ci sync commits when no operator state file
# has been dropped.
make_fixture "$WORK/c13" "chore: devaudit update to 0.1.29"
mkdir -p compliance
cat > compliance/RTM.md <<'RTM'
# RTM
| REQ-ID  | Issue | Risk | Evidence                     | Status              | Approver | Date       |
| ------- | ----- | ---- | ---------------------------- | ------------------- | -------- | ---------- |
| REQ-100 | #10   | LOW  | compliance/evidence/REQ-100/ | APPROVED - DEPLOYED | dev      | 2026-05-30 |
| REQ-101 | #11   | MED  | compliance/evidence/REQ-101/ | IN PROGRESS         | dev      | 2026-06-01 |
RTM
assert_eq "RTM single IN PROGRESS row -> REQ-101" "REQ-101" "$(run_helper)"

# Case 14: step-4-bis ambiguity guard. Two IN PROGRESS rows → falls
# through to the bare date rather than guessing.
make_fixture "$WORK/c14" "chore: devaudit update to 0.1.29"
mkdir -p compliance
cat > compliance/RTM.md <<'RTM'
| REQ-ID  | Status         |
| ------- | -------------- |
| REQ-101 | IN PROGRESS    |
| REQ-102 | IN PROGRESS    |
RTM
assert_eq "RTM two IN PROGRESS rows -> bare date $TODAY" "$TODAY" "$(run_helper)"

# Case 15: step-4-bis must ignore legend rows that mention IN PROGRESS
# inside backticks (the wawagardenbar-app RTM convention) and prose
# mentions in description columns.
make_fixture "$WORK/c15" "chore: devaudit update to 0.1.29"
mkdir -p compliance
cat > compliance/RTM.md <<'RTM'
# RTM
## Conventions
| Value              | Meaning                       |
| ------------------ | ----------------------------- |
| `IN PROGRESS`      | Active development underway   |

| REQ-ID  | Status                                                            |
| ------- | ----------------------------------------------------------------- |
| REQ-200 | RELEASED (was IN PROGRESS during Q3, then deployed)               |
RTM
assert_eq "RTM legend + prose mentions -> bare date $TODAY" "$TODAY" "$(run_helper)"

# Case 16: step-4-bis with the real META-JOBS-shaped RTM row (long
# parenthetical commentary in the status cell). The status cell still
# starts with `IN PROGRESS` after the pipe.
make_fixture "$WORK/c16" "chore: devaudit update to 0.1.29"
mkdir -p compliance
cat > compliance/RTM.md <<'RTM'
| REQ-ID  | Issue | Risk        | Evidence                     | Status                                                                | Approver   | Date       |
| ------- | ----- | ----------- | ---------------------------- | --------------------------------------------------------------------- | ---------- | ---------- |
| REQ-056 | #117  | MEDIUM-HIGH | compliance/evidence/REQ-056/ | IN PROGRESS (WhatsApp inbound-message router; many details follow...) | ostendo-io | 2026-06-01 |
RTM
assert_eq "RTM long parenthetical status -> REQ-056" "REQ-056" "$(run_helper)"

# Case 17: step-4-bis must NOT win over a pending ticket on disk.
# Step 4 returns first.
make_fixture "$WORK/c17" "chore: devaudit update to 0.1.29"
mkdir -p compliance/pending-releases compliance
cat > compliance/pending-releases/RELEASE-TICKET-REQ-301.md <<'TICKET'
# Release Ticket: REQ-301
TICKET
cat > compliance/RTM.md <<'RTM'
| REQ-ID  | Status      |
| ------- | ----------- |
| REQ-302 | IN PROGRESS |
RTM
assert_eq "pending ticket REQ-301 beats RTM IN PROGRESS REQ-302" "REQ-301" "$(run_helper)"

# Case 18: step-4-bis respects RTM_PATH env override.
make_fixture "$WORK/c18" "chore: devaudit update to 0.1.29"
mkdir -p docs
cat > docs/custom-RTM.md <<'RTM'
| REQ-ID  | Status      |
| ------- | ----------- |
| REQ-400 | IN PROGRESS |
RTM
GOT=$(RTM_PATH=docs/custom-RTM.md run_helper)
assert_eq "RTM_PATH=docs/custom-RTM.md -> REQ-400" "REQ-400" "$GOT"

# Case 19: step-4-bis with escaped pipes (\|) in the Status column.
# The Status cell contains literal pipe characters escaped as \| (markdown
# table convention). Without the sed pre-processing, the grep could match
# a pipe inside the cell content followed by " IN PROGRESS", producing
# false positives. With the fix, only unescaped pipe delimiters are matched.
make_fixture "$WORK/c19" "chore: devaudit update to 0.1.29"
mkdir -p compliance
cat > compliance/RTM.md <<'RTM'
# RTM
| REQ-ID  | Issue | Risk        | Evidence                     | Status                                                                | Approver   | Date       |
| ------- | ----- | ----------- | ---------------------------- | --------------------------------------------------------------------- | ---------- | ---------- |
| REQ-056 | #117  | MEDIUM-HIGH | compliance/evidence/REQ-056/ | IN PROGRESS (regex: /^\s*(stop\|unsubscribe\|opt[-\s]?out)\s*$/i)    | ostendo-io | 2026-06-01 |
| REQ-064 | #121  | MEDIUM      | compliance/evidence/REQ-064/ | RELEASED (enum: open\|in_progress\|awaiting_customer\|resolved\|closed) | dev | 2026-06-02 |
RTM
assert_eq "RTM escaped pipes -> REQ-056 (single IN PROGRESS)" "REQ-056" "$(run_helper)"

# Case 20: step-4-bis with escaped pipes — ambiguity guard still works.
# Two IN PROGRESS rows, both with escaped pipes in status → falls through
# to bare date rather than guessing.
make_fixture "$WORK/c20" "chore: devaudit update to 0.1.29"
mkdir -p compliance
cat > compliance/RTM.md <<'RTM'
| REQ-ID  | Status                                                                |
| ------- | -------------------------------------------------------------------- |
| REQ-056 | IN PROGRESS (regex: stop\|unsubscribe\|opt[-\s]?out)                 |
| REQ-064 | IN PROGRESS (enum: open\|in_progress\|awaiting_customer\|resolved)   |
RTM
assert_eq "RTM two IN PROGRESS w/ escaped pipes -> bare date $TODAY" "$TODAY" "$(run_helper)"

# Case 21: close-out reconciliation marker suppresses release registration.
# The workflow caller translates this empty stdout to version=skip so the
# reconciliation push neither creates housekeeping stubs nor attaches evidence
# to an already released REQ.
make_fixture "$WORK/c21" "chore(release): reconcile REQ-089 close-out

Release-Closeout: REQ-089"
assert_eq "close-out marker -> empty version" "" "$(run_helper)"

# Case 22 (#571 Gap 3): close-out marker with no REQ digits — must NOT
# suppress the bare-date fallback. The regex requires REQ-[0-9]{3,} so
# a malformed marker like "Release-Closeout: REQ-AB" should fall through
# to the bare date.
make_fixture "$WORK/c22" "chore(release): reconcile close-out

Release-Closeout: REQ-AB"
assert_eq "malformed close-out marker -> bare date $TODAY" "$TODAY" "$(run_helper)"

# Case 23 (#571 Gap 3): close-out marker with extra whitespace — must
# still suppress (regex allows leading whitespace after the colon).
make_fixture "$WORK/c23" "chore(release): reconcile REQ-100 close-out

Release-Closeout:    REQ-100"
assert_eq "close-out marker with extra whitespace -> empty" "" "$(run_helper)"

# Case 24 (#571 Gap 3): no ticket file, no RTM, no git tags, no close-out
# marker — the ultimate fallback chain reaches the bare date. This tests
# that every prior step's `exit 0` guard correctly falls through when
# its condition is not met.
make_fixture "$WORK/c24" "chore: misc cleanup with no compliance state"
assert_eq "no compliance state at all -> bare date $TODAY" "$TODAY" "$(run_helper)"

# Case 25 (#571 Gap 3): pending-releases dir exists but is empty — step 4
# must not crash and must fall through to step 4-bis / bare date.
make_fixture "$WORK/c25" "chore: devaudit update to 0.1.30"
mkdir -p compliance/pending-releases
assert_eq "empty pending-releases dir -> bare date $TODAY" "$TODAY" "$(run_helper)"

# Case 26 (#571 Gap 3): RTM.md exists but has no IN PROGRESS rows —
# step 4-bis must fall through to the bare date.
make_fixture "$WORK/c26" "chore: devaudit update to 0.1.30"
mkdir -p compliance
cat > compliance/RTM.md <<'RTM'
| REQ-ID  | Status        |
| ------- | ------------- |
| REQ-001 | RELEASED      |
| REQ-002 | DRAFT         |
RTM
assert_eq "RTM with no IN PROGRESS -> bare date $TODAY" "$TODAY" "$(run_helper)"

# Case 27 (#571 Gap 3): RTM.md exists but is empty (no rows at all) —
# step 4-bis must not crash and must fall through.
make_fixture "$WORK/c27" "chore: devaudit update to 0.1.30"
mkdir -p compliance
echo "# Requirements Traceability Matrix" > compliance/RTM.md
assert_eq "empty RTM.md -> bare date $TODAY" "$TODAY" "$(run_helper)"

echo ""
echo "=== Summary: $PASS pass / $FAIL fail ==="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
