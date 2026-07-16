#!/usr/bin/env bash
# submit-bundle-manifest.test.sh — Focused tests for bundle manifest submission.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/submit-bundle-manifest.sh"
[ -x "$HELPER" ] || chmod +x "$HELPER"

PASS=0
FAIL=0
WORK="$(mktemp -d)"
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
  cat > bin/curl <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
LOG_FILE="${SUBMIT_TEST_LOG:?}"
URL=""
BODY_FILE=""
WRITE_OUT=""
METHOD="GET"
BODY=""
ARGS=("$@")
for ((i=0; i<${#ARGS[@]}; i++)); do
  arg="${ARGS[$i]}"
  case "$arg" in
    -X) METHOD="${ARGS[$((i+1))]}" ;;
    -o) BODY_FILE="${ARGS[$((i+1))]}" ;;
    -w) WRITE_OUT="${ARGS[$((i+1))]}" ;;
    --data) BODY="${ARGS[$((i+1))]}" ;;
    http://*|https://*) URL="$arg" ;;
  esac
done
echo "METHOD:${METHOD}" >> "$LOG_FILE"
echo "URL:${URL}" >> "$LOG_FILE"
if [ -n "$BODY" ]; then
  echo "BODY:${BODY}" >> "$LOG_FILE"
fi
if [[ "$URL" == *"/api/ci/releases/resolve"* ]]; then
  printf '{"latest":{"id":"rel_123","version":"REQ-042","status":"draft"}}'
  exit 0
fi
if [[ "$URL" == *"/api/ci/releases/rel_123/bundle-manifest" ]]; then
  if [ -n "$BODY_FILE" ]; then
    printf '{"ok":true}' > "$BODY_FILE"
  fi
  if [ -n "$WRITE_OUT" ]; then
    printf '201'
  fi
  exit 0
fi
printf '{"error":"unexpected url"}'
exit 1
EOF
  chmod +x bin/curl
}

echo "=== submit-bundle-manifest.sh tests ==="

D1="$WORK/case1"
make_fixture "$D1"
cat > "$D1/manifest.json" <<'EOF'
{
  "schemaVersion": 1,
  "approvalRelease": { "version": "REQ-042" },
  "coreRelease": { "version": "REQ-042" },
  "members": [
    {
      "version": "REQ-041",
      "role": "predecessor",
      "relationship": "superseded"
    }
  ],
  "nonReleaseWorkItems": [
    {
      "kind": "housekeeping_commit",
      "title": "docs: refresh release notes"
    }
  ],
  "manifestHash": "sha256:test"
}
EOF
LOG_FILE="$D1/submit.log"
touch "$LOG_FILE"
export PATH="$D1/bin:$PATH"
export SUBMIT_TEST_LOG="$LOG_FILE"
export DEVAUDIT_BASE_URL="https://devaudit.example.test"
export DEVAUDIT_API_KEY="mc_test_dummy"

bash "$HELPER" fixture-project REQ-042 "$D1/manifest.json" > "$D1/stdout.log" 2>&1
assert_contains "resolve endpoint called" "/api/ci/releases/resolve?projectSlug=fixture-project&versionPrefix=REQ-042" "$LOG_FILE"
assert_contains "bundle endpoint called" "/api/ci/releases/rel_123/bundle-manifest" "$LOG_FILE"
assert_contains "member payload submitted" "\"version\": \"REQ-041\"" "$LOG_FILE"

D2="$WORK/case2"
make_fixture "$D2"
cat > "$D2/manifest.json" <<'EOF'
{
  "schemaVersion": 1,
  "approvalRelease": { "version": "REQ-042" },
  "coreRelease": { "version": "REQ-042" },
  "members": [],
  "nonReleaseWorkItems": []
}
EOF
LOG_FILE="$D2/submit.log"
touch "$LOG_FILE"
export PATH="$D2/bin:$PATH"
export SUBMIT_TEST_LOG="$LOG_FILE"

bash "$HELPER" fixture-project REQ-042 "$D2/manifest.json" > "$D2/stdout.log" 2>&1
assert_contains "empty manifest skips submission" "Bundle manifest has no members or non-release work items; skipping submission." "$D2/stdout.log"

echo ""
echo "=== submit-bundle-manifest.test.sh: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
