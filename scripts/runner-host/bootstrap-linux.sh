#!/usr/bin/env bash
set -euo pipefail

ORG="${GITHUB_ORG:-metasession-dev}"
RUNNER_GROUP="${RUNNER_GROUP:-metasession-ci}"
RUNNER_LABEL="${RUNNER_LABEL:-}"
RUNNER_USER="${RUNNER_USER:-metasession-ci}"
ROOT="${METASESSION_CI_ROOT:-/opt/metasession-ci}"
RUNNER_ROOT="${RUNNER_ROOT:-${ROOT}/runners/actions-runner}"
CACHE_ROOT="${CACHE_ROOT:-${ROOT}/cache}"
STATE_ROOT="${STATE_ROOT:-${ROOT}/state}"
CAPABILITIES="${CAPABILITIES:-cap-node,cap-playwright}"
APPLY=false

case "${1:-}" in
  --apply) APPLY=true ;;
  --plan|"") ;;
  *) echo "usage: $0 [--plan|--apply]" >&2; exit 2 ;;
esac

if [ -z "$RUNNER_LABEL" ] || ! [[ "$RUNNER_LABEL" =~ ^metasession-ci-[a-z0-9-]+$ ]]; then
  echo "RUNNER_LABEL must be a unique label matching metasession-ci-<machine>." >&2
  exit 2
fi
if [ "$(uname -s)" != "Linux" ]; then
  echo "This bootstrap currently supports Linux. Use the runbook for macOS/Windows enrollment." >&2
  exit 2
fi

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) RUNNER_ARCH=x64 ;;
  aarch64|arm64) RUNNER_ARCH=arm64 ;;
  *) echo "Unsupported Linux architecture: $ARCH" >&2; exit 2 ;;
esac

LABELS="metasession,metasession-ci,${RUNNER_LABEL},os-linux,arch-${RUNNER_ARCH},${CAPABILITIES}"

cat <<EOF
Organization: ${ORG}
Runner group: ${RUNNER_GROUP}
Runner label: ${RUNNER_LABEL}
Runner root: ${RUNNER_ROOT}
Cache root: ${CACHE_ROOT}
Runner user: ${RUNNER_USER}
Labels: ${LABELS}
EOF

if [ "$APPLY" != "true" ]; then
  echo "Plan only. Re-run with --apply after reviewing these values."
  exit 0
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "--apply must run as root." >&2
  exit 1
fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  build-essential ca-certificates curl git jq python3 python3-venv tar unzip

id "$RUNNER_USER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$RUNNER_USER"
install -d -o "$RUNNER_USER" -g "$RUNNER_USER" "$RUNNER_ROOT" "$CACHE_ROOT" "$STATE_ROOT"

bash "$(dirname "$0")/../../sdlc/files/_common/scripts/check-self-hosted-runner.sh" --apply --force

if [ ! -f "$RUNNER_ROOT/.runner" ]; then
  RELEASE_JSON="$(curl --fail --silent --show-error https://api.github.com/repos/actions/runner/releases/latest)"
  VERSION="$(jq -r '.tag_name | sub("^v"; "")' <<<"$RELEASE_JSON")"
  ARCHIVE="actions-runner-linux-${RUNNER_ARCH}-${VERSION}.tar.gz"
  curl --fail --location --retry 3 \
    "https://github.com/actions/runner/releases/download/v${VERSION}/${ARCHIVE}" \
    -o "/tmp/${ARCHIVE}"
  tar -xzf "/tmp/${ARCHIVE}" -C "$RUNNER_ROOT"

  TOKEN="$(gh api --method POST "/orgs/${ORG}/actions/runners/registration-token" --jq .token)"
  runuser -u "$RUNNER_USER" -- "$RUNNER_ROOT/config.sh" \
    --unattended \
    --url "https://github.com/${ORG}" \
    --token "$TOKEN" \
    --name "$RUNNER_LABEL" \
    --runnergroup "$RUNNER_GROUP" \
    --labels "$LABELS" \
    --work "_work"
fi

cat > "$STATE_ROOT/capabilities.json" <<EOF
{
  "schemaVersion": 1,
  "runnerLabel": "${RUNNER_LABEL}",
  "os": "linux",
  "arch": "${ARCH}",
  "capabilities": $(tr ',' '\n' <<<"$CAPABILITIES" | jq -R . | jq -s .)
}
EOF
chown "$RUNNER_USER:$RUNNER_USER" "$STATE_ROOT/capabilities.json"

cd "$RUNNER_ROOT"
./svc.sh install "$RUNNER_USER" 2>/dev/null || true
./svc.sh start
./svc.sh status

METASESSION_CI_STATE_ROOT="$STATE_ROOT" \
METASESSION_CI_CACHE_ROOT="$CACHE_ROOT" \
  bash "$(dirname "$0")/verify-runner-host.sh"
