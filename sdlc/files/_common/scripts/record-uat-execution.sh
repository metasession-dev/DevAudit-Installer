#!/usr/bin/env bash
# record-uat-execution.sh - Record an explicit Stage 4 UAT execution.
#
# This script does not submit, approve, or release anything. It records the
# manual UAT execution that happened while the release was under UAT review.
#
# Usage:
#   ./scripts/record-uat-execution.sh \
#     --project-slug <slug> \
#     --release <REQ-XXX|version> \
#     --outcome <passed|failed|cancelled|skipped|timed_out|action_required> \
#     --executor <identity> \
#     [--tested-sha <sha>] \
#     [--build-version <version>] \
#     [--checklist-ref <path-or-url>] \
#     [--evidence-ref <path-or-url>] \
#     [--remediation-ref <issue-or-url>] \
#     [--executed-at <iso8601>] \
#     [--execution-id <stable-id>] \
#     [--output-file <path>]
#
# Required environment:
#   DEVAUDIT_BASE_URL
#   DEVAUDIT_API_KEY

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORT_TEST_EXECUTION="${REPORT_TEST_EXECUTION_HELPER:-${SCRIPT_DIR}/report-test-execution.sh}"

usage() {
  sed -n '1,38p' "$0" >&2
  exit 1
}

PROJECT_SLUG=""
RELEASE_VERSION=""
OUTCOME=""
EXECUTOR=""
TESTED_SHA="${GITHUB_SHA:-}"
BUILD_VERSION=""
CHECKLIST_REF=""
EVIDENCE_REF=""
REMEDIATION_REF=""
EXECUTED_AT=""
EXECUTION_ID=""
OUTPUT_FILE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --project-slug) PROJECT_SLUG="${2:-}"; shift 2 ;;
    --release) RELEASE_VERSION="${2:-}"; shift 2 ;;
    --outcome) OUTCOME="${2:-}"; shift 2 ;;
    --executor) EXECUTOR="${2:-}"; shift 2 ;;
    --tested-sha) TESTED_SHA="${2:-}"; shift 2 ;;
    --build-version) BUILD_VERSION="${2:-}"; shift 2 ;;
    --checklist-ref) CHECKLIST_REF="${2:-}"; shift 2 ;;
    --evidence-ref) EVIDENCE_REF="${2:-}"; shift 2 ;;
    --remediation-ref) REMEDIATION_REF="${2:-}"; shift 2 ;;
    --executed-at) EXECUTED_AT="${2:-}"; shift 2 ;;
    --execution-id) EXECUTION_ID="${2:-}"; shift 2 ;;
    --output-file) OUTPUT_FILE="${2:-}"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1" >&2; usage ;;
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
require_arg "$OUTCOME" "--outcome"
require_arg "$EXECUTOR" "--executor"

case "$OUTCOME" in
  passed|failed|cancelled|skipped|timed_out|action_required) ;;
  *)
    echo "Error: --outcome must be passed, failed, cancelled, skipped, timed_out, or action_required" >&2
    exit 1
    ;;
esac
if [ "$OUTCOME" = "failed" ] && [ -z "$REMEDIATION_REF" ]; then
  echo "Error: --remediation-ref is required when --outcome failed" >&2
  exit 1
fi

if [ -z "${DEVAUDIT_BASE_URL:-}" ]; then
  echo "Error: DEVAUDIT_BASE_URL environment variable is required" >&2
  exit 1
fi
if [ -z "${DEVAUDIT_API_KEY:-}" ]; then
  echo "Error: DEVAUDIT_API_KEY environment variable is required" >&2
  exit 1
fi
if [ ! -x "$REPORT_TEST_EXECUTION" ]; then
  echo "Error: report-test-execution helper not found or not executable: $REPORT_TEST_EXECUTION" >&2
  exit 1
fi

if [ -z "$TESTED_SHA" ] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  TESTED_SHA="$(git rev-parse HEAD)"
fi
if [ -z "$TESTED_SHA" ]; then
  echo "Error: --tested-sha is required when GITHUB_SHA is unset and git HEAD cannot be resolved" >&2
  exit 1
fi

iso_now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

hash_value() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | awk '{print $1}'
  else
    printf '%s' "$1" | shasum -a 256 | awk '{print $1}'
  fi
}

sanitize_id_part() {
  printf '%s' "$1" | tr -cs 'A-Za-z0-9._:-' '-'
}

[ -n "$EXECUTED_AT" ] || EXECUTED_AT="$(iso_now)"

if [ -z "$EXECUTION_ID" ]; then
  KEY_SOURCE="${PROJECT_SLUG}|${RELEASE_VERSION}|${TESTED_SHA}|${BUILD_VERSION}|${EXECUTOR}|${OUTCOME}|${CHECKLIST_REF}|${EVIDENCE_REF}|${REMEDIATION_REF}"
  KEY_HASH="$(hash_value "$KEY_SOURCE" | cut -c1-16)"
  EXECUTION_ID="manual-uat:$(sanitize_id_part "$RELEASE_VERSION"):$(sanitize_id_part "$TESTED_SHA" | cut -c1-12):${KEY_HASH}"
fi

IDEMPOTENCY_KEY="manual-uat:${PROJECT_SLUG}:${RELEASE_VERSION}:${EXECUTION_ID}"
OUTCOME_REASON="executor=${EXECUTOR}; tested_sha=${TESTED_SHA}"
[ -z "$BUILD_VERSION" ] || OUTCOME_REASON="${OUTCOME_REASON}; build=${BUILD_VERSION}"
[ -z "$CHECKLIST_REF" ] || OUTCOME_REASON="${OUTCOME_REASON}; checklist=${CHECKLIST_REF}"
[ -z "$EVIDENCE_REF" ] || OUTCOME_REASON="${OUTCOME_REASON}; evidence=${EVIDENCE_REF}"
[ -z "$REMEDIATION_REF" ] || OUTCOME_REASON="${OUTCOME_REASON}; remediation=${REMEDIATION_REF}"

START_OUTPUT="$(mktemp)"
COMPLETE_OUTPUT="$(mktemp)"
cleanup() {
  rm -f "$START_OUTPUT" "$COMPLETE_OUTPUT"
}
trap cleanup EXIT

COMMON_ARGS=(
  --project-slug "$PROJECT_SLUG"
  --release "$RELEASE_VERSION"
  --sdlc-stage 4
  --environment uat
  --suite-kind uat
  --iteration-key "uat:${RELEASE_VERSION}:${TESTED_SHA}"
  --provider manual_uat
  --external-run-id "$EXECUTION_ID"
  --external-job-id "manual-uat-execution"
  --commit-sha "$TESTED_SHA"
  --branch "uat"
  --workflow-name "Manual UAT execution"
  --workflow-url "${DEVAUDIT_BASE_URL%/}/projects/${PROJECT_SLUG}/requirements/${RELEASE_VERSION}"
  --idempotency-key "$IDEMPOTENCY_KEY"
  --started-at "$EXECUTED_AT"
)
COMPLETE_ARGS=(
  "${COMMON_ARGS[@]}"
  --completed-at "$EXECUTED_AT"
  --outcome "$OUTCOME"
  --outcome-reason "$OUTCOME_REASON"
)
if [ -n "$REMEDIATION_REF" ]; then
  COMPLETE_ARGS+=(--incident-reference "$REMEDIATION_REF")
fi

"$REPORT_TEST_EXECUTION" start "${COMMON_ARGS[@]}" --output-file "$START_OUTPUT"
"$REPORT_TEST_EXECUTION" complete "${COMPLETE_ARGS[@]}" --output-file "$COMPLETE_OUTPUT"

if [ -n "$OUTPUT_FILE" ]; then
  {
    printf 'uat_execution_id=%s\n' "$EXECUTION_ID"
    printf 'uat_idempotency_key=%s\n' "$IDEMPOTENCY_KEY"
    printf 'uat_outcome=%s\n' "$OUTCOME"
    printf 'uat_executed_at=%s\n' "$EXECUTED_AT"
    grep '^execution_' "$COMPLETE_OUTPUT" || true
  } >> "$OUTPUT_FILE"
fi

echo "Recorded Stage 4 UAT execution for ${RELEASE_VERSION}: ${OUTCOME}"
echo "  Execution ID: ${EXECUTION_ID}"
echo "  Tested SHA: ${TESTED_SHA}"
echo "  Executor: ${EXECUTOR}"
