#!/usr/bin/env bash
# resolve-bundle-release.sh — print the portal release an evidence upload for
# <REQ-XXX> must be filed against (devaudit-installer#955).
#
# A declared bundle (`Bundles: #A, #B`, devaudit-installer#736) is ONE portal
# release with ONE UAT approval, keyed by the core REQ (the REQ whose number
# names BUNDLED-CHANGES-<core>.{md,json}). Every member keeps its own REQ-XXX
# as the *requirement tag* on its evidence rows, but the *release* those rows
# are filed against is the core's. Filing a member's evidence against a
# release named after the member (`--release REQ-036 --create-release-if-missing`)
# creates a second, orphan portal release per member that nothing ever
# submits or approves.
#
# Usage:   scripts/resolve-bundle-release.sh <REQ-XXX>
# Output:  one line on stdout:
#            - the core REQ-XXX when <REQ-XXX> is a co_tracked member of a live
#              declared-bundle manifest in compliance/pending-releases/
#            - otherwise <REQ-XXX> unchanged (a non-member, the core itself, a
#              predecessor, a bare-date version, `_compliance-docs`, ...)
# Exit:    0 on success; 1 on a usage error; 3 when <REQ-XXX> is a co_tracked
#          member of more than one live bundle (a genuine conflict, not
#          something to guess at).
#
# A manifest whose own core ticket is already archived (approved-releases/ or
# superseded-releases/) is stale and ignored, the same guard
# derive-release-version.sh step 0 applies (devaudit-installer#838).
#
# Install: cp this file to your project's scripts/ directory && chmod +x scripts/resolve-bundle-release.sh

set -euo pipefail

REQ="${1:-}"
if [ -z "$REQ" ]; then
  echo "Usage: $0 <REQ-XXX>" >&2
  exit 1
fi

case "$REQ" in
  REQ-*) ;;
  *)
    printf '%s\n' "$REQ"
    exit 0
    ;;
esac

PENDING_DIR="compliance/pending-releases"
if [ ! -d "$PENDING_DIR" ]; then
  printf '%s\n' "$REQ"
  exit 0
fi

MATCHES=()
for manifest_md in "$PENDING_DIR"/BUNDLED-CHANGES-REQ-*.md; do
  if [ ! -f "$manifest_md" ]; then
    continue
  fi
  core="$(basename "$manifest_md" .md)"
  core="${core#BUNDLED-CHANGES-}"
  if [ "$core" = "$REQ" ]; then
    continue
  fi
  if [ -f "compliance/approved-releases/RELEASE-TICKET-${core}.md" ] \
    || [ -f "compliance/superseded-releases/RELEASE-TICKET-${core}.md" ]; then
    continue
  fi
  manifest_json="${manifest_md%.md}.json"
  is_member=false
  if [ -f "$manifest_json" ] && command -v jq >/dev/null 2>&1; then
    if jq -e --arg req "$REQ" '(.members // []) | any(.role == "co_tracked" and .version == $req)' "$manifest_json" >/dev/null 2>&1; then
      is_member=true
    fi
  elif grep -qF "\`${REQ}\` (co-tracked/bundled)" "$manifest_md" 2>/dev/null; then
    is_member=true
  fi
  if [ "$is_member" = "true" ]; then
    MATCHES+=("$core")
  fi
done

if [ "${#MATCHES[@]}" -gt 1 ]; then
  echo "Error: ${REQ} is a co_tracked member of more than one live declared bundle: ${MATCHES[*]}." >&2
  echo "Remove it from all but one BUNDLED-CHANGES manifest." >&2
  exit 3
fi

if [ "${#MATCHES[@]}" -eq 1 ]; then
  printf '%s\n' "${MATCHES[0]}"
else
  printf '%s\n' "$REQ"
fi
