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
  *actions/runs/111*) printf '%s\n' "${RUN_111:?}" ;;
  *actions/runs/222*) printf '%s\n' "${RUN_222:?}" ;;
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

export RUN_111='{"status":"completed","conclusion":"success"}'
export CHECK_RUNS='{"check_runs":[{"name":"Quality Gates","status":"in_progress","conclusion":null,"details_url":"https://github.com/org/repo/actions/runs/111/job/1","started_at":"2026-07-23T07:47:22Z"}]}'
if bash "$HELPER" org/repo develop abc; then
  echo 'expected stale check without a newer successful rerun to block auto-merge' >&2
  exit 1
fi

export CHECK_RUNS='{"check_runs":[{"name":"Quality Gates","status":"in_progress","conclusion":null,"details_url":"https://github.com/org/repo/actions/runs/111/job/1","started_at":"2026-07-23T07:47:22Z"},{"name":"Quality Gates","status":"completed","conclusion":"success","started_at":"2026-07-23T07:51:36Z"}]}'
bash "$HELPER" org/repo develop abc

export RUN_222='{"status":"in_progress","conclusion":null}'
export CHECK_RUNS='{"check_runs":[{"name":"Quality Gates","status":"in_progress","conclusion":null,"details_url":"https://github.com/org/repo/actions/runs/222/job/1","started_at":"2026-07-23T07:52:00Z"},{"name":"Quality Gates","status":"completed","conclusion":"success","started_at":"2026-07-23T07:51:36Z"}]}'
if bash "$HELPER" org/repo develop abc; then
  echo 'expected active required workflow to block auto-merge' >&2
  exit 1
fi

echo 'verify-auto-merge-checks regression test passed'
