#!/usr/bin/env bash
# list-reqs-in-range.test.sh — fixture-repo tests for list-reqs-in-range.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/list-reqs-in-range.sh"

PASS=0
FAIL=0
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

assert_eq() {
  local desc="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    echo "  PASS: $desc"; PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"; echo "    want: $(printf '%s' "$want" | tr '\n' ' ')"; echo "    got:  $(printf '%s' "$got" | tr '\n' ' ')"
    FAIL=$((FAIL + 1))
  fi
}

new_repo() {
  rm -rf "$1"; mkdir -p "$1"; cd "$1"
  git init -q --initial-branch=main
  git config user.email t@example.com
  git config user.name t
  git commit -q --allow-empty -m "chore: base"
}

echo "=== list-reqs-in-range.sh tests ==="

new_repo "$WORK/r1"
git tag v1.0.0
git commit -q --allow-empty -m "[REQ-010] feat: a"
git commit -q --allow-empty -m "fix: b" -m "Ref: REQ-011"
git commit -q --allow-empty -m "fix: c" -m "Ref: REQ-011"
git commit -q --allow-empty -m "docs: prose only" -m "see REQ-012 for background"
git commit -q --allow-empty -m "feat: ten" -m "Ref: REQ-100"
assert_eq "tags and trailers, distinct, sorted; prose ignored" $'REQ-010\nREQ-011\nREQ-100' "$(bash "$HELPER" v1.0.0 HEAD)"
assert_eq "default SINCE is the last tag" $'REQ-010\nREQ-011\nREQ-100' "$(bash "$HELPER")"
assert_eq "explicit SINCE narrows the range" "REQ-100" "$(bash "$HELPER" HEAD~1 HEAD)"

new_repo "$WORK/r2"
git commit -q --allow-empty -m "[REQ-020] feat: before"
git checkout -q -b feature
git commit -q --allow-empty -m "[REQ-021] feat: on branch"
git remote add origin "$WORK/r2" 2>/dev/null || true
assert_eq "no tag: falls back to merge-base with main" "REQ-021" "$(bash "$HELPER")"

new_repo "$WORK/r3"
git tag v1.0.0
git commit -q --allow-empty -m "chore: close out" -m $'Ref: REQ-030\nRelease-Closeout: REQ-030'
assert_eq "close-out commits are skipped" "" "$(bash "$HELPER" v1.0.0 HEAD)"

new_repo "$WORK/r4"
if bash "$HELPER" no-such-ref HEAD >/dev/null 2>&1; then CODE=0; else CODE=$?; fi
assert_eq "unknown ref exits 1" "1" "$CODE"

echo ""
echo "=== Summary: $PASS pass / $FAIL fail ==="
[ "$FAIL" -eq 0 ]
