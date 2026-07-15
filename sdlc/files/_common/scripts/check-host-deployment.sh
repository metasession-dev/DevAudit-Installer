#!/usr/bin/env bash
# check-host-deployment.sh — wait for a terminal GitHub deployment status for a
# merged production SHA before the release is promoted on the portal.

set -euo pipefail

REPO=""
SHA=""
MAX_ATTEMPTS=30
POLL_SECONDS=10

for arg in "$@"; do
  case "$arg" in
    --repo=*) REPO="${arg#*=}" ;;
    --sha=*) SHA="${arg#*=}" ;;
    --max-attempts=*) MAX_ATTEMPTS="${arg#*=}" ;;
    --poll-seconds=*) POLL_SECONDS="${arg#*=}" ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

if [ -z "$REPO" ] || [ -z "$SHA" ]; then
  echo "Usage: check-host-deployment.sh --repo=<owner/name> --sha=<sha> [--max-attempts=N] [--poll-seconds=N]" >&2
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

for ATTEMPT in $(seq 1 "$MAX_ATTEMPTS"); do
  DEPLOYMENTS_JSON=$(gh api "/repos/${REPO}/deployments?sha=${SHA}&per_page=20")
  DEPLOYMENT_ID=$(DEPLOYMENTS_JSON="$DEPLOYMENTS_JSON" select_deployment_id)

  if [ -z "$DEPLOYMENT_ID" ]; then
    echo "Attempt ${ATTEMPT}/${MAX_ATTEMPTS}: no GitHub deployment found yet for ${SHA}."
    if [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; then
      sleep "$POLL_SECONDS"
      continue
    fi
    echo "::error::No GitHub deployment was published for ${SHA} after ${MAX_ATTEMPTS} attempts."
    exit 1
  fi

  STATUSES_JSON=$(gh api "/repos/${REPO}/deployments/${DEPLOYMENT_ID}/statuses?per_page=20")
  DEPLOY_STATE=$(STATUSES_JSON="$STATUSES_JSON" extract_status_state)

  case "$DEPLOY_STATE" in
    success)
      echo "GitHub deployment ${DEPLOYMENT_ID} for ${SHA} reached terminal success."
      exit 0
      ;;
    failure|error)
      echo "::error::GitHub deployment ${DEPLOYMENT_ID} for ${SHA} reached terminal failure (${DEPLOY_STATE})."
      exit 1
      ;;
    queued|in_progress|pending|"")
      echo "Attempt ${ATTEMPT}/${MAX_ATTEMPTS}: deployment ${DEPLOYMENT_ID} for ${SHA} is ${DEPLOY_STATE:-pending}."
      if [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; then
        sleep "$POLL_SECONDS"
        continue
      fi
      echo "::error::GitHub deployment ${DEPLOYMENT_ID} for ${SHA} did not reach a terminal success state after ${MAX_ATTEMPTS} attempts."
      exit 1
      ;;
    *)
      echo "::error::Deployment ${DEPLOYMENT_ID} for ${SHA} returned unexpected state '${DEPLOY_STATE}'."
      exit 1
      ;;
  esac
done
