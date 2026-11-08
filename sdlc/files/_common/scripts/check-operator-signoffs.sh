#!/usr/bin/env bash
# check-operator-signoffs.sh — report Stage 3 operator sign-offs that are still
# pending for a REQ (devaudit-installer#1200).
#
# Four Stage 3 skills (requirements-aligner, adr-author, risk-register-keeper,
# e2e-test-engineer) end their per-REQ artefact in compliance/evidence/<REQ>/
# with an `## Operator sign-off` block: `- [ ]` boxes, `**Reviewer:**` and
# `**Date:**`. The block runs from that heading to the next `## ` heading or the
# end of the file. It is PENDING when any of these hold:
#   - it contains an unticked `- [ ]` box;
#   - the Reviewer line is missing, empty, `PENDING`, or still a `<placeholder>`;
#   - the Date line is not a YYYY-MM-DD date.
# Files with no `## Operator sign-off` heading are not checked.
#
# Usage:   scripts/check-operator-signoffs.sh <REQ-XXX> [--json]
# Output:  text (default), one line per pending block:
#            <path>: <n> unticked box(es)[, reviewer missing][, date missing]
#          --json: [{ "file", "unticked": ["<box text>", ...],
#                     "reviewerMissing", "dateMissing" }] (empty array when none)
# Exit:    0 when nothing is pending; 1 when something is; 2 on a usage error.
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

DIR="compliance/evidence/${REQ}"
RESULTS="[]"

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
        "- [ ]"*) unticked+=("${line#- \[ \] }") ;;
        "**Reviewer:**"*)
          value="$(printf '%s' "${line#\*\*Reviewer:\*\*}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
          case "$value" in
            ""|PENDING*|pending*|*"<"*">"*) ;;
            *) reviewer_ok=true ;;
          esac
          ;;
        "**Date:**"*)
          value="$(printf '%s' "${line#\*\*Date:\*\*}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
          if printf '%s' "$value" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}'; then date_ok=true; fi
          ;;
      esac
    done < "$file"
    [ "$found" = "true" ] || continue
    if [ "${#unticked[@]}" -eq 0 ] && [ "$reviewer_ok" = "true" ] && [ "$date_ok" = "true" ]; then
      continue
    fi
    unticked_json="[]"
    if [ "${#unticked[@]}" -gt 0 ]; then
      unticked_json="$(printf '%s\n' "${unticked[@]}" | jq -R . | jq -sc .)"
    fi
    RESULTS="$(jq -c --arg file "$file" --argjson unticked "$unticked_json" \
      --argjson rm "$([ "$reviewer_ok" = "true" ] && echo false || echo true)" \
      --argjson dm "$([ "$date_ok" = "true" ] && echo false || echo true)" \
      '. + [{file: $file, unticked: $unticked, reviewerMissing: $rm, dateMissing: $dm}]' <<<"$RESULTS")"
  done
fi

COUNT="$(jq 'length' <<<"$RESULTS")"

if [ "$FORMAT" = "json" ]; then
  printf '%s\n' "$RESULTS"
else
  jq -r '.[] | "\(.file): \(.unticked | length) unticked box(es)" + (if .reviewerMissing then ", reviewer missing" else "" end) + (if .dateMissing then ", date missing" else "" end)' <<<"$RESULTS"
fi

[ "$COUNT" -eq 0 ]
