#!/usr/bin/env bash
# lookup-deployment-vercel.sh -- Vercel provider lookup for reconcile-deployment.sh
# (devaudit-installer#1022).
#
# Prints ONE normalized JSON object on stdout:
#   {"id","status","sha","branch","repo"}   status: success|failed|building|canceled|unknown
# Exits non-zero (message on stderr) when the deployment is not found, is not a
# production deployment, or belongs to a different Vercel project.
#
# Uses the Vercel REST API with curl and jq (no CLI needed):
#   GET https://api.vercel.com/v13/deployments/{id-or-url}[?teamId=$VERCEL_TEAM_ID]
# Needs VERCEL_TOKEN in the environment; VERCEL_TEAM_ID for a team project.
# --project is the Vercel project ID (prj_...) and is checked against the
# deployment's projectId when given; --service and --environment are unused.
# VERCEL_API_BASE overrides the API origin (tests).
set -euo pipefail

DEPLOYMENT_ID=""; PROJECT=""
for arg in "$@"; do
  case "$arg" in
    --deployment-id=*) DEPLOYMENT_ID="${arg#*=}" ;;
    --project=*) PROJECT="${arg#*=}" ;;
    --service=*|--environment=*) ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done
[ -n "$DEPLOYMENT_ID" ] || { echo "lookup-deployment-vercel: --deployment-id is required" >&2; exit 2; }
[ -n "${VERCEL_TOKEN:-}" ] || { echo "lookup-deployment-vercel: VERCEL_TOKEN is not set" >&2; exit 2; }

API="${VERCEL_API_BASE:-https://api.vercel.com}"
URL="${API%/}/v13/deployments/${DEPLOYMENT_ID}"
if [ -n "${VERCEL_TEAM_ID:-}" ]; then URL="${URL}?teamId=${VERCEL_TEAM_ID}"; fi

BODY=$(mktemp); trap 'rm -f "$BODY"' EXIT
CODE=$(curl -sS -o "$BODY" -w '%{http_code}' --connect-timeout 5 --max-time 20 \
  -H "Authorization: Bearer ${VERCEL_TOKEN}" "$URL" || echo 000)
if [ "$CODE" = "404" ]; then echo "Vercel deployment ${DEPLOYMENT_ID} was not found." >&2; exit 1; fi
if ! [[ "$CODE" =~ ^2[0-9][0-9]$ ]]; then
  echo "Vercel API returned HTTP ${CODE} for deployment ${DEPLOYMENT_ID}: $(head -c 300 "$BODY")" >&2
  exit 1
fi
jq -e . "$BODY" >/dev/null 2>&1 || { echo "Vercel API returned non-JSON for ${DEPLOYMENT_ID}" >&2; exit 1; }

TARGET=$(jq -r '.target // empty' "$BODY")
if [ "$TARGET" != "production" ]; then
  echo "Vercel deployment ${DEPLOYMENT_ID} is not a production deployment (target='${TARGET:-none}')." >&2
  exit 1
fi
if [ -n "$PROJECT" ]; then
  ACTUAL_PROJECT=$(jq -r '.projectId // empty' "$BODY")
  if [ "$ACTUAL_PROJECT" != "$PROJECT" ]; then
    echo "Vercel deployment ${DEPLOYMENT_ID} belongs to project '${ACTUAL_PROJECT}', not '${PROJECT}'." >&2
    exit 1
  fi
fi
jq -c '{
  id: (.id // .uid // ""),
  status: ((.readyState // .status // "") | ascii_upcase | if . == "READY" then "success" elif (. == "ERROR") then "failed" elif (. == "BUILDING" or . == "QUEUED" or . == "INITIALIZING") then "building" elif (. == "CANCELED") then "canceled" else "unknown" end),
  sha: (.meta.githubCommitSha // ""),
  branch: (.meta.githubCommitRef // ""),
  repo: (if (.meta.githubOrg // "") != "" and (.meta.githubRepo // "") != "" then (.meta.githubOrg + "/" + .meta.githubRepo) else "" end)
}' "$BODY"
