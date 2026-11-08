#!/usr/bin/env bash
# scope-e2e-reqs-to-release.sh — keep only the REQs that may be filed under a
# portal release (devaudit-installer#1201).
#
# The workflow_run E2E upload recovers REQ ids from the full-regression
# Playwright JSON when no pending ticket exists (#311). That JSON names every
# REQ the suite touches, so filing each one under `--release <release>` puts
# dozens of unrelated requirements into the release's matrix. A release may
# hold only:
#   - itself, when it is a REQ id; and
#   - when it is the core of a declared bundle, that bundle's `co_tracked`
#     members (resolve-bundle-release.sh, #955). Members keep their own REQ id
#     as the requirement tag on rows filed under the core's release.
#
# Usage:   scripts/scope-e2e-reqs-to-release.sh <release> [REQ-XXX ...]
# Output:  one REQ per line on stdout.
#            - <release> is a REQ id: <release> first (the run belongs to it
#              even when the JSON never names it), then each input REQ that is a
#              co_tracked member of its BUNDLED-CHANGES manifest, in input
#              order, de-duplicated.
#            - otherwise (bare-date version, `_compliance-docs`, ...): the input
#              unchanged.
#          `Dropped <REQ> (not in scope of <release>)` goes to stderr for each
#          removed REQ.
# Manifest lookup: compliance/pending-releases/, then approved-releases/, then
# superseded-releases/ (close-out moves it, close-out-release.sh).
# Exit:    0 on success; 1 on a usage error.
#
# Install: cp this file to your project's scripts/ directory && chmod +x scripts/scope-e2e-reqs-to-release.sh

set -euo pipefail

RELEASE="${1:-}"
if [ -z "$RELEASE" ]; then
  echo "Usage: $0 <release> [REQ-XXX ...]" >&2
  exit 1
fi
shift

case "$RELEASE" in
  REQ-[0-9]*) ;;
  *)
    for req in "$@"; do printf '%s\n' "$req"; done
    exit 0
    ;;
esac

MEMBERS=""
for manifest in \
  "compliance/pending-releases/BUNDLED-CHANGES-${RELEASE}.json" \
  "compliance/approved-releases/BUNDLED-CHANGES-${RELEASE}.json" \
  "compliance/superseded-releases/BUNDLED-CHANGES-${RELEASE}.json"; do
  if [ -f "$manifest" ]; then
    if command -v jq >/dev/null 2>&1; then
      MEMBERS="$(jq -r '(.members // [])[] | select(.role == "co_tracked") | .version' "$manifest" 2>/dev/null || true)"
    fi
    break
  fi
done

SEEN=" ${RELEASE} "
printf '%s\n' "$RELEASE"
for req in "$@"; do
  case "$SEEN" in *" ${req} "*) continue ;; esac
  if [ -n "$MEMBERS" ] && printf '%s\n' "$MEMBERS" | grep -qxF "$req"; then
    SEEN="${SEEN}${req} "
    printf '%s\n' "$req"
  else
    echo "Dropped ${req} (not in scope of ${RELEASE})" >&2
  fi
done
