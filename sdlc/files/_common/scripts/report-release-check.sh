#!/usr/bin/env bash
# Records authoritative required-check state independently of evidence upload.
set -euo pipefail

PROJECT_SLUG="" RELEASE_VERSION="" CHECK_KEY="" LABEL="" PROVIDER="github_actions"
STATUS="" REQUIRED="true" EXTERNAL_RUN_ID="" EXTERNAL_URL="" COMMIT_SHA="" BRANCH=""
STARTED_AT="" COMPLETED_AT="" DETAILS_JSON='{}'

while [ "$#" -gt 0 ]; do
  case "$1" in
    --project-slug) PROJECT_SLUG="$2"; shift 2 ;;
    --release) RELEASE_VERSION="$2"; shift 2 ;;
    --check-key) CHECK_KEY="$2"; shift 2 ;;
    --label) LABEL="$2"; shift 2 ;;
    --provider) PROVIDER="$2"; shift 2 ;;
    --status) STATUS="$2"; shift 2 ;;
    --required) REQUIRED="$2"; shift 2 ;;
    --external-run-id) EXTERNAL_RUN_ID="$2"; shift 2 ;;
    --external-url) EXTERNAL_URL="$2"; shift 2 ;;
    --commit-sha) COMMIT_SHA="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --started-at) STARTED_AT="$2"; shift 2 ;;
    --completed-at) COMPLETED_AT="$2"; shift 2 ;;
    --details-json) DETAILS_JSON="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

for value in PROJECT_SLUG RELEASE_VERSION CHECK_KEY LABEL STATUS; do
  if [ -z "${!value}" ]; then echo "Error: ${value} is required" >&2; exit 1; fi
done
case "$STATUS" in
  queued|running|successful|failed|cancelled|timed_out|skipped|action_required|unknown) ;;
  *) echo "Error: invalid check status '$STATUS'" >&2; exit 1 ;;
esac
jq -e 'type == "object"' >/dev/null <<<"$DETAILS_JSON" || {
  echo "Error: --details-json must be a JSON object" >&2; exit 1;
}

BASE="${DEVAUDIT_BASE_URL%/}"
if [ -z "$BASE" ] || [ -z "${DEVAUDIT_API_KEY:-}" ]; then
  echo "::warning::Release check reporting skipped: DevAudit URL/API key missing" >&2
  exit 0
fi
ENCODED_SLUG=$(jq -rn --arg v "$PROJECT_SLUG" '$v|@uri')
ENCODED_VERSION=$(jq -rn --arg v "$RELEASE_VERSION" '$v|@uri')
RESOLVE=$(curl -fsS \
  -H "Authorization: Bearer ${DEVAUDIT_API_KEY}" \
  "${BASE}/api/ci/releases/resolve?projectSlug=${ENCODED_SLUG}&versionPrefix=${ENCODED_VERSION}" || true)
RELEASE_ID=$(jq -r --arg version "$RELEASE_VERSION" \
  'if .latest.version == $version then .latest.id // empty else empty end' <<<"$RESOLVE" 2>/dev/null || true)
if [ -z "$RELEASE_ID" ]; then
  echo "::warning::Release check reporting skipped: exact release ${RELEASE_VERSION} not found" >&2
  exit 0
fi

PAYLOAD=$(jq -n \
  --arg checkKey "$CHECK_KEY" --arg displayLabel "$LABEL" --arg provider "$PROVIDER" \
  --arg status "$STATUS" --argjson required "$REQUIRED" \
  --arg externalRunId "$EXTERNAL_RUN_ID" --arg externalUrl "$EXTERNAL_URL" \
  --arg commitSha "$COMMIT_SHA" --arg branch "$BRANCH" \
  --arg startedAt "$STARTED_AT" --arg completedAt "$COMPLETED_AT" \
  --argjson details "$DETAILS_JSON" \
  '{checkKey:$checkKey,label:$displayLabel,provider:$provider,status:$status,required:$required,
    externalRunId:(if $externalRunId=="" then null else $externalRunId end),
    externalUrl:(if $externalUrl=="" then null else $externalUrl end),
    commitSha:(if $commitSha=="" then null else $commitSha end),
    branch:(if $branch=="" then null else $branch end),
    startedAt:(if $startedAt=="" then null else $startedAt end),
    completedAt:(if $completedAt=="" then null else $completedAt end),details:$details}')

RESPONSE_FILE=$(mktemp)
trap 'rm -f "$RESPONSE_FILE"' EXIT
HTTP_CODE=$(curl -sS -o "$RESPONSE_FILE" -w '%{http_code}' \
  -X POST "${BASE}/api/ci/releases/${RELEASE_ID}/checks" \
  -H "Authorization: Bearer ${DEVAUDIT_API_KEY}" -H 'Content-Type: application/json' \
  -d "$PAYLOAD")
if [ "$HTTP_CODE" = "404" ]; then
  echo "::warning::Portal does not support first-class release checks yet" >&2
  exit 0
fi
if [ "$HTTP_CODE" -lt 200 ] || [ "$HTTP_CODE" -ge 300 ]; then
  cat "$RESPONSE_FILE" >&2 || true
  echo "Error: release check API returned HTTP ${HTTP_CODE}" >&2
  exit 1
fi
