#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECKER="$SCRIPT_DIR/check-self-hosted-runner.sh"

PASS=0
FAIL=0

ok() {
  echo "  PASS: $1"
  PASS=$((PASS + 1))
}

no() {
  echo "  FAIL: $1"
  FAIL=$((FAIL + 1))
}

run_case() {
  local name="$1"; shift
  OUT="$(mktemp)"
  set +e
  "$@" >"$OUT" 2>&1
  CODE=$?
  set -e
  echo "$name"
}

WORK="$(mktemp -d -t runner-check-test-XXXX)"
trap 'rm -rf "$WORK"' EXIT

SYSCTL_FAKE="$WORK/sysctl"
cat > "$SYSCTL_FAKE" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  -n)
    case "$2" in
      fs.inotify.max_user_watches) echo "${FAKE_WATCHES:-524288}" ;;
      fs.inotify.max_user_instances) echo "${FAKE_INSTANCES:-512}" ;;
      *) exit 1 ;;
    esac
    ;;
  -w)
    echo "$2"
    ;;
  *)
    exit 1
    ;;
esac
EOF
chmod +x "$SYSCTL_FAKE"

run_case "Case 1: GitHub-hosted runner no-ops" env DEVAUDIT_RUNNER_ENVIRONMENT=github-hosted SYSCTL_BIN="$SYSCTL_FAKE" "$CHECKER"
[ "$CODE" -eq 0 ] && grep -q "skipped" "$OUT" && ok "hosted runner skipped" || no "hosted runner should skip"

run_case "Case 2: low limits fail with actionable remediation" env DEVAUDIT_RUNNER_ENVIRONMENT=self-hosted FAKE_WATCHES=65536 FAKE_INSTANCES=128 SYSCTL_BIN="$SYSCTL_FAKE" "$CHECKER"
[ "$CODE" -eq 1 ] && grep -q "sudo bash scripts/check-self-hosted-runner.sh --apply" "$OUT" && ok "low limits fail with remediation" || no "low limits should fail"

run_case "Case 3: sufficient limits pass" env DEVAUDIT_RUNNER_ENVIRONMENT=self-hosted FAKE_WATCHES=524288 FAKE_INSTANCES=512 SYSCTL_BIN="$SYSCTL_FAKE" "$CHECKER"
[ "$CODE" -eq 0 ] && grep -q "prerequisites passed" "$OUT" && ok "sufficient limits pass" || no "sufficient limits should pass"

CONF_DIR="$WORK/sysctl.d"
run_case "Case 4: --apply writes persistent config" env DEVAUDIT_RUNNER_ENVIRONMENT=self-hosted SYSCTL_BIN="$SYSCTL_FAKE" SYSCTL_CONF_DIR="$CONF_DIR" "$CHECKER" --apply
if [ "$CODE" -eq 0 ] && grep -q "fs.inotify.max_user_watches=524288" "$CONF_DIR/99-metasession-ci-inotify.conf" && grep -q "fs.inotify.max_user_instances=512" "$CONF_DIR/99-metasession-ci-inotify.conf"; then
  ok "--apply persists config"
else
  no "--apply should persist config"
fi

echo
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
