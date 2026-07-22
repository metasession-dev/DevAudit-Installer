#!/usr/bin/env bash
# render-test-executions.sh - Render release test executions as markdown tables.
#
# Usage:
#   bash scripts/render-test-executions.sh path/to/release-journey.json
#
# Supported input:
#   First-class test execution payloads with `.testExecutions[]`.
#
# Output:
#   Markdown suitable for inclusion under `## Test Executions` in
#   `compliance/evidence/REQ-XXX/test-execution-summary.md`.

set -euo pipefail

INPUT_JSON="${1:-}"

if [ -z "$INPUT_JSON" ] || [ ! -f "$INPUT_JSON" ]; then
  echo "Usage: $0 <release-journey.json>" >&2
  exit 2
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required." >&2
  exit 1
fi

stage_label() {
  case "$1" in
    1) printf '1 plan' ;;
    2) printf '2 implement_test' ;;
    3) printf '3 compile_evidence' ;;
    4) printf '4 uat_review' ;;
    5) printf '5 production' ;;
    *) printf '%s unknown' "${1:-?}" ;;
  esac
}

format_date() {
  local value="$1"
  if [ -z "$value" ] || [ "$value" = "null" ]; then
    printf 'Unknown'
  else
    printf '%s' "$value" | sed -E 's/T/ /; s/Z$//; s/[.][0-9]+$//'
  fi
}

render_test_executions() {
  echo "| Source Release | SDLC Stage | Execution | Suite | Outcome | Workflow / Run | Related Evidence | Incident / Remediation | Date |"
  echo "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"

  declare -A COUNTS=()
  local rows
  rows="$(
    jq -r '
      (.testExecutions // [])
      | sort_by(.sourceRelease // "", .sdlcStage // 0, .startedAt // "", .completedAt // "", .suiteKind // .executionKind // "")
      | .[]
      | {
          sourceRelease: (.sourceRelease // "Unknown"),
          stageCode: ((.sdlcStage // 0) | tostring),
          kind: (.suiteKind // .executionKind // "unknown"),
          outcome: (.outcome // "unknown"),
          workflow: (
            if (.workflowUrl // "") != "" then
              "[" + ((.workflowName // "Workflow")) + "](" + .workflowUrl + ")"
            else
              (.workflowName // "Manual")
            end
          ),
          runMeta: (
            [
              (if (.externalRunId // "") != "" then "run " + .externalRunId else empty end),
              (if (.externalRunAttempt // null) != null then "attempt " + (.externalRunAttempt | tostring) else empty end)
            ]
            | map(select(length > 0))
            | join(", ")
          ),
          evidence: (
            (.relatedEvidence // [])
            | map(.displayName // .fileName // .name // .evidenceType // empty)
            | map(select(length > 0))
            | join(", ")
          ),
          incident: (
            [
              (.incidentReference // empty),
              (.remediationReference // empty),
              (.outcomeReason // empty)
            ]
            | map(select(length > 0))
            | join("; ")
          ),
          date: (.completedAt // .startedAt // "")
        }
      | @base64
    ' "$INPUT_JSON"
  )"

  if [ -z "$rows" ]; then
    echo "| Unknown | Unknown | None | unknown | unknown | No test execution records returned | None | None | Unknown |"
    echo
    echo "**Final assessment:** No first-class test execution records were returned by the portal."
    return 0
  fi

  while IFS= read -r row_b64; do
    [ -n "$row_b64" ] || continue
    local source_release stage_code kind outcome workflow run_meta evidence incident date
    source_release="$(printf '%s' "$row_b64" | base64 -d | jq -r '.sourceRelease')"
    stage_code="$(printf '%s' "$row_b64" | base64 -d | jq -r '.stageCode')"
    kind="$(printf '%s' "$row_b64" | base64 -d | jq -r '.kind')"
    outcome="$(printf '%s' "$row_b64" | base64 -d | jq -r '.outcome')"
    workflow="$(printf '%s' "$row_b64" | base64 -d | jq -r '.workflow')"
    run_meta="$(printf '%s' "$row_b64" | base64 -d | jq -r '.runMeta')"
    evidence="$(printf '%s' "$row_b64" | base64 -d | jq -r '.evidence')"
    incident="$(printf '%s' "$row_b64" | base64 -d | jq -r '.incident')"
    date="$(printf '%s' "$row_b64" | base64 -d | jq -r '.date')"
    [ -n "$source_release" ] || continue
    local group_key execution_ordinal workflow_cell evidence_cell incident_cell
    group_key="${source_release}|${stage_code}"
    COUNTS["$group_key"]=$(( ${COUNTS["$group_key"]:-0} + 1 ))
    execution_ordinal="#${COUNTS[$group_key]}"
    workflow_cell="$workflow"
    if [ -n "$run_meta" ]; then
      workflow_cell="${workflow_cell} (${run_meta})"
    fi
    evidence_cell="${evidence:-None}"
    incident_cell="${incident:-None}"
    printf '| %s | %s | %s | %s | %s | %s | %s | %s | %s |\n' \
      "$source_release" \
      "$(stage_label "$stage_code")" \
      "$execution_ordinal" \
      "$kind" \
      "$outcome" \
      "$workflow_cell" \
      "$evidence_cell" \
      "$incident_cell" \
      "$(format_date "$date")"
  done <<<"$rows"

  echo
  echo "**Final assessment:** Stage-scoped execution numbering is authoritative from first-class portal test execution records."
}

render_test_executions
