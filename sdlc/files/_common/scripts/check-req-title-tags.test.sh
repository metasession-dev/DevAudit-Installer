#!/usr/bin/env bash
# check-req-title-tags.test.sh — tests for check-req-title-tags.sh (devaudit-installer#1095).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/check-req-title-tags.sh"
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

assert_contains() {
  local desc="$1" needle="$2" haystack="$3"
  if printf '%s' "$haystack" | grep -qF -- "$needle"; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    echo "    expected to contain: $needle"
    echo "    actual: $haystack"
    FAIL=$((FAIL + 1))
  fi
}

# project <name> <spec-body> — a project dir with e2e/a.spec.ts holding <spec-body>
project() {
  local dir="$WORK/$1"
  mkdir -p "$dir/e2e"
  printf '%s\n' "$2" > "$dir/e2e/a.spec.ts"
  echo "$dir"
}

# run_in <dir> <args...> — prints "<exit-code>|<stdout>"
run_in() {
  local dir="$1"
  shift
  local out rc
  set +e
  out="$(cd "$dir" && bash "$HELPER" "$@" 2>/dev/null)"
  rc=$?
  set -e
  printf '%s|%s' "$rc" "$out"
}

echo "=== check-req-title-tags.sh tests ==="

echo "1. an annotation-only test (id in neither the title nor a describe) is reported with file and line"
D="$(project t1 "import { test } from '@playwright/test';
import { tagTest } from './helpers/test-tags';
test.describe('staff flow', () => {
  test('[US-01.3] AC2 - approves an order', async ({ page }) => {
    tagTest('REQ-7', 2);
  });
});")"
R="$(run_in "$D")"
assert_eq "exit 1" "1" "${R%%|*}"
assert_contains "names file:line and the call" "e2e/a.spec.ts:5: tagTest('REQ-7', 2) but neither the test title nor a describe contains REQ-7" "${R#*|}"

echo "2. adding [REQ-7][AC2] to the title makes it pass"
D="$(project t2 "test.describe('staff flow', () => {
  test('[REQ-7][AC2] approves an order', async ({ page }) => {
    tagTest('REQ-7', 2);
  });
});")"
R="$(run_in "$D")"
assert_eq "exit 0" "0" "${R%%|*}"

echo "3. the id in an enclosing describe is enough"
D="$(project t3 "test.describe('[REQ-7] staff flow', () => {
  test('approves an order', async ({ page }) => {
    tagTest('REQ-7', 1);
  });
});")"
assert_eq "exit 0" "0" "$(run_in "$D" | cut -d'|' -f1)"

echo "4. exact id: REQ-11 does not satisfy REQ-111, and the reverse"
D="$(project t4a "test('[REQ-11][AC1] x', async () => {
  tagTest('REQ-111', 1);
});")"
assert_eq "REQ-11 title, REQ-111 tag -> exit 1" "1" "$(run_in "$D" | cut -d'|' -f1)"
D="$(project t4b "test('[REQ-111][AC1] x', async () => {
  tagTest('REQ-11', 1);
});")"
assert_eq "REQ-111 title, REQ-11 tag -> exit 1" "1" "$(run_in "$D" | cut -d'|' -f1)"

echo "5. a describe that has closed does not cover a later test"
D="$(project t5 "test.describe('[REQ-7] first', () => {
  test('a', async () => {
    tagTest('REQ-7', 1);
  });
});
test('b without the id', async () => {
  tagTest('REQ-7', 2);
});")"
R="$(run_in "$D")"
assert_eq "exit 1" "1" "${R%%|*}"
assert_contains "reports the later test (line 7)" "e2e/a.spec.ts:7:" "${R#*|}"

echo "6. destructured fixtures and a multi-line signature are handled"
D="$(project t6 "test(
  '[REQ-7][AC1] multi-line',
  async ({ page, request }) => {
    tagTest('REQ-7', [1, 2]);
  },
);
test('[REQ-7][AC3] single line', async ({ page }) => { tagTest('REQ-7', 3); });")"
assert_eq "exit 0" "0" "$(run_in "$D" | cut -d'|' -f1)"

echo "7. braces inside strings and comments do not break scope tracking"
D="$(project t7 "test.describe('[REQ-7] shapes', () => {
  // an unmatched { in a comment
  test('a', async () => {
    const s = '}}}';
    tagTest('REQ-7', 1);
  });
});
test('later, no id', async () => {
  tagTest('REQ-7', 2);
});")"
R="$(run_in "$D")"
assert_eq "exit 1" "1" "${R%%|*}"
assert_contains "only the later test is reported" "e2e/a.spec.ts:9:" "${R#*|}"

echo "8. --req limits the check to one requirement"
D="$(project t8 "test('[REQ-7][AC1] ok', async () => { tagTest('REQ-7', 1); });
test('no id here', async () => { tagTest('REQ-8', 1); });")"
assert_eq "all -> exit 1" "1" "$(run_in "$D" | cut -d'|' -f1)"
assert_eq "--req REQ-7 -> exit 0" "0" "$(run_in "$D" --req REQ-7 | cut -d'|' -f1)"
assert_eq "--req REQ-8 -> exit 1" "1" "$(run_in "$D" --req REQ-8 | cut -d'|' -f1)"

echo "9. tests/e2e is checked too, and node_modules is skipped"
mkdir -p "$WORK/t9/tests/e2e" "$WORK/t9/e2e/node_modules/x"
printf '%s\n' "test('no id', async () => { tagTest('REQ-9', 1); });" > "$WORK/t9/tests/e2e/b.spec.ts"
printf '%s\n' "test('no id', async () => { tagTest('REQ-9', 1); });" > "$WORK/t9/e2e/node_modules/x/c.spec.ts"
R="$(run_in "$WORK/t9")"
assert_eq "exit 1" "1" "${R%%|*}"
assert_contains "reports tests/e2e/b.spec.ts" "tests/e2e/b.spec.ts:1:" "${R#*|}"
if printf '%s' "${R#*|}" | grep -q node_modules; then
  echo "  FAIL: node_modules was scanned"; FAIL=$((FAIL + 1))
else
  echo "  PASS: node_modules not scanned"; PASS=$((PASS + 1))
fi

echo "10. no e2e directory: nothing to check, exit 0; usage errors exit 2"
mkdir -p "$WORK/empty"
assert_eq "no e2e dir -> exit 0" "0" "$(run_in "$WORK/empty" | cut -d'|' -f1)"
assert_eq "bad --req -> exit 2" "2" "$(run_in "$WORK/empty" --req nope | cut -d'|' -f1)"
assert_eq "unknown flag -> exit 2" "2" "$(run_in "$WORK/empty" --bogus | cut -d'|' -f1)"

echo "11. a spec with no tagTest() calls is fine"
D="$(project t11 "test('plain', async () => { expect(1).toBe(1); });")"
assert_eq "exit 0" "0" "$(run_in "$D" | cut -d'|' -f1)"

echo ""
echo "=== check-req-title-tags.test.sh: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
