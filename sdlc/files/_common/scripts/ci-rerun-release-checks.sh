#!/usr/bin/env bash
# ci-rerun-release-checks.sh — DevAudit-Installer#1335 D16: re-run a release pull request's checks once the
# integration branch has passed.
#
# `Release provenance` does not wait for the integration push run: on one self-hosted runner a merge starts the
# push run and the release pull request's run together, and a waiting provenance job would hold the only runner
# while the run it waits for cannot start. So provenance fails fast, and this script, called from the
# `required-check` job of a passing push or manual run on the integration branch, re-runs it: for each open pull
# request into the release branch whose head is this commit, when that pull request's latest run of this workflow
# has a failed `Release provenance`, its failed jobs are re-run (`gh run rerun --failed`). A run still in progress
# is cancelled first (its remaining jobs are only waiting) and re-run once it completes.
#
# It never fails the caller: every problem is a warning and exit 0 (the step is also continue-on-error).
#
# Env: REPOSITORY (owner/repo), HEAD_SHA, RELEASE_BRANCH, WORKFLOW_REF (github.workflow_ref, for this workflow's
#      file), GH_TOKEN; WAIT_LIMIT (seconds to wait for a cancelled run to complete, default 60), POLL (default 5).

set -uo pipefail

for v in REPOSITORY HEAD_SHA RELEASE_BRANCH WORKFLOW_REF; do
  if [ -z "${!v:-}" ]; then echo "::warning::ci-rerun-release-checks: $v is not set; nothing re-run."; exit 0; fi
done
WAIT_LIMIT="${WAIT_LIMIT:-60}"
POLL="${POLL:-5}"

# owner/repo/.github/workflows/ci.yml@refs/heads/develop -> ci.yml
workflow_path="${WORKFLOW_REF#"$REPOSITORY"/}"
workflow_path="${workflow_path%%@*}"
workflow_file="${workflow_path##*/}"

if ! prs=$(gh api "repos/${REPOSITORY}/pulls?state=open&base=${RELEASE_BRANCH}&per_page=100" \
      --jq ".[] | select(.head.sha == \"${HEAD_SHA}\") | .number"); then
  echo "::warning::ci-rerun-release-checks: could not list the open pull requests into ${RELEASE_BRANCH}; re-run their checks by hand if they failed."
  exit 0
fi
if [ -z "$prs" ]; then
  echo "No open pull request into ${RELEASE_BRANCH} has ${HEAD_SHA} as its head; nothing to re-run."
  exit 0
fi

for pr in $prs; do
  if ! run=$(gh api "repos/${REPOSITORY}/actions/workflows/${workflow_file}/runs?event=pull_request&head_sha=${HEAD_SHA}&per_page=50" \
        --jq "[.workflow_runs[] | select(any(.pull_requests[]?; .number == ${pr}))] | sort_by(.created_at) | last | .id // empty"); then
    echo "::warning::ci-rerun-release-checks: could not read the runs of pull request #${pr}; re-run its checks by hand if they failed."
    continue
  fi
  if [ -z "$run" ]; then
    echo "Pull request #${pr}: no run of ${workflow_file} on ${HEAD_SHA} yet; when it runs it will see this success."
    continue
  fi
  if ! provenance=$(gh api "repos/${REPOSITORY}/actions/runs/${run}/jobs?per_page=100" \
        --jq '[.jobs[] | select(.name | startswith("Release provenance"))] | last | .conclusion // ""'); then
    echo "::warning::ci-rerun-release-checks: could not read the jobs of run ${run}; re-run it by hand if it failed."
    continue
  fi
  if [ "$provenance" != "failure" ]; then
    echo "Pull request #${pr}: run ${run} has Release provenance '${provenance:-not finished}'; nothing to re-run."
    continue
  fi
  status=$(gh api "repos/${REPOSITORY}/actions/runs/${run}" --jq '.status' 2>/dev/null || echo unknown)
  if [ "$status" != "completed" ]; then
    echo "Pull request #${pr}: run ${run} is ${status} with a failed Release provenance; cancelling it so it can be re-run."
    gh run cancel "$run" --repo "$REPOSITORY" >/dev/null 2>&1 || true
    waited=0
    while [ "$status" != "completed" ] && [ "$waited" -lt "$WAIT_LIMIT" ]; do
      sleep "$POLL"
      waited=$((waited + POLL))
      status=$(gh api "repos/${REPOSITORY}/actions/runs/${run}" --jq '.status' 2>/dev/null || echo unknown)
    done
    if [ "$status" != "completed" ]; then
      echo "::warning::ci-rerun-release-checks: run ${run} of pull request #${pr} did not complete within ${WAIT_LIMIT}s; re-run its failed jobs by hand."
      continue
    fi
  fi
  if gh run rerun "$run" --failed --repo "$REPOSITORY" >/dev/null 2>&1; then
    echo "Pull request #${pr}: re-running the failed jobs of run ${run} (Release provenance can now find this success)."
  else
    echo "::warning::ci-rerun-release-checks: could not re-run run ${run} of pull request #${pr}; re-run its failed jobs by hand."
  fi
done
exit 0
