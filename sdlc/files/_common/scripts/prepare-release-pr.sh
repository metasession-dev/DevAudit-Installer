#!/usr/bin/env bash
# prepare-release-pr.sh — ensure there is one truthful release PR.
#
# Usage:
#   ./scripts/prepare-release-pr.sh [--apply] [--mode=update|recreate]
#
# Default mode is dry-run + update. Dry-run prints the action it would take.
# With --apply:
#   - no existing PR: creates one
#   - current PR: updates title/body only when needed
#   - stale PR + mode=update: rewrites title/body and comments
#   - stale PR + mode=recreate: closes old PR and opens a fresh one

set -euo pipefail

APPLY=false
MODE="update"
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=true ;;
    --mode=update) MODE="update" ;;
    --mode=recreate) MODE="recreate" ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

INTEGRATION_BRANCH=$(jq -r '.integration_branch // "develop"' sdlc-config.json 2>/dev/null || echo "develop")
RELEASE_BRANCH=$(jq -r '.release_branch // "main"' sdlc-config.json 2>/dev/null || echo "main")

if [ ! -x scripts/derive-release-version.sh ]; then
  chmod +x scripts/derive-release-version.sh 2>/dev/null || true
fi
CURRENT_RELEASE=$(./scripts/derive-release-version.sh)
if [ -z "$CURRENT_RELEASE" ]; then
  echo "No active release version derived; close-out reconciliation appears in progress." >&2
  exit 1
fi

RELEASE_TITLE=""
RELEASE_SUMMARY=""
if [[ "$CURRENT_RELEASE" =~ ^REQ-[0-9]+$ ]] && [ -f scripts/extract-release-metadata.sh ]; then
  # shellcheck disable=SC1091
  source scripts/extract-release-metadata.sh
  extract_release_metadata "$CURRENT_RELEASE"
fi

TITLE="Release: ${CURRENT_RELEASE}"
if [ -n "$RELEASE_TITLE" ]; then
  TITLE="${TITLE} — ${RELEASE_TITLE}"
fi

BODY=$(cat <<EOF
## Release

- Release: ${CURRENT_RELEASE}
- Base: ${RELEASE_BRANCH}
- Head: ${INTEGRATION_BRANCH}
EOF
)

if [ -n "$RELEASE_TITLE" ]; then
  BODY="${BODY}
- Title: ${RELEASE_TITLE}"
fi

if [ -n "$RELEASE_SUMMARY" ]; then
  BODY="${BODY}

## Summary

${RELEASE_SUMMARY}"
fi

BODY="${BODY}

## DevAudit

- Release context is derived from the current ${INTEGRATION_BRANCH} head.
- If this PR replaced an older release PR, the older PR was superseded because it no longer matched the governing release context."

OPEN_PRS=$(gh pr list --base "$RELEASE_BRANCH" --head "$INTEGRATION_BRANCH" --state open --json number,title,body,url --limit 10)
COUNT=$(echo "$OPEN_PRS" | jq 'length')

if [ "$COUNT" -eq 0 ]; then
  echo "No open ${INTEGRATION_BRANCH}->${RELEASE_BRANCH} PR found."
  if [ "$APPLY" = "true" ]; then
    gh pr create --base "$RELEASE_BRANCH" --head "$INTEGRATION_BRANCH" --title "$TITLE" --body "$BODY"
  else
    echo "Dry run: would create release PR titled '$TITLE'."
  fi
  exit 0
fi

if [ "$COUNT" -gt 1 ]; then
  echo "ERROR: ${COUNT} open ${INTEGRATION_BRANCH}->${RELEASE_BRANCH} PRs found. Resolve duplicates manually." >&2
  echo "$OPEN_PRS" | jq -r '.[] | "  #\(.number) \(.title) \(.url)"' >&2
  exit 1
fi

PR_NUMBER=$(echo "$OPEN_PRS" | jq -r '.[0].number')
PR_TITLE=$(echo "$OPEN_PRS" | jq -r '.[0].title // ""')
PR_BODY=$(echo "$OPEN_PRS" | jq -r '.[0].body // ""')
PR_URL=$(echo "$OPEN_PRS" | jq -r '.[0].url')

PR_IS_CURRENT=true
if ! printf '%s\n%s\n' "$PR_TITLE" "$PR_BODY" | grep -q "$CURRENT_RELEASE"; then
  PR_IS_CURRENT=false
fi
if [ -n "$RELEASE_TITLE" ] && [ "$PR_TITLE" != "$TITLE" ]; then
  PR_IS_CURRENT=false
fi
if printf '%s' "$RELEASE_SUMMARY" | grep -q 'Bundled release context:'; then
  if ! printf '%s\n%s\n' "$PR_TITLE" "$PR_BODY" | grep -q "BUNDLED-CHANGES-${CURRENT_RELEASE}.md"; then
    PR_IS_CURRENT=false
  fi
fi

if [ "$PR_IS_CURRENT" = "true" ]; then
  echo "Open release PR #${PR_NUMBER} already matches ${CURRENT_RELEASE}: ${PR_URL}"
  exit 0
fi

echo "Open release PR #${PR_NUMBER} is stale for current release ${CURRENT_RELEASE}: ${PR_URL}"
echo "Current title: ${PR_TITLE}"

if [ "$APPLY" != "true" ]; then
  echo "Dry run: would ${MODE} stale PR #${PR_NUMBER} for ${CURRENT_RELEASE}."
  exit 0
fi

if [ "$MODE" = "recreate" ]; then
  gh pr comment "$PR_NUMBER" --body "Superseded: current ${INTEGRATION_BRANCH} head now derives ${CURRENT_RELEASE}; this PR no longer matches the governing release context."
  gh pr close "$PR_NUMBER" --comment "Closed as superseded by ${CURRENT_RELEASE} release context."
  gh pr create --base "$RELEASE_BRANCH" --head "$INTEGRATION_BRANCH" --title "$TITLE" --body "$BODY"
else
  gh pr edit "$PR_NUMBER" --title "$TITLE" --body "$BODY"
  gh pr comment "$PR_NUMBER" --body "Release PR context refreshed: current ${INTEGRATION_BRANCH} head derives ${CURRENT_RELEASE}."
  echo "Updated PR #${PR_NUMBER} to ${CURRENT_RELEASE}: ${PR_URL}"
fi
