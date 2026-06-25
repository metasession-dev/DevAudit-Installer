#!/usr/bin/env bash
# generate-bundled-changes.sh
#
# Scans commits since a given ref (tag, SHA, or branch) and filters for
# housekeeping commit types (chore/docs/ci/build/test/revert) that were
# skipped via [skip ci] or otherwise not individually released. Outputs
# a markdown summary suitable for upload as `bundled_changes` evidence
# against a REQ-tagged release.
#
# Synced into the consumer's `scripts/` by `devaudit update`; invoked
# from `ci.yml` register-release job when the derived version is a
# REQ-tagged release (not bare-date).
#
# Usage:
#   bash scripts/generate-bundled-changes.sh <since-ref> [<version>]
#
# Where:
#   <since-ref>  — git ref to scan from (tag, SHA, or branch name).
#                   Typically the previous release tag or the merge-base
#                   of the current branch and the previous release.
#   <version>    — (optional) the release version for the header.
#                   Defaults to "current release".
#
# Output (stdout): markdown document listing housekeeping commits
# absorbed into this release.
#
# DevAudit-Installer#220.

set -euo pipefail

SINCE_REF="${1:-}"
VERSION="${2:-current release}"

if [ -z "$SINCE_REF" ]; then
  echo "Usage: bash scripts/generate-bundled-changes.sh <since-ref> [<version>]" >&2
  exit 1
fi

# Verify the ref exists before proceeding.
if ! git rev-parse --verify "$SINCE_REF" >/dev/null 2>&1; then
  echo "Error: ref '$SINCE_REF' not found in git history." >&2
  exit 1
fi

# Housekeeping commit type prefixes (Conventional Commits).
# feat/fix are tracked changes — excluded. Anything else is housekeeping.
# The git log format is "<short-sha>\t<subject>", so the regex matches
# the commit type after the tab character.
HOUSEKEEPING_TYPES='^[0-9a-f]+	(chore|docs|ci|build|test|revert|style|perf|refactor)(\(.+\))?!?:'

# Collect commits since the ref, filtering for housekeeping types.
# Format: <short-sha>\t<subject>
COMMITS=$(git log "$SINCE_REF"..HEAD --format='%h	%s' 2>/dev/null || true)

if [ -z "$COMMITS" ]; then
  # No commits since ref — output an empty summary.
  echo "## Bundled Changes"
  echo ""
  echo "No housekeeping commits found since \`${SINCE_REF}\`."
  echo ""
  exit 0
fi

# Filter for housekeeping commit types.
BUNDLED=$(echo "$COMMITS" | grep -E "$HOUSEKEEPING_TYPES" || true)

if [ -z "$BUNDLED" ]; then
  echo "## Bundled Changes"
  echo ""
  echo "No housekeeping commits found since \`${SINCE_REF}\`."
  echo ""
  exit 0
fi

# Count the bundled commits.
COUNT=$(echo "$BUNDLED" | wc -l | tr -d ' ')

# Generate the markdown summary.
echo "## Bundled Changes"
echo ""
echo "The following ${COUNT} housekeeping commit(s) were absorbed into release \`${VERSION}\` since \`${SINCE_REF}\`:"
echo ""
echo "$BUNDLED" | while IFS=$'\t' read -r SHA SUBJECT; do
  echo "- \`${SHA}\` ${SUBJECT}"
done
echo ""
echo "These commits were not individually released (tooling syncs / housekeeping)."
echo "Gate evidence above covers the full state of develop at CI time, including these changes."
