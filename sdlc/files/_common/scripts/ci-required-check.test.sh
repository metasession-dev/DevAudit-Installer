#!/usr/bin/env bash
# ci-required-check.test.sh — tests for ci-required-check.sh (DevAudit-Installer#1335).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/ci-required-check.sh"

PASS=0
FAIL=0
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

check() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $name"
    echo "    Expected: $expected"
    echo "    Actual:   $actual"
    FAIL=$((FAIL + 1))
  fi
}

# needs <plan result> <plan outputs json> <job=result ...>: prints a NEEDS_JSON document.
needs() {
  local plan_result="$1" outputs="$2"; shift 2
  local doc
  doc="$(jq -n --arg r "$plan_result" --argjson o "$outputs" '{plan: {result: $r, outputs: $o}}')"
  local pair
  for pair in "$@"; do
    doc="$(printf '%s' "$doc" | jq --arg j "${pair%%=*}" --arg r "${pair#*=}" '. + {($j): {result: $r, outputs: {}}}')"
  done
  printf '%s' "$doc"
}
# verdict <needs json> [VAR=value ...]: prints the exit status.
verdict() {
  local json="$1"; shift
  (env -i PATH="$PATH" NEEDS_JSON="$json" GITHUB_STEP_SUMMARY="$WORK/summary.md" "$@" bash "$HELPER" >"$WORK/out" 2>&1) && echo 0 || echo $?
}
said() { grep -c -F "$1" "$WORK/out" || true; }

PR_CODE='{"mode":"feature","change":"code","run_gates":"true","run_register":"false","run_release_checks":"false","reuse":"false"}'
PR_DOCS='{"mode":"feature","change":"docs-only","run_gates":"false","run_register":"false","run_release_checks":"false","reuse":"false"}'
MERGE_RUN='{"mode":"merge","change":"code","run_gates":"true","run_register":"true","run_release_checks":"false","reuse":"false"}'
MERGE_REUSE='{"mode":"merge","change":"code","run_gates":"false","run_register":"true","run_release_checks":"false","reuse":"true"}'
MERGE_NEITHER='{"mode":"merge","change":"code","run_gates":"false","run_register":"true","run_release_checks":"false","reuse":"false"}'
RELEASE='{"mode":"release","change":"code","run_gates":"false","run_register":"false","run_release_checks":"true","reuse":"false"}'

echo "ci-required-check.sh: passes"

check "a code pull request whose gates passed" "0" "$(verdict "$(needs success "$PR_CODE" quality-gates=success register-release=skipped release-provenance=skipped)")"
check "a docs-only pull request (everything else skipped)" "0" "$(verdict "$(needs success "$PR_DOCS" quality-gates=skipped register-release=skipped release-provenance=skipped)")"
check "a code merge whose gates passed" "0" "$(verdict "$(needs success "$MERGE_RUN" quality-gates=success register-release=success release-provenance=skipped)")"
check "a code merge that reused the pull request result" "0" "$(verdict "$(needs success "$MERGE_REUSE" quality-gates=skipped register-release=success release-provenance=skipped)")"
check "a release pull request whose provenance passed" "0" "$(verdict "$(needs success "$RELEASE" quality-gates=skipped register-release=skipped release-provenance=success)")"

echo "ci-required-check.sh: rule 1, the plan"

check "a failed plan fails" "1" "$(verdict "$(needs failure '{}' quality-gates=skipped register-release=skipped release-provenance=skipped)")"
check "a failed plan says why" "1" "$(said 'the plan job did not succeed')"
check "a cancelled plan fails" "1" "$(verdict "$(needs cancelled '{}')")"
check "a plan without a mode fails" "1" "$(verdict "$(needs success '{"run_gates":"false"}')")"
check "missing NEEDS_JSON fails" "1" "$( (env -i PATH="$PATH" bash "$HELPER" >/dev/null 2>&1) && echo 0 || echo $?)"
check "NEEDS_JSON that is not an object fails" "1" "$(verdict '[1,2]')"

echo "ci-required-check.sh: rule 2, the gates"

for r in failure skipped cancelled absent; do
  if [ "$r" = absent ]; then j="$(needs success "$PR_CODE")"; else j="$(needs success "$PR_CODE" quality-gates=$r)"; fi
  check "gates that should have run and are $r fail" "1" "$(verdict "$j")"
  check "gates $r: the message names the result" "1" "$(said "the quality gates should have run and are $r")"
done

echo "ci-required-check.sh: rule 3, the release registration"

check "a failed registration on a code merge fails" "1" "$(verdict "$(needs success "$MERGE_RUN" quality-gates=success register-release=failure)")"
check "a skipped registration on a code merge fails" "1" "$(verdict "$(needs success "$MERGE_REUSE" quality-gates=skipped register-release=skipped)")"

echo "ci-required-check.sh: rule 4, a code merge needs gates or reuse"

check "a code merge with neither gates nor reuse fails" "1" "$(verdict "$(needs success "$MERGE_NEITHER" quality-gates=skipped register-release=success)")"
check "the message says so" "1" "$(said 'neither the gates nor reused')"

echo "ci-required-check.sh: rule 5, the release provenance"

for r in failure skipped cancelled; do
  check "provenance that should have run and is $r fails" "1" "$(verdict "$(needs success "$RELEASE" release-provenance=$r)")"
done

echo "ci-required-check.sh: jobs the plan did not ask for are not judged"

check "a failed gate job on a docs-only pull request does not fail it" "0" "$(verdict "$(needs success "$PR_DOCS" quality-gates=failure)")"
check "a failed provenance job outside a release pull request does not fail it" "0" "$(verdict "$(needs success "$PR_CODE" quality-gates=success release-provenance=failure)")"

echo "ci-required-check.sh: the summary"

BIN="$WORK/bin"; mkdir -p "$BIN"
printf '#!/usr/bin/env bash\nexit 1\n' > "$BIN/gh"; chmod +x "$BIN/gh"
: > "$WORK/summary.md"
check "a summary API failure does not change a pass" "0" "$(verdict "$(needs success "$PR_CODE" quality-gates=success)" PATH="$BIN:$PATH" REPOSITORY=o/r RUN_ID=5 RUN_ATTEMPT=1)"
check "the summary says the timings are unavailable" "1" "$(grep -c 'timings unavailable' "$WORK/summary.md")"
check "the summary lists each job" "1" "$(grep -c '| quality-gates | success |' "$WORK/summary.md")"
printf '#!/usr/bin/env bash\necho %s\n' "'{\"jobs\":[{\"name\":\"Plan\",\"created_at\":\"2026-11-26T10:00:00Z\",\"started_at\":\"2026-11-26T10:03:05Z\",\"completed_at\":\"2026-11-26T10:03:20Z\"},{\"name\":\"Quality Gates\",\"created_at\":\"2026-11-26T10:30:00Z\",\"started_at\":\"2026-11-26T10:31:00Z\",\"completed_at\":null}]}'" > "$BIN/gh"
: > "$WORK/summary.md"
check "with timings: still passes" "0" "$(verdict "$(needs success "$PR_CODE" quality-gates=success)" PATH="$BIN:$PATH" REPOSITORY=o/r RUN_ID=5 RUN_ATTEMPT=1)"
check "queue and run time per job" "1" "$(grep -c '| Plan | 3m 5s | 0m 15s |' "$WORK/summary.md")"
check "a running job is shown as running" "1" "$(grep -c '| Quality Gates | 1m 0s | running |' "$WORK/summary.md")"
check "an unwritable summary does not change a pass" "0" "$(verdict "$(needs success "$PR_CODE" quality-gates=success)" GITHUB_STEP_SUMMARY=/nonexistent/dir/summary.md)"
: > "$WORK/summary.md"
verdict "$(needs success "$PR_CODE" quality-gates=failure)" >/dev/null
check "a failure is listed in the summary" "1" "$(grep -c 'the quality gates should have run and are failure' "$WORK/summary.md")"

echo
echo "Passed: $PASS  Failed: $FAIL"
[ "$FAIL" -eq 0 ]
