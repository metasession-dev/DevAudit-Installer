#!/usr/bin/env bash
# is-transport-layer-req.test.sh — tests for is-transport-layer-req.sh (devaudit-installer#1067).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/is-transport-layer-req.sh"
[ -x "$HELPER" ] || chmod +x "$HELPER"

PASS=0
FAIL=0
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    echo "    expected: $expected"
    echo "    actual:   $actual"
    FAIL=$((FAIL + 1))
  fi
}

# run <dir> <args...> — exit code of the helper run from <dir>
run() {
  local dir="$1"
  shift
  set +e
  (cd "$dir" && bash "$HELPER" "$@" >/dev/null 2>&1)
  local rc=$?
  set -e
  echo "$rc"
}

mkrepo() {
  local dir="$WORK/$1"
  mkdir -p "$dir/e2e" "$dir/tests/e2e"
  echo "$dir"
}

echo "transport-layer only"
d="$(mkrepo transport)"
cat > "$d/e2e/webhook.spec.ts" <<'EOF'
import { test, expect } from '@playwright/test';
test('inbound webhook registers the template', async ({ request }) => {
  // @requirement REQ-111
  const res = await request.post('/api/webhooks/whatsapp', { data: {} });
  expect(res.ok()).toBeTruthy();
});
EOF
assert_eq "a REQ whose only spec uses request, not page, is exempt" "0" "$(run "$d" REQ-111)"

echo "UI specs keep the gate on"
d="$(mkrepo ui)"
cat > "$d/e2e/login.spec.ts" <<'EOF'
test('login', async ({ page }) => {
  // @requirement REQ-064
  await page.goto('/login');
});
EOF
assert_eq "destructured page fixture" "1" "$(run "$d" REQ-064)"
cat > "$d/e2e/mixed-api.spec.ts" <<'EOF'
test('api', async ({ request }) => {
  // @requirement REQ-070
});
EOF
cat > "$d/e2e/mixed-ui.spec.ts" <<'EOF'
test('ui', async (fixtures) => {
  // @requirement REQ-070
  await fixtures.page.goto('/');
  const p = page.locator('x');
});
EOF
assert_eq "one UI spec among transport specs keeps the gate" "1" "$(run "$d" REQ-070)"

echo "no tagged spec"
d="$(mkrepo none)"
printf "test('x', async ({ request }) => {});\n" > "$d/e2e/untagged.spec.ts"
assert_eq "an untagged spec is not an exemption" "1" "$(run "$d" REQ-111)"
assert_eq "a missing spec dir is not an exemption" "1" "$(run "$WORK" REQ-111 does-not-exist)"

echo "tag matching"
d="$(mkrepo prefix)"
printf "// @requirement REQ-111\ntest('x', async ({ request }) => {});\n" > "$d/e2e/a.spec.ts"
assert_eq "REQ-11 does not match a spec tagged REQ-111" "1" "$(run "$d" REQ-11)"
assert_eq "REQ-111 matches" "0" "$(run "$d" REQ-111)"
printf "test('x', async ({ request }) => {});\n// @requirement REQ-5 ok\n" > "$d/tests/e2e/b.spec.ts"
assert_eq "tests/e2e is searched too" "0" "$(run "$d" REQ-5)"
assert_eq "an explicit spec dir is honoured" "0" "$(run "$d" REQ-5 tests/e2e)"
assert_eq "an explicit spec dir excludes the others" "1" "$(run "$d" REQ-111 tests/e2e)"

echo "usage"
assert_eq "no argument" "2" "$(run "$WORK")"
assert_eq "a non-REQ argument" "2" "$(run "$WORK" 'REQ-1; echo')"

echo ""
echo "Passed: $PASS  Failed: $FAIL"
[ "$FAIL" -eq 0 ]
