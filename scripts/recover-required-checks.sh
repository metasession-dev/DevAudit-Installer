#!/usr/bin/env bash
# Diagnose required checks and optionally rerun stale/failed Actions runs.
set -euo pipefail

REPOSITORY="${1:?repository is required}"
PR_NUMBER="${2:?pull request number is required}"
MODE="${3:---dry-run}"

case "$MODE" in
  --dry-run|--apply) ;;
  *) echo "usage: $0 <owner/repo> <pr-number> [--dry-run|--apply]" >&2; exit 2 ;;
esac

PR="$(gh api "/repos/${REPOSITORY}/pulls/${PR_NUMBER}")"
STATE="$(jq -r '.state' <<<"$PR")"
BASE="$(jq -r '.base.ref' <<<"$PR")"
HEAD="$(jq -r '.head.ref' <<<"$PR")"
SHA="$(jq -r '.head.sha' <<<"$PR")"

if [ "$STATE" != "open" ] || [ -z "$BASE" ] || [ -z "$HEAD" ] || [ -z "$SHA" ]; then
  echo "::error::PR #${PR_NUMBER} is not an open PR with resolvable base, head, and SHA."
  exit 1
fi

PROTECTION="$(gh api "/repos/${REPOSITORY}/branches/${BASE}/protection/required_status_checks")"
mapfile -t REQUIRED < <(jq -r '.contexts[]? // empty' <<<"$PROTECTION" | sort -u)
if [ "${#REQUIRED[@]}" -eq 0 ]; then
  echo "::error::${BASE} has no resolvable required check contexts."
  exit 1
fi

CHECKS="$(gh api "/repos/${REPOSITORY}/commits/${SHA}/check-runs?per_page=100")"
declare -A RERUN_IDS=()
missing=0
active=0

for required in "${REQUIRED[@]}"; do
  matching="$(jq -c --arg name "$required" '[.check_runs[]? | select(.name == $name)]' <<<"$CHECKS")"
  if [ "$(jq 'length' <<<"$matching")" -eq 0 ]; then
    echo "::error::Required check '${required}' was never created for ${SHA}."
    missing=1
    continue
  fi

  while IFS= read -r check; do
    status="$(jq -r '.status' <<<"$check")"
    conclusion="$(jq -r '.conclusion // empty' <<<"$check")"
    if [ "$status" = "completed" ] && [ "$conclusion" = "success" ]; then
      continue
    fi

    details_url="$(jq -r '.details_url // .html_url // empty' <<<"$check")"
    run_id="$(sed -nE 's#.*actions/runs/([0-9]+).*#\1#p' <<<"$details_url" | head -n1)"
    if [ -z "$run_id" ]; then
      echo "::error::Required check '${required}' has no rerunnable Actions run: ${details_url:-no-url}."
      active=1
      continue
    fi

    run="$(gh api "/repos/${REPOSITORY}/actions/runs/${run_id}")"
    run_status="$(jq -r '.status // empty' <<<"$run")"
    if [ "$run_status" != "completed" ]; then
      echo "::notice::Required check '${required}' still has an active workflow run ${run_id}; wait for it."
      active=1
      continue
    fi
    RERUN_IDS["$run_id"]=1
  done < <(jq -c '.[]' <<<"$matching")
done

if [ "$missing" -ne 0 ]; then
  echo "::error::GitHub did not create every required check suite. Do not fabricate a status or bypass protection."
  echo "::error::Push an auditable empty commit to '${HEAD}' to obtain a new SHA and fresh pull_request workflow dispatches:"
  echo "git switch ${HEAD} && git commit --allow-empty -m 'ci: retrigger missing required checks for PR #${PR_NUMBER}' && git push"
  exit 1
fi

if [ "${#RERUN_IDS[@]}" -eq 0 ]; then
  if [ "$active" -ne 0 ]; then
    exit 1
  fi
  bash scripts/verify-auto-merge-checks.sh "$REPOSITORY" "$BASE" "$SHA"
  exit 0
fi

for run_id in "${!RERUN_IDS[@]}"; do
  if [ "$MODE" = "--apply" ]; then
    gh run rerun "$run_id" --repo "$REPOSITORY"
    echo "Requested rerun of Actions run ${run_id} for PR #${PR_NUMBER} at ${SHA}."
  else
    echo "Would rerun Actions run ${run_id} for PR #${PR_NUMBER} at ${SHA}."
  fi
done

if [ "$MODE" = "--apply" ]; then
  echo "Recovery dispatched. Wait for every required check on ${SHA} to become terminal green."
else
  echo "Dry run only. Re-run with --apply to dispatch the listed workflow reruns."
fi
