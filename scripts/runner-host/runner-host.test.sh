#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/bin" "$WORK/cache" "$WORK/state"
cat > "$WORK/state/capabilities.json" <<'JSON'
{"schemaVersion":1,"runnerLabel":"metasession-ci-test","os":"linux","arch":"x86_64","capabilities":["cap-node","cap-playwright"]}
JSON

cat > "$WORK/bin/gh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "${RUNNER_FIXTURE:?}"
EOF
chmod +x "$WORK/bin/gh"

export PATH="$WORK/bin:$PATH"
export RUNNER_FIXTURE='{"runners":[{"id":1,"name":"test","status":"online","busy":false,"labels":[{"name":"metasession-ci-test"}]}]}'
GH_TOKEN=test bash "$ROOT/scripts/runner-host/resolve-online-runner.sh" metasession-dev metasession-ci-test |
  grep -q 'runner_name=test'

export RUNNER_FIXTURE='{"runners":[{"id":1,"name":"test","status":"offline","busy":false,"labels":[{"name":"metasession-ci-test"}]}]}'
if GH_TOKEN=test bash "$ROOT/scripts/runner-host/resolve-online-runner.sh" metasession-dev metasession-ci-test >/dev/null 2>&1; then
  echo "offline runner should fail" >&2
  exit 1
fi

(
  cd "$WORK"
  GITHUB_REPOSITORY=metasession-dev/example \
  GITHUB_ENV="$WORK/github-env" \
  METASESSION_CI_CACHE_ROOT="$WORK/cache" \
  METASESSION_CI_CAPABILITIES="$WORK/state/capabilities.json" \
    bash "$ROOT/scripts/runner-host/prepare-repository-cache.sh"
)
grep -q 'PLAYWRIGHT_BROWSERS_PATH=.*/metasession-dev/example/playwright' "$WORK/github-env"

RUNNER_LABEL=invalid bash "$ROOT/scripts/runner-host/bootstrap-linux.sh" --plan >/dev/null 2>&1 && {
  echo "invalid runner label should fail" >&2
  exit 1
}
RUNNER_LABEL=metasession-ci-test bash "$ROOT/scripts/runner-host/bootstrap-linux.sh" --plan |
  grep -q 'Plan only'

echo "runner host contracts passed"
