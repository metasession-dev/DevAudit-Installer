#!/usr/bin/env bash
# is-deferred-ticket.sh — shared "is this release ticket deferred?" check
# (devaudit-installer#956). Deferred tickets stay in compliance/pending-releases/,
# so every CI loop that iterates pending tickets must skip them: their code
# has not been approved for the release in flight.
#
# A ticket is deferred when it carries
#   - **Release intent:** deferred-to-next — <reason>
# This is the SAME field/pattern derive-release-version.sh (is_deferred_ticket),
# validate-commits.sh, check-deferred-reqs-in-range.sh and
# generate-bundled-changes.sh (extract_release_intent + is_deferred_intent)
# use; keep them in step. Absent field = not deferred.
#
# Usage:
#   bash scripts/is-deferred-ticket.sh compliance/pending-releases/RELEASE-TICKET-REQ-050.md
#     exit 0 = deferred, 1 = not deferred (or file unreadable), 2 = usage error
#   source scripts/is-deferred-ticket.sh   # defines is_deferred_ticket <file>
#
# Typical loop use (older consumers without the helper keep the old behaviour):
#   if [ -f scripts/is-deferred-ticket.sh ] && bash scripts/is-deferred-ticket.sh "$T"; then
#     echo "Skipping ${REQ}: deferred (Release intent: deferred-to-next)"; continue
#   fi

is_deferred_ticket() {
  local line
  line=$(grep -m1 '^\- \*\*Release intent:\*\*' "$1" 2>/dev/null || true)
  printf '%s' "$line" | grep -qE '^- \*\*Release intent:\*\*[[:space:]]+deferred-to-next'
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -euo pipefail
  if [ "$#" -ne 1 ]; then
    echo "Usage: is-deferred-ticket.sh <release-ticket.md>" >&2
    exit 2
  fi
  is_deferred_ticket "$1"
fi
