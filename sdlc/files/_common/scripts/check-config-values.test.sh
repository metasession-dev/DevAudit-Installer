#!/usr/bin/env bash
# check-config-values.test.sh — tests for check-config-values.sh (DevAudit-Installer#1160).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$SCRIPT_DIR/check-config-values.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  PASS: $desc"; PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"; echo "    expected: $expected"; echo "    actual:   $actual"; FAIL=$((FAIL + 1))
  fi
}
assert_contains() {
  local desc="$1" needle="$2"
  if grep -qF -- "$needle" "$WORK/out"; then
    echo "  PASS: $desc"; PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"; echo "    missing: $needle"; sed 's/^/    out: /' "$WORK/out"; FAIL=$((FAIL + 1))
  fi
}
assert_not_contains() {
  local desc="$1" needle="$2"
  if grep -qF -- "$needle" "$WORK/out"; then
    echo "  FAIL: $desc"; echo "    found: $needle"; FAIL=$((FAIL + 1))
  else
    echo "  PASS: $desc"; PASS=$((PASS + 1))
  fi
}
run() { # run <args...>; prints the exit code, output to $WORK/out
  ( bash "$SCRIPT" "$@" > "$WORK/out" 2>&1 ) && echo 0 || echo $?
}

echo "nothing named"
assert_eq "no arguments: exit 0" 0 "$(run)"

echo "values present"
export PRESENT_ONE="a-secret-value-1" PRESENT_TWO="x"
assert_eq "set values: exit 0" 0 "$(run 'e2e_env.PRESENT_ONE=secrets.PRESENT_ONE' 'e2e_env.PRESENT_TWO=vars.OTHER_NAME')"
assert_eq "set values: prints nothing" "" "$(cat "$WORK/out")"

echo "an empty value"
unset EMPTY_KEY 2>/dev/null || true
export EMPTY_SET=""
assert_eq "unset variable: exit 1" 1 "$(run 'e2e_env.EMPTY_KEY=secrets.SUPABASE_SECRET_KEY')"
assert_contains "names the map and the variable" "e2e_env.EMPTY_KEY is empty"
assert_contains "names the secret" 'the secret `SUPABASE_SECRET_KEY`'
assert_contains "points at repository secrets" "Repository secrets"
assert_contains "mentions environments" "only in an environment"
assert_eq "empty string: exit 1" 1 "$(run 'app_env.EMPTY_SET=vars.SOME_VARIABLE')"
assert_contains "a variable reference names the variable" 'the variable `SOME_VARIABLE`'
assert_contains "points at variables" "Actions > Variables"

echo "every empty value is reported, set ones are not"
assert_eq "mixed: exit 1" 1 "$(run 'e2e_env.PRESENT_ONE=secrets.PRESENT_ONE' 'e2e_env.MISSING_A=secrets.A' 'e2e_env.MISSING_B=secrets.B')"
assert_contains "first missing" "e2e_env.MISSING_A is empty"
assert_contains "second missing" "e2e_env.MISSING_B is empty"
assert_not_contains "present value not reported" "PRESENT_ONE is empty"

echo "a value is never printed"
assert_eq "present secret: exit 0" 0 "$(run 'e2e_env.PRESENT_ONE=secrets.PRESENT_ONE')"
assert_not_contains "no value in the output" "a-secret-value-1"

echo "the step summary"
export GITHUB_STEP_SUMMARY="$WORK/summary.md"
: > "$GITHUB_STEP_SUMMARY"
run 'e2e_env.MISSING_A=secrets.A' > /dev/null
assert_eq "summary written when something is empty" 1 "$(grep -c 'e2e_env.MISSING_A' "$GITHUB_STEP_SUMMARY")"
: > "$GITHUB_STEP_SUMMARY"
run 'e2e_env.PRESENT_ONE=secrets.PRESENT_ONE' > /dev/null
assert_eq "no summary when all set" "" "$(cat "$GITHUB_STEP_SUMMARY")"
unset GITHUB_STEP_SUMMARY

echo "bad usage"
assert_eq "no '=' in the argument: exit 2" 2 "$(run 'e2e_env.PRESENT_ONE')"
assert_eq "not a variable name: exit 2" 2 "$(run 'e2e_env.BAD-NAME=secrets.X')"

echo
echo "check-config-values.test.sh: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
