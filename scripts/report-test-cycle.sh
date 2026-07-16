#!/usr/bin/env bash
# report-test-cycle.sh — Producer helper for first-class cycle lifecycle events.
#
# Usage:
#   ./scripts/report-test-cycle.sh start|complete [flags...]
#
# Required flags:
#   --project-slug <slug>
#   --release <version>
#   --sdlc-stage <1-5>
#   --environment <ci|uat|production>
#   --cycle-kind <kind>
#   --idempotency-key <key>
#
# Optional flags:
#   --provider <name>              Defaults to github_actions
#   --external-run-id <id>
#   --external-run-attempt <n>
#   --external-job-id <id>
#   --commit-sha <sha>
#   --branch <name>
#   --workflow-name <name>
#   --workflow-url <url>
#   --started-at <iso8601>         Defaults to current UTC on `start`
#   --completed-at <iso8601>       Defaults to current UTC on `complete`
#   --outcome <value>              Terminal outcome for `complete`
#   --outcome-reason <text>
#   --incident-reference <text>
#   --output-file <path>           Writes key=value outputs for callers
#
# Output keys:
#   cycle_supported=true|false
#   cycle_release_id=<uuid-if-resolved>
#   cycle_release_version=<exact-version-if-resolved>
#   cycle_record_id=<uuid-if-created-or-updated>
#   cycle_idempotency_key=<input-key>
#   cycle_started_at=<iso8601-if-known>
#   cycle_completed_at=<iso8601-if-known>
#   cycle_endpoint=<start|complete|reconcile-if-used>

set -euo pipefail

usage() {
  echo "Usage: $0 start|complete [flags...]"
  exit 1
}

[ "$#" -ge 1 ] || usage
MODE="$1"
shift

case "$MODE" in
  start|complete) ;;
  *) usage ;;
esac

PROJECT_SLUG=""
RELEASE_VERSION=""
SDLC_STAGE=""
ENVIRONMENT=""
CYCLE_KIND=""
PROVIDER="github_actions"
EXTERNAL_RUN_ID=""
EXTERNAL_RUN_ATTEMPT=""
EXTERNAL_JOB_ID=""
COMMIT_SHA=""
BRANCH=""
WORKFLOW_NAME=""
WORKFLOW_URL=""
IDEMPOTENCY_KEY=""
STARTED_AT=""
COMPLETED_AT=""
OUTCOME=""
OUTCOME_REASON=""
INCIDENT_REFERENCE=""
OUTPUT_FILE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --project-slug) PROJECT_SLUG="$2"; shift 2 ;;
    --release) RELEASE_VERSION="$2"; shift 2 ;;
    --sdlc-stage) SDLC_STAGE="$2"; shift 2 ;;
    --environment) ENVIRONMENT="$2"; shift 2 ;;
    --cycle-kind) CYCLE_KIND="$2"; shift 2 ;;
    --provider) PROVIDER="$2"; shift 2 ;;
    --external-run-id) EXTERNAL_RUN_ID="$2"; shift 2 ;;
    --external-run-attempt) EXTERNAL_RUN_ATTEMPT="$2"; shift 2 ;;
    --external-job-id) EXTERNAL_JOB_ID="$2"; shift 2 ;;
    --commit-sha) COMMIT_SHA="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --workflow-name) WORKFLOW_NAME="$2"; shift 2 ;;
    --workflow-url) WORKFLOW_URL="$2"; shift 2 ;;
    --idempotency-key) IDEMPOTENCY_KEY="$2"; shift 2 ;;
    --started-at) STARTED_AT="$2"; shift 2 ;;
    --completed-at) COMPLETED_AT="$2"; shift 2 ;;
    --outcome) OUTCOME="$2"; shift 2 ;;
    --outcome-reason) OUTCOME_REASON="$2"; shift 2 ;;
    --incident-reference) INCIDENT_REFERENCE="$2"; shift 2 ;;
    --output-file) OUTPUT_FILE="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

require_arg() {
  local value="$1" name="$2"
  if [ -z "$value" ]; then
    echo "Error: ${name} is required" >&2
    exit 1
  fi
}

require_arg "$PROJECT_SLUG" "--project-slug"
require_arg "$RELEASE_VERSION" "--release"
require_arg "$SDLC_STAGE" "--sdlc-stage"
require_arg "$ENVIRONMENT" "--environment"
require_arg "$CYCLE_KIND" "--cycle-kind"
require_arg "$IDEMPOTENCY_KEY" "--idempotency-key"

if [ -z "${DEVAUDIT_BASE_URL:-}" ]; then
  echo "Error: DEVAUDIT_BASE_URL environment variable is required" >&2
  exit 1
fi
if [ -z "${DEVAUDIT_API_KEY:-}" ]; then
  echo "Error: DEVAUDIT_API_KEY environment variable is required" >&2
  exit 1
fi

if ! [[ "$SDLC_STAGE" =~ ^[1-5]$ ]]; then
  echo "Error: --sdlc-stage must be an integer 1-5 (got: $SDLC_STAGE)" >&2
  exit 1
fi

case "$ENVIRONMENT" in
  ci|uat|production) ;;
  *)
    echo "Error: --environment must be one of ci, uat, production" >&2
    exit 1
    ;;
esac

if [ "$MODE" = "complete" ] && [ -z "$OUTCOME" ]; then
  echo "Error: --outcome is required for complete" >&2
  exit 1
fi

case "$OUTCOME" in
  ""|passed|failed|cancelled|skipped|timed_out|action_required|unknown) ;;
  *)
    echo "Error: --outcome must be a terminal cycle outcome" >&2
    exit 1
    ;;
esac

iso_now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

[ -n "$STARTED_AT" ] || STARTED_AT="$(iso_now)"
if [ "$MODE" = "complete" ] && [ -z "$COMPLETED_AT" ]; then
  COMPLETED_AT="$(iso_now)"
fi

DEVAUDIT_BASE_URL="${DEVAUDIT_BASE_URL%/}"
MAX_TIME_SECONDS=${UPLOAD_MAX_TIME_SECONDS:-120}
CONNECT_TIMEOUT_SECONDS=${UPLOAD_CONNECT_TIMEOUT_SECONDS:-10}

write_output() {
  local key="$1" value="$2"
  if [ -n "$OUTPUT_FILE" ]; then
    printf '%s=%s\n' "$key" "$value" >> "$OUTPUT_FILE"
  fi
}

emit_fallback() {
  local release_id="${1:-}" resolved_version="${2:-}"
  write_output cycle_supported false
  write_output cycle_release_id "$release_id"
  write_output cycle_release_version "$resolved_version"
  write_output cycle_record_id ""
  write_output cycle_idempotency_key "$IDEMPOTENCY_KEY"
  write_output cycle_started_at "$STARTED_AT"
  write_output cycle_completed_at "$COMPLETED_AT"
  write_output cycle_endpoint "$MODE"
}

uri_escape() {
  jq -rn --arg v "$1" '$v|@uri'
}

resolve_release_exact() {
  local encoded_release encoded_slug url body code latest_id latest_version
  encoded_release=$(uri_escape "$RELEASE_VERSION")
  encoded_slug=$(uri_escape "$PROJECT_SLUG")
  url="${DEVAUDIT_BASE_URL}/api/ci/releases/resolve?projectSlug=${encoded_slug}&versionPrefix=${encoded_release}"
  body=$(mktemp)
  code=$(curl -sS -o "$body" -w "%{http_code}" \
    -H "Authorization: Bearer ${DEVAUDIT_API_KEY}" \
    --connect-timeout "$CONNECT_TIMEOUT_SECONDS" \
    --max-time "$MAX_TIME_SECONDS" \
    "$url")
  if [ "$code" -lt 200 ] || [ "$code" -ge 300 ]; then
    echo "::warning::Cycle lifecycle skipped: could not resolve release ${RELEASE_VERSION} (HTTP ${code})." >&2
    rm -f "$body"
    emit_fallback "" ""
    return 1
  fi
  latest_id=$(jq -r '.latest.id // empty' "$body" 2>/dev/null || true)
  latest_version=$(jq -r '.latest.version // empty' "$body" 2>/dev/null || true)
  rm -f "$body"
  if [ -z "$latest_id" ] || [ "$latest_version" != "$RELEASE_VERSION" ]; then
    echo "::warning::Cycle lifecycle skipped: release resolve for ${RELEASE_VERSION} was empty or ambiguous (latest=${latest_version:-none})." >&2
    emit_fallback "$latest_id" "$latest_version"
    return 1
  fi
  RELEASE_ID="$latest_id"
  RESOLVED_RELEASE_VERSION="$latest_version"
  write_output cycle_release_id "$RELEASE_ID"
  write_output cycle_release_version "$RESOLVED_RELEASE_VERSION"
  return 0
}

build_payload() {
  local mode="$1"
  if [ -n "$EXTERNAL_RUN_ATTEMPT" ]; then
    EXTERNAL_RUN_ATTEMPT_JSON="$EXTERNAL_RUN_ATTEMPT"
  else
    EXTERNAL_RUN_ATTEMPT_JSON="null"
  fi
  jq -n \
    --argjson schemaVersion 1 \
    --arg mode "$mode" \
    --arg sdlcStage "$SDLC_STAGE" \
    --arg environment "$ENVIRONMENT" \
    --arg cycleKind "$CYCLE_KIND" \
    --arg provider "$PROVIDER" \
    --arg externalRunId "$EXTERNAL_RUN_ID" \
    --argjson externalRunAttempt "$EXTERNAL_RUN_ATTEMPT_JSON" \
    --arg externalJobId "$EXTERNAL_JOB_ID" \
    --arg idempotencyKey "$IDEMPOTENCY_KEY" \
    --arg startedAt "$STARTED_AT" \
    --arg completedAt "$COMPLETED_AT" \
    --arg outcome "$OUTCOME" \
    --arg outcomeReason "$OUTCOME_REASON" \
    --arg commitSha "$COMMIT_SHA" \
    --arg branch "$BRANCH" \
    --arg workflowName "$WORKFLOW_NAME" \
    --arg workflowUrl "$WORKFLOW_URL" \
    --arg incidentReference "$INCIDENT_REFERENCE" \
    '
      {
        schemaVersion: $schemaVersion,
        sdlcStage: ($sdlcStage | tonumber),
        environment: $environment,
        cycleKind: $cycleKind,
        provider: $provider,
        externalRunId: ($externalRunId | if . == "" then null else . end),
        externalRunAttempt: $externalRunAttempt,
        externalJobId: ($externalJobId | if . == "" then null else . end),
        idempotencyKey: $idempotencyKey,
        startedAt: $startedAt,
        commitSha: ($commitSha | if . == "" then null else . end),
        branch: ($branch | if . == "" then null else . end),
        workflowName: ($workflowName | if . == "" then null else . end),
        workflowUrl: ($workflowUrl | if . == "" then null else . end),
        incidentReference: ($incidentReference | if . == "" then null else . end)
      }
      + (if $mode == "start"
          then { outcome: "running" }
          else {
            completedAt: $completedAt,
            outcome: $outcome,
            outcomeReason: ($outcomeReason | if . == "" then null else . end)
          }
        end)
    '
}

post_cycle_event() {
  local endpoint="$1" payload="$2" body code
  body=$(mktemp)
  code=$(curl -sS -o "$body" -w "%{http_code}" \
    -X POST \
    -H "Authorization: Bearer ${DEVAUDIT_API_KEY}" \
    -H "Content-Type: application/json" \
    --connect-timeout "$CONNECT_TIMEOUT_SECONDS" \
    --max-time "$MAX_TIME_SECONDS" \
    "${DEVAUDIT_BASE_URL}/api/ci/releases/${RELEASE_ID}/cycles/${endpoint}" \
    -d "$payload")
  CYCLE_HTTP_CODE="$code"
  CYCLE_RESPONSE_BODY_FILE="$body"
}

handle_unavailable_endpoint() {
  case "$CYCLE_HTTP_CODE" in
    404|405|501)
      echo "::warning::Cycle lifecycle endpoint ${MODE} unavailable on this portal (HTTP ${CYCLE_HTTP_CODE}); continuing in legacy testCycleId mode." >&2
      emit_fallback "$RELEASE_ID" "$RESOLVED_RELEASE_VERSION"
      rm -f "$CYCLE_RESPONSE_BODY_FILE"
      return 0
      ;;
  esac
  return 1
}

if ! resolve_release_exact; then
  exit 0
fi

PAYLOAD="$(build_payload "$MODE")"
ENDPOINT="$MODE"
post_cycle_event "$ENDPOINT" "$PAYLOAD"

if [ "$MODE" = "complete" ] && [ "$CYCLE_HTTP_CODE" -eq 400 ]; then
  if grep -q 'different terminal outcome' "$CYCLE_RESPONSE_BODY_FILE" 2>/dev/null; then
    ENDPOINT="reconcile"
    post_cycle_event "$ENDPOINT" "$PAYLOAD"
  fi
fi

if [ "$CYCLE_HTTP_CODE" -lt 200 ] || [ "$CYCLE_HTTP_CODE" -ge 300 ]; then
  if handle_unavailable_endpoint; then
    exit 0
  fi
  BODY_EXCERPT="$(head -c 500 "$CYCLE_RESPONSE_BODY_FILE" 2>/dev/null || true)"
  rm -f "$CYCLE_RESPONSE_BODY_FILE"
  echo "Error: cycle ${ENDPOINT} failed for ${RELEASE_VERSION} (HTTP ${CYCLE_HTTP_CODE})${BODY_EXCERPT:+ — ${BODY_EXCERPT}}" >&2
  exit 1
fi

CYCLE_RECORD_ID=$(jq -r '.id // empty' "$CYCLE_RESPONSE_BODY_FILE" 2>/dev/null || true)
rm -f "$CYCLE_RESPONSE_BODY_FILE"
if [ -z "$CYCLE_RECORD_ID" ]; then
  echo "Error: cycle ${ENDPOINT} succeeded but response did not include an id" >&2
  exit 1
fi

write_output cycle_supported true
write_output cycle_record_id "$CYCLE_RECORD_ID"
write_output cycle_idempotency_key "$IDEMPOTENCY_KEY"
write_output cycle_started_at "$STARTED_AT"
write_output cycle_completed_at "$COMPLETED_AT"
write_output cycle_endpoint "$ENDPOINT"

echo "Cycle ${ENDPOINT} recorded for ${RELEASE_VERSION}: ${CYCLE_RECORD_ID}"
