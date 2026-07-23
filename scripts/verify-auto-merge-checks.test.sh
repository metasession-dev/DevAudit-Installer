#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="$ROOT/scripts/verify-auto-merge-checks.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/bin"
cat > "$WORK/bin/gh" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *required_status_checks*) printf '%s\n' '{"contexts":["Quality Gates"]}' ;;
  *check-runs*) printf '%s\n' "${CHECK_RUNS:?}" ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$WORK/bin/gh"

export PATH="$WORK/bin:$PATH"
export CHECK_RUNS='{"check_runs":[{"name":"Quality Gates","status":"completed","conclusion":"success"},{"name":"Quality Gates","status":"in_progress","conclusion":null}]}'
if bash "$HELPER" org/repo develop abc; then
  echo 'expected queued/running duplicate to block auto-merge' >&2
  exit 1
fi

export CHECK_RUNS='{"check_runs":[{"name":"Quality Gates","status":"completed","conclusion":"success"},{"name":"Quality Gates","status":"completed","conclusion":"success"}]}'
bash "$HELPER" org/repo develop abc

echo 'verify-auto-merge-checks regression test passed'
