#!/usr/bin/env bash
# find-tested-run.sh — find a pull request run whose result a merge can reuse (DevAudit-Installer#1298).
#
# ci.yml runs the quality gates on the pull request into the integration branch and again on the merge. When the
# integration branch has not moved in between, both runs test the same tree, so the second repeats the first. On a push
# to the integration branch this script decides whether the merged commit can reuse the pull request run:
#
#   - exactly one merged pull request has the pushed commit as its merge commit, into the integration branch, from this
#     repository's own branch, opened by a person (not Dependabot, whose runs use other secrets);
#   - the latest `pull_request` run of this workflow on that pull request's head commit completed with `success`;
#   - that run's `ci-results` and `tested-tree` artifacts exist and have not expired;
#   - the artifact's tested tree equals the tree of the pushed commit, and every gate in its gate-outcomes.json is
#     `success`.
#
# It fails safe: any doubt (an API error, a missing field, no pull request, several, a fork, a failed or expired run) is
# `reuse=false` with a reason, and exit status 0, so ci.yml runs the gates in full as before. Never reuse on a guess.
#
# Environment:
#   REPOSITORY            owner/name
#   SHA                   the pushed commit
#   INTEGRATION_BRANCH    the branch the pushed commit is on
#   CURRENT_RUN_ID        this workflow run (its workflow id selects the pull request runs of the same workflow)
#   GH_TOKEN              token with contents, pull-requests and actions read
#   GITHUB_OUTPUT         where outputs are written (standard output when unset)
# Outputs: reuse (true|false), reason, and when true source_run_id, source_pr, tested_tree.
set -uo pipefail

OUT="${GITHUB_OUTPUT:-/dev/stdout}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

no_reuse() {
  echo "find-tested-run: no reuse: $1" >&2
  { echo "reuse=false"; echo "reason=$1"; } >> "$OUT"
  exit 0
}

for var in REPOSITORY SHA INTEGRATION_BRANCH CURRENT_RUN_ID; do
  [ -n "${!var:-}" ] || no_reuse "${var} is not set"
done
command -v gh >/dev/null 2>&1 || no_reuse "the gh CLI is missing"
command -v jq >/dev/null 2>&1 || no_reuse "jq is missing"

TREE="$(git rev-parse "${SHA}^{tree}" 2>/dev/null)" || no_reuse "cannot read the tree of ${SHA}"
[ -n "$TREE" ] || no_reuse "cannot read the tree of ${SHA}"

PULLS="$(gh api "repos/${REPOSITORY}/commits/${SHA}/pulls?per_page=100" 2>/dev/null)" || no_reuse "the pull requests of the commit could not be read"
MERGED="$(printf '%s' "$PULLS" | jq -c --arg b "$INTEGRATION_BRANCH" --arg sha "$SHA" \
  '[.[] | select(.merged_at != null and .base.ref == $b and .merge_commit_sha == $sha)]' 2>/dev/null)" || no_reuse "the pull requests of the commit could not be parsed"
COUNT="$(printf '%s' "$MERGED" | jq 'length' 2>/dev/null)" || no_reuse "the pull requests of the commit could not be parsed"
[ "$COUNT" = "1" ] || no_reuse "the commit is the merge commit of ${COUNT:-?} pull requests into ${INTEGRATION_BRANCH}, not exactly one"

PR="$(printf '%s' "$MERGED" | jq -r '.[0].number // empty')"
HEAD_SHA="$(printf '%s' "$MERGED" | jq -r '.[0].head.sha // empty')"
HEAD_REPO="$(printf '%s' "$MERGED" | jq -r '.[0].head.repo.full_name // empty')"
BASE_REPO="$(printf '%s' "$MERGED" | jq -r '.[0].base.repo.full_name // empty')"
AUTHOR="$(printf '%s' "$MERGED" | jq -r '.[0].user.login // empty')"
AUTHOR_TYPE="$(printf '%s' "$MERGED" | jq -r '.[0].user.type // empty')"
[ -n "$PR" ] && [ -n "$HEAD_SHA" ] || no_reuse "the pull request has no number or head commit"
[ "$HEAD_REPO" = "$REPOSITORY" ] && [ "$BASE_REPO" = "$REPOSITORY" ] || no_reuse "pull request #${PR} is from a fork or its repository is unknown"
case "$(printf '%s' "$AUTHOR" | tr '[:upper:]' '[:lower:]')" in
  dependabot*|*"[bot]") no_reuse "pull request #${PR} was opened by ${AUTHOR}, whose runs use other secrets" ;;
esac
[ "$AUTHOR_TYPE" != "Bot" ] || no_reuse "pull request #${PR} was opened by a bot (${AUTHOR})"

WORKFLOW_ID="$(gh api "repos/${REPOSITORY}/actions/runs/${CURRENT_RUN_ID}" --jq '.workflow_id' 2>/dev/null)" || no_reuse "the workflow of this run could not be read"
[ -n "$WORKFLOW_ID" ] || no_reuse "the workflow of this run could not be read"

RUNS="$(gh api "repos/${REPOSITORY}/actions/workflows/${WORKFLOW_ID}/runs?event=pull_request&head_sha=${HEAD_SHA}&per_page=100" 2>/dev/null)" || no_reuse "the pull request runs could not be read"
RUN="$(printf '%s' "$RUNS" | jq -c --arg r "$REPOSITORY" --arg h "$HEAD_SHA" \
  '[.workflow_runs[]? | select(.event == "pull_request" and .head_sha == $h)] | max_by(.id) // empty' 2>/dev/null)" || no_reuse "the pull request runs could not be parsed"
[ -n "$RUN" ] || no_reuse "pull request #${PR} has no run of this workflow on ${HEAD_SHA:0:7}"
RUN_ID="$(printf '%s' "$RUN" | jq -r '.id // empty')"
RUN_STATUS="$(printf '%s' "$RUN" | jq -r '.status // empty')"
RUN_CONCLUSION="$(printf '%s' "$RUN" | jq -r '.conclusion // empty')"
RUN_REPO="$(printf '%s' "$RUN" | jq -r '.head_repository.full_name // empty')"
[ -n "$RUN_ID" ] || no_reuse "the pull request run has no id"
[ "$RUN_REPO" = "$REPOSITORY" ] || no_reuse "run ${RUN_ID} is not from this repository"
[ "$RUN_STATUS" = "completed" ] && [ "$RUN_CONCLUSION" = "success" ] || no_reuse "the latest pull request run ${RUN_ID} is ${RUN_STATUS:-unknown}/${RUN_CONCLUSION:-none}, not completed/success"

ARTIFACTS="$(gh api "repos/${REPOSITORY}/actions/runs/${RUN_ID}/artifacts?per_page=100" 2>/dev/null)" || no_reuse "the artifacts of run ${RUN_ID} could not be read"
for name in ci-results tested-tree; do
  FOUND="$(printf '%s' "$ARTIFACTS" | jq -r --arg n "$name" --arg r "$RUN_ID" \
    '[.artifacts[]? | select(.name == $n and .expired == false and ((.workflow_run.id // 0) | tostring) == $r)] | length' 2>/dev/null)" || no_reuse "the artifacts of run ${RUN_ID} could not be parsed"
  [ "$FOUND" = "1" ] || no_reuse "run ${RUN_ID} has no unexpired '${name}' artifact"
done

gh run download "$RUN_ID" -R "$REPOSITORY" -n tested-tree -D "$TMP/tested" >/dev/null 2>&1 || no_reuse "the tested-tree artifact of run ${RUN_ID} could not be downloaded"
[ -f "$TMP/tested/tested-tree.txt" ] || no_reuse "run ${RUN_ID} did not record the tree it tested"
TESTED_TREE="$(tr -d '[:space:]' < "$TMP/tested/tested-tree.txt")"
[ -n "$TESTED_TREE" ] || no_reuse "the recorded tested tree of run ${RUN_ID} is empty"
[ "$TESTED_TREE" = "$TREE" ] || no_reuse "the merged tree ${TREE:0:7} differs from the tree ${TESTED_TREE:0:7} that run ${RUN_ID} tested"

[ -f "$TMP/tested/gate-outcomes.json" ] || no_reuse "run ${RUN_ID} recorded no gate outcomes"
jq -e 'type == "object" and length > 0 and (to_entries | all(.value == "success"))' "$TMP/tested/gate-outcomes.json" >/dev/null 2>&1 \
  || no_reuse "not every gate of run ${RUN_ID} was a success"

echo "find-tested-run: reusing run ${RUN_ID} of pull request #${PR} (tree ${TREE:0:7})" >&2
{
  echo "reuse=true"
  echo "reason=ok"
  echo "source_run_id=${RUN_ID}"
  echo "source_pr=${PR}"
  echo "tested_tree=${TREE}"
} >> "$OUT"
exit 0
