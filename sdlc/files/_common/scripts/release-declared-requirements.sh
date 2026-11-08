#!/usr/bin/env bash
# release-declared-requirements.sh — print the requirement scope a release
# declares to the portal (devaudit-installer#1209).
#
# The portal (devaudit#962) accepts `metadata.declaredRequirementIds` on a
# direct evidence upload and, once declared, keeps non-screenshot evidence for
# any REQ outside the release's scope out of its requirement matrix. The
# declaration REPLACES the previous one, so every sender must send the complete
# list; CI sends it only from the integration-branch release registration.
#
# Scope of release <release>, when it is a REQ id:
#   - <release> itself;
#   - the co_tracked members of its declared bundle, from
#     BUNDLED-CHANGES-<release>.json in compliance/pending-releases/, then
#     approved-releases/, then superseded-releases/ (members are a local
#     declaration the portal does not otherwise know about, #955).
#
# Usage:   scripts/release-declared-requirements.sh <release>
# Output:  one line, comma-separated, sorted and de-duplicated
#          (e.g. `REQ-200,REQ-201`); nothing for a release that is not a REQ id
#          (a bare-date version, `_compliance-docs`).
# Exit:    0 on success; 1 on a usage error.
#
# Install: cp this file to your project's scripts/ directory && chmod +x scripts/release-declared-requirements.sh

set -euo pipefail

RELEASE="${1:-}"
if [ -z "$RELEASE" ]; then
  echo "Usage: $0 <release>" >&2
  exit 1
fi

case "$RELEASE" in
  REQ-[0-9]*) ;;
  *) exit 0 ;;
esac

IDS="$RELEASE"
for manifest in \
  "compliance/pending-releases/BUNDLED-CHANGES-${RELEASE}.json" \
  "compliance/approved-releases/BUNDLED-CHANGES-${RELEASE}.json" \
  "compliance/superseded-releases/BUNDLED-CHANGES-${RELEASE}.json"; do
  if [ -f "$manifest" ]; then
    if command -v jq >/dev/null 2>&1; then
      MEMBERS="$(jq -r '(.members // [])[] | select(.role == "co_tracked") | .version' "$manifest" 2>/dev/null || true)"
      [ -n "$MEMBERS" ] && IDS="${IDS}"$'\n'"${MEMBERS}"
    fi
    break
  fi
done

printf '%s\n' "$IDS" | grep -E '^REQ-[A-Za-z0-9-]+$' | sort -u | paste -sd, -
