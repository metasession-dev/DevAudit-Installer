#!/usr/bin/env bash
# sdlc-guard.sh — Pre-commit/pre-push guard for manual SDLC execution detection.
#
# Checks whether the current branch is a tracked type (feat/, fix/, refactor/,
# perf/) and, if so, requires the .sdlc-implementer-invoked sentinel (or
# SDLC_IMPLEMENTER_ACTIVE=true env var) to be present.  If the sentinel is
# missing, the guard exits 1 with an actionable error message.
#
# Housekeeping branches (chore/, docs/, ci/, build/, test/, compliance/,
# revert/, main, develop, release/) are exempt — the guard only fires for
# tracked feature work where the sdlc-implementer skill should have been
# invoked.
#
# Usage (pre-commit):
#   bash scripts/sdlc-guard.sh
#
# Usage (pre-push, before heavier checks):
#   bash scripts/sdlc-guard.sh
#
# Bypass: --no-verify (commit-msg hook + CI still enforce)
#
# DevAudit-Installer#231

set -euo pipefail

# Env override — lets the skill set SDLC_IMPLEMENTER_ACTIVE=true
if [ "${SDLC_IMPLEMENTER_ACTIVE:-false}" = "true" ]; then
  exit 0
fi

# Sentinel file written by sdlc-implementer Phase 0
if [ -f .sdlc-implementer-invoked ]; then
  exit 0
fi

# Determine the current branch
BRANCH=$(git branch --show-current 2>/dev/null || echo "")

# Only fire for tracked branch types
case "$BRANCH" in
  feat/*|fix/*|refactor/*|perf/*)
    : # tracked — continue to the check below
    ;;
  *)
    # Housekeeping, develop, main, or detached HEAD — exempt
    exit 0
    ;;
esac

echo ""
echo "ERROR: Manual SDLC execution detected."
echo "       Current branch '$BRANCH' is a tracked type (feat/fix/refactor/perf)."
echo "       The .sdlc-implementer-invoked sentinel is missing, which means"
echo "       the sdlc-implementer skill was not invoked before committing."
echo ""
echo "       Invoke the sdlc-implementer skill (Claude Code) or run"
echo "       'devaudit status' to check SDLC workflow state."
echo ""
echo "       Bypass with --no-verify (last resort, not a habit)."
exit 1
