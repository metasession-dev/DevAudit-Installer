#!/usr/bin/env bash
# upload-evidence.test.sh — Focused regression tests for sentinel propagation.
#
# Verifies tracked uploads automatically forward `.sdlc-implementer-invoked`
# content and a commit timestamp to the portal-facing upload contract.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/upload-evidence.sh"
[ -x "$HELPER" ] || chmod +x "$HELPER"

PASS=0
FAIL=0

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

assert_contains() {
  local desc="$1" needle="$2" file="$3"
  if grep -Fq "$needle" "$file"; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    echo "    missing: $needle"
    echo "    file:"
    sed 's/^/    /' "$file"
    FAIL=$((FAIL + 1))
  fi
}

make_fixture() {
  local dir="$1"
  rm -rf "$dir"
  mkdir -p "$dir/bin"
  cd "$dir"
  git init -q --initial-branch=main
  git config user.email "test@example.com"
  git config user.name "test"
  echo "evidence" > evidence.txt
  printf '%s\n' '[{"currentPhase":"3","initializedBy":"skill","status":"active"}]' > .sdlc-implementer-invoked
  git add evidence.txt .sdlc-implementer-invoked
  git commit -q -m "feat: tracked upload fixture"

  cat > bin/curl <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
LOG_FILE="${UPLOAD_TEST_LOG:?}"
URL=""
OUT_FILE=""
HDR_FILE=""
WRITE_OUT=""
ARGS=("$@")
for ((i=0; i<${#ARGS[@]}; i++)); do
  arg="${ARGS[$i]}"
  case "$arg" in
    -o) OUT_FILE="${ARGS[$((i+1))]}" ;;
    -D) HDR_FILE="${ARGS[$((i+1))]}" ;;
    -w) WRITE_OUT="${ARGS[$((i+1))]}" ;;
    http://*|https://*) URL="$arg" ;;
    -F)
      echo "FORM:${ARGS[$((i+1))]}" >> "$LOG_FILE"
      ;;
  esac
done
echo "URL:${URL}" >> "$LOG_FILE"
if [[ "$URL" == *"/api/health" ]]; then
  printf '200 '
  exit 0
fi
if [ -n "$OUT_FILE" ]; then
  printf '{"ok":true}' > "$OUT_FILE"
fi
if [ -n "$HDR_FILE" ]; then
  : > "$HDR_FILE"
fi
if [ -n "$WRITE_OUT" ]; then
  printf '201'
fi
EOF
  chmod +x bin/curl
}

echo "=== upload-evidence.sh tests ==="

D1="$WORK/case1"
make_fixture "$D1"
LOG_FILE="$D1/upload.log"
touch "$LOG_FILE"
export PATH="$D1/bin:$PATH"
export UPLOAD_TEST_LOG="$LOG_FILE"
export DEVAUDIT_BASE_URL="https://devaudit.example.test"
export DEVAUDIT_API_KEY="mc_test_dummy"

bash "$HELPER" fixture-project REQ-091 test_report evidence.txt \
  --release v2026.07.13 \
  --environment uat \
  --category test_report \
  --change-type feat > "$D1/stdout.log" 2>&1

assert_contains "tracked upload forwards sentinelContent" \
  'FORM:sentinelContent=[{"currentPhase":"3","initializedBy":"skill","status":"active"}]' \
  "$LOG_FILE"
assert_contains "tracked upload forwards commitTimestamp field" \
  'FORM:commitTimestamp=' \
  "$LOG_FILE"
assert_contains "tracked upload forwards changeType" \
  'FORM:changeType=feat' \
  "$LOG_FILE"
assert_contains "tracked upload stamps commitTimestamp into metadata" \
  'FORM:metadata={"commitTimestamp":"' \
  "$LOG_FILE"

echo ""
echo "=== upload-evidence.test.sh: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
