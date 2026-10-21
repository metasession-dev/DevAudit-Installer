#!/usr/bin/env bash
# run-test-tier.test.sh — tests for run-test-tier.sh (devaudit-installer#1060).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/run-test-tier.sh"
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

# run_dry <config-json|-> <args...> — print the command the script would run
run_dry() {
  local cfg="$1"
  shift
  local dir="$WORK/run-$RANDOM"
  mkdir -p "$dir"
  if [ "$cfg" != "-" ]; then printf '%s' "$cfg" > "$dir/sdlc-config.json"; fi
  (cd "$dir" && SDLC_CONFIG="" GITHUB_WORKSPACE="$dir" RUN_TEST_TIER_DRY_RUN=1 bash "$HELPER" "$@" 2>/dev/null)
}

echo "Playwright defaults (no keys set) match what the workflows ran before"
assert_eq "smoke uses e2e_project" \
  "npx playwright test --project=chromium --reporter=json,html" \
  "$(run_dry '{"e2e_project":"chromium"}' smoke)"
assert_eq "full uses the regression project" \
  "npx playwright test --project=regression --reporter=json,html" \
  "$(run_dry '{}' full)"
assert_eq "regression is an alias of full" \
  "npx playwright test --project=regression --reporter=json,html" \
  "$(run_dry '{}' regression)"
assert_eq "feature greps the requirement" \
  'npx playwright test --grep "REQ-042" --reporter=json,html' \
  "$(run_dry '{}' feature REQ-042)"
assert_eq "no config file at all still resolves" \
  "npx playwright test --project=regression --reporter=json,html" \
  "$(run_dry - full)"

echo "critical falls back to smoke without a critical project"
assert_eq "no playwright config -> smoke project" \
  "npx playwright test --project=smoke --reporter=json,html" \
  "$(run_dry '{}' critical)"
dir="$WORK/with-critical"
mkdir -p "$dir"
printf '{}' > "$dir/sdlc-config.json"
printf "export default { projects: [{ name: 'critical' }] };\n" > "$dir/playwright.config.ts"
assert_eq "a critical project is used" \
  "npx playwright test --project=critical --reporter=json,html" \
  "$(cd "$dir" && GITHUB_WORKSPACE="$dir" RUN_TEST_TIER_DRY_RUN=1 bash "$HELPER" critical 2>/dev/null)"

echo "pytest defaults"
P='{"test_runner":"pytest"}'
assert_eq "smoke" "pytest -m smoke --junit-xml=junit.xml" "$(run_dry "$P" smoke)"
assert_eq "critical" 'pytest -m "smoke or critical" --junit-xml=junit.xml' "$(run_dry "$P" critical)"
assert_eq "full" "pytest --junit-xml=junit.xml" "$(run_dry "$P" full)"
# the pytest feature scope runs the files that mention the id, wherever in the file
fdir="$WORK/pyfeature"
mkdir -p "$fdir/tests/api"
printf '%s' "$P" > "$fdir/sdlc-config.json"
printf '# [REQ-042][AC1] health endpoint answers 200\ndef test_health(): pass\n' > "$fdir/tests/api/test_health.py"
printf '# covers REQ-0421 only\ndef test_other(): pass\n' > "$fdir/tests/test_other.py"
printf '# REQ-042\ndef test_two(): pass\n' > "$fdir/tests/test_two.py"
printf '# REQ-042\n' > "$fdir/tests/notes.txt"
assert_eq "feature runs the files that mention the id (not REQ-0421, not non-python files)" \
  "pytest tests/api/test_health.py tests/test_two.py --junit-xml=junit.xml" \
  "$(cd "$fdir" && GITHUB_WORKSPACE="$fdir" RUN_TEST_TIER_DRY_RUN=1 bash "$HELPER" feature REQ-042 2>/dev/null)"
assert_eq "REQ-04 does not match REQ-042 or REQ-0421" "exit 5" \
  "$(cd "$fdir" && GITHUB_WORKSPACE="$fdir" RUN_TEST_TIER_DRY_RUN=1 bash "$HELPER" feature REQ-04 2>/dev/null)"
assert_eq "no match is exit 5, never a full run" "5" \
  "$(cd "$fdir" && GITHUB_WORKSPACE="$fdir" bash "$HELPER" feature REQ-999 >/dev/null 2>&1; echo $?)"
printf '# REQ-042\n' > "$fdir/tests/test with space.py"
assert_eq "a path with a space is quoted" "pytest tests/api/test_health.py tests/test\\ with\\ space.py tests/test_two.py --junit-xml=junit.xml" \
  "$(cd "$fdir" && GITHUB_WORKSPACE="$fdir" RUN_TEST_TIER_DRY_RUN=1 bash "$HELPER" feature REQ-042 2>/dev/null)"
dir="$WORK/junit"
mkdir -p "$dir"
printf '%s' "$P" > "$dir/sdlc-config.json"
assert_eq "TEST_JUNIT_XML sets the output path" \
  "pytest --junit-xml=out/r.xml" \
  "$(cd "$dir" && GITHUB_WORKSPACE="$dir" TEST_JUNIT_XML=out/r.xml RUN_TEST_TIER_DRY_RUN=1 bash "$HELPER" full 2>/dev/null)"

echo "a key set replaces the default"
assert_eq "test_tier_smoke" "make smoke" "$(run_dry '{"test_tier_smoke":"make smoke","e2e_project":"x"}' smoke)"
assert_eq "test_tier_critical" "make crit" "$(run_dry '{"test_tier_critical":"make crit"}' critical)"
assert_eq "test_tier_full beats test_runner" "make all" "$(run_dry '{"test_runner":"pytest","test_tier_full":"make all"}' full)"
assert_eq "{REQ} is substituted" "jest -t REQ-7" "$(run_dry '{"test_feature_command":"jest -t {REQ}"}' feature REQ-7)"
assert_eq "{REQ} is substituted in every position" "a REQ-7 b REQ-7" "$(run_dry '{"test_feature_command":"a {REQ} b {REQ}"}' feature REQ-7)"

echo "errors"
set +e
(cd "$WORK" && bash "$HELPER" bogus >/dev/null 2>&1); assert_eq "unknown tier exits 2" "2" "$?"
(cd "$WORK" && bash "$HELPER" feature >/dev/null 2>&1); assert_eq "feature without a REQ exits 2" "2" "$?"
(cd "$WORK" && bash "$HELPER" feature 'REQ-1; rm -rf /' >/dev/null 2>&1); assert_eq "unsafe REQ id exits 2" "2" "$?"
dir="$WORK/badrunner"
mkdir -p "$dir"
printf '{"test_runner":"mocha"}' > "$dir/sdlc-config.json"
(cd "$dir" && GITHUB_WORKSPACE="$dir" bash "$HELPER" full >/dev/null 2>&1); assert_eq "unknown test_runner exits 2" "2" "$?"

echo "exit code passes through"
dir="$WORK/exit"
mkdir -p "$dir"
printf '{"test_tier_smoke":"exit 3","test_tier_full":"true"}' > "$dir/sdlc-config.json"
(cd "$dir" && GITHUB_WORKSPACE="$dir" bash "$HELPER" smoke >/dev/null 2>&1); assert_eq "failing command" "3" "$?"
(cd "$dir" && GITHUB_WORKSPACE="$dir" bash "$HELPER" full >/dev/null 2>&1); assert_eq "passing command" "0" "$?"
set -e

echo ""
echo "Passed: $PASS  Failed: $FAIL"
[ "$FAIL" -eq 0 ]
