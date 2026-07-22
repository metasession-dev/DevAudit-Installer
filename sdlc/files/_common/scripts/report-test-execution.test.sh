#!/usr/bin/env bash
# report-test-execution.test.sh - Focused regression tests for the test execution lifecycle helper.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/report-test-execution.sh"
[ -x "$HELPER" ] || chmod +x "$HELPER"

PASS=0
FAIL=0

ok() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
no() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

make_fixture() {
  local dir="$1"
  rm -rf "$dir"
  mkdir -p "$dir/bin"
  cat > "$dir/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
LOG_FILE="${EXECUTION_TEST_LOG:?}"
URL=""
OUT_FILE=""
WRITE_OUT=""
BODY=""
ARGS=("$@")
for ((i=0; i<${#ARGS[@]}; i++)); do
  arg="${ARGS[$i]}"
  case "$arg" in
    -o) OUT_FILE="${ARGS[$((i+1))]}" ;;
    -w) WRITE_OUT="${ARGS[$((i+1))]}" ;;
    -d) BODY="${ARGS[$((i+1))]}" ;;
    http://*|https://*) URL="$arg" ;;
  esac
done
printf 'URL:%s\n' "$URL" >> "$LOG_FILE"
if [ -n "$BODY" ]; then
  printf 'BODY:%s\n' "$BODY" >> "$LOG_FILE"
fi

status=500
payload='{"error":"unhandled"}'
case "$URL" in
  *"/api/ci/releases/resolve"*)
    status="${RESOLVE_STATUS:-200}"
    payload="${RESOLVE_BODY:-{}}"
    ;;
  *"/cycles/start")
    status="${START_STATUS:-201}"
    payload="${START_BODY:-{}}"
    ;;
  *"/cycles/complete")
    status="${COMPLETE_STATUS:-200}"
    payload="${COMPLETE_BODY:-{}}"
    ;;
  *"/cycles/reconcile")
    status="${RECONCILE_STATUS:-200}"
    payload="${RECONCILE_BODY:-{}}"
    ;;
esac

if [ -n "$OUT_FILE" ]; then
  printf '%s' "$payload" > "$OUT_FILE"
fi
if [ -n "$WRITE_OUT" ]; then
  printf '%s' "$status"
fi
EOF
  chmod +x "$dir/bin/curl"
}

run_helper() {
  PATH="$1/bin:$PATH" \
  EXECUTION_TEST_LOG="$1/curl.log" \
  DEVAUDIT_BASE_URL="https://devaudit.example.test" \
  DEVAUDIT_API_KEY="mc_test_dummy" \
  "$HELPER" "${@:2}"
}

assert_contains() {
  local label="$1" needle="$2" file="$3"
  if grep -Fq -- "$needle" "$file"; then ok "$label"; else no "$label"; fi
}

echo "=== report-test-execution.sh tests ==="

case_start_success() {
  echo "case: start resolves exact release and records execution"
  local dir out exit_code
  dir=$(mktemp -d)
  make_fixture "$dir"
  out="$dir/out.env"
  RESOLVE_STATUS=200 \
  RESOLVE_BODY='{"latest":{"id":"release-1","version":"REQ-100"}}' \
  START_STATUS=201 \
  START_BODY='{"id":"execution-1"}' \
  run_helper "$dir" start \
    --project-slug fixture-app \
    --release REQ-100 \
    --sdlc-stage 2 \
    --environment uat \
    --suite-kind e2e \
    --iteration-key rework-1 \
    --iteration-ordinal 1 \
    --idempotency-key github:fixture/repo:feature-e2e.e2e:12345:1:2:REQ-100 \
    --output-file "$out" >"$dir/stdout.log" 2>"$dir/stderr.log" && exit_code=0 || exit_code=$?
  if [ "$exit_code" -eq 0 ]; then ok "exit code 0"; else no "expected exit 0"; fi
  assert_contains "outputs supported=true" "execution_supported=true" "$out"
  assert_contains "outputs execution_record_id" "execution_record_id=execution-1" "$out"
  assert_contains "called start endpoint" "/cycles/start" "$dir/curl.log"
  assert_contains "payload has suite kind" '"suiteKind": "e2e"' "$dir/curl.log"
  assert_contains "payload carries portal transport kind" '"cycleKind": "e2e"' "$dir/curl.log"
  assert_contains "payload has iteration key" '"iterationKey": "rework-1"' "$dir/curl.log"
  rm -rf "$dir"
}

case_complete_reconciles_terminal_conflict() {
  echo "case: complete falls back to reconcile on terminal-outcome conflict"
  local dir out exit_code
  dir=$(mktemp -d)
  make_fixture "$dir"
  out="$dir/out.env"
  RESOLVE_STATUS=200 \
  RESOLVE_BODY='{"latest":{"id":"release-1","version":"REQ-100"}}' \
  COMPLETE_STATUS=400 \
  COMPLETE_BODY='{"error":"Test execution already has a different terminal outcome; use reconcile"}' \
  RECONCILE_STATUS=200 \
  RECONCILE_BODY='{"id":"execution-1"}' \
  run_helper "$dir" complete \
    --project-slug fixture-app \
    --release REQ-100 \
    --sdlc-stage 2 \
    --environment uat \
    --suite-kind e2e \
    --idempotency-key github:fixture/repo:feature-e2e.e2e:12345:1:2:REQ-100 \
    --started-at 2026-07-16T10:00:00Z \
    --outcome failed \
    --output-file "$out" >"$dir/stdout.log" 2>"$dir/stderr.log" && exit_code=0 || exit_code=$?
  if [ "$exit_code" -eq 0 ]; then ok "exit code 0"; else no "expected exit 0"; fi
  assert_contains "called complete endpoint" "/cycles/complete" "$dir/curl.log"
  assert_contains "called reconcile endpoint" "/cycles/reconcile" "$dir/curl.log"
  assert_contains "outputs reconcile endpoint" "execution_endpoint=reconcile" "$out"
  rm -rf "$dir"
}

case_missing_release_fails() {
  echo "case: release resolve failure is not treated as successful fallback"
  local dir out exit_code
  dir=$(mktemp -d)
  make_fixture "$dir"
  out="$dir/out.env"
  RESOLVE_STATUS=404 \
  RESOLVE_BODY='{"error":"missing"}' \
  run_helper "$dir" start \
    --project-slug fixture-app \
    --release REQ-100 \
    --sdlc-stage 2 \
    --environment uat \
    --suite-kind e2e \
    --idempotency-key key \
    --output-file "$out" >"$dir/stdout.log" 2>"$dir/stderr.log" && exit_code=0 || exit_code=$?
  if [ "$exit_code" -ne 0 ]; then ok "exit code non-zero"; else no "expected non-zero"; fi
  if grep -q '/cycles/start' "$dir/curl.log"; then no "unexpected start endpoint call"; else ok "no start endpoint call"; fi
  rm -rf "$dir"
}

case_start_success
case_complete_reconciles_terminal_conflict
case_missing_release_fails

echo ""
echo "=== report-test-execution.test.sh: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
