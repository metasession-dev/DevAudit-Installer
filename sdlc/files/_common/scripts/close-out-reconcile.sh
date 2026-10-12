#!/usr/bin/env bash
# close-out-reconcile.sh — devaudit-installer#786
#
# Scheduled reconciliation fallback for the release close-out pipeline.
# The portal's `release-closed` repository_dispatch is a single one-shot
# webhook with no retry visible to the consumer side — if it's ever missed
# (dispatch send failure, the release never actually reaching `released`
# on the portal via some other path, etc.) a release ticket can sit
# un-reconciled in compliance/pending-releases/ indefinitely even though
# its code is already live on `main`. See
# docs/issues/pending-releases-not-closed-out.md and
# docs/release-lineage-and-test-execution-audit-model.md.
#
# This script only DETECTS staleness — it prints one REQ-XXX per line for
# every pending release ticket whose REQ already has a matching commit
# reachable from origin/main (i.e. genuinely shipped), so the caller
# (close-out-reconcile.yml.template) can decide what to do about each one
# (typically: trigger close-out-release.yml's existing reconciliation
# logic for it). Prints nothing, exits 0, if none are stale.
#
# A ticket carrying `Release intent: deferred-to-next` (#956) is parked, not
# stale: it is NOT reported just for sitting in pending-releases/. If its
# commits ARE reachable from origin/main, though, its code shipped without
# the release being approved (a silent absorption); that signal is kept and
# printed as `REQ-XXX deferred` so the caller can word it accordingly and
# must not auto-close it out as a normal release.
#
# Usage:
#   close-out-reconcile.sh [pending-dir]
#
# Requires: git, with `origin/main` already fetched by the caller
# (this script does not fetch — callers differ on remote naming/auth).

set -euo pipefail

PENDING_DIR="${1:-compliance/pending-releases}"

# Shared deferred-ticket check (sourced next to this script when present).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=is-deferred-ticket.sh
[ -f "$SCRIPT_DIR/is-deferred-ticket.sh" ] && source "$SCRIPT_DIR/is-deferred-ticket.sh"

[ -d "$PENDING_DIR" ] || exit 0

shopt -s nullglob
for TICKET in "$PENDING_DIR"/RELEASE-TICKET-REQ-*.md; do
  REQ=$(basename "$TICKET" .md | sed 's/^RELEASE-TICKET-//')
  # Only bare REQ-XXX tickets are eligible — matches derive-release-version.sh's
  # own tracked-release identity shape.
  case "$REQ" in
    REQ-*) ;;
    *) continue ;;
  esac
  # A REQ is "demonstrably already shipped" if origin/main has a commit
  # tagged with it, in either convention this framework uses: `[REQ-XXX]`
  # in the subject, or `Ref: REQ-XXX` in the body. Two separate --grep
  # flags OR together by default (git log semantics) unless --all-match is
  # given, which we deliberately don't pass.
  if git log origin/main -E --grep="\[${REQ}\]" --grep="Ref: ${REQ}\$" --oneline -1 2>/dev/null | grep -q .; then
    if declare -F is_deferred_ticket >/dev/null && is_deferred_ticket "$TICKET"; then
      echo "$REQ deferred"
    else
      echo "$REQ"
    fi
  fi
done
