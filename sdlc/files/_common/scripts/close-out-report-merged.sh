#!/usr/bin/env bash
# close-out-report-merged.sh — report `completed` close-out status for close-out pull requests that merged recently
# (DevAudit-Installer#1334).
#
# close-out-release.yml waits only a few minutes for its close-out pull request to merge, so it does not hold the
# runner that the pull request's own checks need. A merge made by GitHub auto-merge under GITHUB_TOKEN starts no
# `pull_request: closed` run, so close-out-completion.yml does not report it either. close-out-reconcile.yml (daily)
# calls this script to report those merges. Reporting a merge twice is harmless: the portal records the same status.
#
# For every pull request merged into the integration branch within SINCE_DAYS whose head branch is
# `chore/close-out-REQ-<n>` (CLOSEOUT_BRANCH_PREFIX from close-out-contract.sh), it resolves the portal release of that
# REQ and POSTs {status: completed, ...} to /api/ci/releases/<id>/close-out, as close-out-release.yml does.
#
# Environment:
#   REPOSITORY (or GITHUB_REPOSITORY)   owner/name
#   INTEGRATION_BRANCH                  default develop
#   BASE_URL                            the DevAudit portal URL (empty: nothing is reported, exit 0)
#   DEVAUDIT_API_KEY                    the project key (empty: nothing is reported, exit 0)
#   PROJECT_SLUG                        the portal project slug
#   SINCE_DAYS                          how far back to look (default 3)
#   WORKFLOW_RUN_ID, WORKFLOW_URL       recorded with each report
#   NOW                                 test seam: the current time in epoch seconds
#   GH_TOKEN                            for gh pr list (pull-requests: read)
#
# Exit: 0 (each failure is a ::warning::, the reconcile run must not fail on it), 2 on a usage error.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/close-out-contract.sh" 2>/dev/null || true
PREFIX="${CLOSEOUT_BRANCH_PREFIX:-chore/close-out-}"

REPOSITORY="${REPOSITORY:-${GITHUB_REPOSITORY:-}}"
INTEGRATION_BRANCH="${INTEGRATION_BRANCH:-develop}"
BASE_URL="${BASE_URL:-}"
SINCE_DAYS="${SINCE_DAYS:-3}"
NOW="${NOW:-$(date +%s)}"

[ -n "$REPOSITORY" ] || { echo "Error: REPOSITORY is not set" >&2; exit 2; }
[ -n "${PROJECT_SLUG:-}" ] || { echo "Error: PROJECT_SLUG is not set" >&2; exit 2; }
printf '%s' "$SINCE_DAYS" | grep -qE '^[0-9]+$' || { echo "Error: SINCE_DAYS must be a whole number" >&2; exit 2; }

if [ -z "$BASE_URL" ] || [ -z "${DEVAUDIT_API_KEY:-}" ]; then
  echo "::warning::DevAudit base URL and project API key are required to report close-out completion; skipping."
  exit 0
fi
for tool in gh jq curl; do
  command -v "$tool" >/dev/null 2>&1 || { echo "::warning::$tool is not available; close-out completion of merged pull requests was not reported."; exit 0; }
done

PRS="$(gh pr list --repo "$REPOSITORY" --state merged --base "$INTEGRATION_BRANCH" --limit 100 \
  --json number,headRefName,url,mergeCommit,mergedAt 2>/dev/null)" || {
  echo "::warning::Could not list the merged pull requests of ${REPOSITORY}; close-out completion was not reported."
  exit 0
}
SINCE=$((NOW - SINCE_DAYS * 86400))
MATCHES="$(printf '%s' "$PRS" | jq -c --arg p "$PREFIX" --argjson since "$SINCE" '
  .[]?
  | select((.headRefName // "") | startswith($p))
  | select(((.headRefName // "") | ltrimstr($p)) | test("^REQ-[0-9]+$"))
  | select(((.mergedAt // "") | if . == "" then 0 else (sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) end) >= $since)
  | {req: (.headRefName | ltrimstr($p)), number, url, sha: (.mergeCommit.oid // "")}' 2>/dev/null)" || {
  echo "::warning::Could not read the merged pull requests; close-out completion was not reported."
  exit 0
}

REPORTED=0
if [ -z "$MATCHES" ]; then
  echo "No close-out pull request merged into ${INTEGRATION_BRANCH} in the last ${SINCE_DAYS} day(s)."
  exit 0
fi

while IFS= read -r m; do
  [ -n "$m" ] || continue
  REQ="$(jq -r '.req' <<<"$m")"
  NUMBER="$(jq -r '.number // empty' <<<"$m")"
  URL="$(jq -r '.url // empty' <<<"$m")"
  SHA="$(jq -r '.sha // empty' <<<"$m")"
  if ! printf '%s' "$NUMBER" | grep -qE '^[0-9]+$' || [ -z "$URL" ] || [ -z "$SHA" ]; then
    echo "::warning::Merged close-out pull request for ${REQ} has no number, url or merge commit; skipped."
    continue
  fi
  RELEASE="$(curl --fail-with-body -sS -G "${BASE_URL%/}/api/ci/releases/resolve" -H "Authorization: Bearer ${DEVAUDIT_API_KEY}" \
    --data-urlencode "projectSlug=${PROJECT_SLUG}" --data-urlencode "versionPrefix=${REQ}" 2>/dev/null || true)"
  RELEASE_ID="$(jq -r '.latest.id // empty' <<<"${RELEASE:-{}}" 2>/dev/null || true)"
  RELEASE_VERSION="$(jq -r '.latest.version // empty' <<<"${RELEASE:-{}}" 2>/dev/null || true)"
  if [ -z "$RELEASE_ID" ] || [ "$RELEASE_VERSION" != "$REQ" ]; then
    echo "::warning::Unable to resolve ${REQ} on the portal; close-out completion of #${NUMBER} not reported."
    continue
  fi
  PAYLOAD="$(jq -nc --arg workflowRunId "${WORKFLOW_RUN_ID:-}" --arg workflowUrl "${WORKFLOW_URL:-}" --arg pullRequestUrl "$URL" \
    --arg mergeSha "$SHA" --argjson pullRequestNumber "$NUMBER" \
    '{status:"completed",workflowRunId:$workflowRunId,workflowUrl:$workflowUrl,pullRequestNumber:$pullRequestNumber,pullRequestUrl:$pullRequestUrl,mergeSha:$mergeSha}')" || {
    echo "::warning::Could not build the completion payload for ${REQ}; skipped."
    continue
  }
  if curl --fail-with-body -sS -X POST "${BASE_URL%/}/api/ci/releases/${RELEASE_ID}/close-out" \
    -H "Authorization: Bearer ${DEVAUDIT_API_KEY}" -H 'Content-Type: application/json' --data "$PAYLOAD" >/dev/null; then
    echo "Reported close-out completion of ${REQ} (#${NUMBER})."
    REPORTED=$((REPORTED + 1))
  else
    echo "::warning::Failed to report close-out completion of ${REQ} (#${NUMBER})."
  fi
done <<<"$MATCHES"

echo "Reported ${REPORTED} close-out completion(s)."
exit 0
