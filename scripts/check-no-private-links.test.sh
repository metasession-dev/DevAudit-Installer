#!/usr/bin/env bash
# check-no-private-links.test.sh — tests for check-no-private-links.sh (DevAudit-Installer#1128).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$SCRIPT_DIR/check-no-private-links.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0
ok() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
no() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

P='https://github.com/metasession-dev/devaudit'

# repo <name> <relative path> <content>: a temporary repository with one tracked file; prints its path
repo() {
  local dir="$WORK/$1"
  mkdir -p "$dir/$(dirname "$2")"
  printf '%s\n' "$3" > "$dir/$2"
  ( cd "$dir" && git init -q && git add -A )
  echo "$dir"
}

expect_fail() { # <label> <content> [path]
  local d; d="$(repo "f$RANDOM$RANDOM" "${3:-doc.md}" "$2")"
  if bash "$GUARD" "$d" >/dev/null 2>&1; then no "$1 should fail"; else ok "$1 fails"; fi
}
expect_pass() { # <label> <content> [path]
  local d; d="$(repo "p$RANDOM$RANDOM" "${3:-doc.md}" "$2")"
  if bash "$GUARD" "$d" >/dev/null 2>&1; then ok "$1 passes"; else no "$1 should pass"; fi
}

echo "patterns that must fail"
expect_fail "a /blob/ link" "see [x]($P/blob/main/docs/a.md)"
expect_fail "a /tree/ link" "see $P/tree/main/docs"
expect_fail "an /issues/ link" "see $P/issues/12"
expect_fail "a /pull/ link" "see $P/pull/12"
expect_fail "a link to the repository root in parentheses" "the portal ([repo]($P))"
expect_fail "a root link followed by a quote" "url: \"$P\""
expect_fail "a root link followed by a space" "see $P for more"
expect_fail "a root link at the end of the line" "see $P"
expect_fail "a link in a synced template" "Reference: $P/blob/main/docs/x.md" "sdlc/files/_common/github/pull_request_template.md"

echo "things that must pass"
expect_pass "this repository's own links" "see https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/framework-registry.md"
expect_pass "the portal's public site" "see https://devaudit.ai/"
expect_pass "the repository named without a link" "the repo metasession-dev/devaudit is private"
expect_pass "a historical record" "see $P/pull/413" "docs/issues/old.md"
expect_pass "an article" "see $P/pull/413" "docs/articles/old.md"
expect_pass "the SRS" "see $P/pull/413" "docs/SRS.md"
expect_pass "the changelog" "see $P/pull/413" "cli/CHANGELOG.md"
expect_pass "a contract id URL (allow-list)" "\"\$id\": \"$P/raw/x\"" "contracts/evidence-types.json"
expect_pass "the contract sync workflow (allow-list)" "body: see [x]($P)" ".github/workflows/sync-evidence-contract.yml"
expect_pass "the validation string check (allow-list)" "includes('$P/')" "cli/src/update/validation.ts"

echo "the real repository is clean"
if bash "$GUARD" >/dev/null 2>&1; then ok "no tracked file links into the private repository"; else no "the repository has private links (run the script to list them)"; fi

echo ""
echo "check-no-private-links.test.sh: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
