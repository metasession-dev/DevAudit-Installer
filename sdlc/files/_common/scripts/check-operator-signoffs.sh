#!/usr/bin/env bash
# check-operator-signoffs.sh — report Stage 3 operator sign-offs that are still
# pending for a REQ (devaudit-installer#1200, #1211).
#
# Four Stage 3 skills (requirements-aligner, adr-author, risk-register-keeper,
# e2e-test-engineer) end their per-REQ artefact in compliance/evidence/<REQ>/
# with an `## Operator sign-off` block: boxes, a Reviewer line and a Date line.
# The block runs from that heading to the next `## ` heading or the end of the
# file. It is PENDING when any of these hold:
#   - it contains an unanswered box `- [ ]` (leading spaces allowed). A box is
#     answered when ticked (`- [x]` / `- [X]`) or marked not applicable
#     (`- [~]`), for a conditional box such as adr-author's "If ADR:" / "If
#     no-ADR:" pair where only one applies;
#   - the Reviewer line is missing, empty, `PENDING`, or a placeholder (the
#     whole value is `<...>`, or it contains `<operator-name>`). `Name <email>`
#     is a real reviewer;
#   - the Date line is not a YYYY-MM-DD date.
# Reviewer and Date are read from `**Reviewer:**`, `**Reviewer**:` or
# `Reviewer:` (same for Date). Files with no `## Operator sign-off` heading are
# not checked.
#
# Usage:   scripts/check-operator-signoffs.sh <REQ-XXX> [--json]
# Output:  text (default; needs only bash, grep and sed), one line per pending block:
#            <path>: <n> unticked box(es)[, reviewer missing][, date missing]
#          --json (needs jq): [{ "file", "unticked": ["<box text>", ...],
#                     "reviewerMissing", "dateMissing" }] (empty array when none)
# Exit:    0 when nothing is pending; 1 when something is; 2 on a usage error or
#          when --json is asked for and jq is missing.
#
# Install: cp this file to your project's scripts/ directory && chmod +x scripts/check-operator-signoffs.sh

set -euo pipefail

REQ="${1:-}"
FORMAT="text"
if [ -z "$REQ" ] || [ "${REQ#-}" != "$REQ" ]; then
  echo "Usage: $0 <REQ-XXX> [--json]" >&2
  exit 2
fi
shift
case "${1:-}" in
  "") ;;
  --json) FORMAT="json" ;;
  *)
    echo "Usage: $0 <REQ-XXX> [--json]" >&2
    exit 2
    ;;
esac
if [ "$FORMAT" = "json" ] && ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for --json" >&2
  exit 2
fi

trim() { printf '%s' "$1" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }

# field_value <line> <Name> — prints the value when the line is a Name field in
# any accepted style, else returns 1.
field_value() {
  local line="$1" name="$2" rest
  line="$(trim "$line")"
  case "$line" in
    "**${name}:**"*) rest="${line#\*\*${name}:\*\*}" ;;
    "**${name}**:"*) rest="${line#\*\*${name}\*\*:}" ;;
    "${name}:"*) rest="${line#${name}:}" ;;
    *) return 1 ;;
  esac
  trim "$rest"
}

reviewer_is_real() {
  local v="$1"
  case "$v" in
    "" | PENDING* | pending* | Pending*) return 1 ;;
    *"<operator-name>"*) return 1 ;;
    "<"*">") return 1 ;;
  esac
  return 0
}

DIR="compliance/evidence/${REQ}"
PENDING_FILES=()
TEXT_LINES=()
JSON_ROWS=()

if [ -d "$DIR" ]; then
  for file in "$DIR"/*.md; do
    [ -f "$file" ] || continue
    in_block=false
    found=false
    unticked=()
    reviewer_ok=false
    date_ok=false
    while IFS= read -r line || [ -n "$line" ]; do
      if [ "$in_block" = "false" ]; then
        case "$line" in
          "## Operator sign-off"*) in_block=true; found=true ;;
        esac
        continue
      fi
      case "$line" in
        "## "*) break ;;
      esac
      stripped="$(trim "$line")"
      case "$stripped" in
        "- [ ]"*)
          unticked+=("$(trim "${stripped#- \[ \]}")")
          continue
          ;;
      esac
      if value="$(field_value "$line" Reviewer)"; then
        reviewer_is_real "$value" && reviewer_ok=true
      elif value="$(field_value "$line" Date)"; then
        printf '%s' "$value" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}' && date_ok=true
      fi
    done < "$file"
    [ "$found" = "true" ] || continue
    if [ "${#unticked[@]}" -eq 0 ] && [ "$reviewer_ok" = "true" ] && [ "$date_ok" = "true" ]; then
      continue
    fi
    PENDING_FILES+=("$file")
    text="${file}: ${#unticked[@]} unticked box(es)"
    [ "$reviewer_ok" = "true" ] || text="${text}, reviewer missing"
    [ "$date_ok" = "true" ] || text="${text}, date missing"
    TEXT_LINES+=("$text")
    if [ "$FORMAT" = "json" ]; then
      unticked_json="[]"
      if [ "${#unticked[@]}" -gt 0 ]; then
        unticked_json="$(printf '%s\n' "${unticked[@]}" | jq -R . | jq -sc .)"
      fi
      JSON_ROWS+=("$(jq -cn --arg file "$file" --argjson unticked "$unticked_json" \
        --argjson rm "$([ "$reviewer_ok" = "true" ] && echo false || echo true)" \
        --argjson dm "$([ "$date_ok" = "true" ] && echo false || echo true)" \
        '{file: $file, unticked: $unticked, reviewerMissing: $rm, dateMissing: $dm}')")
    fi
  done
fi

if [ "$FORMAT" = "json" ]; then
  if [ "${#JSON_ROWS[@]}" -eq 0 ]; then
    printf '[]\n'
  else
    printf '%s\n' "${JSON_ROWS[@]}" | jq -sc .
  fi
else
  for text in ${TEXT_LINES[@]+"${TEXT_LINES[@]}"}; do printf '%s\n' "$text"; done
fi

[ "${#PENDING_FILES[@]}" -eq 0 ]
