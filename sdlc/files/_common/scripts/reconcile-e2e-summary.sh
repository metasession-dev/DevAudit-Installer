#!/usr/bin/env bash
# reconcile-e2e-summary.sh -- compare a test-execution-summary.md with the CI
# E2E results for one execution (devaudit-installer#1016, R13).
#
# The summary is hand-edited; the CI results are not. A summary that says "3
# failed" while the run it cites failed one spec, or that never mentions a spec
# CI reported as failed, misleads the reviewer. This helper fails on that.
#
# Usage:
#   bash scripts/reconcile-e2e-summary.sh --summary <test-execution-summary.md> \
#        --results <e2e-regression-results.json> [--run-id <id>] [--attempt <n>]
#
# Inputs
#   --results   Playwright JSON reporter output for ONE execution.
#   --run-id    The CI run the results came from. When given, triage rows whose
#               Source cell contains this id (and `/<attempt>` when --attempt is
#               given) are the rows that must match this execution exactly.
#
# Checks
#   1. every spec CI reported as failed appears in the summary's
#      "## E2E failures & triage" table (any source);
#   2. with --run-id: the triage rows tied to that run name exactly the failed
#      specs CI reported, and their count equals the CI failure count.
#
# Exit: 0 reconciled; 1 mismatch (reasons on stderr); 2 usage/input error.

set -euo pipefail

SUMMARY=""; RESULTS=""; RUN_ID=""; ATTEMPT=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --summary) SUMMARY="${2:-}"; shift 2 ;;
    --results) RESULTS="${2:-}"; shift 2 ;;
    --run-id) RUN_ID="${2:-}"; shift 2 ;;
    --attempt) ATTEMPT="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "Error: unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -f "$SUMMARY" ] || { echo "Error: --summary not found: ${SUMMARY:-<empty>}" >&2; exit 2; }
[ -f "$RESULTS" ] || { echo "Error: --results not found: ${RESULTS:-<empty>}" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "Error: jq is required" >&2; exit 2; }
jq -e . "$RESULTS" >/dev/null 2>&1 || { echo "Error: --results is not valid JSON" >&2; exit 2; }

# Failed spec files in the Playwright JSON (a spec is failed when ok == false).
CI_FAILED="$(jq -r '[.. | objects | select(has("specs")) | .specs[]? | select(.ok == false) | .file] | map(select(. != null)) | unique | .[]' "$RESULTS" | sort -u)"
CI_FAILED_COUNT="$(printf '%s' "$CI_FAILED" | grep -c . || true)"

# Triage table rows: "spec<TAB>source" for every data row.
ROWS="$(awk '
  /^## E2E failures & triage/ { f = 1; next }
  /^## / { f = 0 }
  f && /^\|/ {
    if ($0 ~ /^\|[[:space:]|:-]*$/) next
    if (tolower($0) ~ /classification/ && tolower($0) ~ /disposition/) next
    n = split($0, c, "|")
    for (i = 2; i < n; i++) gsub(/^[[:space:]]+|[[:space:]]+$/, "", c[i])
    print c[2] "\t" c[3]
  }' "$SUMMARY")"

ERRORS=()
mentioned() { # <spec file> -> 0 when some triage row names it (full path or basename)
  local spec="$1" base; base="$(basename "$spec")"
  printf '%s\n' "$ROWS" | awk -F'\t' -v s="$spec" -v b="$base" 'index($1, s) || index($1, b) { found = 1 } END { exit !found }'
}

while IFS= read -r spec; do
  [ -n "$spec" ] || continue
  mentioned "$spec" || ERRORS+=("CI reported $spec as failed but the summary's '## E2E failures & triage' table does not mention it")
done <<<"$CI_FAILED"

if [ -n "$RUN_ID" ]; then
  KEY="$RUN_ID"; [ -n "$ATTEMPT" ] && KEY="$RUN_ID/$ATTEMPT"
  RUN_ROWS="$(printf '%s\n' "$ROWS" | awk -F'\t' -v k="$KEY" 'index($2, k)')"
  RUN_ROW_COUNT="$(printf '%s' "$RUN_ROWS" | grep -c . || true)"
  if [ "$RUN_ROW_COUNT" != "$CI_FAILED_COUNT" ]; then
    ERRORS+=("the summary lists $RUN_ROW_COUNT failure(s) for run $KEY but CI reported $CI_FAILED_COUNT failed spec(s)")
  fi
  while IFS=$'\t' read -r spec _src; do
    [ -n "$spec" ] || continue
    base="$(basename "$spec")"
    if ! printf '%s\n' "$CI_FAILED" | awk -v s="$spec" -v b="$base" 'index($0, s) || index($0, b) { found = 1 } END { exit !found }'; then
      ERRORS+=("the summary lists '$spec' as failed in run $KEY but CI did not report that spec as failed")
    fi
  done <<<"$RUN_ROWS"
fi

if [ "${#ERRORS[@]}" -gt 0 ]; then
  echo "E2E summary does not reconcile with the CI results ($RESULTS):" >&2
  for e in "${ERRORS[@]}"; do echo "  - $e" >&2; done
  exit 1
fi
echo "OK: summary reconciles with CI results ($CI_FAILED_COUNT failed spec(s)${RUN_ID:+, run $RUN_ID${ATTEMPT:+/$ATTEMPT}})"
