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
  *branches/*/protection/required_status_checks*)
    if [ -n "${LEGACY_JSON:-}" ]; then printf '%s\n' "$LEGACY_JSON"; else printf '%s\n' '{"message":"Not Found"}'; exit 1; fi ;;
  */branches/*)
    if [ -n "${BRANCH_JSON:-}" ]; then printf '%s\n' "$BRANCH_JSON"; else printf '%s\n' '{"message":"Not Found"}'; exit 1; fi ;;
  *actions/runs/111*) printf '%s\n' "${RUN_111:?}" ;;
  *actions/runs/222*) printf '%s\n' "${RUN_222:?}" ;;
  *check-runs*) printf '%s\n' "${CHECK_RUNS:?}" ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$WORK/bin/gh"

export PATH="$WORK/bin:$PATH"
export LEGACY_JSON='{"contexts":["Quality Gates"]}'
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

# #1064 — the classic protection endpoint answers 404 to the workflow token; the
# branch endpoint carries the same list.
unset LEGACY_JSON
export CHECK_RUNS='{"check_runs":[{"name":"Quality Gates","status":"completed","conclusion":"success"}]}'
export BRANCH_JSON='{"protection":{"required_status_checks":{"contexts":["Quality Gates"]}}}'
bash "$HELPER" org/repo develop abc

export CHECK_RUNS='{"check_runs":[{"name":"Other","status":"completed","conclusion":"success"}]}'
if bash "$HELPER" org/repo develop abc; then
  echo 'expected a required check with no run to block auto-merge (branch endpoint)' >&2
  exit 1
fi

export CHECK_RUNS='{"check_runs":[{"name":"Quality Gates","status":"completed","conclusion":"success"}]}'
export BRANCH_JSON='{"protection":{"required_status_checks":{"contexts":[]}}}'
if bash "$HELPER" org/repo develop abc; then
  echo 'expected a branch with no required contexts to block auto-merge' >&2
  exit 1
fi

export BRANCH_JSON='{"name":"develop"}'
if bash "$HELPER" org/repo develop abc; then
  echo 'expected an unprotected branch response to block auto-merge' >&2
  exit 1
fi

unset BRANCH_JSON
if bash "$HELPER" org/repo develop abc; then
  echo 'expected unresolvable protection to block auto-merge' >&2
  exit 1
fi

echo 'verify-auto-merge-checks regression test passed'
