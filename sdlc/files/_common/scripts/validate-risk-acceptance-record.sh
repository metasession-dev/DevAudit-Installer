#!/usr/bin/env bash
# validate-risk-acceptance-record.sh -- validate a documented-exception record
# (devaudit-installer#1016 accepted E2E failure, #1017 accepted dependency risk).
#
# A required gate may only be accepted, never silently waived, when the record
# states the impact, a decision-maker, a review date in the future and a
# tracking issue. This helper fails on an unedited template, a missing field or
# section, a past review date, or a malformed tracking issue.
#
# Usage:
#   bash scripts/validate-risk-acceptance-record.sh --kind <e2e|dependency> <record.md> [--today YYYY-MM-DD]
#
# Exit codes: 0 valid; 1 invalid (reasons on stderr); 2 usage error.

set -euo pipefail

KIND=""
RECORD=""
TODAY="$(date -u +%Y-%m-%d)"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --kind) KIND="${2:-}"; shift 2 ;;
    --today) TODAY="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    -*) echo "Error: unknown option: $1" >&2; exit 2 ;;
    *) RECORD="$1"; shift ;;
  esac
done

case "$KIND" in
  e2e) EXPECTED_KIND="accepted_e2e_failure" ;;
  dependency) EXPECTED_KIND="accepted_dependency_risk" ;;
  *) echo "Error: --kind must be e2e or dependency" >&2; exit 2 ;;
esac
[ -n "$RECORD" ] || { echo "Error: record path required" >&2; exit 2; }
[ -f "$RECORD" ] || { echo "Error: record not found: $RECORD" >&2; exit 1; }
[[ "$TODAY" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "Error: --today must be YYYY-MM-DD" >&2; exit 2; }

ERRORS=()
err() { ERRORS+=("$1"); }

# Frontmatter: the block between the first two '---' lines.
FRONT="$(awk 'NR==1 && $0!="---"{exit} NR>1 && $0=="---"{exit} NR>1{print}' "$RECORD")"
[ -n "$FRONT" ] || err "no YAML frontmatter (the record must start with a '---' block)"

# fm_value <key>: first scalar value of a top-level key, quotes and trailing comments removed.
fm_value() {
  printf '%s\n' "$FRONT" | awk -v k="$1" '
    $0 ~ "^"k":" {
      sub("^"k":[[:space:]]*", "")
      sub(/[[:space:]]+#.*$/, "")
      gsub(/^"|"$/, "")
      print; exit
    }'
}

is_blank_or_placeholder() {
  local v="$1"
  [ -z "$v" ] && return 0
  case "$v" in
    *REPLACE*|*"<"*">"*|XXX|REQ-XXX|YYYY-MM-DD) return 0 ;;
  esac
  return 1
}

check_scalar() { # <key>
  local v; v="$(fm_value "$1")"
  if is_blank_or_placeholder "$v"; then err "frontmatter '$1' is missing or still a placeholder"; fi
}

check_date() { # <key>
  local v; v="$(fm_value "$1")"
  if ! [[ "$v" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then err "frontmatter '$1' must be a YYYY-MM-DD date (got '${v:-empty}')"; fi
}

[ "$(fm_value record_kind)" = "$EXPECTED_KIND" ] || err "frontmatter 'record_kind' must be '$EXPECTED_KIND'"

check_scalar decision_maker
check_scalar decided_at; check_date decided_at
check_scalar review_by;  check_date review_by

REVIEW_BY="$(fm_value review_by)"
if [[ "$REVIEW_BY" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] && [[ ! "$REVIEW_BY" > "$TODAY" ]]; then
  err "review_by ($REVIEW_BY) is not in the future (today is $TODAY): an exception must carry a future review date"
fi
DECIDED_AT="$(fm_value decided_at)"
if [[ "$DECIDED_AT" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] && [[ "$DECIDED_AT" > "$TODAY" ]]; then
  err "decided_at ($DECIDED_AT) is in the future"
fi

TRACKING="$(fm_value tracking_issue)"
if ! [[ "$TRACKING" =~ ^https://github\.com/[^/]+/[^/]+/issues/[1-9][0-9]*$ ]]; then
  err "frontmatter 'tracking_issue' must be an exact GitHub issue URL (got '${TRACKING:-empty}')"
fi

if [ "$KIND" = "e2e" ]; then
  check_scalar req
  check_scalar ci_run
  check_scalar head_sha
  case "$(fm_value classification)" in
    flake|test_bug|app_defect|seed_data_gap) ;;
    *) err "frontmatter 'classification' must be one of flake, test_bug, app_defect, seed_data_gap" ;;
  esac
  printf '%s\n' "$FRONT" | grep -q '^failing_specs:' || err "frontmatter 'failing_specs' is missing"
  if printf '%s\n' "$FRONT" | awk '/^failing_specs:/{f=1;next} f&&/^[^[:space:]-]/{f=0} f&&/^[[:space:]]*-/{n++} END{exit !(n>0)}'; then :; else err "frontmatter 'failing_specs' lists no spec"; fi
  REQUIRED_SECTIONS=("Failure" "Evidence of classification" "Impact assessment" "Why this does not block this release" "Remediation")
else
  check_scalar package
  check_scalar severity
  check_scalar remediation_deadline; check_date remediation_deadline
  printf '%s\n' "$FRONT" | grep -q '^advisory_ids:' || err "frontmatter 'advisory_ids' is missing"
  if printf '%s\n' "$FRONT" | awk '/^advisory_ids:/{f=1;next} f&&/^[^[:space:]-]/{f=0} f&&/^[[:space:]]*-/{n++} END{exit !(n>0)}'; then :; else err "frontmatter 'advisory_ids' lists no advisory"; fi
  REQUIRED_SECTIONS=("Advisories" "Reachability and exploitability" "Impact assessment" "Compensating controls" "Remediation")
fi

# Each required '## <Section>' must exist and have non-placeholder content.
section_body() { # <heading>
  awk -v h="$1" '
    /^## / { insec = (tolower(substr($0, 4)) == tolower(h)); next }
    insec { print }
  ' "$RECORD"
}
for section in "${REQUIRED_SECTIONS[@]}"; do
  body="$(section_body "$section")"
  if [ -z "$(printf '%s' "$body" | tr -d '[:space:]')" ]; then
    err "section '## $section' is missing or empty"
  elif printf '%s' "$body" | grep -q 'REPLACE'; then
    err "section '## $section' still contains REPLACE placeholders"
  fi
done

if grep -q 'REPLACE — name of the person' "$RECORD"; then err "decision_maker is still the template placeholder"; fi
if grep -Eq '^\|[[:space:]]*Decision maker[[:space:]]*\|.*REPLACE' "$RECORD"; then err "the sign-off table still contains REPLACE"; fi

if [ "${#ERRORS[@]}" -gt 0 ]; then
  echo "Invalid ${EXPECTED_KIND} record: $RECORD" >&2
  for e in "${ERRORS[@]}"; do echo "  - $e" >&2; done
  exit 1
fi
echo "OK: $RECORD is a valid ${EXPECTED_KIND} record (review_by ${REVIEW_BY}, tracking ${TRACKING})"
