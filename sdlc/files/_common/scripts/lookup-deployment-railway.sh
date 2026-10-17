#!/usr/bin/env bash
# lookup-deployment-railway.sh -- Railway provider lookup for reconcile-deployment.sh
# (devaudit-installer#1022; was inlined in reconcile-railway-deployment.sh, #841/#842).
#
# Prints ONE normalized JSON object on stdout:
#   {"id","status","sha","branch","repo"}   status: success|failed|building|canceled|unknown
# Exits non-zero (message on stderr) when the deployment is not found.
#
# Needs the `railway` CLI on PATH and RAILWAY_TOKEN in the environment.
set -euo pipefail

DEPLOYMENT_ID=""; PROJECT=""; SERVICE=""; ENVIRONMENT="production"
for arg in "$@"; do
  case "$arg" in
    --deployment-id=*) DEPLOYMENT_ID="${arg#*=}" ;;
    --project=*) PROJECT="${arg#*=}" ;;
    --service=*) SERVICE="${arg#*=}" ;;
    --environment=*) ENVIRONMENT="${arg#*=}" ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done
[ -n "$DEPLOYMENT_ID" ] && [ -n "$PROJECT" ] && [ -n "$SERVICE" ] || { echo "lookup-deployment-railway: --deployment-id, --project and --service are required" >&2; exit 2; }

DEPLOYMENTS=$(railway deployment list --json --project "$PROJECT" --environment "$ENVIRONMENT" --service "$SERVICE" --limit 100)
MATCH=$(jq -cer --arg id "$DEPLOYMENT_ID" '.[] | select(.id == $id)' <<<"$DEPLOYMENTS") || {
  echo "Railway deployment ${DEPLOYMENT_ID} was not found." >&2
  exit 1
}
jq -c '{
  id: .id,
  status: ((.status // "") | ascii_downcase | if . == "success" then "success" elif (. == "failed" or . == "crashed") then "failed" elif (. == "building" or . == "deploying" or . == "initializing" or . == "queued") then "building" elif (. == "removed" or . == "skipped") then "canceled" else "unknown" end),
  sha: (.meta.commitHash // ""),
  branch: (.meta.branch // ""),
  repo: (.meta.repo // "")
}' <<<"$MATCH"
