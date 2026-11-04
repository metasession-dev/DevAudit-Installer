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
  *"/resolve")
    status="${RESOLVE_CYCLE_STATUS:-200}"
    payload="${RESOLVE_CYCLE_BODY:-{}}"
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

valid_record() { # <file>
  cat > "$1" <<'REC'
---
record_kind: "accepted_e2e_failure"
req: "REQ-108"
release: "REQ-108"
failing_specs:
  - "e2e/critical/example.spec.ts"
ci_run: "https://github.com/acme/app/actions/runs/1"
head_sha: "389bf6f0000000000000000000000000000000aa"
classification: "flake"
decision_maker: "A. Operator"
decided_at: "2026-10-15"
review_by: "2099-01-01"
tracking_issue: "https://github.com/acme/app/issues/852"
---

## Failure

| Spec | Test | CI run / attempt | Error excerpt |
| --- | --- | --- | --- |
| example | t | 1/1 | x |

## Evidence of classification

Re-run five times, all pass.

## Impact assessment

No user-visible journey affected.

## Why this does not block this release

Unrelated to the change.

## Remediation

Tracked in the issue above.
REC
}

case_resolve_success() {
  echo "case: resolve calls the cycle-resolution endpoint with the excusing payload"
  local dir out exit_code
  dir=$(mktemp -d)
  make_fixture "$dir"
  out="$dir/out.env"
  valid_record "$dir/record.md"
  RESOLVE_STATUS=200 \
  RESOLVE_BODY='{"latest":{"id":"release-1","version":"REQ-108"}}' \
  RESOLVE_CYCLE_STATUS=200 \
  RESOLVE_CYCLE_BODY='{"id":"cycle-1","resolution_type":"accepted_exception"}' \
  run_helper "$dir" resolve \
    --project-slug example-app \
    --release REQ-108 \
    --test-cycle-id cycle-1 \
    --resolution-type accepted_exception \
    --reason "unrelated pre-existing defect example-org/example-app#852" \
    --remediation-reference https://github.com/acme/app/issues/852 \
    --record "$dir/record.md" \
    --output-file "$out" >"$dir/stdout.log" 2>"$dir/stderr.log" && exit_code=0 || exit_code=$?
  if [ "$exit_code" -eq 0 ]; then ok "exit code 0"; else no "expected exit 0"; fi
  assert_contains "called resolve endpoint" "/cycles/cycle-1/resolve" "$dir/curl.log"
  assert_contains "payload has resolutionType" '"resolutionType": "accepted_exception"' "$dir/curl.log"
  assert_contains "payload has reason referencing the record" '(record: ' "$dir/curl.log"
  assert_contains "payload has remediationReference" '"remediationReference": "https://github.com/acme/app/issues/852"' "$dir/curl.log"
  assert_contains "outputs resolve endpoint" "execution_endpoint=resolve" "$out"
  rm -rf "$dir"
}

case_accepted_exception_requires_tracking_issue_and_record() {
  echo "case: accepted_exception without --remediation-reference or --record fails before any network call (#1016)"
  local dir exit_code
  dir=$(mktemp -d)
  make_fixture "$dir"
  valid_record "$dir/record.md"
  run_helper "$dir" resolve --project-slug example-app --release REQ-108 --test-cycle-id cycle-1 \
    --resolution-type accepted_exception --reason "flake" --record "$dir/record.md" \
    >"$dir/stdout.log" 2>"$dir/stderr.log" && exit_code=0 || exit_code=$?
  if [ "$exit_code" -ne 0 ]; then ok "no tracking issue: non-zero"; else no "expected non-zero without --remediation-reference"; fi
  assert_contains "error names --remediation-reference" "--remediation-reference" "$dir/stderr.log"
  run_helper "$dir" resolve --project-slug example-app --release REQ-108 --test-cycle-id cycle-1 \
    --resolution-type accepted_exception --reason "flake" --remediation-reference https://github.com/acme/app/issues/852 \
    >"$dir/stdout.log" 2>"$dir/stderr.log" && exit_code=0 || exit_code=$?
  if [ "$exit_code" -ne 0 ]; then ok "no record: non-zero"; else no "expected non-zero without --record"; fi
  assert_contains "error names --record" "--record" "$dir/stderr.log"
  rm -rf "$dir"
}

case_accepted_exception_rejects_incomplete_record() {
  echo "case: accepted_exception with an unedited/expired record fails validation (#1016)"
  local dir exit_code
  dir=$(mktemp -d)
  make_fixture "$dir"
  valid_record "$dir/record.md"
  sed 's/review_by: "2099-01-01"/review_by: "2020-01-01"/' "$dir/record.md" > "$dir/expired.md"
  run_helper "$dir" resolve --project-slug example-app --release REQ-108 --test-cycle-id cycle-1 \
    --resolution-type accepted_exception --reason "flake" --remediation-reference https://github.com/acme/app/issues/852 \
    --record "$dir/expired.md" >"$dir/stdout.log" 2>"$dir/stderr.log" && exit_code=0 || exit_code=$?
  if [ "$exit_code" -ne 0 ]; then ok "expired record: non-zero"; else no "expected non-zero for an expired record"; fi
  assert_contains "error says the review date is not in the future" "not in the future" "$dir/stderr.log"
  if [ -e "$dir/curl.log" ] && grep -q "/resolve" "$dir/curl.log"; then no "must not call the portal with an invalid record"; else ok "no portal call was made"; fi
  rm -rf "$dir"
}

case_retry_passed_needs_no_record() {
  echo "case: retry_passed (a verified re-run) does not need a record (#1016)"
  local dir exit_code
  dir=$(mktemp -d)
  make_fixture "$dir"
  RESOLVE_STATUS=200 \
  RESOLVE_BODY='{"latest":{"id":"release-1","version":"REQ-108"}}' \
  RESOLVE_CYCLE_STATUS=200 \
  RESOLVE_CYCLE_BODY='{"id":"cycle-1"}' \
  run_helper "$dir" resolve --project-slug example-app --release REQ-108 --test-cycle-id cycle-1 \
    --resolution-type retry_passed --resolved-by-cycle-id cycle-2 --reason "re-run passed on the same SHA" \
    >"$dir/stdout.log" 2>"$dir/stderr.log" && exit_code=0 || exit_code=$?
  if [ "$exit_code" -eq 0 ]; then ok "retry_passed succeeds without a record"; else no "expected exit 0"; fi
  rm -rf "$dir"
}

case_resolve_requires_reason() {
  echo "case: resolve without --reason fails before any network call"
  local dir exit_code
  dir=$(mktemp -d)
  make_fixture "$dir"
  RESOLVE_STATUS=200 \
  RESOLVE_BODY='{"latest":{"id":"release-1","version":"REQ-108"}}' \
  run_helper "$dir" resolve \
    --project-slug example-app \
    --release REQ-108 \
    --test-cycle-id cycle-1 \
    --resolution-type accepted_exception \
    >"$dir/stdout.log" 2>"$dir/stderr.log" && exit_code=0 || exit_code=$?
  if [ "$exit_code" -ne 0 ]; then ok "exit code non-zero"; else no "expected non-zero"; fi
  assert_contains "error names --reason" "--reason is required" "$dir/stderr.log"
  rm -rf "$dir"
}

case_resolve_rejects_invalid_resolution_type() {
  echo "case: resolve rejects an unknown --resolution-type"
  local dir exit_code
  dir=$(mktemp -d)
  make_fixture "$dir"
  run_helper "$dir" resolve \
    --project-slug example-app \
    --release REQ-108 \
    --test-cycle-id cycle-1 \
    --resolution-type bogus \
    --reason "irrelevant" \
    >"$dir/stdout.log" 2>"$dir/stderr.log" && exit_code=0 || exit_code=$?
  if [ "$exit_code" -ne 0 ]; then ok "exit code non-zero"; else no "expected non-zero"; fi
  assert_contains "error names --resolution-type" "--resolution-type must be one of" "$dir/stderr.log"
  rm -rf "$dir"
}

case_attribution_guard() {
  echo "case: a doc-only PR does not record a release-scoped execution; a code PR does (#1019)"
  local dir out exit_code
  dir=$(mktemp -d)
  make_fixture "$dir"
  ( cd "$dir" && git init -q -b develop && git config user.email t@example.test && git config user.name t && git config commit.gpgsign false \
    && mkdir -p src compliance && echo a > src/app.ts && git add -A && git commit -q -m "chore: init" \
    && git update-ref refs/remotes/origin/develop HEAD && git checkout -q -b topic \
    && echo triage > compliance/triage.md && git add -A && git commit -q -m "compliance: [REQ-109] triage" )
  out="$dir/out.env"
  ( cd "$dir" && GITHUB_EVENT_NAME=pull_request GITHUB_BASE_REF=develop \
    RESOLVE_STATUS=200 RESOLVE_BODY='{"latest":{"id":"release-1","version":"REQ-109"}}' START_STATUS=201 START_BODY='{"id":"cycle-1"}' \
    run_helper "$dir" start --project-slug example-app --release REQ-109 --sdlc-stage 2 --environment uat --suite-kind e2e \
      --iteration-key k --iteration-ordinal 1 --idempotency-key github:fixture/repo:e2e:1:1:REQ-109 --commit-sha deadbeef --branch topic --output-file "$out" >"$dir/stdout.log" 2>"$dir/stderr.log" ) && exit_code=0 || exit_code=$?
  if [ "$exit_code" -eq 0 ]; then ok "doc-only PR: exit 0"; else no "doc-only PR: expected exit 0"; fi
  if [ -e "$dir/curl.log" ] && grep -q "/cycles/start" "$dir/curl.log"; then no "doc-only PR must not record an execution"; else ok "doc-only PR: no execution recorded"; fi
  assert_contains "doc-only PR: the skip is a visible warning" "changes no code" "$dir/stdout.log"
  assert_contains "doc-only PR: the output file says the guard skipped it" "execution_skipped_reason=attribution_guard_doc-only" "$out"

  ( cd "$dir" && echo b >> src/app.ts && git add -A && git commit -q -m "fix: [REQ-109] real change" )
  rm -f "$dir/curl.log"
  ( cd "$dir" && GITHUB_EVENT_NAME=pull_request GITHUB_BASE_REF=develop \
    RESOLVE_STATUS=200 RESOLVE_BODY='{"latest":{"id":"release-1","version":"REQ-109"}}' START_STATUS=201 START_BODY='{"id":"cycle-1"}' \
    run_helper "$dir" start --project-slug example-app --release REQ-109 --sdlc-stage 2 --environment uat --suite-kind e2e \
      --iteration-key k --iteration-ordinal 1 --idempotency-key github:fixture/repo:e2e:1:1:REQ-109 --commit-sha deadbeef --branch topic >"$dir/stdout2.log" 2>"$dir/stderr2.log" ) && exit_code=0 || exit_code=$?
  assert_contains "code PR: the execution is recorded as before" "/cycles/start" "$dir/curl.log"
  rm -f "$dir/curl.log"
  ( cd "$dir" && git reset -q --hard HEAD~1 && GITHUB_EVENT_NAME=pull_request GITHUB_BASE_REF=develop \
    RESOLVE_STATUS=200 RESOLVE_BODY='{"latest":{"id":"release-1","version":"REQ-109"}}' START_STATUS=201 START_BODY='{"id":"cycle-1"}' \
    run_helper "$dir" start --project-slug example-app --release REQ-109 --sdlc-stage 2 --environment uat --suite-kind e2e \
      --iteration-key k --iteration-ordinal 1 --idempotency-key github:fixture/repo:e2e:1:1:REQ-109 --commit-sha deadbeef --branch topic --no-attribution-guard >"$dir/stdout3.log" 2>"$dir/stderr3.log" ) && exit_code=0 || exit_code=$?
  assert_contains "--no-attribution-guard restores the old attribution" "/cycles/start" "$dir/curl.log"
  rm -rf "$dir"
}

case_run_data_file() {
  echo "case: complete sends the run record's data object as runData"
  local dir exit_code
  dir=$(mktemp -d)
  make_fixture "$dir"
  printf '%s' '{"outcome":"passed","data":{"isolation":"shared","seedCommit":"abc","seedFilesHash":"h","reset":{"ran":true,"exitCode":0},"preflight":{"ran":false,"exitCode":null},"leakCheck":{"ran":true,"count":0},"workers":2,"skipped":{"count":1,"byReason":{"x":1}}}}' > "$dir/meta.json"
  printf '%s' '{"outcome":"passed"}' > "$dir/nodata.json"
  common=(--project-slug fixture-app --release REQ-100 --sdlc-stage 2 --environment uat --suite-kind e2e --idempotency-key github:fixture/repo:e2e:1:1:REQ-100 --started-at 2026-07-16T10:00:00Z --outcome passed)
  RESOLVE_STATUS=200 RESOLVE_BODY='{"latest":{"id":"release-1","version":"REQ-100"}}' COMPLETE_STATUS=200 COMPLETE_BODY='{"id":"e1"}' \
    run_helper "$dir" complete "${common[@]}" --run-data-file "$dir/meta.json" >"$dir/stdout.log" 2>"$dir/stderr.log" && exit_code=0 || exit_code=$?
  if [ "$exit_code" -eq 0 ]; then ok "exit code 0"; else no "expected exit 0"; fi
  assert_contains "payload carries runData" '"runData"' "$dir/curl.log"
  assert_contains "runData uses the portal field names" '"seedFilesHash": "h"' "$dir/curl.log"
  assert_contains "schemaVersion stays 1" '"schemaVersion": 1' "$dir/curl.log"
  rm -f "$dir/curl.log"
  RESOLVE_STATUS=200 RESOLVE_BODY='{"latest":{"id":"release-1","version":"REQ-100"}}' COMPLETE_STATUS=200 COMPLETE_BODY='{"id":"e1"}' \
    run_helper "$dir" complete "${common[@]}" >"$dir/stdout.log" 2>"$dir/stderr.log" && exit_code=0 || exit_code=$?
  if grep -Fq '"runData"' "$dir/curl.log"; then no "no file: payload unchanged"; else ok "no file: payload unchanged"; fi
  rm -f "$dir/curl.log"
  RESOLVE_STATUS=200 RESOLVE_BODY='{"latest":{"id":"release-1","version":"REQ-100"}}' COMPLETE_STATUS=200 COMPLETE_BODY='{"id":"e1"}' \
    run_helper "$dir" complete "${common[@]}" --run-data-file "$dir/nodata.json" >"$dir/stdout.log" 2>"$dir/stderr.log" && exit_code=0 || exit_code=$?
  if grep -Fq '"runData"' "$dir/curl.log"; then no "file without data: payload unchanged"; else ok "file without data: payload unchanged"; fi
  rm -f "$dir/curl.log"
  RESOLVE_STATUS=200 RESOLVE_BODY='{"latest":{"id":"release-1","version":"REQ-100"}}' START_STATUS=201 START_BODY='{"id":"e1"}' \
    run_helper "$dir" start --project-slug fixture-app --release REQ-100 --sdlc-stage 2 --environment uat --suite-kind e2e --idempotency-key k --run-data-file "$dir/meta.json" >"$dir/stdout.log" 2>"$dir/stderr.log" && exit_code=0 || exit_code=$?
  if grep -Fq '"runData"' "$dir/curl.log"; then no "start never sends runData"; else ok "start never sends runData"; fi
  rm -rf "$dir"
}

case_attribution_guard
case_run_data_file
case_start_success
case_complete_reconciles_terminal_conflict
case_missing_release_fails
case_resolve_success
case_accepted_exception_requires_tracking_issue_and_record
case_accepted_exception_rejects_incomplete_record
case_retry_passed_needs_no_record
case_resolve_requires_reason
case_resolve_rejects_invalid_resolution_type

echo ""
echo "=== report-test-execution.test.sh: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
