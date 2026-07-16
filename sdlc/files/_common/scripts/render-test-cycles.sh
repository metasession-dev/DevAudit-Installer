#!/usr/bin/env bash
# render-test-cycles.sh — Render release test cycles as markdown tables.
#
# Usage:
#   bash scripts/render-test-cycles.sh path/to/release-journey.json
#
# Supported inputs:
#   1. First-class cycle payloads with `.cycles[]`
#   2. Legacy grouped-evidence payloads with one of:
#        - `.legacyCycles[]`
#        - `.testCycleGroups[]`
#        - `.evidenceGroups[]`
#
# Output:
#   Markdown suitable for inclusion under `## Test Cycles` in
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

render_first_class_cycles() {
  echo "| Source Release | SDLC Stage | Cycle | Kind | Outcome | Workflow / Run | Related Evidence | Incident / Remediation | Date |"
  echo "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"

  declare -A COUNTS=()
  local rows
  rows="$(
    jq -r '
      (.cycles // [])
      | sort_by(.sourceRelease // "", .sdlcStage // 0, .startedAt // "", .completedAt // "", .cycleKind // "")
      | .[]
      | {
          sourceRelease: (.sourceRelease // "Unknown"),
          stageCode: ((.sdlcStage // 0) | tostring),
          kind: (.cycleKind // "unknown"),
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
    echo "| Unknown | Unknown | None | unknown | unknown | No cycle records returned | None | None | Unknown |"
    echo
    echo "**Final assessment:** No first-class cycle records were returned by the portal."
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
    local group_key cycle_ordinal workflow_cell evidence_cell incident_cell
    group_key="${source_release}|${stage_code}"
    COUNTS["$group_key"]=$(( ${COUNTS["$group_key"]:-0} + 1 ))
    cycle_ordinal="#${COUNTS[$group_key]}"
    workflow_cell="$workflow"
    if [ -n "$run_meta" ]; then
      workflow_cell="${workflow_cell} (${run_meta})"
    fi
    evidence_cell="${evidence:-None}"
    incident_cell="${incident:-None}"
    printf '| %s | %s | %s | %s | %s | %s | %s | %s | %s |\n' \
      "$source_release" \
      "$(stage_label "$stage_code")" \
      "$cycle_ordinal" \
      "$kind" \
      "$outcome" \
      "$workflow_cell" \
      "$evidence_cell" \
      "$incident_cell" \
      "$(format_date "$date")"
  done <<<"$rows"

  echo
  echo "**Final assessment:** Stage-scoped cycle numbering is authoritative from first-class portal cycle records."
}

render_legacy_cycles() {
  echo "> Legacy portal fallback — first-class cycle records unavailable; grouped by uploaded evidence \`testCycleId\`."
  echo
  echo "| Source Release | SDLC Stage | Cycle | Kind | Outcome | Workflow / Run | Related Evidence | Incident / Remediation | Date |"
  echo "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"

  local rows
  rows="$(
    jq -r '
      (.legacyCycles // .testCycleGroups // .evidenceGroups // [])
      | .[]
      | {
          sourceRelease: (.sourceRelease // "Legacy grouped evidence"),
          stageLabel: (.sdlcStageLabel // "legacy grouping"),
          cycleId: (.testCycleId // .cycleId // "unknown"),
          kind: (.cycleKind // "legacy"),
          outcome: (.outcome // "unknown"),
          workflow: (
            if (.workflowUrl // "") != "" then
              "[" + ((.workflowName // "Workflow")) + "](" + .workflowUrl + ")"
            else
              (.workflowName // "Legacy grouping")
            end
          ),
          evidence: (
            (.relatedEvidence // .evidence // [])
            | map(.displayName // .fileName // .name // .evidenceType // .path // empty)
            | map(select(length > 0))
            | join(", ")
          ),
          incident: (.incidentReference // .notes // "Legacy fallback"),
          date: (.date // .createdAt // "")
        }
      | @base64
    ' "$INPUT_JSON"
  )"

  if [ -z "$rows" ]; then
    echo "| Legacy grouped evidence | legacy grouping | unknown | legacy | unknown | Legacy grouping | None | Legacy fallback | Unknown |"
    echo
    echo "**Final assessment:** Legacy fallback used, but no grouped evidence records were returned."
    return 0
  fi

  while IFS= read -r row_b64; do
    [ -n "$row_b64" ] || continue
    local source_release stage_label_value cycle_id kind outcome workflow evidence incident date
    source_release="$(printf '%s' "$row_b64" | base64 -d | jq -r '.sourceRelease')"
    stage_label_value="$(printf '%s' "$row_b64" | base64 -d | jq -r '.stageLabel')"
    cycle_id="$(printf '%s' "$row_b64" | base64 -d | jq -r '.cycleId')"
    kind="$(printf '%s' "$row_b64" | base64 -d | jq -r '.kind')"
    outcome="$(printf '%s' "$row_b64" | base64 -d | jq -r '.outcome')"
    workflow="$(printf '%s' "$row_b64" | base64 -d | jq -r '.workflow')"
    evidence="$(printf '%s' "$row_b64" | base64 -d | jq -r '.evidence')"
    incident="$(printf '%s' "$row_b64" | base64 -d | jq -r '.incident')"
    date="$(printf '%s' "$row_b64" | base64 -d | jq -r '.date')"
    [ -n "$cycle_id" ] || continue
    printf '| %s | %s | %s | %s | %s | %s | %s | %s | %s |\n' \
      "$source_release" \
      "$stage_label_value" \
      "$cycle_id" \
      "$kind" \
      "$outcome" \
      "$workflow" \
      "${evidence:-None}" \
      "${incident:-Legacy fallback}" \
      "$(format_date "$date")"
  done <<<"$rows"

  echo
  echo "**Final assessment:** Legacy grouping was used because the portal did not expose first-class cycle records."
}

if jq -e '((.cycles // []) | length) > 0' "$INPUT_JSON" >/dev/null 2>&1; then
  render_first_class_cycles
else
  render_legacy_cycles
fi
