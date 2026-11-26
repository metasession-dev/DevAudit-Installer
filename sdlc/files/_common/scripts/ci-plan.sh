#!/usr/bin/env bash
# ci-plan.sh — decide what one run of the CI workflow does (DevAudit-Installer#1335).
#
# The `plan` job of ci.yml runs this first. Every other job reads its outputs, so this is the one place that decides,
# from the event and the changed files, whether the quality gates run, whether a merge reuses a pull request run's
# result, whether the release is registered and evidence uploaded, whether the feature E2E runs, and whether the
# release-PR checks run. There are no trigger path filters: the workflow always starts, so the required check
# `Quality Gates` is always reported.
#
# It fails (non-zero exit, so `Quality Gates` fails) on any error: a missing tool or synced script, an event it does
# not know, a git failure. It never falls back to a default plan.
#
# Environment:
#   EVENT_NAME            github.event_name (pull_request, push, workflow_dispatch)
#   BASE_REF, HEAD_REF    the pull request's base and head branch (pull_request only)
#   REF_NAME              github.ref_name
#   SHA                   github.sha
#   BEFORE_SHA            github.event.before (push only)
#   INTEGRATION_BRANCH    the integration branch (develop by default)
#   RELEASE_BRANCH        the release branch (main by default)
#   PATHS_IGNORE          newline-separated patterns (YAML list items allowed): changes only to these never need the gates
#   TEST_RUNNER           playwright (default) or pytest: where the feature E2E looks for tests tagged with the REQ
#   WORKING_DIR_PREFIX    the app's directory with a trailing slash, or empty
#   REQUIRED_CHECK_NAME   the required check's job name (passed to find-tested-run.sh)
#   REPOSITORY, CURRENT_RUN_ID, GH_TOKEN   for find-tested-run.sh (push only)
#   GITHUB_OUTPUT         where outputs are written (standard output when unset)
#   GITHUB_STEP_SUMMARY   optional: the plan is also written there
#
# Outputs (always all of them): mode, change, run_gates, reuse, reuse_reason, source_run_id, source_pr, tested_tree,
# run_register, run_upload, req_id, has_tests, run_feature, run_scope_decision, run_release_checks, reason.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="${GITHUB_OUTPUT:-/dev/stdout}"

fail() {
  echo "::error::ci-plan: $1" >&2
  exit "${2:-1}"
}

for tool in git jq python3; do
  command -v "$tool" >/dev/null 2>&1 || fail "$tool is required on the runner (see docs/self-hosted-runner-ci.md)"
done
for helper in provenance-gated-commit.sh classify-pr-attribution.sh find-tested-run.sh; do
  [ -f "$SCRIPT_DIR/$helper" ] || fail "scripts/$helper is missing; run devaudit update to sync the scripts"
done

EVENT_NAME="${EVENT_NAME:-}"
BASE_REF="${BASE_REF:-}"
HEAD_REF="${HEAD_REF:-}"
REF_NAME="${REF_NAME:-}"
SHA="${SHA:-}"
BEFORE_SHA="${BEFORE_SHA:-}"
INTEGRATION_BRANCH="${INTEGRATION_BRANCH:-develop}"
RELEASE_BRANCH="${RELEASE_BRANCH:-main}"
TEST_RUNNER="${TEST_RUNNER:-playwright}"
WORKING_DIR_PREFIX="${WORKING_DIR_PREFIX:-}"

# Every output starts false / none / empty; the mode below sets what runs.
mode="" change="code" reason=""
run_gates=false reuse=false reuse_reason="" source_run_id="" source_pr="" tested_tree=""
run_register=false run_upload=false req_id=none has_tests=false run_feature=false run_scope_decision=false
run_release_checks=false

# ── Mode ──
case "$EVENT_NAME" in
  pull_request)
    [ -n "$BASE_REF" ] || fail "BASE_REF is not set for a pull_request event" 2
    if [ "$BASE_REF" = "$INTEGRATION_BRANCH" ]; then
      mode=feature
    elif [ "$BASE_REF" = "$RELEASE_BRANCH" ]; then
      case "$HEAD_REF" in
        hotfix/*|fix/hotfix-*) mode=hotfix ;;
        *) mode=release ;;
      esac
    else
      fail "a pull request into '$BASE_REF' is neither the integration branch ($INTEGRATION_BRANCH) nor the release branch ($RELEASE_BRANCH)" 2
    fi
    ;;
  push)
    [ "$REF_NAME" = "$INTEGRATION_BRANCH" ] || fail "a push to '$REF_NAME' is not a push to the integration branch ($INTEGRATION_BRANCH)" 2
    mode=merge
    ;;
  workflow_dispatch)
    mode=manual
    ;;
  *)
    fail "unknown event '${EVENT_NAME:-<empty>}'" 2
    ;;
esac

# ── Change kind ──
# The same rules as the release-PR provenance check: provenance-gated-commit.sh pr-docs-only (an empty list, 3000 files
# or more, or any .github/workflows/ file is code).
classify_files() { # changed files on standard input
  local files kind
  files="$(cat)"
  kind="$(printf '%s\n' "$files" | PATHS_IGNORE="${PATHS_IGNORE:-}" bash "$SCRIPT_DIR/provenance-gated-commit.sh" pr-docs-only)" \
    || fail "provenance-gated-commit.sh pr-docs-only failed"
  case "$kind" in
    docs-only|code) change="$kind" ;;
    *) fail "provenance-gated-commit.sh pr-docs-only printed '$kind'" ;;
  esac
  change_count="$(printf '%s' "$files" | grep -c . || true)"
}
change_count=0

pr_diff() {
  git fetch --no-tags --quiet origin "+refs/heads/${BASE_REF}:refs/remotes/origin/${BASE_REF}" 2>/dev/null || true
  local base
  base="$(git merge-base "origin/${BASE_REF}" HEAD 2>/dev/null)" || fail "cannot find the merge base of origin/${BASE_REF} and HEAD (is the checkout shallow? the plan needs fetch-depth: 0)"
  git diff --name-only "$base" HEAD || fail "git diff against the merge base failed"
}

case "$mode" in
  feature|hotfix|release)
    files="$(pr_diff)" || exit 1
    # Not a pipe: classify_files sets `change` in this shell.
    classify_files < <(printf '%s' "$files")
    ;;
  merge)
    if [ -z "$BEFORE_SHA" ] || [ -z "${BEFORE_SHA//0/}" ] || ! git cat-file -e "${BEFORE_SHA}^{commit}" 2>/dev/null; then
      change=code
      reason="no usable previous commit (${BEFORE_SHA:-none}): treated as code"
    else
      files="$(git diff --name-only "$BEFORE_SHA" "$SHA")" || fail "git diff ${BEFORE_SHA}..${SHA} failed"
      classify_files < <(printf '%s' "$files")
    fi
    ;;
  manual)
    change=code
    ;;
esac

# The REQ of a feature pull request, exactly as feature-e2e.yml's detect-req step did (DevAudit-Installer#580, #1019).
detect_req() {
  local attribution base_sha range_reqs range_count branch="$HEAD_REF"
  attribution="$(bash "$SCRIPT_DIR/classify-pr-attribution.sh" --base "origin/${BASE_REF}")" || fail "classify-pr-attribution.sh failed"
  if [[ "$attribution" == skip:* ]]; then
    echo "::notice::Feature E2E not attributing this PR to any release (${attribution#skip:}): it changes no code, so it must not move a release's tested SHA, branch or executions (devaudit-installer#1019)."
    req_id=none
    return 0
  fi
  base_sha="$(git merge-base "origin/${BASE_REF}" HEAD 2>/dev/null || echo '')"
  range_reqs=""
  if [ -n "$base_sha" ]; then
    range_reqs="$(git log "${base_sha}..HEAD" --pretty=%B 2>/dev/null \
      | grep -ioE '(\[REQ-[0-9]+\]|Ref:[[:space:]]*REQ-[0-9]+)' \
      | grep -oiE 'REQ-[0-9]+' | tr '[:lower:]' '[:upper:]' | sort -u || true)"
  fi
  range_count="$(printf '%s\n' "$range_reqs" | grep -c . || true)"
  if [ "$range_count" = "1" ]; then
    req_id="$range_reqs"
  elif [[ $branch =~ (REQ-[0-9]+) ]]; then
    # Fallback: the branch name, when the commits do not name exactly one REQ.
    req_id="${BASH_REMATCH[1]}"
  else
    req_id=none
    if [ "$range_count" -gt 1 ] 2>/dev/null; then
      echo "::warning::PR commits carry multiple distinct REQ tags ($(printf '%s\n' "$range_reqs" | tr '\n' ' ')) and the branch name (${branch}) doesn't disambiguate — skipping feature E2E. This workflow scopes one REQ per PR; split bundled REQs into separate PRs or verify this one's E2E coverage manually."
    else
      echo "::warning::No REQ could be determined for this PR from commit trailers (${base_sha:-<no base>}..HEAD) or the branch name (${branch}) — feature E2E is being skipped, not verified. If this PR is tracked, ensure at least one commit carries a 'Ref: REQ-XXX' trailer."
    fi
    return 0
  fi
  if [ "$TEST_RUNNER" = "pytest" ]; then
    if grep -rl "$req_id" "${WORKING_DIR_PREFIX}tests/" --include="*.py" >/dev/null 2>&1; then has_tests=true; fi
  else
    if grep -rl "@requirement $req_id" "${WORKING_DIR_PREFIX}e2e/" --include="*.spec.ts" >/dev/null 2>&1; then has_tests=true; fi
  fi
}

# ── What runs ──
case "$mode" in
  feature)
    if [ "$change" = code ]; then
      run_gates=true
      detect_req
      if [ "$req_id" != none ] && [ "$has_tests" = true ]; then run_feature=true; fi
      if [ "$req_id" != none ] && [ "$has_tests" = false ]; then run_scope_decision=true; fi
      reason="feature pull request with code (${change_count} file(s)): the gates run"
    else
      reason="feature pull request that changes only paths_ignore paths (${change_count} file(s)): nothing else runs"
    fi
    ;;
  merge)
    if [ "$change" = code ]; then
      command -v gh >/dev/null 2>&1 || fail "gh is required on the runner for a merge (see docs/self-hosted-runner-ci.md)"
      run_register=true
      run_upload=true
      found="$(mktemp)"
      trap 'rm -f "$found"' EXIT
      GITHUB_OUTPUT="$found" bash "$SCRIPT_DIR/find-tested-run.sh" || fail "find-tested-run.sh failed"
      value() { sed -n "s/^$1=//p" "$found" | head -1; }
      [ "$(value reuse)" = true ] && reuse=true || reuse=false
      reuse_reason="$(value reason)"
      source_run_id="$(value source_run_id)"
      source_pr="$(value source_pr)"
      tested_tree="$(value tested_tree)"
      if [ "$reuse" = true ]; then
        run_gates=false
        reason="merge whose tree pull request #${source_pr} tested in run ${source_run_id}: its result is reused"
      else
        run_gates=true
        reason="${reason:+$reason; }merge with code: the gates run (no reuse: ${reuse_reason:-unknown})"
      fi
    else
      reason="merge that changes only paths_ignore paths (${change_count} file(s)): nothing else runs"
    fi
    ;;
  release)
    run_release_checks=true
    reason="release pull request: release scope and provenance are checked; the gates do not run again"
    ;;
  hotfix)
    run_gates=true
    reason="hotfix pull request into ${RELEASE_BRANCH}: the gates always run"
    ;;
  manual)
    run_gates=true
    if [ "$REF_NAME" = "$INTEGRATION_BRANCH" ]; then
      run_register=true
      run_upload=true
    fi
    reason="manual run on ${REF_NAME:-<unknown ref>}: the gates run"
    ;;
esac

{
  echo "mode=$mode"
  echo "change=$change"
  echo "run_gates=$run_gates"
  echo "reuse=$reuse"
  echo "reuse_reason=$reuse_reason"
  echo "source_run_id=$source_run_id"
  echo "source_pr=$source_pr"
  echo "tested_tree=$tested_tree"
  echo "run_register=$run_register"
  echo "run_upload=$run_upload"
  echo "req_id=$req_id"
  echo "has_tests=$has_tests"
  echo "run_feature=$run_feature"
  echo "run_scope_decision=$run_scope_decision"
  echo "run_release_checks=$run_release_checks"
  echo "reason=$reason"
} >> "$OUT"

echo "Plan: mode=$mode change=$change run_gates=$run_gates reuse=$reuse run_register=$run_register run_upload=$run_upload req_id=$req_id has_tests=$has_tests run_feature=$run_feature run_scope_decision=$run_scope_decision run_release_checks=$run_release_checks"
echo "Reason: $reason"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### CI plan"
    echo
    echo "- Mode: \`$mode\`, change: \`$change\`"
    echo "- Reason: $reason"
    echo "- Gates: \`$run_gates\`, reuse: \`$reuse\`${reuse_reason:+ ($reuse_reason)}"
    echo "- Register: \`$run_register\`, upload: \`$run_upload\`, release checks: \`$run_release_checks\`"
    echo "- REQ: \`$req_id\`, tagged tests: \`$has_tests\`, feature E2E: \`$run_feature\`, scope decision: \`$run_scope_decision\`"
  } >> "$GITHUB_STEP_SUMMARY" 2>/dev/null || true
fi
