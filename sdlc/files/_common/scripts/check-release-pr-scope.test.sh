#!/usr/bin/env bash
# check-release-pr-scope.test.sh — Tests for release PR metadata drift checks.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/check-release-pr-scope.sh"

PASS=0
FAIL=0
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

assert_exit() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $name"
    echo "    Expected exit: $expected"
    echo "    Actual exit:   $actual"
    FAIL=$((FAIL + 1))
  fi
}

assert_grep() {
  local name="$1" pattern="$2" file="$3"
  if grep -Eq "$pattern" "$file"; then
    echo "  ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $name"
    echo "    Missing pattern: $pattern"
    FAIL=$((FAIL + 1))
  fi
}

make_fixture() {
  local dir="$1" subject="$2"
  rm -rf "$dir"
  mkdir -p "$dir/scripts" "$dir/compliance/pending-releases"
  cp "$SCRIPT_DIR/derive-release-version.sh" "$dir/scripts/derive-release-version.sh"
  cp "$SCRIPT_DIR/extract-release-metadata.sh" "$dir/scripts/extract-release-metadata.sh"
  cp "$HELPER" "$dir/scripts/check-release-pr-scope.sh"
  chmod +x "$dir/scripts/"*.sh
  (
    cd "$dir"
    git init -q
    git config user.email test@example.com
    git config user.name tester
    git commit --allow-empty -q -m "$subject"
  )
}

run_check() {
  local dir="$1" out="$2"
  shift 2
  (
    cd "$dir"
    "$@" bash scripts/check-release-pr-scope.sh
  ) >"$out" 2>&1
}

echo "=== check-release-pr-scope.sh tests ==="
echo ""

echo "--- Test 1: matching REQ scope passes ---"
make_fixture "$WORK/test1" "[REQ-093] feat: ship release"
cat > "$WORK/test1/compliance/pending-releases/RELEASE-TICKET-REQ-093.md" <<'EOF'
# Release Ticket — REQ-093

**Requirement:** REQ-093 — Example release

## Summary
Normal tracked release.
EOF
OUT="$WORK/test1.out"
if run_check "$WORK/test1" "$OUT" env PR_TITLE="Release: REQ-093" PR_BODY=$'## Release\n- Release: REQ-093\n'; then
  CODE=0
else
  CODE=$?
fi
assert_exit "matching REQ scope passes" 0 "$CODE"
assert_grep "success message emitted" 'Release Scope Integrity verified for REQ-093' "$OUT"
echo ""

echo "--- Test 2: stale REQ scope fails ---"
make_fixture "$WORK/test2" "[REQ-093] feat: ship release"
OUT="$WORK/test2.out"
if run_check "$WORK/test2" "$OUT" env PR_TITLE="Release: REQ-092" PR_BODY=$'## Release\n- Release: REQ-092\n'; then
  CODE=0
else
  CODE=$?
fi
assert_exit "stale REQ scope fails" 1 "$CODE"
assert_grep "declared scope printed" 'Declared PR scope: REQ-092' "$OUT"
assert_grep "derived scope printed" 'Derived effective scope: REQ-093' "$OUT"
echo ""

echo "--- Test 3: bundled release must mention bundled marker ---"
make_fixture "$WORK/test3" "[REQ-093] feat: bundled release"
cat > "$WORK/test3/compliance/pending-releases/RELEASE-TICKET-REQ-093.md" <<'EOF'
# Release Ticket — REQ-093

**Requirement:** REQ-093 — Example release

## Summary
Tracked release summary.
EOF
cat > "$WORK/test3/compliance/pending-releases/BUNDLED-CHANGES-REQ-093.md" <<'EOF'
# Bundled Changes — REQ-093
EOF
OUT="$WORK/test3.out"
if run_check "$WORK/test3" "$OUT" env PR_TITLE="Release: REQ-093" PR_BODY=$'## Release\n- Release: REQ-093\n'; then
  CODE=0
else
  CODE=$?
fi
assert_exit "missing bundled marker fails" 1 "$CODE"
assert_grep "bundled mismatch printed" 'bundled release context marker' "$OUT"
echo ""

echo "--- Test 4: hotfix branches skip scope integrity ---"
make_fixture "$WORK/test4" "[REQ-093] feat: ship release"
OUT="$WORK/test4.out"
if run_check "$WORK/test4" "$OUT" env HEAD_REF="hotfix/urgent-fix" PR_TITLE="fix: urgent prod bug" PR_BODY="HOTFIX"; then
  CODE=0
else
  CODE=$?
fi
assert_exit "hotfix branch skips" 0 "$CODE"
assert_grep "hotfix skip message" 'Hotfix PR detected' "$OUT"
echo ""

echo "=== check-release-pr-scope.test.sh: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
