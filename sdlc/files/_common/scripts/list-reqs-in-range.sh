#!/usr/bin/env bash
# list-reqs-in-range.sh — print the distinct REQ ids referenced by the commits
# in a git range, one per line, sorted.
#
# Usage:
#   bash scripts/list-reqs-in-range.sh [SINCE] [HEAD]
#
#   SINCE  exclusive lower bound. Default: the last tag reachable from HEAD,
#          else the merge-base of HEAD with origin/main (or main).
#   HEAD   inclusive upper bound. Default: HEAD.
#
# A commit references a REQ via a bracketed `[REQ-x]` tag in its subject or a
# `Ref: REQ-x` trailer in its body (same two conventions as
# derive-release-version.sh steps 1-3 and generate-bundled-changes.sh
# req_has_commits_in_range). Unbracketed prose mentions do not count, and
# `REQ-1` never matches `REQ-10`. A commit carrying a `Release-Closeout:`
# marker is skipped, same as derive-release-version.sh step 3-bis (its Ref:
# trailer is traceability for a close-out, not new work in the range).
#
# The two callers above each inline the lookup against one known REQ;
# this script is the enumerate-all form for devaudit-installer#956 and is
# deliberately a copy of that regex, not a refactor of them.
#
# Exit: 0 on success (empty output = no REQs); 1 on an unresolvable ref.

set -euo pipefail

SINCE="${1:-}"
UNTIL="${2:-HEAD}"

if ! git rev-parse --verify "${UNTIL}^{commit}" >/dev/null 2>&1; then
  echo "Error: ref '${UNTIL}' not found in git history." >&2
  exit 1
fi

if [ -z "$SINCE" ]; then
  SINCE=$(git describe --tags --abbrev=0 "$UNTIL" 2>/dev/null || true)
fi
if [ -z "$SINCE" ]; then
  for base in origin/main main; do
    if git rev-parse --verify "${base}^{commit}" >/dev/null 2>&1; then
      SINCE=$(git merge-base "$base" "$UNTIL" 2>/dev/null || true)
      [ -n "$SINCE" ] && break
    fi
  done
fi

if [ -n "$SINCE" ]; then
  if ! git rev-parse --verify "${SINCE}^{commit}" >/dev/null 2>&1; then
    echo "Error: ref '${SINCE}' not found in git history." >&2
    exit 1
  fi
  RANGE="${SINCE}..${UNTIL}"
else
  RANGE="$UNTIL"
fi

git log "$RANGE" --format='%H' 2>/dev/null \
  | while IFS= read -r sha; do
      subject=$(git log -1 --format='%s' "$sha")
      body=$(git log -1 --format='%b' "$sha")
      if printf '%s\n' "$body" | grep -qE '^Release-Closeout:[[:space:]]*REQ-[0-9]{3,}'; then
        continue
      fi
      printf '%s\n' "$subject" | grep -oE '\[REQ-[0-9]+\]' || true
      printf '%s\n' "$body" | grep -ioE 'Ref:[[:space:]]*REQ-[0-9]+' || true
    done \
  | grep -oiE 'REQ-[0-9]+' | tr '[:lower:]' '[:upper:]' | sort -u || true
