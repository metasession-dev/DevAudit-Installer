#!/usr/bin/env bash
# record-custom-deployment.sh -- record a self-run deploy as a GitHub deployment
# (devaudit-installer#1022, the `custom` host adapter).
#
# Hosts such as Vercel and Railway post a GitHub `deployment_status` themselves. A
# deploy you run yourself (AWS, a self-hosted box, any script) does not, so the
# production gate (post-deploy-prod.yml) would never see a deployment. The synced
# deploy-custom.yml uses this helper to create the GitHub deployment, verify that the
# new build is really serving, and post the terminal status.
#
# Usage:
#   record-custom-deployment.sh create --repo=<owner/name> --sha=<sha> [--environment=production] [--description=<text>]
#       prints the new deployment id on stdout
#   record-custom-deployment.sh status --repo=<owner/name> --deployment-id=<id> --state=<in_progress|success|failure|error> \
#       [--url=<environment url>] [--description=<text>] [--environment=production]
#   record-custom-deployment.sh verify --sha=<sha> [--sha-url=<url> [--sha-jq=<jq filter>]] [--health-url=<url>] \
#       [--max-attempts=30] [--poll-seconds=10]
#       exit 0 once the deployed build is confirmed, 1 on timeout, 2 on usage errors
#
# verify checks, in order of precedence:
#   1. --sha-url  : GET the URL (an optional DEVAUDIT_PROBE_HEADER line is sent). With --sha-jq the
#                   filter's result must equal the SHA (either may be abbreviated); without it the
#                   response body must contain the SHA. This proves the NEW build is serving.
#   2. --health-url : 2xx/3xx only. Weaker: an old build still answering also passes. Prefer --sha-url.
set -euo pipefail

CMD="${1:-}"; [ "$#" -gt 0 ] && shift
REPO=""; SHA=""; ENVIRONMENT="production"; DESCRIPTION=""; DEPLOYMENT_ID=""; STATE=""; URL=""
SHA_URL=""; SHA_JQ=""; HEALTH_URL=""; MAX_ATTEMPTS=30; POLL_SECONDS=10
for arg in "$@"; do
  case "$arg" in
    --repo=*) REPO="${arg#*=}" ;; --sha=*) SHA="${arg#*=}" ;; --environment=*) ENVIRONMENT="${arg#*=}" ;;
    --description=*) DESCRIPTION="${arg#*=}" ;; --deployment-id=*) DEPLOYMENT_ID="${arg#*=}" ;;
    --state=*) STATE="${arg#*=}" ;; --url=*) URL="${arg#*=}" ;;
    --sha-url=*) SHA_URL="${arg#*=}" ;; --sha-jq=*) SHA_JQ="${arg#*=}" ;; --health-url=*) HEALTH_URL="${arg#*=}" ;;
    --max-attempts=*) MAX_ATTEMPTS="${arg#*=}" ;; --poll-seconds=*) POLL_SECONDS="${arg#*=}" ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

case "$CMD" in
  create)
    [ -n "$REPO" ] && [ -n "$SHA" ] || { echo "create needs --repo and --sha" >&2; exit 2; }
    # required_contexts [] : the commit's checks already gated the merge; a pending/failed
    # unrelated context must not 409 the deployment record of a deploy that already ran.
    PAYLOAD=$(jq -nc --arg ref "$SHA" --arg env "$ENVIRONMENT" --arg desc "${DESCRIPTION:-DevAudit custom deploy}" \
      '{ref:$ref,environment:$env,auto_merge:false,required_contexts:[],description:$desc,production_environment:($env == "production"),transient_environment:false}')
    RESPONSE=$(gh api --method POST "/repos/${REPO}/deployments" --input - <<<"$PAYLOAD")
    ID=$(jq -r '.id // empty' <<<"$RESPONSE")
    [ -n "$ID" ] || { echo "::error::GitHub did not return a deployment id: ${RESPONSE}" >&2; exit 1; }
    echo "$ID"
    ;;
  status)
    [ -n "$REPO" ] && [ -n "$DEPLOYMENT_ID" ] && [ -n "$STATE" ] || { echo "status needs --repo, --deployment-id and --state" >&2; exit 2; }
    case "$STATE" in in_progress|success|failure|error|queued|inactive) ;; *) echo "Invalid --state: $STATE" >&2; exit 2 ;; esac
    ARGS=(--method POST "/repos/${REPO}/deployments/${DEPLOYMENT_ID}/statuses" -f "state=${STATE}" -f "environment=${ENVIRONMENT}")
    [ -z "$DESCRIPTION" ] || ARGS+=(-f "description=${DESCRIPTION}")
    [ -z "$URL" ] || ARGS+=(-f "environment_url=${URL}")
    # Same #842 lesson as reconcile-deployment.sh: gh's default error surface hides the errors[] body.
    set +e
    OUT=$(gh api "${ARGS[@]}" --verbose 2>&1); RC=$?
    set -e
    if [ "$RC" -ne 0 ]; then
      echo "::error::Deployment status POST (${STATE}) failed (exit ${RC}). Full request/response detail follows:"
      echo "$OUT"
      exit "$RC"
    fi
    ;;
  verify)
    [ -n "$SHA" ] || { echo "verify needs --sha" >&2; exit 2; }
    [ -n "$SHA_URL" ] || [ -n "$HEALTH_URL" ] || { echo "verify needs --sha-url or --health-url" >&2; exit 2; }
    HDR=(); [ -z "${DEVAUDIT_PROBE_HEADER:-}" ] || HDR=(-H "$DEVAUDIT_PROBE_HEADER")
    matches() { # <value>: equal, or one is a prefix of the other (abbreviated SHAs)
      local v="$1"
      [ -n "$v" ] || return 1
      [[ "$SHA" == "$v"* || "$v" == "$SHA"* ]]
    }
    for ((i = 1; i <= MAX_ATTEMPTS; i++)); do
      if [ -n "$SHA_URL" ]; then
        BODY=$(curl -sS --connect-timeout 5 --max-time 15 ${HDR[@]+"${HDR[@]}"} "$SHA_URL" 2>/dev/null || true)
        if [ -n "$SHA_JQ" ]; then
          GOT=$(jq -r "$SHA_JQ // empty" <<<"$BODY" 2>/dev/null || true)
          if matches "$GOT"; then echo "Deployed build confirmed at ${SHA_URL}: ${GOT}"; exit 0; fi
          echo "Attempt ${i}/${MAX_ATTEMPTS}: ${SHA_URL} reports '${GOT:-nothing}', expected ${SHA}"
        else
          if [[ "$BODY" == *"$SHA"* ]]; then echo "Deployed build confirmed at ${SHA_URL}"; exit 0; fi
          echo "Attempt ${i}/${MAX_ATTEMPTS}: ${SHA_URL} does not mention ${SHA}"
        fi
      else
        CODE=$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 15 ${HDR[@]+"${HDR[@]}"} "$HEALTH_URL" 2>/dev/null || echo 000)
        if [[ "$CODE" =~ ^[23][0-9][0-9]$ ]]; then echo "Health check passed at ${HEALTH_URL} (HTTP ${CODE}); note this does not prove the new build is the one serving."; exit 0; fi
        echo "Attempt ${i}/${MAX_ATTEMPTS}: ${HEALTH_URL} returned HTTP ${CODE}"
      fi
      [ "$i" -lt "$MAX_ATTEMPTS" ] && sleep "$POLL_SECONDS"
    done
    echo "::error::The deployed build for ${SHA} was not confirmed after ${MAX_ATTEMPTS} attempts."
    exit 1
    ;;
  *)
    echo "Usage: record-custom-deployment.sh create|status|verify [--flag=value ...]" >&2
    exit 2
    ;;
esac
