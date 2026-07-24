#!/usr/bin/env bash
# Wait for one exact public npm package version and its tarball to be readable.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <package-name> <version>" >&2
  exit 64
fi

PACKAGE_NAME="$1"
EXPECTED_VERSION="$2"
REGISTRY_URL="${NPM_PUBLICATION_REGISTRY:-https://registry.npmjs.org}"
MAX_ATTEMPTS="${NPM_PUBLICATION_VERIFY_ATTEMPTS:-20}"
INTERVAL_SECONDS="${NPM_PUBLICATION_VERIFY_INTERVAL_SECONDS:-15}"

if ! [[ "$MAX_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || ! [[ "$INTERVAL_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "NPM publication verification attempts and interval must be non-negative integers." >&2
  exit 64
fi

for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt++)); do
  actual_version="$(npm view "${PACKAGE_NAME}@${EXPECTED_VERSION}" version \
    --registry="$REGISTRY_URL" --prefer-online --fetch-retries=0 2>/dev/null || true)"
  tarball_url="$(npm view "${PACKAGE_NAME}@${EXPECTED_VERSION}" dist.tarball \
    --registry="$REGISTRY_URL" --prefer-online --fetch-retries=0 2>/dev/null || true)"

  if [ "$actual_version" = "$EXPECTED_VERSION" ] && [ -n "$tarball_url" ] && \
    curl --fail --silent --show-error --location --head "$tarball_url" >/dev/null; then
    echo "Verified public npm publication: ${PACKAGE_NAME}@${EXPECTED_VERSION}"
    exit 0
  fi

  echo "Waiting for public npm publication (${attempt}/${MAX_ATTEMPTS}): ${PACKAGE_NAME}@${EXPECTED_VERSION}" >&2
  if [ "$attempt" -lt "$MAX_ATTEMPTS" ] && [ "$INTERVAL_SECONDS" -gt 0 ]; then
    sleep "$INTERVAL_SECONDS"
  fi
done

echo "Public npm verification timed out: ${PACKAGE_NAME}@${EXPECTED_VERSION} was not readable from ${REGISTRY_URL}." >&2
echo "Check with: npm view ${PACKAGE_NAME}@${EXPECTED_VERSION} version --registry=${REGISTRY_URL}" >&2
exit 1
