#!/usr/bin/env bash
# check-host-deployment.test.sh — Tests for host deployment wait helper.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/check-host-deployment.sh"

PASS=0
FAIL=0
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

assert_exit() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $name"
    echo "    Expected exit: $expected"
    echo "    Actual exit:   $actual"
    FAIL=$((FAIL + 1))
  fi
}

assert_grep() {
  local name="$1" pattern="$2" file="$3"
  if grep -Eq "$pattern" "$file"; then
    echo "  ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $name"
    echo "    Missing pattern: $pattern"
    FAIL=$((FAIL + 1))
  fi
}

write_mock_gh() {
  local dir="$1"
  mkdir -p "$dir/mock-bin"
  cat > "$dir/mock-bin/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "$1" != "api" ]; then
  echo "unexpected gh invocation: $*" >&2
  exit 1
fi
case "$2" in
  */deployments\?sha=*)
    printf '%s' "${MOCK_DEPLOYMENTS_JSON}"
    ;;
  */statuses\?per_page=20)
    printf '%s' "${MOCK_STATUSES_JSON}"
    ;;
  *)
    echo "unexpected gh api path: $2" >&2
    exit 1
    ;;
esac
EOF
  chmod +x "$dir/mock-bin/gh"
}

run_check() {
  local dir="$1" out="$2"
  shift 2
  (
    cd "$dir"
    PATH="$dir/mock-bin:$PATH" "$@" bash "$HELPER" --repo=metasession-dev/example --sha=abc123 --max-attempts=1 --poll-seconds=0 --output-file="$out.result"
  ) >"$out" 2>&1
}

echo "=== check-host-deployment.sh tests ==="
echo ""

write_mock_gh "$WORK"

echo "--- Test 1: success status passes ---"
OUT="$WORK/test1.out"
if run_check "$WORK" "$OUT" env \
  MOCK_DEPLOYMENTS_JSON='[{"id":5453707224,"environment":"production"}]' \
  MOCK_STATUSES_JSON='[{"state":"success"}]'; then
  CODE=0
else
  CODE=$?
fi
assert_exit "success deployment passes" 0 "$CODE"
assert_grep "success message emitted" 'terminal success' "$OUT"
assert_grep "success result is structured" '^verification=success$' "$OUT.result"
echo ""

echo "--- Test 2: failure status fails ---"
OUT="$WORK/test2.out"
if run_check "$WORK" "$OUT" env \
  MOCK_DEPLOYMENTS_JSON='[{"id":5453707224,"environment":"production"}]' \
  MOCK_STATUSES_JSON='[{"state":"failure"}]'; then
  CODE=0
else
  CODE=$?
fi
assert_exit "failed deployment exits 1" 1 "$CODE"
assert_grep "failure message emitted" 'deployment_terminal_failure' "$OUT"
assert_grep "terminal failure result is structured" '^verification=deployment_terminal_failure$' "$OUT.result"
echo ""

echo "--- Test 3: missing deployment fails closed ---"
OUT="$WORK/test3.out"
if run_check "$WORK" "$OUT" env \
  MOCK_DEPLOYMENTS_JSON='[]' \
  MOCK_STATUSES_JSON='[]'; then
  CODE=0
else
  CODE=$?
fi
assert_exit "missing deployment exits 1" 1 "$CODE"
assert_grep "missing deployment message emitted" 'deployment_status_missing' "$OUT"
assert_grep "missing deployment result is structured" '^verification=deployment_status_missing$' "$OUT.result"
echo ""

echo "--- Test 4: prolonged in-progress status reports timeout ---"
OUT="$WORK/test4.out"
if run_check "$WORK" "$OUT" env \
  MOCK_DEPLOYMENTS_JSON='[{"id":5453707224,"environment":"production"}]' \
  MOCK_STATUSES_JSON='[{"state":"in_progress","description":"provider still building","environment_url":"https://example.test"}]'; then
  CODE=0
else
  CODE=$?
fi
assert_exit "in-progress deployment fails closed" 1 "$CODE"
assert_grep "timeout classification emitted" 'deployment_status_timeout' "$OUT"
assert_grep "timeout result is structured" '^verification=deployment_status_timeout$' "$OUT.result"
assert_grep "timeout retains target URL" '^target_url=https://example.test$' "$OUT.result"
echo ""

echo "--- Test 5: missing status reports timeout ---"
OUT="$WORK/test5.out"
if run_check "$WORK" "$OUT" env \
  MOCK_DEPLOYMENTS_JSON='[{"id":5453707224,"environment":"production"}]' \
  MOCK_STATUSES_JSON='[]'; then
  CODE=0
else
  CODE=$?
fi
assert_exit "missing status fails closed" 1 "$CODE"
assert_grep "missing status timeout classification emitted" 'deployment_status_timeout' "$OUT"
assert_grep "missing status result is structured" '^deployment_state=missing$' "$OUT.result"
echo ""

echo "=== check-host-deployment.test.sh: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
