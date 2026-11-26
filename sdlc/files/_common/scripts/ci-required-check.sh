#!/usr/bin/env bash
# ci-required-check.sh — decide the required check `Quality Gates` of one CI run (DevAudit-Installer#1335).
#
# The `required-check` job of ci.yml (named `Quality Gates`, `if: always()`) runs this after every job it judges.
# It passes only when every job the plan asked for succeeded, so the check never passes on a guess: a failed or
# missing plan, a failed, skipped or cancelled job that should have run, or a code merge with neither gates nor reuse
# fails it. Jobs the plan did not ask for are expected to be skipped and are not judged. The feature E2E, the scope
# decision, the evidence upload and the release scope check are not judged (they are not in the job's `needs`).
#
# Environment:
#   NEEDS_JSON     ${{ toJSON(needs) }}: {"<job>": {"result": "...", "outputs": {...}}}
#   REPOSITORY, RUN_ID, RUN_ATTEMPT, GH_TOKEN   optional: per-job queue and run times for the job summary
#   GITHUB_STEP_SUMMARY                         optional: where the summary goes
#
# Exit: 0 pass, 1 fail (one ::error:: line per reason). The summary never changes the exit status.
set -uo pipefail

command -v jq >/dev/null 2>&1 || { echo "::error::ci-required-check: jq is required on the runner (see docs/self-hosted-runner-ci.md)"; exit 1; }

NEEDS="${NEEDS_JSON:-}"
if [ -z "$NEEDS" ] || ! printf '%s' "$NEEDS" | jq -e 'type == "object"' >/dev/null 2>&1; then
  echo "::error::ci-required-check: NEEDS_JSON is missing or is not a JSON object"
  exit 1
fi

result() { printf '%s' "$NEEDS" | jq -r --arg j "$1" '.[$j].result // "absent"'; }
plan_out() { printf '%s' "$NEEDS" | jq -r --arg k "$1" '.plan.outputs[$k] // ""'; }

FAILURES=()
failure() { FAILURES+=("$1"); }

PLAN_RESULT="$(result plan)"
MODE="$(plan_out mode)"
CHANGE="$(plan_out change)"
RUN_GATES="$(plan_out run_gates)"
RUN_REGISTER="$(plan_out run_register)"
RUN_RELEASE_CHECKS="$(plan_out run_release_checks)"
REUSE="$(plan_out reuse)"

# 1. The plan itself.
if [ "$PLAN_RESULT" != "success" ] || [ -z "$MODE" ]; then
  failure "the plan job did not succeed (result: ${PLAN_RESULT}, mode: ${MODE:-none}), so nothing can be trusted"
else
  # 2. The gates, when the plan asked for them.
  if [ "$RUN_GATES" = "true" ] && [ "$(result quality-gates)" != "success" ]; then
    failure "the quality gates should have run and are $(result quality-gates)"
  fi
  # 3. The release registration, when the plan asked for it.
  if [ "$RUN_REGISTER" = "true" ] && [ "$(result register-release)" != "success" ]; then
    failure "the release registration should have run and is $(result register-release)"
  fi
  # 4. A code merge needs either the gates or a reused pull request result.
  if [ "$MODE" = "merge" ] && [ "$CHANGE" = "code" ] && [ "$RUN_GATES" != "true" ] && [ "$REUSE" != "true" ]; then
    failure "a merge with code ran neither the gates nor reused a pull request result"
  fi
  # 5. The release-PR provenance, when the plan asked for it.
  if [ "$RUN_RELEASE_CHECKS" = "true" ] && [ "$(result release-provenance)" != "success" ]; then
    failure "the release provenance check should have run and is $(result release-provenance)"
  fi
fi

# ── Job summary (never changes the result) ──
summary() {
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] || return 0
  {
    echo "### Quality Gates"
    echo
    echo "- Plan: mode \`${MODE:-none}\`, change \`${CHANGE:-none}\`, reuse \`${REUSE:-false}\`"
    local reason reuse_reason req
    reason="$(plan_out reason)"; reuse_reason="$(plan_out reuse_reason)"; req="$(plan_out req_id)"
    [ -z "$reason" ] || echo "- Reason: ${reason}"
    [ -z "$reuse_reason" ] || echo "- Reuse: ${reuse_reason}"
    [ -z "$req" ] || echo "- REQ: \`${req}\`"
    echo
    echo "| Job | Result |"
    echo "| --- | --- |"
    printf '%s' "$NEEDS" | jq -r 'to_entries[] | "| \(.key) | \(.value.result // "absent") |"'
    echo
    if [ -n "${REPOSITORY:-}" ] && [ -n "${RUN_ID:-}" ] && command -v gh >/dev/null 2>&1; then
      local jobs
      if jobs="$(gh api "repos/${REPOSITORY}/actions/runs/${RUN_ID}/attempts/${RUN_ATTEMPT:-1}/jobs?per_page=100" 2>/dev/null)"; then
        echo "| Job | Queued | Ran |"
        echo "| --- | --- | --- |"
        printf '%s' "$jobs" | jq -r '
          def secs(a; b): if (a // "") == "" or (b // "") == "" then null else ((b | fromdateiso8601) - (a | fromdateiso8601)) end;
          def fmt(s): if s == null then "running" else "\(s / 60 | floor)m \(s % 60)s" end;
          .jobs[]? | "| \(.name) | \(fmt(secs(.created_at; .started_at))) | \(fmt(secs(.started_at; .completed_at))) |"' 2>/dev/null \
          || echo "timings unavailable"
      else
        echo "timings unavailable"
      fi
    fi
    if [ "${#FAILURES[@]}" -gt 0 ]; then
      echo
      echo "**Failed:**"
      local f
      for f in "${FAILURES[@]}"; do echo "- $f"; done
    fi
  } >> "$GITHUB_STEP_SUMMARY" 2>/dev/null
}
summary || true

if [ "${#FAILURES[@]}" -gt 0 ]; then
  for f in "${FAILURES[@]}"; do echo "::error::Quality Gates: $f"; done
  exit 1
fi
echo "Quality Gates passed (mode ${MODE}, change ${CHANGE})."
exit 0
