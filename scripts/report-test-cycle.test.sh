#!/usr/bin/env bash
# report-test-cycle.test.sh — Focused regression tests for cycle lifecycle helper.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/report-test-cycle.sh"
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
LOG_FILE="${CYCLE_TEST_LOG:?}"
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
  CYCLE_TEST_LOG="$1/curl.log" \
  DEVAUDIT_BASE_URL="https://devaudit.example.test" \
  DEVAUDIT_API_KEY="mc_test_dummy" \
  "$HELPER" "${@:2}"
}

echo "=== report-test-cycle.sh tests ==="

case_start_success() {
  echo "case: start resolves exact release and records cycle"
  local dir out exit_code
  dir=$(mktemp -d)
  make_fixture "$dir"
  out="$dir/out.env"
  RESOLVE_STATUS=200 \
  RESOLVE_BODY='{"latest":{"id":"release-1","version":"REQ-100"}}' \
  START_STATUS=201 \
  START_BODY='{"id":"cycle-1"}' \
  run_helper "$dir" start \
    --project-slug fixture-app \
    --release REQ-100 \
    --sdlc-stage 2 \
    --environment uat \
    --cycle-kind e2e \
    --idempotency-key github:fixture/repo:feature-e2e.e2e:12345:1:2:REQ-100 \
    --output-file "$out" >"$dir/stdout.log" 2>"$dir/stderr.log" && exit_code=0 || exit_code=$?
  if [ "$exit_code" -eq 0 ]; then ok "exit code 0"; else no "expected exit 0"; fi
  if grep -q '^cycle_supported=true$' "$out"; then ok "outputs supported=true"; else no "missing supported=true"; fi
  if grep -q '^cycle_record_id=cycle-1$' "$out"; then ok "outputs cycle_record_id"; else no "missing cycle_record_id"; fi
  if grep -q '/cycles/start' "$dir/curl.log"; then ok "called start endpoint"; else no "missing start endpoint"; fi
  rm -rf "$dir"
}

case_ambiguous_release_falls_back() {
  echo "case: ambiguous release resolve falls back without cycle endpoint call"
  local dir out exit_code
  dir=$(mktemp -d)
  make_fixture "$dir"
  out="$dir/out.env"
  RESOLVE_STATUS=200 \
  RESOLVE_BODY='{"latest":{"id":"release-1","version":"REQ-999"}}' \
  run_helper "$dir" start \
    --project-slug fixture-app \
    --release REQ-100 \
    --sdlc-stage 2 \
    --environment uat \
    --cycle-kind e2e \
    --idempotency-key github:fixture/repo:feature-e2e.e2e:12345:1:2:REQ-100 \
    --output-file "$out" >"$dir/stdout.log" 2>"$dir/stderr.log" && exit_code=0 || exit_code=$?
  if [ "$exit_code" -eq 0 ]; then ok "exit code 0"; else no "expected exit 0"; fi
  if grep -q '^cycle_supported=false$' "$out"; then ok "outputs supported=false"; else no "missing supported=false"; fi
  if grep -q '/cycles/start' "$dir/curl.log"; then no "unexpected start endpoint call"; else ok "no start endpoint call"; fi
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
  COMPLETE_BODY='{"error":"Test cycle already has a different terminal outcome; use reconcile"}' \
  RECONCILE_STATUS=200 \
  RECONCILE_BODY='{"id":"cycle-1"}' \
  run_helper "$dir" complete \
    --project-slug fixture-app \
    --release REQ-100 \
    --sdlc-stage 2 \
    --environment uat \
    --cycle-kind e2e \
    --idempotency-key github:fixture/repo:feature-e2e.e2e:12345:1:2:REQ-100 \
    --started-at 2026-07-16T10:00:00Z \
    --outcome failed \
    --output-file "$out" >"$dir/stdout.log" 2>"$dir/stderr.log" && exit_code=0 || exit_code=$?
  if [ "$exit_code" -eq 0 ]; then ok "exit code 0"; else no "expected exit 0"; fi
  if grep -q '/cycles/complete' "$dir/curl.log"; then ok "called complete endpoint"; else no "missing complete endpoint"; fi
  if grep -q '/cycles/reconcile' "$dir/curl.log"; then ok "called reconcile endpoint"; else no "missing reconcile endpoint"; fi
  if grep -q '^cycle_endpoint=reconcile$' "$out"; then ok "outputs reconcile endpoint"; else no "missing reconcile endpoint output"; fi
  rm -rf "$dir"
}

case_start_success
case_ambiguous_release_falls_back
case_complete_reconciles_terminal_conflict

echo ""
echo "=== report-test-cycle.test.sh: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
