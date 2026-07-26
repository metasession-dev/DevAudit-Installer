#!/usr/bin/env bash
set -euo pipefail

STATE_ROOT="${METASESSION_CI_STATE_ROOT:-/opt/metasession-ci/state}"
CACHE_ROOT="${METASESSION_CI_CACHE_ROOT:-/opt/metasession-ci/cache}"
CAPABILITIES_PATH="${METASESSION_CI_CAPABILITIES:-${STATE_ROOT}/capabilities.json}"
REQUIRED_COMMANDS="${REQUIRED_RUNNER_COMMANDS:-git gh jq curl tar node npm python3}"
failed=0

for command_name in $REQUIRED_COMMANDS; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "::error::Missing runner prerequisite: ${command_name}" >&2
    failed=1
  fi
done

python3 -m venv --help >/dev/null 2>&1 || {
  echo "::error::python3 venv support is unavailable." >&2
  failed=1
}

[ -d "$CACHE_ROOT" ] && [ -w "$CACHE_ROOT" ] || {
  echo "::error::Cache root is missing or not writable: ${CACHE_ROOT}" >&2
  failed=1
}

if ! jq -e '
  .schemaVersion == 1 and
  (.runnerLabel | type == "string" and length > 0) and
  (.os | type == "string" and length > 0) and
  (.arch | type == "string" and length > 0) and
  (.capabilities | type == "array")
' "$CAPABILITIES_PATH" >/dev/null 2>&1; then
  echo "::error::Capability declaration is missing or malformed: ${CAPABILITIES_PATH}" >&2
  failed=1
fi

if [ "$(uname -s)" = "Linux" ]; then
  DEVAUDIT_RUNNER_ENVIRONMENT=self-hosted \
    bash "$(dirname "$0")/../../sdlc/files/_common/scripts/check-self-hosted-runner.sh" || failed=1
fi

if [ "$failed" -ne 0 ]; then
  echo "::error::Runner host is not ready. Re-run bootstrap-linux.sh and inspect the messages above." >&2
  exit 1
fi

echo "Runner host readiness passed."
jq . "$CAPABILITIES_PATH"
