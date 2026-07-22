#!/usr/bin/env bash
# record-uat-execution.test.sh - Regression tests for the manual UAT execution helper.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/record-uat-execution.sh"
[ -x "$HELPER" ] || chmod +x "$HELPER"

PASS=0
FAIL=0

ok() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
no() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

make_fixture() {
  local dir="$1"
  rm -rf "$dir"
  mkdir -p "$dir/bin"
  cat > "$dir/bin/report-test-cycle.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
LOG_FILE="${UAT_TEST_LOG:?}"
printf 'CALL:%s\n' "$*" >> "$LOG_FILE"
mode="$1"
shift
out=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output-file) out="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [ -n "$out" ]; then
  {
    printf 'cycle_supported=true\n'
    printf 'cycle_record_id=cycle-%s\n' "$mode"
    printf 'cycle_idempotency_key=stub\n'
  } >> "$out"
fi
EOF
  chmod +x "$dir/bin/report-test-cycle.sh"
}

run_helper() {
  UAT_TEST_LOG="$1/uat.log" \
  DEVAUDIT_BASE_URL="https://devaudit.example.test" \
  DEVAUDIT_API_KEY="mc_test_dummy" \
  REPORT_TEST_CYCLE_HELPER="$1/bin/report-test-cycle.sh" \
  "$HELPER" "${@:2}"
}

assert_contains() {
  local label="$1" needle="$2" file="$3"
  if grep -Fq -- "$needle" "$file"; then ok "$label"; else no "$label"; fi
}

echo "=== record-uat-execution.sh tests ==="

case_passed_records_stage_four_pair() {
  echo "case: passed UAT records Stage 4 start and complete"
  local dir out exit_code
  dir=$(mktemp -d)
  make_fixture "$dir"
  out="$dir/out.env"
  run_helper "$dir" \
    --project-slug fixture-app \
    --release REQ-100 \
    --outcome passed \
    --executor "Jane Reviewer" \
    --tested-sha abc123def456 \
    --build-version build-42 \
    --checklist-ref compliance/evidence/REQ-100/uat-checklist.md \
    --evidence-ref https://devaudit.example.test/projects/fixture-app/releases/release-1 \
    --executed-at 2026-07-20T12:00:00Z \
    --output-file "$out" >"$dir/stdout.log" 2>"$dir/stderr.log" && exit_code=0 || exit_code=$?
  if [ "$exit_code" -eq 0 ]; then ok "exit code 0"; else no "expected exit 0"; fi
  assert_contains "called start" "CALL:start" "$dir/uat.log"
  assert_contains "called complete" "CALL:complete" "$dir/uat.log"
  assert_contains "stage 4" "--sdlc-stage 4" "$dir/uat.log"
  assert_contains "uat environment" "--environment uat" "$dir/uat.log"
  assert_contains "uat kind" "--cycle-kind uat" "$dir/uat.log"
  assert_contains "manual provider" "--provider manual_uat" "$dir/uat.log"
  assert_contains "tested sha" "--commit-sha abc123def456" "$dir/uat.log"
  assert_contains "passed outcome" "--outcome passed" "$dir/uat.log"
  assert_contains "executor provenance" "executor=Jane Reviewer" "$dir/uat.log"
  if grep -q '^uat_execution_id=' "$out"; then ok "output execution id"; else no "missing output execution id"; fi
  rm -rf "$dir"
}

case_idempotency_is_stable() {
  echo "case: derived execution id is stable for repeat command"
  local dir out1 out2 id1 id2
  dir=$(mktemp -d)
  make_fixture "$dir"
  out1="$dir/out1.env"
  out2="$dir/out2.env"
  run_helper "$dir" --project-slug fixture-app --release REQ-100 --outcome passed --executor "Jane Reviewer" --tested-sha abc123def456 --executed-at 2026-07-20T12:00:00Z --output-file "$out1" >/dev/null
  run_helper "$dir" --project-slug fixture-app --release REQ-100 --outcome passed --executor "Jane Reviewer" --tested-sha abc123def456 --executed-at 2026-07-20T13:00:00Z --output-file "$out2" >/dev/null
  id1=$(grep '^uat_idempotency_key=' "$out1")
  id2=$(grep '^uat_idempotency_key=' "$out2")
  if [ "$id1" = "$id2" ]; then ok "stable idempotency key"; else no "idempotency key changed"; fi
  rm -rf "$dir"
}

case_failed_records_remediation() {
  echo "case: failed UAT includes remediation reference"
  local dir
  dir=$(mktemp -d)
  make_fixture "$dir"
  run_helper "$dir" \
    --project-slug fixture-app \
    --release REQ-100 \
    --outcome failed \
    --executor "Jane Reviewer" \
    --tested-sha abc123def456 \
    --remediation-ref https://github.com/example/repo/issues/10 \
    >/dev/null
  assert_contains "failed outcome" "--outcome failed" "$dir/uat.log"
  assert_contains "incident reference" "--incident-reference https://github.com/example/repo/issues/10" "$dir/uat.log"
  rm -rf "$dir"
}

case_invalid_outcome_fails_before_calls() {
  echo "case: invalid outcome fails before lifecycle calls"
  local dir exit_code
  dir=$(mktemp -d)
  make_fixture "$dir"
  run_helper "$dir" --project-slug fixture-app --release REQ-100 --outcome green --executor Jane --tested-sha abc123 >/dev/null 2>"$dir/stderr.log" && exit_code=0 || exit_code=$?
  if [ "$exit_code" -ne 0 ]; then ok "exit code non-zero"; else no "expected non-zero"; fi
  if [ ! -f "$dir/uat.log" ]; then ok "no lifecycle call"; else no "unexpected lifecycle call"; fi
  rm -rf "$dir"
}

case_passed_records_stage_four_pair
case_idempotency_is_stable
case_failed_records_remediation
case_invalid_outcome_fails_before_calls

echo ""
echo "=== record-uat-execution.test.sh: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
