#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="${GITHUB_REPOSITORY:-${1:-}}"
CACHE_ROOT="${METASESSION_CI_CACHE_ROOT:-/opt/metasession-ci/cache}"
CAPABILITIES_PATH="${METASESSION_CI_CAPABILITIES:-/opt/metasession-ci/state/capabilities.json}"

if ! [[ "$REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "::error::A valid owner/repository name is required." >&2
  exit 2
fi
if [ ! -r "$CAPABILITIES_PATH" ]; then
  echo "::error::Runner capability file is missing: ${CAPABILITIES_PATH}" >&2
  exit 1
fi

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
NODE_VERSION="$(node --version 2>/dev/null || echo unavailable)"
NPM_VERSION="$(npm --version 2>/dev/null || echo unavailable)"
REPO_CACHE="${CACHE_ROOT}/${REPOSITORY}"

mkdir -p \
  "$REPO_CACHE/npm" \
  "$REPO_CACHE/playwright" \
  "$REPO_CACHE/node_modules" \
  "$REPO_CACHE/build"

jq -e --arg os "$OS" --arg arch "$ARCH" '
  (.os | ascii_downcase) == $os and .arch == $arch and
  (.capabilities | index("cap-node") != null)
' "$CAPABILITIES_PATH" >/dev/null || {
  echo "::error::Runner capabilities do not satisfy Node CI for ${OS}/${ARCH}." >&2
  exit 1
}

FINGERPRINT="${OS}:${ARCH}:${NODE_VERSION}:${NPM_VERSION}"
printf '%s\n' "$FINGERPRINT" > "$REPO_CACHE/runtime-fingerprint"

for path in .next dist build coverage test-results playwright-report; do
  [ -e "$path" ] && rm -rf -- "$path"
done

if [ -n "${GITHUB_ENV:-}" ]; then
  {
    echo "npm_config_cache=${REPO_CACHE}/npm"
    echo "PLAYWRIGHT_BROWSERS_PATH=${REPO_CACHE}/playwright"
    echo "DEVAUDIT_REPO_CACHE=${REPO_CACHE}"
  } >> "$GITHUB_ENV"
fi

echo "Repository cache ready: ${REPO_CACHE}"
echo "Runtime fingerprint: ${FINGERPRINT}"
