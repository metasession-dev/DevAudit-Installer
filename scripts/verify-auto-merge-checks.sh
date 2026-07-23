#!/usr/bin/env bash
# Fail closed unless every required check run for a PR head SHA is terminal-green.
set -euo pipefail

REPOSITORY="${1:?repository is required}"
BRANCH="${2:?target branch is required}"
SHA="${3:?head SHA is required}"

PROTECTION="$(gh api "/repos/${REPOSITORY}/branches/${BRANCH}/protection/required_status_checks" 2>/dev/null || true)"
if [ -z "$PROTECTION" ]; then
  echo "::error::Unable to resolve required checks for ${BRANCH}; refusing auto-merge."
  exit 1
fi

mapfile -t REQUIRED < <(jq -r '.contexts[]? // empty' <<<"$PROTECTION" | sort -u)
if [ "${#REQUIRED[@]}" -eq 0 ]; then
  echo "::error::${BRANCH} has no resolvable required check contexts; refusing auto-merge."
  exit 1
fi

CHECKS="$(gh api "/repos/${REPOSITORY}/commits/${SHA}/check-runs?per_page=100")"
for required in "${REQUIRED[@]}"; do
  matching="$(jq -c --arg name "$required" '[.check_runs[]? | select(.name == $name)]' <<<"$CHECKS")"
  count="$(jq 'length' <<<"$matching")"
  if [ "$count" -eq 0 ]; then
    echo "::error::Required check '${required}' has no run for current PR SHA ${SHA}."
    exit 1
  fi
  if ! jq -e 'all(.[]; .status == "completed" and .conclusion == "success")' >/dev/null <<<"$matching"; then
    echo "::error::Required check '${required}' has queued, running, or non-success executions for ${SHA}:"
    jq -r '.[] | "  - \(.html_url // .details_url // "no-url") [\(.status)/\(.conclusion // "pending")]"' <<<"$matching"
    exit 1
  fi
done

echo "All required checks are terminal-green for ${SHA}."
