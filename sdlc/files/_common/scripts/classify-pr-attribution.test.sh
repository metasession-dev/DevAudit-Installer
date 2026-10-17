#!/usr/bin/env bash
# classify-pr-attribution.test.sh -- tests for classify-pr-attribution.sh (devaudit-installer#1019).
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/classify-pr-attribution.sh"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
PASS=0; FAIL=0

new_repo() { # <dir>
  rm -rf "$1"; mkdir -p "$1"; cd "$1" || exit 1
  git init -q -b develop; git config user.email t@example.test; git config user.name t; git config commit.gpgsign false
  mkdir -p src compliance/evidence/REQ-109 docs
  echo a > src/app.ts; echo "# t" > docs/guide.md
  git add -A; git commit -q -m "chore: init"
  git checkout -q -b topic
}
commit() { # <msg> <files...>
  local msg="$1"; shift
  for f in "$@"; do mkdir -p "$(dirname "$f")"; echo "$RANDOM" >> "$f"; done
  git add -A; git commit -q -m "$msg"
}
expect() { # <desc> <want> [extra args]
  local desc="$1" want="$2"; shift 2
  local got; got="$(bash "$HELPER" --base develop "$@" 2>/dev/null)"
  if [ "$got" = "$want" ]; then echo "  PASS: $desc"; PASS=$((PASS + 1)); else echo "  FAIL: $desc (want '$want', got '$got')"; FAIL=$((FAIL + 1)); fi
}

echo "=== classify-pr-attribution.sh tests ==="

new_repo "$WORK/code"
commit "feat: [REQ-109] change

Ref: REQ-109" src/app.ts compliance/evidence/REQ-109/test-plan.md
expect "a PR that changes code attaches" attach

new_repo "$WORK/docs"
commit "compliance: [REQ-109] e2e regression triage

Ref: REQ-109" compliance/evidence/REQ-109/e2e-triage.md
expect "the REQ-109 shape: a doc-only compliance PR carrying Ref: does not attach" skip:doc-only

new_repo "$WORK/marker"
commit "compliance: record triage

Compliance-Record: REQ-109" compliance/evidence/REQ-109/e2e-triage.md docs/guide.md
expect "a Compliance-Record trailer on a doc-only PR is the explicit document-only marker" skip:compliance-record

new_repo "$WORK/markercode"
commit "fix: oops

Compliance-Record: REQ-109" src/app.ts
out="$(bash "$HELPER" --base develop 2>"$WORK/err.txt")"
if [ "$out" = "attach" ] && grep -q "also changes non-documentation" "$WORK/err.txt"; then echo "  PASS: the marker on a code-bearing PR attaches, with a warning"; PASS=$((PASS + 1)); else echo "  FAIL: marker + code (got '$out')"; cat "$WORK/err.txt"; FAIL=$((FAIL + 1)); fi

new_repo "$WORK/mixed"
commit "docs: x" docs/guide.md
commit "fix: [REQ-109] y

Ref: REQ-109" src/app.ts
expect "docs plus code attaches" attach

new_repo "$WORK/md"
commit "docs: readme" README.md packages/x/NOTES.md
expect "any *.md at any depth is documentation" skip:doc-only

new_repo "$WORK/empty"
git commit -q --allow-empty -m "chore: empty"
expect "an empty range is skip:no-changes" skip:no-changes

new_repo "$WORK/custom"
commit "chore: tweak" tools/script.sh
got="$(DEVAUDIT_DOC_PATH_REGEX='^tools/' bash "$HELPER" --base develop 2>/dev/null)"
if [ "$got" = "skip:doc-only" ]; then echo "  PASS: DEVAUDIT_DOC_PATH_REGEX overrides what counts as documentation"; PASS=$((PASS + 1)); else echo "  FAIL: custom regex (got '$got')"; FAIL=$((FAIL + 1)); fi

new_repo "$WORK/badbase"
got="$(bash "$HELPER" --base no-such-ref 2>/dev/null)"
if [ "$got" = "attach" ]; then echo "  PASS: an unresolvable base degrades to attach (pre-#1019 behaviour)"; PASS=$((PASS + 1)); else echo "  FAIL: bad base (got '$got')"; FAIL=$((FAIL + 1)); fi

if bash "$HELPER" >/dev/null 2>&1; then echo "  FAIL: missing --base should exit 2"; FAIL=$((FAIL + 1)); else echo "  PASS: missing --base is a usage error"; PASS=$((PASS + 1)); fi

echo ""
echo "=== classify-pr-attribution.test.sh: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
