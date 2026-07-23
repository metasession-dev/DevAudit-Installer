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
  if jq -e 'all(.[]; .status == "completed" and .conclusion == "success")' >/dev/null <<<"$matching"; then
    continue
  fi

  # GitHub can leave an old check-run in_progress after its underlying Actions
  # workflow has completed. It remains fail-closed until a newer rerun of the
  # same required check succeeds on this SHA; then the stale projection cannot
  # deadlock an otherwise terminal-green PR (#503).
  unresolved=0
  while IFS= read -r check; do
    status="$(jq -r '.status' <<<"$check")"
    conclusion="$(jq -r '.conclusion // empty' <<<"$check")"
    if [ "$status" = "completed" ] && [ "$conclusion" = "success" ]; then
      continue
    fi

    details_url="$(jq -r '.details_url // .html_url // empty' <<<"$check")"
    run_id="$(sed -nE 's#.*actions/runs/([0-9]+).*#\1#p' <<<"$details_url" | head -n1)"
    started_at="$(jq -r '.started_at // empty' <<<"$check")"
    if [ -z "$run_id" ] || [ -z "$started_at" ]; then
      echo "::error::Required check '${required}' has a nonterminal execution with no resolvable Actions run: ${details_url:-no-url}."
      unresolved=1
      continue
    fi

    workflow_run="$(gh api "/repos/${REPOSITORY}/actions/runs/${run_id}" 2>/dev/null || true)"
    workflow_status="$(jq -r '.status // empty' <<<"$workflow_run" 2>/dev/null || true)"
    workflow_conclusion="$(jq -r '.conclusion // empty' <<<"$workflow_run" 2>/dev/null || true)"
    if [ "$workflow_status" != "completed" ] || [ "$workflow_conclusion" != "success" ]; then
      echo "::error::Required check '${required}' is still active or unsuccessful: ${details_url} [workflow ${workflow_status:-unknown}/${workflow_conclusion:-pending}]."
      unresolved=1
      continue
    fi

    if jq -e --arg started_at "$started_at" '
      any(.[];
        .status == "completed" and .conclusion == "success" and
        (.started_at // "") > $started_at
      )
    ' >/dev/null <<<"$matching"; then
      echo "::warning::Ignoring stale '${required}' check projection at ${details_url}; a newer rerun is terminal-green for ${SHA}."
      continue
    fi

    echo "::error::Required check '${required}' is stale after a successful workflow, but no newer terminal-green rerun exists for ${SHA}. Rerun ${details_url} before merge."
    unresolved=1
  done < <(jq -c '.[]' <<<"$matching")

  if [ "$unresolved" -ne 0 ]; then
    exit 1
  fi
done

echo "All required checks are terminal-green for ${SHA}."
