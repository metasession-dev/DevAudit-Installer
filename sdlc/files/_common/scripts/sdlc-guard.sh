#!/usr/bin/env bash
# sdlc-guard.sh — Pre-commit/pre-push guard for manual SDLC execution detection.
#
# Checks whether the current branch is a tracked type (feat/, fix/, refactor/,
# perf/) and, if so, requires the .sdlc-implementer-invoked sentinel (or
# SDLC_IMPLEMENTER_ACTIVE=true env var) to be present.  If the sentinel is
# missing, the guard exits 1 with an actionable error message.  If present,
# it also requires a freshness-check record in that same sentinel (see
# devaudit-installer#839) — unless the REQ was already in flight before that
# enforcement began, per FRESHNESS_ENFORCED_SINCE below.
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
# DevAudit-Installer#231, #839

set -euo pipefail

# Env override — lets the skill set SDLC_IMPLEMENTER_ACTIVE=true
if [ "${SDLC_IMPLEMENTER_ACTIVE:-false}" = "true" ]; then
  exit 0
fi

# Determine the current branch
BRANCH=$(git branch --show-current 2>/dev/null || echo "")

# Only fire for tracked branch types
case "$BRANCH" in
  feat/*|fix/*|refactor/*|perf/*)
    : # tracked — continue to the checks below
    ;;
  *)
    # Housekeeping, develop, main, or detached HEAD — exempt
    exit 0
    ;;
esac

# Sentinel file written by sdlc-implementer Phase 0
if [ ! -f .sdlc-implementer-invoked ]; then
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
fi

# ── Freshness-check enforcement (devaudit-installer#839) ──────────────
# Phase 0 step 0 records a freshness-check entry (freshnessCheckedAt) in
# the same sentinel array phase records use, via
# `node SDLC/bin/devaudit-sdlc.js --freshness-checked=<version>`. A tracked
# push must have one — unless this REQ's earliest sentinel record predates
# FRESHNESS_ENFORCED_SINCE, in which case it was already in flight before
# this enforcement existed and is grandfathered (it never had a chance to
# record the check). Requires jq; if jq is unavailable this check degrades
# to a warning rather than blocking, since it's a courtesy on top of the
# sentinel-presence check above, not the primary gate.
FRESHNESS_ENFORCED_SINCE="2026-09-28T00:00:00Z"

if ! command -v jq >/dev/null 2>&1; then
  echo "Pre-push: jq not found — skipping freshness-check enforcement (devaudit-installer#839)."
  exit 0
fi

FRESHNESS_COUNT=$(jq '[.[] | select(has("freshnessCheckedAt"))] | length' .sdlc-implementer-invoked 2>/dev/null || echo 0)

if [ "${FRESHNESS_COUNT:-0}" -gt 0 ]; then
  exit 0
fi

EARLIEST_PHASE_AT=$(jq -r '[.[] | select(has("currentPhase")) | .activatedAt] | sort | first // empty' .sdlc-implementer-invoked 2>/dev/null || echo "")

if [[ -n "$EARLIEST_PHASE_AT" && "$EARLIEST_PHASE_AT" < "$FRESHNESS_ENFORCED_SINCE" ]]; then
  echo "Pre-push: freshness-check grandfathered — this REQ was already in flight before devaudit-installer#839 enforcement began ($FRESHNESS_ENFORCED_SINCE)."
  exit 0
fi

echo ""
echo "ERROR: Freshness check not recorded (devaudit-installer#839)."
echo "       Current branch '$BRANCH' is a tracked type (feat/fix/refactor/perf)."
echo "       The .sdlc-implementer-invoked sentinel has no freshness-check entry,"
echo "       which means Phase 0 step 0's freshness check was never recorded."
echo ""
echo "       Invoke the sdlc-implementer skill (Claude Code), or run this directly:"
echo "         node SDLC/bin/devaudit-sdlc.js --freshness-checked=<installed-version>"
echo ""
echo "       Bypass with --no-verify (last resort, not a habit)."
exit 1
