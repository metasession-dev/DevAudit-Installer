#!/usr/bin/env bash
# e2e-release-gate.sh — the release-gate logic of compliance-evidence.yml
# (devaudit-installer#1059), kept out of the workflow because its run block is
# close to GitHub's expression-template size limit.
#
# resolve <event> <tier> <metadata.json>
#   Print "<tier> <gate-tier>". For a pull_request run whose metadata records
#   tier smoke|critical|full (written by e2e-regression.yml when a release-gate
#   key is configured) both words are that tier. Otherwise <tier> is unchanged
#   and <gate-tier> is empty: no gate was configured, so no gate check is made.
#
# report <project-slug> <release> <gate-tier> <branch> [execution-outcome]
#   Report the run-level `e2e-release-gate` release check: stable key, label
#   "E2E Release Gate (<tier>)", required, details {tier, headSha}. The status
#   comes from the triggering run's conclusion (a recorded timeout wins).
#   Environment: E2E_CONCLUSION, E2E_HEAD_SHA, E2E_RUN_ID, E2E_RUN_URL,
#   E2E_RUN_STARTED_AT, E2E_RUN_UPDATED_AT; DEVAUDIT_BASE_URL and
#   DEVAUDIT_API_KEY as for report-release-check.sh.
#
# Install: cp this file to your project's scripts/ directory && chmod +x scripts/e2e-release-gate.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cmd="${1:-}"
[ "$#" -gt 0 ] && shift

case "$cmd" in
  resolve)
    EVENT="${1:?event is required}"
    TIER="${2:?tier is required}"
    METADATA="${3:-}"
    META_TIER=""
    if [ "$EVENT" = "pull_request" ] && [ -n "$METADATA" ] && [ -f "$METADATA" ]; then
      META_TIER="$(jq -r '.tier // empty' "$METADATA" 2>/dev/null || true)"
      case "$META_TIER" in
        smoke | critical | full) TIER="$META_TIER" ;;
        *) META_TIER="" ;;
      esac
    fi
    echo "$TIER $META_TIER"
    ;;
  report)
    PROJECT="${1:?project slug is required}"
    RELEASE="${2:?release is required}"
    GATE_TIER="${3:?gate tier is required}"
    BRANCH="${4:-}"
    OUTCOME="${5:-}"
    case "${E2E_CONCLUSION:-}" in
      success) STATUS=successful ;;
      failure) STATUS=failed ;;
      cancelled) STATUS=cancelled ;;
      timed_out) STATUS=timed_out ;;
      action_required) STATUS=action_required ;;
      *) STATUS=unknown ;;
    esac
    if [ "$OUTCOME" = "timed_out" ]; then STATUS=timed_out; fi
    DETAILS="$(jq -cn --arg tier "$GATE_TIER" --arg headSha "${E2E_HEAD_SHA:-}" '{tier:$tier,headSha:$headSha}')"
    bash "$SCRIPT_DIR/report-release-check.sh" \
      --project-slug "$PROJECT" --release "$RELEASE" \
      --check-key "e2e-release-gate" \
      --label "E2E Release Gate (${GATE_TIER})" --provider github_actions --status "$STATUS" \
      --required true \
      --external-run-id "${E2E_RUN_ID:-}" \
      --external-url "${E2E_RUN_URL:-}" \
      --commit-sha "${E2E_HEAD_SHA:-}" --branch "$BRANCH" \
      --started-at "${E2E_RUN_STARTED_AT:-}" \
      --completed-at "${E2E_RUN_UPDATED_AT:-}" \
      --details-json "$DETAILS"
    ;;
  *)
    echo "usage: e2e-release-gate.sh resolve <event> <tier> <metadata.json> | report <project> <release> <gate-tier> <branch> [outcome]" >&2
    exit 2
    ;;
esac
