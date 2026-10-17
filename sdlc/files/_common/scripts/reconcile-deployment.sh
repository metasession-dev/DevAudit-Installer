#!/usr/bin/env bash
# reconcile-deployment.sh -- reconcile a verified provider deployment to its GitHub
# deployment, host-neutrally (devaudit-installer#1022; was reconcile-railway-deployment.sh,
# #841/#842).
#
# Recovery for the case where the hosting provider deployed correctly but its
# `deployment_status` event never reached GitHub, so the post-deploy gate would wait
# forever. The provider-specific part is one lookup script per host
# (lookup-deployment-<host>.sh, declared by the host adapter's `reconcile.lookup_script`);
# everything after the lookup is the same for every host:
#   1. the provider deployment is terminal-successful,
#   2. it deployed exactly the expected SHA from `main` of this repository,
#   3. the production health URL answers 2xx/3xx (an optional DEVAUDIT_PROBE_HEADER is sent),
#   4. a `success` status is posted to the existing GitHub deployment (idempotent),
#   5. deployment-reconciliation.json records the provenance.
#
# Usage:
#   bash scripts/reconcile-deployment.sh --provider=<host> --repo=<owner/name> --sha=<sha> \
#     --github-deployment-id=<id> --provider-deployment-id=<id> --provider-project=<id> \
#     [--provider-service=<id>] [--provider-environment=production] --health-url=<url>
set -euo pipefail

PROVIDER=""; REPO=""; SHA=""; GITHUB_DEPLOYMENT_ID=""; PROVIDER_DEPLOYMENT_ID=""
PROVIDER_PROJECT=""; PROVIDER_ENVIRONMENT="production"; PROVIDER_SERVICE=""; HEALTH_URL=""
for arg in "$@"; do
  case "$arg" in
    --provider=*) PROVIDER="${arg#*=}" ;; --repo=*) REPO="${arg#*=}" ;; --sha=*) SHA="${arg#*=}" ;;
    --github-deployment-id=*) GITHUB_DEPLOYMENT_ID="${arg#*=}" ;;
    --provider-deployment-id=*) PROVIDER_DEPLOYMENT_ID="${arg#*=}" ;;
    --provider-project=*) PROVIDER_PROJECT="${arg#*=}" ;;
    --provider-environment=*) PROVIDER_ENVIRONMENT="${arg#*=}" ;;
    --provider-service=*) PROVIDER_SERVICE="${arg#*=}" ;;
    --health-url=*) HEALTH_URL="${arg#*=}" ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done
[ -n "$PROVIDER" ] && [ -n "$REPO" ] && [ -n "$SHA" ] && [ -n "$GITHUB_DEPLOYMENT_ID" ] && [ -n "$PROVIDER_DEPLOYMENT_ID" ] && [ -n "$PROVIDER_PROJECT" ] && [ -n "$HEALTH_URL" ] \
  || { echo "Missing required reconciliation arguments" >&2; exit 2; }
[[ "$PROVIDER" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "Invalid --provider: ${PROVIDER}" >&2; exit 2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOOKUP="$SCRIPT_DIR/lookup-deployment-${PROVIDER}.sh"
[ -f "$LOOKUP" ] || { echo "::error::No provider lookup for host '${PROVIDER}' (expected ${LOOKUP}). Re-run devaudit update, or the host adapter has no reconcile support."; exit 1; }

set +e
MATCH=$(bash "$LOOKUP" --deployment-id="$PROVIDER_DEPLOYMENT_ID" --project="$PROVIDER_PROJECT" --service="$PROVIDER_SERVICE" --environment="$PROVIDER_ENVIRONMENT")
LOOKUP_RC=$?
set -e
if [ "$LOOKUP_RC" -ne 0 ] || ! jq -e . <<<"$MATCH" >/dev/null 2>&1; then
  echo "::error::${PROVIDER} deployment ${PROVIDER_DEPLOYMENT_ID} could not be looked up (lookup exit ${LOOKUP_RC})."
  exit 1
fi
STATUS=$(jq -r '.status // empty' <<<"$MATCH")
PROVIDER_SHA=$(jq -r '.sha // empty' <<<"$MATCH")
BRANCH=$(jq -r '.branch // empty' <<<"$MATCH")
PROVIDER_REPO=$(jq -r '.repo // empty' <<<"$MATCH")
[ "$STATUS" = "success" ] || { echo "::error::${PROVIDER} deployment is not terminal-successful: ${STATUS:-missing}"; exit 1; }
[ "$PROVIDER_SHA" = "$SHA" ] && [ "$BRANCH" = "main" ] && [ "$PROVIDER_REPO" = "$REPO" ] || { echo "::error::${PROVIDER} provenance mismatch: repo=$PROVIDER_REPO branch=$BRANCH sha=$PROVIDER_SHA"; exit 1; }

PROBE_ARGS=()
if [ -n "${DEVAUDIT_PROBE_HEADER:-}" ]; then PROBE_ARGS=(-H "$DEVAUDIT_PROBE_HEADER"); fi
HTTP=$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 15 ${PROBE_ARGS[@]+"${PROBE_ARGS[@]}"} "$HEALTH_URL" || echo 000)
[[ "$HTTP" =~ ^[23][0-9][0-9]$ ]] || { echo "::error::Health probe failed for ${HEALTH_URL}: HTTP ${HTTP}"; exit 1; }

DESCRIPTION="manual_reconciliation; provider_deployment=${PROVIDER_DEPLOYMENT_ID}; provider=${PROVIDER}; sha=${SHA}; health_http=${HTTP}; verified_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# A status posted by this workflow before #1022 carried `railway_deployment=<id>`; both spellings count as "already reconciled".
EXISTING=$(gh api "/repos/${REPO}/deployments/${GITHUB_DEPLOYMENT_ID}/statuses?per_page=20" --jq '[.[] | select(.state == "success" and (.description // "" | (contains("provider_deployment='"$PROVIDER_DEPLOYMENT_ID"'") or contains("railway_deployment='"$PROVIDER_DEPLOYMENT_ID"'"))))] | length')
if [ "$EXISTING" = "0" ]; then
  # #842: gh api's default error surface truncates to "Validation Failed (HTTP nnn)" and
  # drops the errors[] body needed to root-cause the 422 seen in production. Capture the
  # full --verbose request/response trace and print it on failure instead of discarding it.
  set +e
  STATUS_OUTPUT=$(gh api --method POST "/repos/${REPO}/deployments/${GITHUB_DEPLOYMENT_ID}/statuses" -f state=success -f environment=production -f description="$DESCRIPTION" -f environment_url="$HEALTH_URL" --verbose 2>&1)
  STATUS_RC=$?
  set -e
  if [ "$STATUS_RC" -ne 0 ]; then
    echo "::error::Deployment status POST failed (exit ${STATUS_RC}). Full request/response detail follows for root-cause diagnosis (see #842):"
    echo "$STATUS_OUTPUT"
    exit "$STATUS_RC"
  fi
fi
jq -n --arg provenance manual_reconciliation --arg provider "$PROVIDER" --arg providerDeploymentId "$PROVIDER_DEPLOYMENT_ID" --arg sha "$SHA" --arg healthUrl "$HEALTH_URL" --arg healthHttp "$HTTP" --arg actor "${GITHUB_ACTOR:-operator}" --arg verifiedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{provenance:$provenance,provider:$provider,providerDeploymentId:$providerDeploymentId,sha:$sha,healthUrl:$healthUrl,healthHttp:($healthHttp|tonumber),actor:$actor,verifiedAt:$verifiedAt}' > deployment-reconciliation.json
echo "Verified ${PROVIDER} deployment ${PROVIDER_DEPLOYMENT_ID}; GitHub deployment ${GITHUB_DEPLOYMENT_ID} reconciled."
