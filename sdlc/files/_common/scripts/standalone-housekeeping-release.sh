#!/usr/bin/env bash
# standalone-housekeeping-release.sh — validate and promote an explicit
# standalone-housekeeping exception after a reviewed, green main promotion.
#
# Manifest contract:
# compliance/standalone-housekeeping/STANDALONE-HOUSEKEEPING-vYYYY.MM.DD.json
# {
#   "schemaVersion": 1,
#   "version": "vYYYY.MM.DD",
#   "releaseMode": "standalone_housekeeping",
#   "reason": "Why this cannot wait for the next tracked REQ release."
# }

set -euo pipefail

COMMAND="${1:-}"
VERSION="${2:-}"
MANIFEST_PATH="${3:-}"

usage() {
  echo "Usage: $0 validate <version> <manifest-path>" >&2
  echo "       $0 promote <project-slug> <version> <manifest-path>" >&2
  exit 2
}

validate_manifest() {
  local expected_version="$1" path="$2"
  if ! [[ "$expected_version" =~ ^v[0-9]{4}\.[0-9]{2}\.[0-9]{2}(\.[0-9]+)?$ ]]; then
    echo "Error: ${expected_version} is not a bare-date housekeeping version." >&2
    return 1
  fi
  if [ ! -f "$path" ]; then
    echo "Error: standalone-housekeeping declaration not found: ${path}" >&2
    return 1
  fi
  if ! command -v jq >/dev/null 2>&1; then
    echo "Error: jq is required." >&2
    return 1
  fi

  local schema_version manifest_version release_mode reason
  schema_version=$(jq -r '.schemaVersion // empty' "$path")
  manifest_version=$(jq -r '.version // empty' "$path")
  release_mode=$(jq -r '.releaseMode // empty' "$path")
  reason=$(jq -r '.reason // empty' "$path")

  [ "$schema_version" = "1" ] || { echo "Error: schemaVersion must be 1." >&2; return 1; }
  [ "$manifest_version" = "$expected_version" ] || { echo "Error: declaration version must exactly match ${expected_version}." >&2; return 1; }
  [ "$release_mode" = "standalone_housekeeping" ] || { echo "Error: releaseMode must be standalone_housekeeping." >&2; return 1; }
  if [ "${#reason}" -lt 20 ]; then
    echo "Error: reason must explain why this cannot wait for the next tracked REQ (minimum 20 characters)." >&2
    return 1
  fi
}

case "$COMMAND" in
  validate)
    [ -n "$VERSION" ] && [ -n "$MANIFEST_PATH" ] || usage
    validate_manifest "$VERSION" "$MANIFEST_PATH"
    echo "Standalone housekeeping declaration is valid for ${VERSION}."
    ;;
  promote)
    PROJECT_SLUG="${2:-}"
    VERSION="${3:-}"
    MANIFEST_PATH="${4:-}"
    [ -n "$PROJECT_SLUG" ] && [ -n "$VERSION" ] && [ -n "$MANIFEST_PATH" ] || usage
    validate_manifest "$VERSION" "$MANIFEST_PATH"
    : "${DEVAUDIT_BASE_URL:?DEVAUDIT_BASE_URL must be set}"
    : "${DEVAUDIT_API_KEY:?DEVAUDIT_API_KEY must be set}"

    BASE_URL="${DEVAUDIT_BASE_URL%/}"
    ENCODED_SLUG=$(jq -rn --arg value "$PROJECT_SLUG" '$value|@uri')
    ENCODED_VERSION=$(jq -rn --arg value "$VERSION" '$value|@uri')
    RESOLVED=$(curl -fsS -H "Authorization: Bearer ${DEVAUDIT_API_KEY}" \
      "${BASE_URL}/api/ci/releases/resolve?projectSlug=${ENCODED_SLUG}&versionPrefix=${ENCODED_VERSION}")
    RELEASE_ID=$(jq -r '.latest.id // empty' <<<"$RESOLVED")
    RESOLVED_VERSION=$(jq -r '.latest.version // empty' <<<"$RESOLVED")
    [ -n "$RELEASE_ID" ] || { echo "Error: could not resolve ${VERSION}." >&2; exit 1; }
    [ "$RESOLVED_VERSION" = "$VERSION" ] || { echo "Error: resolve returned ${RESOLVED_VERSION}, not exact ${VERSION}." >&2; exit 1; }

    REASON=$(jq -r '.reason' "$MANIFEST_PATH")
    PAYLOAD=$(jq -n --arg releaseMode standalone_housekeeping --arg standaloneReason "$REASON" \
      '{releaseMode: $releaseMode, standaloneReason: $standaloneReason}')
    RESPONSE_FILE=$(mktemp)
    trap 'rm -f "$RESPONSE_FILE"' EXIT
    HTTP_CODE=$(curl -sS -o "$RESPONSE_FILE" -w '%{http_code}' \
      -X PATCH "${BASE_URL}/api/ci/releases/${RELEASE_ID}" \
      -H "Authorization: Bearer ${DEVAUDIT_API_KEY}" \
      -H 'Content-Type: application/json' --data "$PAYLOAD")
    if [ "$HTTP_CODE" != "200" ]; then
      echo "Error: standalone housekeeping promotion failed with HTTP ${HTTP_CODE}." >&2
      sed 's/^/  /' "$RESPONSE_FILE" >&2
      exit 1
    fi
    echo "Promoted ${VERSION} as standalone housekeeping (release ${RELEASE_ID})."
    ;;
  *) usage ;;
esac
