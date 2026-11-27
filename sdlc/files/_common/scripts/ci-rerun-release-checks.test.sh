#!/usr/bin/env bash
# ci-rerun-release-checks.test.sh — tests for ci-rerun-release-checks.sh (DevAudit-Installer#1335 D16), with a
# fake gh that answers from fixture files and records every cancel and rerun.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

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

BIN="$WORK/bin"; mkdir -p "$BIN"
FX="$WORK/fx"
LOG="$WORK/gh.log"
export FX LOG

# fake gh:
#   gh api <path> --jq <filter>  -> jq <filter> over $FX/<key>.json, key from the path (pulls, runs, jobs-<id>,
#                                   run-<id>); a missing file or $FX/<key>.fail fails the call.
#   gh run cancel|rerun ...      -> recorded in $LOG; `rerun` fails when $FX/rerun.fail exists. A cancel marks the
#                                   run completed unless $FX/cancel.stuck exists.
cat > "$BIN/gh" <<'GH'
#!/usr/bin/env bash
if [ "$1" = run ]; then
  echo "$*" >> "$LOG"
  if [ "$2" = rerun ] && [ -e "$FX/rerun.fail" ]; then exit 1; fi
  if [ "$2" = cancel ] && [ ! -e "$FX/cancel.stuck" ]; then echo '{"status":"completed"}' > "$FX/run-$3.json"; fi
  exit 0
fi
[ "$1" = api ] || exit 2
path="$2"; filter="${4:-.}"
case "$path" in
  repos/*/pulls\?*) key=pulls ;;
  repos/*/actions/workflows/*/runs\?*) key=runs ;;
  repos/*/actions/runs/*/jobs\?*) id="${path#*actions/runs/}"; key="jobs-${id%%/*}" ;;
  repos/*/actions/runs/*) key="run-${path##*/}" ;;
  *) exit 2 ;;
esac
[ ! -e "$FX/$key.fail" ] && [ -f "$FX/$key.json" ] || exit 1
jq -r "$filter" "$FX/$key.json"
GH
chmod +x "$BIN/gh"

SHA=aaaa1111
reset() { rm -rf "$FX"; mkdir -p "$FX"; : > "$LOG"; }
pulls() { echo "[{\"number\":2,\"head\":{\"sha\":\"$1\"}},{\"number\":3,\"head\":{\"sha\":\"other\"}}]" > "$FX/pulls.json"; }
runs() { echo '{"workflow_runs":[{"id":70,"created_at":"2026-11-27T01:00:00Z","pull_requests":[{"number":2}]},{"id":71,"created_at":"2026-11-27T02:00:00Z","pull_requests":[{"number":2}]},{"id":72,"created_at":"2026-11-27T03:00:00Z","pull_requests":[{"number":9}]}]}' > "$FX/runs.json"; }
jobs() { echo "{\"jobs\":[{\"name\":\"Plan\",\"conclusion\":\"success\"},{\"name\":\"$1\",\"conclusion\":$2}]}" > "$FX/jobs-71.json"; }
status() { echo "{\"status\":\"$1\"}" > "$FX/run-71.json"; }
run() {
  PATH="$BIN:$PATH" REPOSITORY=example-org/example-app HEAD_SHA="$SHA" RELEASE_BRANCH=main \
    WORKFLOW_REF="example-org/example-app/.github/workflows/ci.yml@refs/heads/develop" WAIT_LIMIT=2 POLL=1 \
    "$@" bash "$SCRIPT_DIR/ci-rerun-release-checks.sh"
}

echo "ci-rerun-release-checks.sh"

reset; pulls "$SHA"; runs; jobs "Release provenance" '"failure"'; status completed
out=$(run); rc=$?
check "a completed run with a failed provenance is re-run (failed jobs only)" "run rerun 71 --failed --repo example-org/example-app" "$(cat "$LOG")"
check "it picks the PR's latest run, not another PR's" "1" "$(grep -c 'run 71' <<<"$out")"
check "exit 0" "0" "$rc"

reset; pulls "$SHA"; runs; jobs "Release provenance (web)" '"failure"'; status completed
run >/dev/null
check "a namespaced job name (multi-target) matches" "run rerun 71 --failed --repo example-org/example-app" "$(cat "$LOG")"

reset; pulls "$SHA"; runs; jobs "Release provenance" '"success"'; status completed
out=$(run)
check "a passing provenance is not re-run" "" "$(cat "$LOG")"
check "and says so" "1" "$(grep -c "has Release provenance 'success'" <<<"$out")"

reset; pulls "$SHA"; runs; jobs "Release provenance" 'null'; status in_progress
out=$(run)
check "a provenance that has not finished is left to see the success itself" "" "$(cat "$LOG")"
check "and says so" "1" "$(grep -c "'not finished'" <<<"$out")"

reset; pulls "$SHA"; runs; jobs "Release provenance" '"failure"'; status in_progress
out=$(run)
check "a run in progress is cancelled, then re-run" "$(printf 'run cancel 71 --repo example-org/example-app\nrun rerun 71 --failed --repo example-org/example-app')" "$(cat "$LOG")"

reset; pulls "$SHA"; runs; jobs "Release provenance" '"failure"'; status in_progress; touch "$FX/cancel.stuck"
out=$(run); rc=$?
check "a cancelled run that never completes is not re-run" "run cancel 71 --repo example-org/example-app" "$(cat "$LOG")"
check "and it warns" "1" "$(grep -c '::warning::.*did not complete within 2s' <<<"$out")"
check "still exit 0" "0" "$rc"

reset; pulls "other-sha"; runs
out=$(run)
check "no open release PR with this head: nothing re-run" "" "$(cat "$LOG")"
check "and says so" "1" "$(grep -c 'nothing to re-run' <<<"$out")"

reset; pulls "$SHA"; echo '{"workflow_runs":[]}' > "$FX/runs.json"
out=$(run)
check "no run of the workflow yet: nothing re-run" "1" "$(grep -c 'no run of ci.yml' <<<"$out")"

reset; touch "$FX/pulls.fail"
out=$(run); rc=$?
check "an API failure is a warning" "1" "$(grep -c '::warning::.*could not list' <<<"$out")"
check "and exit 0" "0" "$rc"

reset; pulls "$SHA"; runs; jobs "Release provenance" '"failure"'; status completed; touch "$FX/rerun.fail"
out=$(run); rc=$?
check "a failed rerun is a warning" "1" "$(grep -c '::warning::.*could not re-run run 71' <<<"$out")"
check "and exit 0" "0" "$rc"

reset
out=$(run env -u HEAD_SHA); rc=$?
check "a missing input is a warning, exit 0" "1 0" "$(grep -c '::warning::.*HEAD_SHA is not set' <<<"$out") $rc"

echo ""
echo "Passed: $PASS  Failed: $FAIL"
[ "$FAIL" -eq 0 ]
