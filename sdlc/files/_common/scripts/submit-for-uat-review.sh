#!/usr/bin/env bash
# submit-for-uat-review.sh — Run readiness checks, then submit a release for UAT review.
#
# Usage:
#   ./scripts/submit-for-uat-review.sh <project-slug> <version-prefix>
#
# Example:
#   ./scripts/submit-for-uat-review.sh wawagardenbar-app v2026.05.14
#
# Required environment:
#   DEVAUDIT_USER_TOKEN — Personal Access Token (mctok_…) issued from
#                            /settings/tokens. Attributes the submission
#                            to the issuing user so the four-eyes approval
#                            control is preserved (the submitter cannot
#                            approve their own release).
#   DEVAUDIT_API_KEY    — project-scoped API key (existing) used to
#                            resolve the release id and read its current
#                            status. Distinct from the PAT.
#   DEVAUDIT_BASE_URL   — DevAudit base URL (e.g. https://devaudit.metasession.co).
#
# What it does:
#   1. Verify working tree is clean and develop is up-to-date with origin.
#   2. Verify the release ticket exists in compliance/pending-releases/.
#   3. Verify CI gates green on the current develop HEAD via gh CLI.
#   4. Resolve the release id from (projectSlug, versionPrefix) via /api/ci/releases/resolve.
#   5. If status is draft        → POST /api/releases/<id>/submit-review with the PAT.
#      If status is uat_review   → idempotent no-op (exit 0, "already submitted").
#      If status is uat_approved → idempotent no-op (exit 0, "already approved").
#      Any other status          → refuse with an explanatory message.

set -euo pipefail

PROJECT_SLUG="${1:-}"
VERSION_PREFIX="${2:-}"

if [ -z "$PROJECT_SLUG" ] || [ -z "$VERSION_PREFIX" ]; then
  echo "Usage: $0 <project-slug> <version-prefix>" >&2
  echo "Example: $0 wawagardenbar-app v2026.05.14" >&2
  exit 1
fi

: "${DEVAUDIT_USER_TOKEN:?DEVAUDIT_USER_TOKEN must be set (issue from /settings/tokens)}"
: "${DEVAUDIT_API_KEY:?DEVAUDIT_API_KEY must be set (project API key)}"
: "${DEVAUDIT_BASE_URL:?DEVAUDIT_BASE_URL must be set (e.g. https://devaudit.metasession.co)}"

BASE_URL="${DEVAUDIT_BASE_URL%/}"

FAILED=0
note() { printf '  - %s\n' "$*"; }
fail() { printf '  ✗ %s\n' "$*"; FAILED=$((FAILED + 1)); }
ok()   { printf '  ✓ %s\n' "$*"; }

echo "Readiness checks for ${PROJECT_SLUG} ${VERSION_PREFIX}"

# 1. Working tree clean
if [ -n "$(git status --porcelain)" ]; then
  fail "Working tree has uncommitted changes — commit or stash before submitting."
else
  ok "Working tree clean."
fi

# 2. develop up-to-date with origin
git fetch origin develop --quiet
LOCAL_SHA="$(git rev-parse develop 2>/dev/null || echo '')"
REMOTE_SHA="$(git rev-parse origin/develop 2>/dev/null || echo '')"
if [ -z "$LOCAL_SHA" ] || [ -z "$REMOTE_SHA" ]; then
  fail "Cannot resolve develop SHA — is the develop branch present?"
elif [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  fail "Local develop (${LOCAL_SHA:0:7}) does not match origin/develop (${REMOTE_SHA:0:7}) — push first."
else
  ok "develop is up-to-date with origin (${LOCAL_SHA:0:7})."
fi

# 3. Release ticket exists somewhere under compliance/pending-releases/
TICKETS=$(find compliance/pending-releases -maxdepth 1 -name 'RELEASE-TICKET-*.md' 2>/dev/null | head -5 || true)
if [ -z "$TICKETS" ]; then
  fail "No RELEASE-TICKET-*.md found in compliance/pending-releases/."
else
  ok "Release ticket present:$(echo "$TICKETS" | sed 's|.*/| |g' | tr '\n' ' ')"
fi

# 4. CI gates green on current develop HEAD (if gh CLI available)
if command -v gh >/dev/null 2>&1; then
  CI_CONCLUSIONS=$(gh run list --branch develop --commit "$REMOTE_SHA" --limit 10 --json conclusion,status,name 2>/dev/null || echo '[]')
  if [ "$CI_CONCLUSIONS" = '[]' ]; then
    fail "No CI runs found for ${REMOTE_SHA:0:7} — has the push reached GitHub Actions yet?"
  else
    INCOMPLETE=$(echo "$CI_CONCLUSIONS" | jq -r '[.[] | select(.status != "completed")] | length')
    FAILED_RUNS=$(echo "$CI_CONCLUSIONS" | jq -r '[.[] | select(.conclusion == "failure" or .conclusion == "cancelled")] | length')
    if [ "$INCOMPLETE" -gt 0 ]; then
      fail "CI still running on ${REMOTE_SHA:0:7} (${INCOMPLETE} in-flight)."
    elif [ "$FAILED_RUNS" -gt 0 ]; then
      fail "CI failed on ${REMOTE_SHA:0:7} (${FAILED_RUNS} runs failed)."
    else
      ok "CI gates green on ${REMOTE_SHA:0:7}."
    fi
  fi
else
  note "gh CLI not available — skipping CI-green check. Verify in GitHub UI."
fi

# 5. Resolve release id from (projectSlug, versionPrefix)
RESOLVE_URL="${BASE_URL}/api/ci/releases/resolve?projectSlug=${PROJECT_SLUG}&versionPrefix=${VERSION_PREFIX}"
RESOLVE=$(curl -s -H "Authorization: Bearer ${DEVAUDIT_API_KEY}" "$RESOLVE_URL")
RELEASE_ID=$(echo "$RESOLVE" | jq -r '.latest.id // empty')
RELEASE_STATUS=$(echo "$RESOLVE" | jq -r '.latest.status // empty')
RELEASE_VERSION=$(echo "$RESOLVE" | jq -r '.latest.version // empty')

if [ -z "$RELEASE_ID" ]; then
  fail "No release found in DevAudit for ${PROJECT_SLUG} ${VERSION_PREFIX} (has CI uploaded evidence yet?)."
else
  ok "Release found: ${RELEASE_VERSION} (id ${RELEASE_ID:0:8}…, status ${RELEASE_STATUS})."
fi

if [ "$FAILED" -gt 0 ]; then
  echo ""
  echo "Refusing to submit — ${FAILED} readiness check(s) failed."
  exit 1
fi

# 6. Idempotent dispatch on release status
case "$RELEASE_STATUS" in
  draft)
    echo ""
    echo "Submitting ${RELEASE_VERSION} for UAT review…"
    SUBMIT_URL="${BASE_URL}/api/releases/${RELEASE_ID}/submit-review"
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
      -H "X-DevAudit-Token: ${DEVAUDIT_USER_TOKEN}" \
      -H "Content-Type: application/json" \
      "$SUBMIT_URL")
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | sed '$d')
    if [ "$HTTP_CODE" = "200" ]; then
      NEW_STATUS=$(echo "$BODY" | jq -r '.status')
      echo "  Status: draft → ${NEW_STATUS}"
      echo "  Review page: ${BASE_URL}/projects/${PROJECT_SLUG}/releases/${RELEASE_ID}?env=uat"
    else
      echo "  Submission failed (HTTP ${HTTP_CODE}): $(echo "$BODY" | jq -r '.error // .')" >&2
      exit 1
    fi
    ;;
  uat_review)
    echo ""
    echo "Release already submitted for UAT review (status: uat_review). No action taken."
    echo "Review page: ${BASE_URL}/projects/${PROJECT_SLUG}/releases/${RELEASE_ID}?env=uat"
    ;;
  uat_approved | prod_review | prod_approved | released)
    echo ""
    echo "Release has progressed past UAT review (status: ${RELEASE_STATUS}). No action taken."
    echo "Release page: ${BASE_URL}/projects/${PROJECT_SLUG}/releases/${RELEASE_ID}"
    ;;
  uat_rejected | prod_rejected)
    echo ""
    echo "Release is in a rejected state (status: ${RELEASE_STATUS}). Address review comments and push a fix before resubmitting." >&2
    exit 2
    ;;
  *)
    echo ""
    echo "Release in unexpected status: ${RELEASE_STATUS}. Refusing to submit." >&2
    exit 2
    ;;
esac
