#!/usr/bin/env bash
# resolve-e2e-upload-targets.sh — decide, for each REQ the workflow_run E2E
# upload is about to file, which release it goes under and whether it gets the
# run's JSON as its e2e_result (devaudit-installer#1213).
#
# The REQs come from pending release tickets or, when there are none, from the
# run's own Playwright JSON (#311). Filing each under the derived release put
# one REQ's evidence into another release's matrix (#1201, #1213).
#
# Rules, when <derived-release> is a REQ id:
#   - keep only the REQs that may be filed under it: itself and the co_tracked
#     members of its declared bundle (scope-e2e-reqs-to-release.sh); another
#     pending REQ's evidence belongs to its own release's runs, not this one;
#   - every kept REQ is filed under <derived-release> (a member files under its
#     bundle's core, resolve-bundle-release.sh);
#   - <derived-release> always gets the run JSON (the canonical run artefact for
#     its release); a member gets it only when the JSON has an executed test
#     tagged to it (e2e-json-tags-req.sh, the same check ci.yml uses).
# When <derived-release> is a bare date (vYYYY.MM.DD): more than one REQ means no
# tracked REQ was executed for it, so nothing is printed (#1214); one REQ is kept.
# Any other non-REQ release: the input is kept, filed under it, with the JSON.
#
# Usage:   scripts/resolve-e2e-upload-targets.sh <derived-release> <results.json|""> [REQ ...]
# Output:  one `<REQ> <release> <json:yes|no>` line per REQ to upload.
#          `Dropped <REQ> ...` lines go to stderr.
# Exit:    0 on success; 1 on a usage error.
#
# Install: cp this file to your project's scripts/ directory && chmod +x scripts/resolve-e2e-upload-targets.sh

set -euo pipefail

DERIVED="${1:-}"
if [ -z "$DERIVED" ] || [ "$#" -lt 2 ]; then
  echo "Usage: $0 <derived-release> <results.json|\"\"> [REQ ...]" >&2
  exit 1
fi
JSON="$2"
shift 2
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$DERIVED" in
  REQ-[0-9]*) ;;
  v[0-9][0-9][0-9][0-9].[0-9][0-9].[0-9][0-9]*)
    # devaudit-installer#1214: a bare-date (housekeeping) release whose run names
    # several REQs executed no tracked REQ of its own; filing them all under it
    # would fill its matrix. Print nothing, so the caller keeps the run as GitHub
    # CI history. (A single REQ is turned into that REQ's release by the caller
    # before this script runs.)
    if [ "$#" -gt 1 ]; then
      echo "Dropped $* (bare-date release ${DERIVED} holds no per-REQ evidence)" >&2
      exit 0
    fi
    for req in "$@"; do printf '%s %s yes\n' "$req" "$DERIVED"; done
    exit 0
    ;;
  *)
    for req in "$@"; do printf '%s %s yes\n' "$req" "$DERIVED"; done
    exit 0
    ;;
esac

mapfile -t KEPT < <(bash "$DIR/scope-e2e-reqs-to-release.sh" "$DERIVED" "$@")
for req in "${KEPT[@]}"; do
  [ -n "$req" ] || continue
  if [ "$req" = "$DERIVED" ]; then
    printf '%s %s yes\n' "$req" "$DERIVED"
  elif [ -n "$JSON" ] && bash "$DIR/e2e-json-tags-req.sh" "$req" "$JSON"; then
    printf '%s %s yes\n' "$req" "$DERIVED"
  else
    printf '%s %s no\n' "$req" "$DERIVED"
  fi
done
