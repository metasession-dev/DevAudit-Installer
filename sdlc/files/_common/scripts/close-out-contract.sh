#!/usr/bin/env bash
# close-out-contract.sh — Shared constants for release close-out automation.
#
# Sourced by close-out-release.yml.template and any CI logic that needs to
# recognise or suppress reconciliation pushes (devaudit#281, devaudit#284).
#
# Usage: source scripts/close-out-contract.sh
#   CLOSEOUT_BRANCH_PREFIX  — reserved automation branch prefix
#   CLOSEOUT_MARKER         — structured marker for PR/commit bodies
#   CLOSEOUT_MARKER_REGEX   — grep pattern to detect the marker

# Reserved branch prefix for automation. Humans should not use this for
# unrelated housekeeping work.
CLOSEOUT_BRANCH_PREFIX="chore/close-out-"

# Structured close-out marker emitted in the PR body / merge commit body.
# Format: Release-Closeout: REQ-XXX
CLOSEOUT_MARKER_PREFIX="Release-Closeout:"
CLOSEOUT_MARKER_REGEX='^Release-Closeout:[[:space:]]*REQ-[0-9]{3,}'

# Emit the marker for a given REQ-ID.
closeout_marker() {
  printf '%s %s\n' "$CLOSEOUT_MARKER_PREFIX" "$1"
}

# Check if a string (e.g. commit body, PR body) contains the close-out marker.
is_closeout_marker() {
  grep -qE "$CLOSEOUT_MARKER_REGEX" <<< "$1"
}

# Extract the REQ-ID from a close-out marker string.
closeout_marker_req() {
  grep -oE "$CLOSEOUT_MARKER_REGEX" <<< "$1" | grep -oE 'REQ-[0-9]{3,}' | head -1
}
