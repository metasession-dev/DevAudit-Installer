#!/usr/bin/env bash
# close-out-release.test.sh — Tests for the RTM-flip awk in
# close-out-release.sh, specifically that it locates the correct
# Status column when the RTM has multiple markdown tables with
# different shapes (#72 regression: the prior implementation locked
# `statuscol` on the FIRST header containing "Status", mangling the
# wrong column when a legend table appeared above the main RTM).
#
# Usage:
#   ./scripts/close-out-release.test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/close-out-release.sh"
[ -x "$HELPER" ] || chmod +x "$HELPER"

PASS=0
FAIL=0

assert_eq() {
  local desc="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    echo "        want: $want"
    echo "        got:  $got"
    FAIL=$((FAIL + 1))
  fi
}

# Build a self-contained fixture under $1 with:
#   - compliance/RTM.md containing the legend table + the main RTM
#   - compliance/pending-releases/RELEASE-TICKET-REQ-050.md (so the script
#     can stage the move + flip; close-out aborts early without it)
#   - a `.git` so the `git mv` step doesn't break
make_fixture() {
  local dir="$1"
  rm -rf "$dir"
  mkdir -p "$dir/compliance/pending-releases" "$dir/compliance/approved-releases"
  cd "$dir"
  git init -q --initial-branch=main
  git config user.email "test@example.com"
  git config user.name "test"

  # Multi-table RTM: legend table first (Status | Description, 2 cols, the
  # shape that mangled WGB on REQ-048/050), then the main RTM (REQ-ID, …,
  # Status, …, 7 cols).
  cat > compliance/RTM.md <<'EOF'
# Requirements Traceability Matrix

## Status Legend

| Status                       | Description                                |
| ---------------------------- | ------------------------------------------ |
| DRAFT                        | Requirement captured, planning underway    |
| TESTED - PENDING SIGN-OFF    | Implementation merged, awaiting close-out  |
| RELEASED                     | Promoted to main + portal-released         |

## Main RTM

| REQ-ID  | Source | Risk   | Evidence                       | Status                    | Owner   | Date       |
| ------- | ------ | ------ | ------------------------------ | ------------------------- | ------- | ---------- |
| REQ-049 | #155   | LOW    | compliance/evidence/REQ-049/   | RELEASED                  | thomp@. | 2026-05-24 |
| REQ-050 | #180   | HIGH   | compliance/evidence/REQ-050/   | TESTED - PENDING SIGN-OFF | thomp@. | 2026-05-28 |
EOF

  # A minimal release ticket — just enough for the script's pre-checks to pass.
  cat > compliance/pending-releases/RELEASE-TICKET-REQ-050.md <<'EOF'
# Release Ticket: REQ-050

**Status:** TESTED - PENDING SIGN-OFF
**DevAudit Release:** REQ-050
EOF

  git add -A
  git commit -q -m "fixture: pre-close-out state"
}

# ── Case 1: multi-table RTM, status-column lock disambiguated by ID column ─
{
  dir="$(mktemp -d)/cli-close-out-fixture-1"
  make_fixture "$dir"
  # Skip the portal probe + the ticket-move so we isolate the RTM-flip path.
  unset DEVAUDIT_API_KEY DEVAUDIT_BASE_URL || true
  # Run the script; tolerate exit on the warnings — the RTM flip should still
  # have happened before any non-fatal warning.
  bash "$HELPER" REQ-050 >/dev/null 2>&1 || true
  # Assert: col-1 stays REQ-050 (NOT overwritten with RELEASED); col-5 flips.
  row=$(grep -m1 -E "^\| REQ-050 " compliance/RTM.md || true)
  col1=$(echo "$row" | awk -F '|' '{gsub(/^[[:space:]]+|[[:space:]]+$/,"",$2); print $2}')
  col5=$(echo "$row" | awk -F '|' '{gsub(/^[[:space:]]+|[[:space:]]+$/,"",$6); print $6}')
  assert_eq "REQ-050 row: col-1 unchanged"   "REQ-050"  "$col1"
  assert_eq "REQ-050 row: col-5 flipped"     "RELEASED" "$col5"
  # And the unrelated REQ-049 row stays untouched (it was already RELEASED
  # before this run; if the awk picked up the wrong table or column, col-1
  # would say RELEASED instead of REQ-049).
  row49=$(grep -m1 -E "^\| REQ-049 " compliance/RTM.md || true)
  col1_49=$(echo "$row49" | awk -F '|' '{gsub(/^[[:space:]]+|[[:space:]]+$/,"",$2); print $2}')
  assert_eq "REQ-049 row: col-1 untouched"   "REQ-049"  "$col1_49"
  rm -rf "$(dirname "$dir")"
}

# ── Case 2: single-table RTM (the simple shape) — behaviour unchanged ──────
{
  dir="$(mktemp -d)/cli-close-out-fixture-2"
  mkdir -p "$dir/compliance/pending-releases" "$dir/compliance/approved-releases"
  cd "$dir"
  git init -q --initial-branch=main >/dev/null
  git config user.email "test@example.com"
  git config user.name "test"
  cat > compliance/RTM.md <<'EOF'
# Requirements Traceability Matrix

| REQ-ID  | Source | Risk   | Evidence                       | Status                    | Owner   | Date       |
| ------- | ------ | ------ | ------------------------------ | ------------------------- | ------- | ---------- |
| REQ-050 | #180   | HIGH   | compliance/evidence/REQ-050/   | TESTED - PENDING SIGN-OFF | thomp@. | 2026-05-28 |
EOF
  cat > compliance/pending-releases/RELEASE-TICKET-REQ-050.md <<'EOF'
# Release Ticket: REQ-050

**Status:** TESTED - PENDING SIGN-OFF
**DevAudit Release:** REQ-050
EOF
  git add -A
  git commit -q -m "fixture: single-table"
  unset DEVAUDIT_API_KEY DEVAUDIT_BASE_URL || true
  bash "$HELPER" REQ-050 >/dev/null 2>&1 || true
  row=$(grep -m1 -E "^\| REQ-050 " compliance/RTM.md || true)
  col1=$(echo "$row" | awk -F '|' '{gsub(/^[[:space:]]+|[[:space:]]+$/,"",$2); print $2}')
  col5=$(echo "$row" | awk -F '|' '{gsub(/^[[:space:]]+|[[:space:]]+$/,"",$6); print $6}')
  assert_eq "single-table: col-1 unchanged" "REQ-050"  "$col1"
  assert_eq "single-table: col-5 flipped"   "RELEASED" "$col5"
  rm -rf "$(dirname "$dir")"
}

echo
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
