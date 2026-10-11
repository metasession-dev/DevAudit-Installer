#!/usr/bin/env bash
# check-deferred-reqs-in-range.sh — promotion gate for deferred REQs
# (devaudit-installer#956). Fails a develop -> main release PR when a REQ that
# is deferred has commits in the PR range but is not listed as an absorbed
# predecessor in the release ticket being promoted, i.e. it would ship to
# production without ever having been approved.
#
# A REQ is deferred when EITHER
#   - its pending ticket carries `- **Release intent:** deferred-to-next ...`
#     (the sole declaration of deferral), or
#   - its RTM row (compliance/RTM.md) has status DEFERRED.
#
# Usage (called by check-release-pr-scope.sh; also runnable directly):
#   CURRENT_RELEASE=REQ-050 SINCE_REF=origin/main \
#     bash scripts/check-deferred-reqs-in-range.sh
#
#   CURRENT_RELEASE  release being promoted (REQ-n, vYYYY.MM.DD, ...). Its own
#                    ticket supplies the 'Absorbed predecessor releases' list.
#                    The release itself is never reported as a deferred REQ.
#   SINCE_REF        exclusive lower bound of the PR range (default origin/main).
#   RTM_PATH         default compliance/RTM.md.
#
# Informational only: this is a step in the existing Release Scope Integrity
# job; it is NOT a separate required status context (Quality Gates stays the
# only one).

set -euo pipefail

CURRENT_RELEASE="${CURRENT_RELEASE:-}"
SINCE_REF="${SINCE_REF:-origin/main}"
RTM_PATH="${RTM_PATH:-compliance/RTM.md}"
PENDING_DIR="compliance/pending-releases"

# deferred REQ -> source description
declare -A DEFERRED=()

if [ -d "$PENDING_DIR" ]; then
  for ticket in "$PENDING_DIR"/RELEASE-TICKET-REQ-*.md; do
    [ -f "$ticket" ] || continue
    line=$(grep -m1 '^\- \*\*Release intent:\*\*' "$ticket" 2>/dev/null || true)
    if printf '%s' "$line" | grep -qE '^- \*\*Release intent:\*\*[[:space:]]+deferred-to-next'; then
      req=$(basename "$ticket" .md | sed 's/^RELEASE-TICKET-//')
      DEFERRED["$req"]="$ticket (Release intent: deferred-to-next)"
    fi
  done
fi

if [ -f "$RTM_PATH" ]; then
  while IFS= read -r req; do
    [ -n "$req" ] || continue
    [ -z "${DEFERRED[$req]:-}" ] || continue
    ticket="${PENDING_DIR}/RELEASE-TICKET-${req}.md"
    if [ -f "$ticket" ]; then
      DEFERRED["$req"]="$ticket (RTM status DEFERRED)"
    else
      DEFERRED["$req"]="${RTM_PATH} row ${req} (RTM status DEFERRED; no pending ticket found)"
    fi
  done < <(sed 's/\\|/  /g' "$RTM_PATH" 2>/dev/null \
    | grep -E '\|[[:space:]]+DEFERRED' \
    | grep -oE '^\|[[:space:]]*REQ-[0-9]+' \
    | grep -oE 'REQ-[0-9]+' | sort -u || true)
fi

if [ "${#DEFERRED[@]}" -eq 0 ]; then
  echo "Deferral gate: no deferred REQs (no 'Release intent: deferred-to-next' ticket, no DEFERRED RTM row)."
  exit 0
fi

# Absorbed predecessors listed in the release ticket being promoted.
CURRENT_TICKET="${PENDING_DIR}/RELEASE-TICKET-${CURRENT_RELEASE}.md"
ABSORBED=""
if [ -n "$CURRENT_RELEASE" ] && [ -f "$CURRENT_TICKET" ]; then
  pred_line=$(grep -m1 '^\- \*\*Absorbed predecessor releases:\*\*' "$CURRENT_TICKET" 2>/dev/null || true)
  if [ -n "$pred_line" ] && ! printf '%s' "$pred_line" | grep -qi '\bNone\b'; then
    ABSORBED=$(printf '%s' "$pred_line" | grep -oE 'REQ-[0-9]+' || true)
  fi
fi

HELPER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/list-reqs-in-range.sh"
if [ ! -f "$HELPER" ]; then
  echo "::error::Deferral gate: list-reqs-in-range.sh not found next to this script." >&2
  exit 1
fi
IN_RANGE=$(bash "$HELPER" "$SINCE_REF" HEAD)

FAILED=0
for req in $(printf '%s\n' "${!DEFERRED[@]}" | sort); do
  [ "$req" != "$CURRENT_RELEASE" ] || continue
  printf '%s\n' "$IN_RANGE" | grep -qx "$req" || continue
  if printf '%s\n' "$ABSORBED" | grep -qx "$req"; then
    echo "Deferral gate: ${req} is deferred and is listed as an absorbed predecessor of ${CURRENT_RELEASE} — OK."
    continue
  fi
  echo "::error::Deferral gate: ${req} is deferred (${DEFERRED[$req]}) and has commits in ${SINCE_REF}..HEAD, but ${CURRENT_RELEASE:-the release being promoted} does not list it under 'Absorbed predecessor releases' in ${CURRENT_TICKET}. Promoting would ship ${req} to production unapproved. List ${req} under 'Absorbed predecessor releases' in ${CURRENT_TICKET}, or revert ${req}'s commits from this PR."
  FAILED=1
done

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi
echo "Deferral gate: no deferred REQ ships unlisted in ${SINCE_REF}..HEAD."
