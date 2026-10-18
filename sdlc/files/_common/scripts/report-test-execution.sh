#!/usr/bin/env bash
# report-test-execution.sh - Producer helper for first-class test execution lifecycle events.
#
# Usage:
#   ./scripts/report-test-execution.sh start|complete [flags...]
#   ./scripts/report-test-execution.sh resolve --test-cycle-id <uuid> --resolution-type <type> --reason <text> [flags...]
#
# Required flags (start|complete):
#   --project-slug <slug>
#   --release <version>
#   --sdlc-stage <1-5>
#   --environment <ci|uat|production>
#   --suite-kind <kind>
#   --idempotency-key <key>
#
# Required flags (resolve):
#   --project-slug <slug>
#   --release <version>
#   --test-cycle-id <uuid>
#   --resolution-type <retry_passed|superseded|accepted_exception|incident_remediated>
#   --reason <text>
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
#   --incident-reference <text>    Attached to the cycle row on start|complete
#   --remediation-reference <text> Attached to the cycle row on start|complete; or on `resolve`, threaded into the resolution record
#   --resolved-by-cycle-id <uuid>  `resolve` only -- the passing cycle that supersedes this one, if any
#   --record <path>                `resolve` only -- the documented accepted-exception record
#                                  (compliance/evidence/REQ-XXX/accepted-e2e-failure-<spec>.md).
#                                  REQUIRED for --resolution-type accepted_exception, together with
#                                  --remediation-reference (the tracking issue) -- see below.
#   --output-file <path>           Writes key=value outputs for callers
#
# `resolve` is the self-service path for a failed cycle on an immutable,
# already-shipped commit that can never honestly produce a passing rerun
# (devaudit#866/#867) -- e.g. a post-deploy regression suite failing on an
# already-tracked, unrelated defect. It calls the existing
# POST /api/ci/releases/{id}/cycles/{cycleId}/resolve endpoint directly,
# which `--incident-reference`/`--remediation-reference` on `complete` never
# reached on their own. Example:
#
#   report-test-execution.sh resolve \
#     --project-slug example-app --release REQ-108 \
#     --test-cycle-id 77eb11a9-428d-4aaa-8bd7-d3d0550c6f06 \
#     --resolution-type accepted_exception \
#     --reason "unrelated pre-existing defect example-org/example-app#852" \
#     --remediation-reference https://github.com/example-org/example-app/issues/852 \
#     --record compliance/evidence/REQ-108/accepted-e2e-failure-webhook-idempotency.md
#
# devaudit-installer#1016: `accepted_exception` is a documented waiver, never a
# silent one. It is refused unless --remediation-reference names the tracking
# issue AND --record points at a record that passes
# scripts/validate-risk-acceptance-record.sh --kind e2e (impact assessment,
# decision-maker, a review date in the future, an exact tracking-issue URL).
# The record path is appended to the reason sent to the portal. Fixing the
# failure (retry_passed with a verified re-run, incident_remediated) needs
# neither. Resolving here records triage in the portal directly, so
# `execution_triage_missing` clears without merging anything into the release
# head.
#
# Output keys:
#   execution_supported=true
#   execution_release_id=<uuid>
#   execution_release_version=<exact-version>
#   execution_record_id=<uuid-if-created-or-updated>
#   execution_idempotency_key=<input-key-if-applicable>
#   execution_started_at=<iso8601-if-known>
#   execution_completed_at=<iso8601-if-known>
#   execution_endpoint=<start|complete|reconcile-if-used|resolve>

set -euo pipefail

usage() {
  echo "Usage: $0 start|complete|resolve [flags...]"
  exit 1
}

[ "$#" -ge 1 ] || usage
MODE="$1"
shift

case "$MODE" in
  start|complete|resolve) ;;
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
TEST_CYCLE_ID=""
RESOLUTION_TYPE=""
RESOLVED_BY_CYCLE_ID=""
REASON=""
RECORD_PATH=""
# devaudit-installer#1019 -- default on; see classify-pr-attribution.sh.
ATTRIBUTION_GUARD="${DEVAUDIT_ATTRIBUTION_GUARD:-1}"

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
    --test-cycle-id) TEST_CYCLE_ID="$2"; shift 2 ;;
    --resolution-type) RESOLUTION_TYPE="$2"; shift 2 ;;
    --resolved-by-cycle-id) RESOLVED_BY_CYCLE_ID="$2"; shift 2 ;;
    --reason) REASON="$2"; shift 2 ;;
    --record) RECORD_PATH="$2"; shift 2 ;;
    --no-attribution-guard) ATTRIBUTION_GUARD=0; shift ;;
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

# devaudit-installer#1019 -- a pull request that changes no code (documentation
# / compliance records only) must not record a release-scoped test execution:
# its head SHA and branch would become the release's "tested" code. start and
# complete are skipped with a warning; resolve is a deliberate triage action and
# is unaffected.
if [ "$MODE" != "resolve" ] && [ "$ATTRIBUTION_GUARD" != "0" ] && [ "${GITHUB_EVENT_NAME:-}" = "pull_request" ] \
   && [ -n "${GITHUB_BASE_REF:-}" ] && [ -f "$(dirname "${BASH_SOURCE[0]}")/classify-pr-attribution.sh" ]; then
  ATTRIBUTION="$(bash "$(dirname "${BASH_SOURCE[0]}")/classify-pr-attribution.sh" --base "origin/${GITHUB_BASE_REF}" 2>/dev/null || echo attach)"
  case "$ATTRIBUTION" in
    skip:*)
      echo "::warning::This PR changes no code (${ATTRIBUTION#skip:}); not recording a release-scoped test execution for ${RELEASE_VERSION} (devaudit-installer#1019). Pass --no-attribution-guard to override."
      if [ -n "$OUTPUT_FILE" ]; then
        printf 'execution_supported=false\nexecution_skipped_reason=attribution_guard_%s\n' "${ATTRIBUTION#skip:}" > "$OUTPUT_FILE"
      fi
      exit 0
      ;;
  esac
fi

if [ "$MODE" = "resolve" ]; then
  require_arg "$TEST_CYCLE_ID" "--test-cycle-id"
  require_arg "$RESOLUTION_TYPE" "--resolution-type"
  require_arg "$REASON" "--reason"
  case "$RESOLUTION_TYPE" in
    retry_passed|superseded|accepted_exception|incident_remediated) ;;
    *)
      echo "Error: --resolution-type must be one of retry_passed, superseded, accepted_exception, incident_remediated" >&2
      exit 1
      ;;
  esac
  # devaudit-installer#1016 -- accepting a failure requires a documented
  # exception (impact, decision-maker, review date, tracking issue), checked
  # before any network call.
  if [ "$RESOLUTION_TYPE" = "accepted_exception" ]; then
    require_arg "$REMEDIATION_REFERENCE" "--remediation-reference (the tracking issue for an accepted_exception)"
    require_arg "$RECORD_PATH" "--record (the accepted-exception record for an accepted_exception)"
    RECORD_VALIDATOR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/validate-risk-acceptance-record.sh"
    if [ ! -f "$RECORD_VALIDATOR" ]; then
      echo "Error: $RECORD_VALIDATOR is missing; run devaudit update to restore the synced scripts." >&2
      exit 1
    fi
    if ! bash "$RECORD_VALIDATOR" --kind e2e "$RECORD_PATH" >&2; then
      echo "Error: --record failed validation; an accepted_exception needs a complete accepted-exception record." >&2
      exit 1
    fi
    REASON="${REASON} (record: ${RECORD_PATH})"
  fi
else
  require_arg "$SDLC_STAGE" "--sdlc-stage"
  require_arg "$ENVIRONMENT" "--environment"
  require_arg "$SUITE_KIND" "--suite-kind"
  require_arg "$IDEMPOTENCY_KEY" "--idempotency-key"

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
fi

if [ -z "${DEVAUDIT_BASE_URL:-}" ]; then
  echo "Error: DEVAUDIT_BASE_URL environment variable is required" >&2
  exit 1
fi
if [ -z "${DEVAUDIT_API_KEY:-}" ]; then
  echo "Error: DEVAUDIT_API_KEY environment variable is required (CI already" >&2
  echo "       has one as a repo secret)." >&2
  echo "       Consequence: this test-execution record cannot be reported" >&2
  echo "       without it. Fallback (devaudit-installer#845): this is CI/" >&2
  echo "       operator-only work by design — a session running locally" >&2
  echo "       without the key should let the CI-driven quality-gates run" >&2
  echo "       report it instead, or have an operator record it manually on" >&2
  echo "       the portal." >&2
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

build_resolution_payload() {
  jq -n \
    --arg resolutionType "$RESOLUTION_TYPE" \
    --arg resolvedByCycleId "$RESOLVED_BY_CYCLE_ID" \
    --arg reason "$REASON" \
    --arg remediationReference "$REMEDIATION_REFERENCE" \
    '
      {
        resolutionType: $resolutionType,
        resolvedByCycleId: ($resolvedByCycleId | if . == "" then null else . end),
        reason: $reason,
        remediationReference: ($remediationReference | if . == "" then null else . end)
      }
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

post_resolution_event() {
  local payload="$1" body code
  body=$(mktemp)
  code=$(curl -sS -o "$body" -w "%{http_code}" \
    -X POST \
    -H "Authorization: Bearer ${DEVAUDIT_API_KEY}" \
    -H "Content-Type: application/json" \
    --connect-timeout "$CONNECT_TIMEOUT_SECONDS" \
    --max-time "$MAX_TIME_SECONDS" \
    "${DEVAUDIT_BASE_URL}/api/ci/releases/${RELEASE_ID}/cycles/${TEST_CYCLE_ID}/resolve" \
    -d "$payload")
  EXECUTION_HTTP_CODE="$code"
  EXECUTION_RESPONSE_BODY_FILE="$body"
}

if ! resolve_release_exact; then
  exit 1
fi

if [ "$MODE" = "resolve" ]; then
  PAYLOAD="$(build_resolution_payload)"
  ENDPOINT="resolve"
  post_resolution_event "$PAYLOAD"
else
  PAYLOAD="$(build_payload "$MODE")"
  ENDPOINT="$MODE"
  post_execution_event "$ENDPOINT" "$PAYLOAD"

  if [ "$MODE" = "complete" ] && [ "$EXECUTION_HTTP_CODE" -eq 400 ]; then
    if grep -q 'different terminal outcome' "$EXECUTION_RESPONSE_BODY_FILE" 2>/dev/null; then
      ENDPOINT="reconcile"
      post_execution_event "$ENDPOINT" "$PAYLOAD"
    fi
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
[ -z "$IDEMPOTENCY_KEY" ] || write_output execution_idempotency_key "$IDEMPOTENCY_KEY"
[ -z "$STARTED_AT" ] || write_output execution_started_at "$STARTED_AT"
[ -z "$COMPLETED_AT" ] || write_output execution_completed_at "$COMPLETED_AT"
write_output execution_endpoint "$ENDPOINT"

echo "Test execution ${ENDPOINT} recorded for ${RELEASE_VERSION}: ${EXECUTION_RECORD_ID}"
