#!/usr/bin/env bash
# check-deferred-reqs-in-range.test.sh — promotion-gate tests (#956) plus an
# end-to-end case through check-release-pr-scope.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PASS=0
FAIL=0
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

assert_eq() {
  local desc="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    echo "  PASS: $desc"; PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (want $want, got $got)"; FAIL=$((FAIL + 1))
  fi
}
assert_out() {
  local desc="$1" pattern="$2" file="$3"
  if grep -Eq "$pattern" "$file"; then
    echo "  PASS: $desc"; PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (missing /$pattern/)"; sed 's/^/    | /' "$file"; FAIL=$((FAIL + 1))
  fi
}

# Fixture: main with a base commit; develop with a deferred REQ-060 commit and
# the release REQ-061 commit. origin/main is a ref pointing at main.
make_fixture() {
  local dir="$1"
  rm -rf "$dir"; mkdir -p "$dir/scripts" "$dir/compliance/pending-releases"
  cp "$SCRIPT_DIR/check-deferred-reqs-in-range.sh" "$SCRIPT_DIR/list-reqs-in-range.sh" \
     "$SCRIPT_DIR/check-release-pr-scope.sh" "$SCRIPT_DIR/derive-release-version.sh" \
     "$SCRIPT_DIR/extract-release-metadata.sh" "$SCRIPT_DIR/standalone-housekeeping-release.sh" "$dir/scripts/"
  cd "$dir"
  git init -q --initial-branch=main
  git config user.email t@example.com
  git config user.name t
  git add . && git commit -q -m "chore: base"
  git update-ref refs/remotes/origin/main HEAD
  git checkout -q -b develop
  git commit -q --allow-empty -m "[REQ-060] feat: deferred work"
  git commit -q --allow-empty -m "[REQ-061] feat: the release"
}

deferred_ticket() {
  printf '%s\n' "# Release Ticket — REQ-060" "" "- **Release intent:** deferred-to-next — PR #9 closed unmerged" \
    > compliance/pending-releases/RELEASE-TICKET-REQ-060.md
}
release_ticket() {
  { printf '%s\n' "# Release Ticket — REQ-061" "" "**Requirement:** REQ-061 — release"
    [ -z "${1:-}" ] || printf '%s\n' "- **Absorbed predecessor releases:** $1"; } \
    > compliance/pending-releases/RELEASE-TICKET-REQ-061.md
}
gate() {
  local out="$1"; shift
  if CURRENT_RELEASE=REQ-061 SINCE_REF=origin/main bash scripts/check-deferred-reqs-in-range.sh >"$out" 2>&1; then echo 0; else echo 1; fi
}

echo "=== check-deferred-reqs-in-range.sh tests ==="

echo "--- deferred REQ in range, not listed -> fail ---"
make_fixture "$WORK/a"; deferred_ticket; release_ticket "None"
assert_eq "exit 1" 1 "$(gate "$WORK/a.out")"
assert_out "names the REQ" 'REQ-060 is deferred' "$WORK/a.out"
assert_out "names the ticket" 'compliance/pending-releases/RELEASE-TICKET-REQ-060.md' "$WORK/a.out"
assert_out "tells the author what to do" "Absorbed predecessor releases.*or revert" "$WORK/a.out"

echo "--- deferred REQ listed as absorbed predecessor -> pass ---"
make_fixture "$WORK/b"; deferred_ticket; release_ticket "REQ-060"
assert_eq "exit 0" 0 "$(gate "$WORK/b.out")"
assert_out "reports OK" 'REQ-060 is deferred and is listed' "$WORK/b.out"

echo "--- no deferred tickets -> pass as today ---"
make_fixture "$WORK/c"; release_ticket "None"
printf '%s\n' "# Release Ticket — REQ-060" > compliance/pending-releases/RELEASE-TICKET-REQ-060.md
assert_eq "exit 0" 0 "$(gate "$WORK/c.out")"
assert_out "says no deferred REQs" 'no deferred REQs' "$WORK/c.out"

echo "--- DEFERRED RTM row only (ticket has no intent field) -> fail ---"
make_fixture "$WORK/d"; release_ticket "None"
printf '%s\n' "# Release Ticket — REQ-060" > compliance/pending-releases/RELEASE-TICKET-REQ-060.md
printf '%s\n' '| REQ-ID | Status |' '| --- | --- |' '| REQ-060 | DEFERRED |' '| REQ-061 | IN PROGRESS |' > compliance/RTM.md
assert_eq "exit 1" 1 "$(gate "$WORK/d.out")"
assert_out "names the REQ and RTM status" 'REQ-060 is deferred .*RTM status DEFERRED' "$WORK/d.out"

echo "--- deferred REQ with no commits in range -> pass ---"
make_fixture "$WORK/e"; release_ticket "None"
printf '%s\n' "# Release Ticket — REQ-099" "- **Release intent:** deferred-to-next — parked" > compliance/pending-releases/RELEASE-TICKET-REQ-099.md
assert_eq "exit 0" 0 "$(gate "$WORK/e.out")"

echo "--- end to end: develop -> main PR fails through check-release-pr-scope.sh ---"
make_fixture "$WORK/f"; deferred_ticket; release_ticket "None"
if HEAD_REF=develop BASE_REF=main PR_TITLE="Release: REQ-061" PR_BODY=$'- Release: REQ-061\n' \
  bash scripts/check-release-pr-scope.sh >"$WORK/f.out" 2>&1; then CODE=0; else CODE=1; fi
assert_eq "scope check exits 1" 1 "$CODE"
assert_out "deferral error surfaced" 'Deferral gate: REQ-060 is deferred' "$WORK/f.out"
release_ticket "REQ-060"
if HEAD_REF=develop BASE_REF=main PR_TITLE="Release: REQ-061" PR_BODY=$'- Release: REQ-061\n' \
  bash scripts/check-release-pr-scope.sh >"$WORK/f2.out" 2>&1; then CODE=0; else CODE=1; fi
assert_eq "listed predecessor passes the scope check" 0 "$CODE"

echo ""
echo "=== Summary: $PASS pass / $FAIL fail ==="
[ "$FAIL" -eq 0 ]
