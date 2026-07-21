#!/usr/bin/env bash
# Reconcile a verified Railway recovery deployment to its GitHub deployment.
set -euo pipefail

REPO=""; SHA=""; GITHUB_DEPLOYMENT_ID=""; RAILWAY_DEPLOYMENT_ID=""
RAILWAY_PROJECT=""; RAILWAY_ENVIRONMENT="production"; RAILWAY_SERVICE=""; HEALTH_URL=""
for arg in "$@"; do
  case "$arg" in
    --repo=*) REPO="${arg#*=}" ;; --sha=*) SHA="${arg#*=}" ;;
    --github-deployment-id=*) GITHUB_DEPLOYMENT_ID="${arg#*=}" ;;
    --railway-deployment-id=*) RAILWAY_DEPLOYMENT_ID="${arg#*=}" ;;
    --railway-project=*) RAILWAY_PROJECT="${arg#*=}" ;;
    --railway-environment=*) RAILWAY_ENVIRONMENT="${arg#*=}" ;;
    --railway-service=*) RAILWAY_SERVICE="${arg#*=}" ;;
    --health-url=*) HEALTH_URL="${arg#*=}" ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done
[ -n "$REPO" ] && [ -n "$SHA" ] && [ -n "$GITHUB_DEPLOYMENT_ID" ] && [ -n "$RAILWAY_DEPLOYMENT_ID" ] && [ -n "$RAILWAY_PROJECT" ] && [ -n "$RAILWAY_SERVICE" ] && [ -n "$HEALTH_URL" ] || { echo "Missing required reconciliation arguments" >&2; exit 2; }

DEPLOYMENTS=$(railway deployment list --json --project "$RAILWAY_PROJECT" --environment "$RAILWAY_ENVIRONMENT" --service "$RAILWAY_SERVICE" --limit 100)
MATCH=$(jq -cer --arg id "$RAILWAY_DEPLOYMENT_ID" '.[] | select(.id == $id)' <<<"$DEPLOYMENTS") || { echo "::error::Railway deployment ${RAILWAY_DEPLOYMENT_ID} was not found."; exit 1; }
STATUS=$(jq -r '.status // empty' <<<"$MATCH")
PROVIDER_SHA=$(jq -r '.meta.commitHash // empty' <<<"$MATCH")
BRANCH=$(jq -r '.meta.branch // empty' <<<"$MATCH")
PROVIDER_REPO=$(jq -r '.meta.repo // empty' <<<"$MATCH")
[ "$STATUS" = "SUCCESS" ] || { echo "::error::Railway deployment is not terminal-successful: ${STATUS:-missing}"; exit 1; }
[ "$PROVIDER_SHA" = "$SHA" ] && [ "$BRANCH" = "main" ] && [ "$PROVIDER_REPO" = "$REPO" ] || { echo "::error::Railway provenance mismatch: repo=$PROVIDER_REPO branch=$BRANCH sha=$PROVIDER_SHA"; exit 1; }
HTTP=$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 15 "$HEALTH_URL" || echo 000)
[[ "$HTTP" =~ ^[23][0-9][0-9]$ ]] || { echo "::error::Health probe failed for ${HEALTH_URL}: HTTP ${HTTP}"; exit 1; }
DESCRIPTION="manual_reconciliation; railway_deployment=${RAILWAY_DEPLOYMENT_ID}; sha=${SHA}; health_http=${HTTP}; verified_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
EXISTING=$(gh api "/repos/${REPO}/deployments/${GITHUB_DEPLOYMENT_ID}/statuses?per_page=20" --jq '[.[] | select(.state == "success" and (.description // "" | contains("railway_deployment='"$RAILWAY_DEPLOYMENT_ID"'")))] | length')
if [ "$EXISTING" = "0" ]; then
  gh api --method POST "/repos/${REPO}/deployments/${GITHUB_DEPLOYMENT_ID}/statuses" -f state=success -f environment=production -f description="$DESCRIPTION" -f environment_url="$HEALTH_URL" >/dev/null
fi
jq -n --arg provenance manual_reconciliation --arg provider railway --arg providerDeploymentId "$RAILWAY_DEPLOYMENT_ID" --arg sha "$SHA" --arg healthUrl "$HEALTH_URL" --arg healthHttp "$HTTP" --arg actor "${GITHUB_ACTOR:-operator}" --arg verifiedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{provenance:$provenance,provider:$provider,providerDeploymentId:$providerDeploymentId,sha:$sha,healthUrl:$healthUrl,healthHttp:($healthHttp|tonumber),actor:$actor,verifiedAt:$verifiedAt}' > deployment-reconciliation.json
echo "Verified Railway deployment ${RAILWAY_DEPLOYMENT_ID}; GitHub deployment ${GITHUB_DEPLOYMENT_ID} reconciled."
