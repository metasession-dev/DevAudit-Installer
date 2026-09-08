#!/usr/bin/env bash
# close-out-reconcile.test.sh — Tests for close-out-reconcile.sh
# (devaudit-installer#786): detects a pending release ticket whose REQ
# already has a matching commit on origin/main, so it can be
# reconciled even if the portal's one-shot release-closed dispatch was
# ever missed.
#
# Usage:
#   ./scripts/close-out-reconcile.test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/close-out-reconcile.sh"
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

# Build a throwaway repo with a `main` branch (holding some commits, some
# REQ-tagged) and a checked-out `develop` branch carrying pending-release
# tickets, mirroring the real layout close-out-reconcile.sh runs against.
make_fixture() {
  local dir="$1"
  rm -rf "$dir"
  mkdir -p "$dir"
  cd "$dir"
  git init -q --initial-branch=main
  git config user.email "test@example.com"
  git config user.name "test"
  git commit -q --allow-empty -m "chore: initial"

  # A REQ that genuinely shipped: tagged commit lands on main.
  git commit -q --allow-empty -m "feat: add widget

[REQ-101] Add widget"

  # A REQ referenced only via the body convention.
  git commit -q --allow-empty -m "feat: add gadget

Ref: REQ-102"

  git checkout -q -b develop
  mkdir -p compliance/pending-releases
  # REQ-101 and REQ-102 both shipped to main already but are still
  # sitting in pending-releases/ — these are the stale ones.
  echo "# REQ-101" > compliance/pending-releases/RELEASE-TICKET-REQ-101.md
  echo "# REQ-102" > compliance/pending-releases/RELEASE-TICKET-REQ-102.md
  # REQ-103 has never shipped to main — not stale, should not be reported.
  echo "# REQ-103" > compliance/pending-releases/RELEASE-TICKET-REQ-103.md
  git add -A
  git commit -q -m "chore: pending release tickets"

  # The script reads origin/main, not local main — set up a same-repo
  # "origin" remote pointing at this repo's own main branch, matching how
  # a real GitHub Actions checkout has origin/main available.
  git remote add origin "$dir"
  git fetch -q origin main
}

test_detects_stale_pending_tickets() {
  local dir
  dir="$(mktemp -d)/fixture"
  make_fixture "$dir"

  local result
  result="$("$HELPER" compliance/pending-releases | sort)"

  assert_eq "detects both stale REQs, not the still-pending one" \
    "$(printf 'REQ-101\nREQ-102')" "$result"

  rm -rf "$(dirname "$dir")"
}

test_no_pending_dir_is_a_quiet_noop() {
  local dir
  dir="$(mktemp -d)/fixture-empty"
  mkdir -p "$dir"
  cd "$dir"
  git init -q --initial-branch=main >/dev/null

  local result
  result="$("$HELPER" compliance/pending-releases || true)"
  assert_eq "no pending-releases dir prints nothing" "" "$result"

  rm -rf "$(dirname "$dir")"
}

test_ignores_non_req_ticket_filenames() {
  local dir
  dir="$(mktemp -d)/fixture-nonreq"
  make_fixture "$dir"
  # A malformed/legacy filename that doesn't parse to REQ-XXX must be
  # skipped, not crash the scan.
  touch compliance/pending-releases/RELEASE-TICKET-housekeeping.md

  local result
  result="$("$HELPER" compliance/pending-releases | sort)"
  assert_eq "still only reports the two genuinely stale REQs" \
    "$(printf 'REQ-101\nREQ-102')" "$result"

  rm -rf "$(dirname "$dir")"
}

test_detects_stale_pending_tickets
test_no_pending_dir_is_a_quiet_noop
test_ignores_non_req_ticket_filenames

echo
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
