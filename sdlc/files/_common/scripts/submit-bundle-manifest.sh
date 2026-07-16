#!/usr/bin/env bash
# submit-bundle-manifest.sh — resolve a release row, then POST its bundle manifest.
#
# Usage:
#   ./scripts/submit-bundle-manifest.sh <project-slug> <release-version> <manifest-path> [--reconcile-existing-ownership]

set -euo pipefail

PROJECT_SLUG="${1:-}"
RELEASE_VERSION="${2:-}"
MANIFEST_PATH="${3:-}"
shift $(( $# >= 3 ? 3 : $# ))

RECONCILE_EXISTING_OWNERSHIP=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --reconcile-existing-ownership)
      RECONCILE_EXISTING_OWNERSHIP=true
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [ -z "$PROJECT_SLUG" ] || [ -z "$RELEASE_VERSION" ] || [ -z "$MANIFEST_PATH" ]; then
  echo "Usage: $0 <project-slug> <release-version> <manifest-path> [--reconcile-existing-ownership]" >&2
  exit 1
fi

: "${DEVAUDIT_BASE_URL:?DEVAUDIT_BASE_URL must be set}"
: "${DEVAUDIT_API_KEY:?DEVAUDIT_API_KEY must be set}"

if [ ! -f "$MANIFEST_PATH" ]; then
  echo "Error: manifest file not found: $MANIFEST_PATH" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required." >&2
  exit 1
fi

BASE_URL="${DEVAUDIT_BASE_URL%/}"

SCHEMA_VERSION="$(jq -r '.schemaVersion // empty' "$MANIFEST_PATH")"
if [ "$SCHEMA_VERSION" != "1" ]; then
  echo "Error: manifest schemaVersion must be 1." >&2
  exit 1
fi

MEMBER_COUNT="$(jq -r '(.members // []) | length' "$MANIFEST_PATH")"
WORK_ITEM_COUNT="$(jq -r '(.nonReleaseWorkItems // []) | length' "$MANIFEST_PATH")"
if [ "$MEMBER_COUNT" = "0" ] && [ "$WORK_ITEM_COUNT" = "0" ]; then
  echo "Bundle manifest has no members or non-release work items; skipping submission."
  exit 0
fi

RESOLVE_URL="${BASE_URL}/api/ci/releases/resolve?projectSlug=${PROJECT_SLUG}&versionPrefix=${RELEASE_VERSION}"
RESOLVE_RESPONSE="$(curl -sS -H "Authorization: Bearer ${DEVAUDIT_API_KEY}" "$RESOLVE_URL")"
RELEASE_ID="$(printf '%s' "$RESOLVE_RESPONSE" | jq -r '.latest.id // empty')"
RESOLVED_VERSION="$(printf '%s' "$RESOLVE_RESPONSE" | jq -r '.latest.version // empty')"

if [ -z "$RELEASE_ID" ]; then
  echo "Error: could not resolve release ${RELEASE_VERSION} for project ${PROJECT_SLUG}." >&2
  exit 1
fi
if [ "$RESOLVED_VERSION" != "$RELEASE_VERSION" ]; then
  echo "Error: resolve endpoint returned ${RESOLVED_VERSION} instead of exact release ${RELEASE_VERSION}." >&2
  exit 1
fi

PAYLOAD="$(cat "$MANIFEST_PATH")"
if [ "$RECONCILE_EXISTING_OWNERSHIP" = "true" ]; then
  PAYLOAD="$(jq '. + { reconcileExistingOwnership: true }' "$MANIFEST_PATH")"
fi

POST_URL="${BASE_URL}/api/ci/releases/${RELEASE_ID}/bundle-manifest"
HTTP_BODY_FILE="$(mktemp)"
trap 'rm -f "$HTTP_BODY_FILE"' EXIT
HTTP_CODE="$(
  curl -sS -o "$HTTP_BODY_FILE" -w "%{http_code}" \
    -X POST \
    -H "Authorization: Bearer ${DEVAUDIT_API_KEY}" \
    -H "Content-Type: application/json" \
    --data "$PAYLOAD" \
    "$POST_URL"
)"

if [ "$HTTP_CODE" != "201" ]; then
  echo "Error: bundle manifest submission failed with HTTP ${HTTP_CODE}." >&2
  sed 's/^/  /' "$HTTP_BODY_FILE" >&2
  exit 1
fi

echo "Submitted bundle manifest for ${RELEASE_VERSION} to release ${RELEASE_ID}."
echo "  members: ${MEMBER_COUNT}"
echo "  non-release work items: ${WORK_ITEM_COUNT}"
