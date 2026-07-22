#!/usr/bin/env bash
# report-test-execution.sh - Producer helper for first-class test execution lifecycle events.
#
# Usage:
#   ./scripts/report-test-execution.sh start|complete [flags...]
#
# Required flags:
#   --project-slug <slug>
#   --release <version>
#   --sdlc-stage <1-5>
#   --environment <ci|uat|production>
#   --suite-kind <kind>
#   --idempotency-key <key>
#
# Optional flags:
#   --iteration-key <key>
#   --iteration-ordinal <n>
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
#   --remediation-reference <text>
#   --output-file <path>           Writes key=value outputs for callers
#
# Output keys:
#   execution_supported=true
#   execution_release_id=<uuid>
#   execution_release_version=<exact-version>
#   execution_record_id=<uuid-if-created-or-updated>
#   execution_idempotency_key=<input-key>
#   execution_started_at=<iso8601-if-known>
#   execution_completed_at=<iso8601-if-known>
#   execution_endpoint=<start|complete|reconcile-if-used>

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
SUITE_KIND=""
ITERATION_KEY=""
ITERATION_ORDINAL=""
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
REMEDIATION_REFERENCE=""
OUTPUT_FILE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --project-slug) PROJECT_SLUG="$2"; shift 2 ;;
    --release) RELEASE_VERSION="$2"; shift 2 ;;
    --sdlc-stage) SDLC_STAGE="$2"; shift 2 ;;
    --environment) ENVIRONMENT="$2"; shift 2 ;;
    --suite-kind) SUITE_KIND="$2"; shift 2 ;;
    --iteration-key) ITERATION_KEY="$2"; shift 2 ;;
    --iteration-ordinal) ITERATION_ORDINAL="$2"; shift 2 ;;
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
    --remediation-reference) REMEDIATION_REFERENCE="$2"; shift 2 ;;
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
require_arg "$SUITE_KIND" "--suite-kind"
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
    echo "Error: --outcome must be a terminal test execution outcome" >&2
    exit 1
    ;;
esac

if [ -n "$ITERATION_ORDINAL" ] && ! [[ "$ITERATION_ORDINAL" =~ ^[0-9]+$ ]]; then
  echo "Error: --iteration-ordinal must be a positive integer" >&2
  exit 1
fi

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
    echo "Error: could not resolve release ${RELEASE_VERSION} for test execution lifecycle (HTTP ${code})." >&2
    rm -f "$body"
    return 1
  fi
  latest_id=$(jq -r '.latest.id // empty' "$body" 2>/dev/null || true)
  latest_version=$(jq -r '.latest.version // empty' "$body" 2>/dev/null || true)
  rm -f "$body"
  if [ -z "$latest_id" ] || [ "$latest_version" != "$RELEASE_VERSION" ]; then
    echo "Error: release resolve for ${RELEASE_VERSION} was empty or ambiguous (latest=${latest_version:-none})." >&2
    return 1
  fi
  RELEASE_ID="$latest_id"
  RESOLVED_RELEASE_VERSION="$latest_version"
  write_output execution_release_id "$RELEASE_ID"
  write_output execution_release_version "$RESOLVED_RELEASE_VERSION"
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
    --arg suiteKind "$SUITE_KIND" \
    --arg iterationKey "$ITERATION_KEY" \
    --arg iterationOrdinal "$ITERATION_ORDINAL" \
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
    --arg remediationReference "$REMEDIATION_REFERENCE" \
    '
      {
        schemaVersion: $schemaVersion,
        sdlcStage: ($sdlcStage | tonumber),
        environment: $environment,
        cycleKind: $suiteKind,
        suiteKind: $suiteKind,
        iterationKey: ($iterationKey | if . == "" then null else . end),
        iterationOrdinal: ($iterationOrdinal | if . == "" then null else tonumber end),
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
        incidentReference: ($incidentReference | if . == "" then null else . end),
        remediationReference: ($remediationReference | if . == "" then null else . end)
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

post_execution_event() {
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
  EXECUTION_HTTP_CODE="$code"
  EXECUTION_RESPONSE_BODY_FILE="$body"
}

if ! resolve_release_exact; then
  exit 1
fi

PAYLOAD="$(build_payload "$MODE")"
ENDPOINT="$MODE"
post_execution_event "$ENDPOINT" "$PAYLOAD"

if [ "$MODE" = "complete" ] && [ "$EXECUTION_HTTP_CODE" -eq 400 ]; then
  if grep -q 'different terminal outcome' "$EXECUTION_RESPONSE_BODY_FILE" 2>/dev/null; then
    ENDPOINT="reconcile"
    post_execution_event "$ENDPOINT" "$PAYLOAD"
  fi
fi

if [ "$EXECUTION_HTTP_CODE" -lt 200 ] || [ "$EXECUTION_HTTP_CODE" -ge 300 ]; then
  BODY_EXCERPT="$(head -c 500 "$EXECUTION_RESPONSE_BODY_FILE" 2>/dev/null || true)"
  rm -f "$EXECUTION_RESPONSE_BODY_FILE"
  echo "Error: test execution ${ENDPOINT} failed for ${RELEASE_VERSION} (HTTP ${EXECUTION_HTTP_CODE})${BODY_EXCERPT:+ - ${BODY_EXCERPT}}" >&2
  exit 1
fi

EXECUTION_RECORD_ID=$(jq -r '.id // empty' "$EXECUTION_RESPONSE_BODY_FILE" 2>/dev/null || true)
rm -f "$EXECUTION_RESPONSE_BODY_FILE"
if [ -z "$EXECUTION_RECORD_ID" ]; then
  echo "Error: test execution ${ENDPOINT} succeeded but response did not include an id" >&2
  exit 1
fi

write_output execution_supported true
write_output execution_record_id "$EXECUTION_RECORD_ID"
write_output execution_idempotency_key "$IDEMPOTENCY_KEY"
write_output execution_started_at "$STARTED_AT"
write_output execution_completed_at "$COMPLETED_AT"
write_output execution_endpoint "$ENDPOINT"

echo "Test execution ${ENDPOINT} recorded for ${RELEASE_VERSION}: ${EXECUTION_RECORD_ID}"
