#!/usr/bin/env bash
# update-sdlc-status.sh — Post or update the canonical SDLC status
# sticky comment on a REQ tracking issue (devaudit#131).
#
# Purpose: long-running SDLC issues accumulate dozens of comments.
# The operator scrolling the thread can't find "where are we right
# now" without re-reading. This helper writes a marker-tagged comment
# at a predictable shape; subsequent calls find + edit the existing
# comment instead of stacking new ones, so the latest status always
# lives in exactly one place on the issue.
#
# Idempotent — find-or-create. The marker is HTML-commented so it
# doesn't show up in the rendered issue UI but is greppable via the
# API. Subsequent invocations on the same issue replace the body
# without dropping the marker.
#
# Usage:
#   ./scripts/update-sdlc-status.sh <issue-number> "<last-step>" "<next-step>" [--repo owner/name] [--dry-run]
#
# Examples:
#   ./scripts/update-sdlc-status.sh 322 \
#     "Phase 2 complete — feat branch landed on develop" \
#     "Phase 3 — sdlc-implementer auto-continuing"
#
#   ./scripts/update-sdlc-status.sh 322 \
#     "Phase 4 — release PR #455 opened" \
#     "Operator action — review + merge develop→main when ready" \
#     --repo metasession-dev/wawagardenbar-app
#
# Required:
#   - `gh` CLI authenticated (uses GITHUB_TOKEN or the current `gh auth` session)
#   - The issue must exist
#
# Optional flags:
#   --repo owner/name   Override repo (defaults to the cwd's git remote)
#   --dry-run           Print the body + the gh command that would run,
#                       without making any API calls. Used by the test
#                       suite + safe for operator inspection.

set -euo pipefail

if [ "$#" -lt 3 ]; then
  cat <<'USAGE' >&2
Usage: update-sdlc-status.sh <issue-number> "<last-step>" "<next-step>" [--repo owner/name] [--dry-run]
USAGE
  exit 1
fi

ISSUE_NUM="$1"
LAST_STEP="$2"
NEXT_STEP="$3"
shift 3

REPO=""
DRY_RUN=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo)
      REPO="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      echo "Unknown flag: $1" >&2
      exit 1
      ;;
  esac
done

# Validate issue number is numeric early so we don't make bogus API
# calls when the caller fat-fingers the arg order.
if ! [[ "$ISSUE_NUM" =~ ^[1-9][0-9]*$ ]]; then
  echo "Error: issue number must be a positive integer, got: $ISSUE_NUM" >&2
  exit 1
fi

MARKER='<!-- sdlc-implementer:status -->'

# Body shape — keep this compact and load-bearing. The marker MUST be
# the first line so the find-existing pass can use startswith() in
# the gh JSON filter without false positives.
BODY=$(cat <<EOF
$MARKER

**🟢 LAST STEP** — $LAST_STEP

**🔵 NEXT STEP** — $NEXT_STEP

---

_Updated by \`sdlc-implementer\` on every stage transition. The full SDLC trail lives in the comments below; this comment is the always-current pointer._
EOF
)

REPO_FLAG=""
if [ -n "$REPO" ]; then
  REPO_FLAG="--repo $REPO"
fi

if [ "$DRY_RUN" = "true" ]; then
  echo "[dry-run] would update sticky on issue #$ISSUE_NUM${REPO:+ in $REPO}"
  echo "----- body -----"
  echo "$BODY"
  echo "----- end body -----"
  exit 0
fi

# Find an existing status sticky on this issue. We grep through the
# comments looking for the canonical marker; if found, edit it; if
# not, create a fresh one.
#
# gh's --jq filter handles the lookup server-side so we don't drag
# every comment back to local. `startswith` is the right matcher
# because the marker is always the first line.
EXISTING_ID=""
# Build the api endpoint. Without --repo, gh resolves from the current
# git remote — same as `gh issue …` does elsewhere in the framework.
if [ -n "$REPO" ]; then
  EXISTING_ID=$(gh api "repos/$REPO/issues/$ISSUE_NUM/comments" --paginate \
    --jq '.[] | select(.body | startswith("'"$MARKER"'")) | .id' | head -1)
else
  EXISTING_ID=$(gh api "repos/{owner}/{repo}/issues/$ISSUE_NUM/comments" --paginate \
    --jq '.[] | select(.body | startswith("'"$MARKER"'")) | .id' | head -1)
fi

if [ -n "$EXISTING_ID" ]; then
  echo "Updating existing SDLC status sticky (comment id: $EXISTING_ID)"
  if [ -n "$REPO" ]; then
    gh api "repos/$REPO/issues/comments/$EXISTING_ID" -X PATCH \
      --field "body=$BODY" >/dev/null
  else
    gh api "repos/{owner}/{repo}/issues/comments/$EXISTING_ID" -X PATCH \
      --field "body=$BODY" >/dev/null
  fi
else
  echo "Posting new SDLC status sticky on issue #$ISSUE_NUM"
  # shellcheck disable=SC2086  # REPO_FLAG must split on space
  gh issue comment "$ISSUE_NUM" $REPO_FLAG --body "$BODY" >/dev/null
fi

echo "SDLC status updated."
