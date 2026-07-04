#!/usr/bin/env bash
# extract-release-metadata.test.sh — Tests for extract-release-metadata.sh.
#
# Creates throwaway release-ticket fixtures, sources the helper, and asserts
# on the extracted title and summary. Hermetic: runs inside mktemp'd
# directories that are torn down at the end.
#
# Usage:
#   ./scripts/extract-release-metadata.test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/extract-release-metadata.sh"
[ -x "$HELPER" ] || chmod +x "$HELPER"

PASS=0
FAIL=0

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# $1 = test name, $2 = expected, $3 = actual
assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $name"
    echo "    Expected: $expected"
    echo "    Actual:   $actual"
    FAIL=$((FAIL + 1))
  fi
}

assert_empty() {
  local name="$1" actual="$2"
  if [ -z "$actual" ]; then
    echo "  ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $name (expected empty, got: $actual)"
    FAIL=$((FAIL + 1))
  fi
}

# $1 = test dir
make_fixture() {
  local dir="$1"
  rm -rf "$dir"
  mkdir -p "$dir/compliance/pending-releases"
  mkdir -p "$dir/compliance/approved-releases"
  cd "$dir"
}

echo "=== extract-release-metadata.sh tests ==="
echo ""

# --- Test 1: Extract title from **Requirement:** line ---
echo "--- Test 1: Title from **Requirement:** line ---"
make_fixture "$WORK/test1"
cat > "compliance/pending-releases/RELEASE-TICKET-REQ-089.md" <<'TICKET'
# Release Ticket — REQ-089

**Requirement:** REQ-089 — Admin order management: portion size selection, manual price override, per-item special instructions, stock validation

## Summary
This release implements admin order management features including portion size
selection, manual price override, and per-item special instructions.

## Changes
- Added portion size dropdown
- Added manual price override
TICKET

source "$HELPER"
extract_release_metadata "REQ-089"
assert_eq "Title from Requirement line" \
  "Admin order management: portion size selection, manual price override, per-item special instructions, stock validation" \
  "$RELEASE_TITLE"
assert_eq "Summary extracted" \
  "This release implements admin order management features including portion size
selection, manual price override, and per-item special instructions." \
  "$RELEASE_SUMMARY"
echo ""

# --- Test 2: Fallback to H1 when no **Requirement:** line ---
echo "--- Test 2: Fallback to normalised H1 ---"
make_fixture "$WORK/test2"
cat > "compliance/pending-releases/RELEASE-TICKET-REQ-001.md" <<'TICKET'
# Release Ticket — REQ-001

## Summary
Some summary here.
TICKET

source "$HELPER"
extract_release_metadata "REQ-001"
assert_eq "H1 fallback strips 'Release Ticket —' prefix" \
  "REQ-001" \
  "$RELEASE_TITLE"
echo ""

# --- Test 3: Empty title when no ticket exists ---
echo "--- Test 3: Empty title when no ticket ---"
make_fixture "$WORK/test3"
source "$HELPER"
extract_release_metadata "REQ-999"
assert_empty "Title empty when no ticket" "$RELEASE_TITLE"
assert_empty "Summary empty when no ticket" "$RELEASE_SUMMARY"
echo ""

# --- Test 4: Summary with placeholder text is cleared ---
echo "--- Test 4: Placeholder summary is cleared ---"
make_fixture "$WORK/test4"
cat > "compliance/pending-releases/RELEASE-TICKET-REQ-002.md" <<'TICKET'
# Release Ticket — REQ-002

**Requirement:** REQ-002 — Some feature

## Summary
TODO: Add summary

## Changes
- Stuff
TICKET

source "$HELPER"
extract_release_metadata "REQ-002"
assert_eq "Title still extracted" "Some feature" "$RELEASE_TITLE"
assert_empty "Placeholder summary cleared" "$RELEASE_SUMMARY"
echo ""

# --- Test 5: No Summary section → empty summary ---
echo "--- Test 5: No Summary section ---"
make_fixture "$WORK/test5"
cat > "compliance/pending-releases/RELEASE-TICKET-REQ-003.md" <<'TICKET'
# Release Ticket — REQ-003

**Requirement:** REQ-003 — Another feature

## Changes
- Change A
TICKET

source "$HELPER"
extract_release_metadata "REQ-003"
assert_eq "Title extracted" "Another feature" "$RELEASE_TITLE"
assert_empty "Summary empty when no section" "$RELEASE_SUMMARY"
echo ""

# --- Test 6: Summary stops at next ## heading ---
echo "--- Test 6: Summary stops at next ## ---"
make_fixture "$WORK/test6"
cat > "compliance/pending-releases/RELEASE-TICKET-REQ-004.md" <<'TICKET'
# Release Ticket — REQ-004

**Requirement:** REQ-004 — Feature four

## Summary
Line one of summary.
Line two of summary.

## Changes
This should NOT be in summary.
TICKET

source "$HELPER"
extract_release_metadata "REQ-004"
assert_eq "Title" "Feature four" "$RELEASE_TITLE"
assert_eq "Summary stops at next ##" \
  "Line one of summary.
Line two of summary." \
  "$RELEASE_SUMMARY"
echo ""

# --- Test 7: Approved-releases fallback when no pending ticket ---
echo "--- Test 7: Approved-releases fallback ---"
make_fixture "$WORK/test7"
cat > "compliance/approved-releases/RELEASE-TICKET-REQ-005.md" <<'TICKET'
# Release Ticket — REQ-005

**Requirement:** REQ-005 — Approved feature

## Summary
Summary from approved ticket.
TICKET

source "$HELPER"
extract_release_metadata "REQ-005"
assert_eq "Title from approved-releases" "Approved feature" "$RELEASE_TITLE"
assert_eq "Summary from approved-releases" "Summary from approved ticket." "$RELEASE_SUMMARY"
echo ""

# --- Test 8: Em-dash variant in Requirement line ---
echo "--- Test 8: Em-dash variant ---"
make_fixture "$WORK/test8"
cat > "compliance/pending-releases/RELEASE-TICKET-REQ-006.md" <<'TICKET'
# Release Ticket — REQ-006

**Requirement:** REQ-006 — Feature with em-dash

## Summary
Summary.
TICKET

source "$HELPER"
extract_release_metadata "REQ-006"
assert_eq "Em-dash title" "Feature with em-dash" "$RELEASE_TITLE"
echo ""

# --- Test 9: H1 with human title (not just REQ-XXX) ---
echo "--- Test 9: H1 with human title fallback ---"
make_fixture "$WORK/test9"
cat > "compliance/pending-releases/RELEASE-TICKET-REQ-007.md" <<'TICKET'
# Fix login redirect bug

## Summary
Fixes the redirect issue.
TICKET

source "$HELPER"
extract_release_metadata "REQ-007"
assert_eq "H1 human title fallback" "Fix login redirect bug" "$RELEASE_TITLE"
echo ""

# --- Test 10: Summary with leading/trailing blank lines trimmed ---
echo "--- Test 10: Summary blank line trimming ---"
make_fixture "$WORK/test10"
printf '%s\n' \
  '# Release Ticket — REQ-008' \
  '' \
  '**Requirement:** REQ-008 — Feature eight' \
  '' \
  '## Summary' \
  '' \
  '' \
  'Actual summary content.' \
  '' \
  '' \
  '## Changes' \
  '- Change' > "compliance/pending-releases/RELEASE-TICKET-REQ-008.md"

source "$HELPER"
extract_release_metadata "REQ-008"
assert_eq "Title" "Feature eight" "$RELEASE_TITLE"
assert_eq "Summary trimmed" "Actual summary content." "$RELEASE_SUMMARY"
echo ""

# --- Test 11: RTM issue title fallback without release ticket ---
echo "--- Test 11: RTM issue title fallback without release ticket ---"
make_fixture "$WORK/test11"
cat > compliance/RTM.md <<'RTM'
| REQ-ID  | Issue | Risk | Evidence | Status |
| ------- | ----- | ---- | -------- | ------ |
| REQ-011 | #456  | LOW  | n/a      | DRAFT  |
RTM
mkdir -p bin
cat > bin/gh <<'GH'
#!/usr/bin/env bash
if [ "$1" = "issue" ] && [ "$2" = "view" ] && [ "$3" = "456" ]; then
  printf '%s\n' "Issue title from RTM"
  exit 0
fi
exit 1
GH
chmod +x bin/gh
PATH="$PWD/bin:$PATH"
source "$HELPER"
extract_release_metadata "REQ-011"
assert_eq "RTM issue title fallback without ticket" "Issue title from RTM" "$RELEASE_TITLE"
assert_empty "Summary empty without ticket" "$RELEASE_SUMMARY"
echo ""

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
exit $FAIL
