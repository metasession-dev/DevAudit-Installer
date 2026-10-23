#!/usr/bin/env bash
# e2e-release-gate.test.sh — tests for e2e-release-gate.sh (devaudit-installer#1059).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# the script finds report-release-check.sh next to itself: use a stub copy
mkdir -p "$WORK/scripts"
cp "$SCRIPT_DIR/e2e-release-gate.sh" "$WORK/scripts/"
cat > "$WORK/scripts/report-release-check.sh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$STUB_OUT"
EOF
HELPER="$WORK/scripts/e2e-release-gate.sh"

PASS=0
FAIL=0

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

meta() { printf '{"project":"x","tier":"%s"}' "$1" > "$WORK/meta.json"; echo "$WORK/meta.json"; }

echo "resolve"
assert_eq "pull_request with a recorded full tier" "full full" "$(bash "$HELPER" resolve pull_request critical "$(meta full)")"
assert_eq "pull_request with a recorded smoke tier" "smoke smoke" "$(bash "$HELPER" resolve pull_request critical "$(meta smoke)")"
assert_eq "pull_request with a recorded critical tier" "critical critical" "$(bash "$HELPER" resolve pull_request critical "$(meta critical)")"
assert_eq "an unknown recorded tier is ignored" "critical " "$(bash "$HELPER" resolve pull_request critical "$(meta weird)")"
assert_eq "no tier recorded keeps the event mapping" "critical " "$(printf '{"project":"x"}' > "$WORK/none.json"; bash "$HELPER" resolve pull_request critical "$WORK/none.json")"
assert_eq "a missing metadata file keeps the event mapping" "critical " "$(bash "$HELPER" resolve pull_request critical "$WORK/missing.json")"
assert_eq "a deployment_status run ignores the recorded tier" "regression " "$(bash "$HELPER" resolve deployment_status regression "$(meta full)")"
assert_eq "an unreadable metadata file is ignored" "critical " "$(echo 'not json' > "$WORK/bad.json"; bash "$HELPER" resolve pull_request critical "$WORK/bad.json")"

echo "report"
report() {
  export STUB_OUT="$WORK/args.txt"
  rm -f "$STUB_OUT"
  E2E_CONCLUSION="$1" E2E_HEAD_SHA=abc123 E2E_RUN_ID=77 E2E_RUN_URL=https://example.test/run/77 \
    E2E_RUN_STARTED_AT=2026-10-20T10:00:00Z E2E_RUN_UPDATED_AT=2026-10-20T10:30:00Z \
    bash "$HELPER" report my-project v1.2.3 full feature/x "${2:-}"
}
arg() { grep -A1 -x -- "$1" "$WORK/args.txt" | tail -1; }

report success
assert_eq "stable check key" "e2e-release-gate" "$(arg --check-key)"
assert_eq "label names the tier" "E2E Release Gate (full)" "$(arg --label)"
assert_eq "required" "true" "$(arg --required)"
assert_eq "success is successful" "successful" "$(arg --status)"
assert_eq "details carry the tier and the head sha" '{"tier":"full","headSha":"abc123"}' "$(arg --details-json)"
assert_eq "release and project" "v1.2.3 my-project" "$(arg --release) $(arg --project-slug)"
assert_eq "run id, url and branch" "77 https://example.test/run/77 feature/x" "$(arg --external-run-id) $(arg --external-url) $(arg --branch)"
report failure
assert_eq "failure is failed" "failed" "$(arg --status)"
report cancelled
assert_eq "cancelled" "cancelled" "$(arg --status)"
report failure timed_out
assert_eq "a recorded timeout wins" "timed_out" "$(arg --status)"
report neutral
assert_eq "anything else is unknown" "unknown" "$(arg --status)"

echo "usage"
set +e
(bash "$HELPER" bogus >/dev/null 2>&1); assert_eq "unknown command exits 2" "2" "$?"
(bash "$HELPER" >/dev/null 2>&1); assert_eq "no command exits 2" "2" "$?"
set -e

echo ""
echo "Passed: $PASS  Failed: $FAIL"
[ "$FAIL" -eq 0 ]
