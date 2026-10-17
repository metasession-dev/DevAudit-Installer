#!/usr/bin/env bash
# reconcile-e2e-summary.test.sh -- tests for reconcile-e2e-summary.sh (devaudit-installer#1016).
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/reconcile-e2e-summary.sh"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
PASS=0; FAIL=0

expect() { # <desc> <want-rc> <needle-or-empty> <args...>
  local desc="$1" want="$2" needle="$3"; shift 3
  local out rc=0
  out=$(bash "$HELPER" "$@" 2>&1) || rc=$?
  if [ "$rc" = "$want" ] && { [ -z "$needle" ] || printf '%s' "$out" | grep -Fq -- "$needle"; }; then
    echo "  PASS: $desc"; PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (rc=$rc want=$want needle='$needle')"; echo "$out" | sed 's/^/    /'; FAIL=$((FAIL + 1))
  fi
}

# Attempt 1 failed one spec; attempt 2 (same SHA) passed.
cat > "$WORK/attempt1.json" <<'JSON'
{"stats":{"unexpected":1},"suites":[{"title":"critical","specs":[
  {"file":"e2e/critical/webhook-idempotency-replay.spec.ts","ok":false},
  {"file":"e2e/critical/other.spec.ts","ok":true}],"suites":[
  {"title":"nested","specs":[{"file":"e2e/critical/nested.spec.ts","ok":true}]}]}]}
JSON
cat > "$WORK/attempt2.json" <<'JSON'
{"stats":{"unexpected":0},"suites":[{"title":"critical","specs":[{"file":"e2e/critical/webhook-idempotency-replay.spec.ts","ok":true}]}]}
JSON
cat > "$WORK/nested-fail.json" <<'JSON'
{"stats":{"unexpected":1},"suites":[{"title":"a","specs":[],"suites":[{"title":"b","specs":[{"file":"e2e/deep/inner.spec.ts","ok":false}]}]}]}
JSON

summary() { # <file> <row...>
  local f="$1"; shift
  { echo "# Test Execution Summary"; echo; echo "## E2E failures & triage"; echo
    echo "| Spec / check | Source | Classification | Evidence | Disposition | Reference |"
    echo "| --- | --- | --- | --- | --- | --- |"
    for r in "$@"; do echo "$r"; done; } > "$f"
}

echo "=== reconcile-e2e-summary.sh tests ==="

summary "$WORK/good.md" "| e2e/critical/webhook-idempotency-replay.spec.ts | CI 36659647566/1 | flake | re-ran | Fix | #910 |"
expect "triaged CI failure reconciles (run + attempt)" 0 "OK" --summary "$WORK/good.md" --results "$WORK/attempt1.json" --run-id 36659647566 --attempt 1

summary "$WORK/missing.md" "| e2e/critical/dashboard-revenue.spec.ts | local | test bug | x | Fix | #5 |"
expect "a CI failure absent from the triage table is a mismatch" 1 "does not mention it" --summary "$WORK/missing.md" --results "$WORK/attempt1.json"

summary "$WORK/wrongspec.md" "| e2e/critical/dashboard-revenue.spec.ts | CI 36659647566/1 | flake | x | Fix | #5 |"
expect "summary names a different spec than CI failed (REQ-109 shape)" 1 "CI did not report that spec as failed" --summary "$WORK/wrongspec.md" --results "$WORK/attempt1.json" --run-id 36659647566 --attempt 1

summary "$WORK/count.md" \
  "| e2e/critical/webhook-idempotency-replay.spec.ts | CI 36659647566/1 | flake | x | Fix | #5 |" \
  "| e2e/critical/dashboard-revenue.spec.ts | CI 36659647566/1 | flake | x | Fix | #6 |" \
  "| e2e/critical/express.spec.ts | CI 36659647566/1 | flake | x | Fix | #7 |"
expect "failure count in the summary differs from CI's" 1 "lists 3 failure(s) for run 36659647566/1 but CI reported 1" --summary "$WORK/count.md" --results "$WORK/attempt1.json" --run-id 36659647566 --attempt 1

expect "the passing re-run reports no failures, so the attempt-1 row belongs to attempt 1 only" 0 "OK" --summary "$WORK/good.md" --results "$WORK/attempt2.json" --run-id 36659647566 --attempt 2
expect "a row claiming a failure for the passing attempt is a mismatch" 1 "lists 1 failure(s) for run 36659647566/1 but CI reported 0" --summary "$WORK/good.md" --results "$WORK/attempt2.json" --run-id 36659647566 --attempt 1

summary "$WORK/nested.md" "| inner.spec.ts | CI 7/1 | app defect | x | Fix | #9 |"
expect "failures in nested suites are found (matched by basename)" 0 "OK" --summary "$WORK/nested.md" --results "$WORK/nested-fail.json" --run-id 7 --attempt 1

expect "a missing summary is an input error" 2 "--summary not found" --summary "$WORK/none.md" --results "$WORK/attempt1.json"
echo "{not json" > "$WORK/bad.json"
expect "invalid results JSON is an input error" 2 "not valid JSON" --summary "$WORK/good.md" --results "$WORK/bad.json"

echo ""
echo "=== reconcile-e2e-summary.test.sh: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
