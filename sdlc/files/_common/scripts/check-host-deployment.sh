#!/usr/bin/env bash
# check-host-deployment.sh — wait for a terminal GitHub deployment status for a
# merged production SHA before the release is promoted on the portal.

set -euo pipefail

REPO=""
SHA=""
MAX_ATTEMPTS=30
POLL_SECONDS=10
OUTPUT_FILE=""

for arg in "$@"; do
  case "$arg" in
    --repo=*) REPO="${arg#*=}" ;;
    --sha=*) SHA="${arg#*=}" ;;
    --max-attempts=*) MAX_ATTEMPTS="${arg#*=}" ;;
    --poll-seconds=*) POLL_SECONDS="${arg#*=}" ;;
    --output-file=*) OUTPUT_FILE="${arg#*=}" ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

if [ -z "$REPO" ] || [ -z "$SHA" ]; then
  echo "Usage: check-host-deployment.sh --repo=<owner/name> --sha=<sha> [--max-attempts=N] [--poll-seconds=N] [--output-file=path]" >&2
  exit 2
fi

select_deployment_id() {
  python3 - <<'PY'
import json
import os

deployments = json.loads(os.environ.get("DEPLOYMENTS_JSON", "[]"))
preferred = None
fallback = None
for deployment in deployments:
    env = str(deployment.get("environment") or "").lower()
    dep_id = deployment.get("id")
    if dep_id is None:
        continue
    if fallback is None:
        fallback = dep_id
    if env in {"production", "prod"}:
        preferred = dep_id
        break
if preferred is not None:
    print(preferred)
elif fallback is not None:
    print(fallback)
PY
}

extract_status_state() {
  python3 - <<'PY'
import json
import os

statuses = json.loads(os.environ.get("STATUSES_JSON", "[]"))
if statuses:
    latest = statuses[0]
    print(str(latest.get("state") or "").lower())
PY
}

extract_status_details() {
  python3 - <<'PY'
import json
import os

statuses = json.loads(os.environ.get("STATUSES_JSON", "[]"))
latest = statuses[0] if statuses else {}
print(json.dumps({
    "state": str(latest.get("state") or "").lower(),
    "description": str(latest.get("description") or ""),
    "target_url": str(latest.get("target_url") or latest.get("environment_url") or ""),
    "environment": str(latest.get("environment") or ""),
}, separators=(",", ":")))
PY
}

json_field() {
  STATUS_DETAILS="$1" FIELD="$2" python3 - <<'PY'
import json
import os
print(json.loads(os.environ["STATUS_DETAILS"]).get(os.environ["FIELD"], ""))
PY
}

write_result() {
  local verification="$1" deployment_id="$2" deployment_state="$3" description="$4" target_url="$5" environment="$6" attempt="$7"
  [ -n "$OUTPUT_FILE" ] || return 0
  cat > "$OUTPUT_FILE" <<EOF
verification=${verification}
deployment_id=${deployment_id}
deployment_state=${deployment_state}
description=${description}
target_url=${target_url}
environment=${environment}
attempt=${attempt}
elapsed_seconds=$(( (ATTEMPT - 1) * POLL_SECONDS ))
EOF
}

for ATTEMPT in $(seq 1 "$MAX_ATTEMPTS"); do
  DEPLOYMENTS_JSON=$(gh api "/repos/${REPO}/deployments?sha=${SHA}&per_page=20")
  DEPLOYMENT_ID=$(DEPLOYMENTS_JSON="$DEPLOYMENTS_JSON" select_deployment_id)

  if [ -z "$DEPLOYMENT_ID" ]; then
    echo "::notice::deployment verification attempt=${ATTEMPT}/${MAX_ATTEMPTS} sha=${SHA} deployment_id=none state=missing"
    if [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; then
      sleep "$POLL_SECONDS"
      continue
    fi
    write_result "deployment_status_missing" "" "" "No GitHub deployment was published for the SHA" "" "" "$ATTEMPT"
    echo "::error::deployment_status_missing: no GitHub deployment was published for ${SHA} after ${MAX_ATTEMPTS} attempts."
    exit 1
  fi

  STATUSES_JSON=$(gh api "/repos/${REPO}/deployments/${DEPLOYMENT_ID}/statuses?per_page=20")
  STATUS_DETAILS=$(STATUSES_JSON="$STATUSES_JSON" extract_status_details)
  DEPLOY_STATE=$(json_field "$STATUS_DETAILS" state)
  DESCRIPTION=$(json_field "$STATUS_DETAILS" description)
  TARGET_URL=$(json_field "$STATUS_DETAILS" target_url)
  ENVIRONMENT=$(json_field "$STATUS_DETAILS" environment)
  echo "::notice::deployment verification attempt=${ATTEMPT}/${MAX_ATTEMPTS} sha=${SHA} deployment_id=${DEPLOYMENT_ID} environment=${ENVIRONMENT:-unknown} state=${DEPLOY_STATE:-missing} target_url=${TARGET_URL:-none} elapsed_seconds=$(( (ATTEMPT - 1) * POLL_SECONDS ))"

  case "$DEPLOY_STATE" in
    success)
      write_result "success" "$DEPLOYMENT_ID" "$DEPLOY_STATE" "$DESCRIPTION" "$TARGET_URL" "$ENVIRONMENT" "$ATTEMPT"
      echo "GitHub deployment ${DEPLOYMENT_ID} for ${SHA} reached terminal success."
      exit 0
      ;;
    failure|error)
      write_result "deployment_terminal_failure" "$DEPLOYMENT_ID" "$DEPLOY_STATE" "$DESCRIPTION" "$TARGET_URL" "$ENVIRONMENT" "$ATTEMPT"
      echo "::error::deployment_terminal_failure: GitHub deployment ${DEPLOYMENT_ID} for ${SHA} reached ${DEPLOY_STATE}. ${DESCRIPTION} ${TARGET_URL}"
      exit 1
      ;;
    queued|in_progress|pending|"")
      if [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; then
        sleep "$POLL_SECONDS"
        continue
      fi
      write_result "deployment_status_timeout" "$DEPLOYMENT_ID" "${DEPLOY_STATE:-missing}" "$DESCRIPTION" "$TARGET_URL" "$ENVIRONMENT" "$ATTEMPT"
      echo "::error::deployment_status_timeout: GitHub deployment ${DEPLOYMENT_ID} for ${SHA} remained ${DEPLOY_STATE:-missing} after ${MAX_ATTEMPTS} attempts. Last target URL: ${TARGET_URL:-none}."
      exit 1
      ;;
    *)
      write_result "deployment_status_unknown" "$DEPLOYMENT_ID" "$DEPLOY_STATE" "$DESCRIPTION" "$TARGET_URL" "$ENVIRONMENT" "$ATTEMPT"
      echo "::error::deployment_status_unknown: deployment ${DEPLOYMENT_ID} for ${SHA} returned unexpected state '${DEPLOY_STATE}'. ${DESCRIPTION} ${TARGET_URL}"
      exit 1
      ;;
  esac
done
