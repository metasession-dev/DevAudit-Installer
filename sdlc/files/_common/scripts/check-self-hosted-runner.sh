#!/usr/bin/env bash
# Validate host-level prerequisites for self-hosted CI runners.

set -euo pipefail

MIN_WATCHES="${MIN_INOTIFY_WATCHES:-524288}"
MIN_INSTANCES="${MIN_INOTIFY_INSTANCES:-512}"
RUNNER_ENVIRONMENT="${DEVAUDIT_RUNNER_ENVIRONMENT:-${RUNNER_ENVIRONMENT:-}}"
SYSCTL_BIN="${SYSCTL_BIN:-sysctl}"
SYSCTL_CONF_DIR="${SYSCTL_CONF_DIR:-/etc/sysctl.d}"
APPLY=false
FORCE=false

usage() {
  cat <<EOF
Usage: check-self-hosted-runner.sh [--apply] [--force]

Validates Linux self-hosted runner prerequisites needed by Next.js/Turbopack
and Playwright E2E jobs.

Options:
  --apply   Persist and apply inotify sysctl minima. Requires permission to
            write ${SYSCTL_CONF_DIR} and run sysctl -w.
  --force   Run checks even when DEVAUDIT_RUNNER_ENVIRONMENT is not self-hosted.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply) APPLY=true ;;
    --force) FORCE=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [ "${FORCE}" != "true" ] && [ -n "${RUNNER_ENVIRONMENT}" ] && [ "${RUNNER_ENVIRONMENT}" != "self-hosted" ]; then
  echo "Runner environment is ${RUNNER_ENVIRONMENT}; self-hosted prerequisite checks skipped."
  exit 0
fi

OS_NAME="$(uname -s 2>/dev/null || echo unknown)"
if [ "${OS_NAME}" != "Linux" ]; then
  echo "Runner OS is ${OS_NAME}; Linux inotify prerequisite checks skipped."
  exit 0
fi

read_sysctl() {
  local key="$1"
  "${SYSCTL_BIN}" -n "$key" 2>/dev/null || true
}

write_sysctl_config() {
  mkdir -p "${SYSCTL_CONF_DIR}"
  cat > "${SYSCTL_CONF_DIR}/99-metasession-ci-inotify.conf" <<EOF
fs.inotify.max_user_watches=${MIN_WATCHES}
fs.inotify.max_user_instances=${MIN_INSTANCES}
EOF
}

if [ "${APPLY}" = "true" ]; then
  echo "Persisting self-hosted runner inotify prerequisites..."
  write_sysctl_config
  "${SYSCTL_BIN}" -w "fs.inotify.max_user_watches=${MIN_WATCHES}"
  "${SYSCTL_BIN}" -w "fs.inotify.max_user_instances=${MIN_INSTANCES}"
fi

CURRENT_WATCHES="$(read_sysctl fs.inotify.max_user_watches)"
CURRENT_INSTANCES="$(read_sysctl fs.inotify.max_user_instances)"

if ! [[ "${CURRENT_WATCHES}" =~ ^[0-9]+$ ]] || ! [[ "${CURRENT_INSTANCES}" =~ ^[0-9]+$ ]]; then
  echo "::error::Unable to read Linux inotify sysctl values on this self-hosted runner." >&2
  echo "Run: sudo bash scripts/check-self-hosted-runner.sh --apply" >&2
  exit 1
fi

FAILED=false
if [ "${CURRENT_WATCHES}" -lt "${MIN_WATCHES}" ]; then
  echo "::error::fs.inotify.max_user_watches=${CURRENT_WATCHES}, expected at least ${MIN_WATCHES}." >&2
  FAILED=true
fi
if [ "${CURRENT_INSTANCES}" -lt "${MIN_INSTANCES}" ]; then
  echo "::error::fs.inotify.max_user_instances=${CURRENT_INSTANCES}, expected at least ${MIN_INSTANCES}." >&2
  FAILED=true
fi

if [ "${FAILED}" = "true" ]; then
  cat >&2 <<EOF
Self-hosted runner is missing durable inotify capacity for Turbopack/Playwright E2E.

Apply on the runner host:
  sudo bash scripts/check-self-hosted-runner.sh --apply

Expected persistent file:
  ${SYSCTL_CONF_DIR}/99-metasession-ci-inotify.conf

Do not classify this as product-test evidence; repair the runner and rerun CI.
EOF
  exit 1
fi

echo "Self-hosted runner prerequisites passed: fs.inotify.max_user_watches=${CURRENT_WATCHES}, fs.inotify.max_user_instances=${CURRENT_INSTANCES}."
