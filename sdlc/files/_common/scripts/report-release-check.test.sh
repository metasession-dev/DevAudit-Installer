#!/usr/bin/env bash
# Focused regression tests for authoritative release-check reporting.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/report-release-check.sh"
PASS=0
FAIL=0

ok() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
no() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

make_fixture() {
  local dir="$1"
  mkdir -p "$dir/bin"
  cat > "$dir/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
URL=""
OUT=""
BODY=""
ARGS=("$@")
for ((i=0; i<${#ARGS[@]}; i++)); do
  case "${ARGS[$i]}" in
    -o) OUT="${ARGS[$((i+1))]}" ;;
    -d) BODY="${ARGS[$((i+1))]}" ;;
    http://*|https://*) URL="${ARGS[$i]}" ;;
  esac
done
printf 'URL:%s\nBODY:%s\n' "$URL" "$BODY" >> "${CHECK_TEST_LOG:?}"
if [[ "$URL" == *'/api/ci/releases/resolve'* ]]; then
  printf '%s' "${RESOLVE_BODY:-{}}"
  exit 0
fi
if [ -n "$OUT" ]; then printf '%s' "${CHECK_BODY:-{}}" > "$OUT"; fi
printf '%s' "${CHECK_STATUS:-200}"
EOF
  chmod +x "$dir/bin/curl"
}

run_helper() {
  PATH="$1/bin:$PATH" \
  CHECK_TEST_LOG="$1/curl.log" \
  DEVAUDIT_BASE_URL="https://devaudit.example.test" \
  DEVAUDIT_API_KEY="mc_test_dummy" \
  "$HELPER" "${@:2}"
}

base_args=(
  --project-slug fixture-app
  --release REQ-100
  --check-key quality-gates
  --label "Quality Gates"
  --status failed
  --external-run-id 123
  --commit-sha abc123
  --details-json '{"artifactUpload":"successful"}'
)

echo "=== report-release-check.sh tests ==="

dir=$(mktemp -d)
make_fixture "$dir"
RESOLVE_BODY='{"latest":{"id":"release-1","version":"REQ-100"}}' \
  CHECK_STATUS=201 run_helper "$dir" "${base_args[@]}"
if grep -q '/api/ci/releases/release-1/checks' "$dir/curl.log"; then ok "posts to exact release"; else no "missing check endpoint"; fi
if grep -q 'status.*failed' "$dir/curl.log" && grep -q 'artifactUpload.*successful' "$dir/curl.log"; then
  ok "keeps execution outcome separate from upload detail"
else
  no "incorrect check payload"
fi
rm -rf "$dir"

dir=$(mktemp -d)
make_fixture "$dir"
RESOLVE_BODY='{"latest":{"id":"release-1","version":"REQ-100"}}' \
  CHECK_STATUS=404 run_helper "$dir" "${base_args[@]}" >/dev/null 2>&1 && ok "tolerates older portal" || no "404 should be tolerant"
rm -rf "$dir"

dir=$(mktemp -d)
make_fixture "$dir"
if RESOLVE_BODY='{"latest":{"id":"release-1","version":"REQ-100"}}' \
  CHECK_STATUS=500 CHECK_BODY='{"error":"failed"}' run_helper "$dir" "${base_args[@]}" >/dev/null 2>&1; then
  no "500 should fail"
else
  ok "fails on portal error"
fi
rm -rf "$dir"

if "$HELPER" "${base_args[@]/failed/not-a-status}" >/dev/null 2>&1; then
  no "invalid status should fail"
else
  ok "rejects invalid status"
fi

echo "=== report-release-check.sh: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
