#!/usr/bin/env bash
# Return the PR number associated with a completed check_run event.
# Missing, malformed, or unassociated events are intentionally successful
# no-ops so Auto Merge remains fail-closed without creating failed run noise.
set -euo pipefail

EVENT_PATH="${1:-${GITHUB_EVENT_PATH:-}}"
if [ -z "$EVENT_PATH" ] || [ ! -r "$EVENT_PATH" ]; then
  echo "::notice::No readable check_run event payload; skipping Auto Merge." >&2
  exit 0
fi

PR_NUMBER="$(jq -r '.check_run.pull_requests[0].number // empty' "$EVENT_PATH" 2>/dev/null || true)"
if ! [[ "$PR_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "::notice::No pull request is associated with this check run; skipping Auto Merge." >&2
  exit 0
fi

printf '%s\n' "$PR_NUMBER"
