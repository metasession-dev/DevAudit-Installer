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

assert_not_contains() {
  local desc="$1" needle="$2" file="$3"
  if grep -Fq "$needle" "$file"; then
    echo "  FAIL: $desc"
    echo "    unexpectedly present: $needle"
    echo "    file:"
    sed 's/^/    /' "$file"
    FAIL=$((FAIL + 1))
  else
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
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

# devaudit#775 — CI checkouts never have the gitignored local sentinel
# file. Verify the git-trailer fallback picks up sdlc-implementer
# provenance from the commit message instead, and that it stays silent
# (no false sentinelContent) when neither the file nor the trailer exists.

make_fixture_trailer_only() {
  local dir="$1"
  rm -rf "$dir"
  mkdir -p "$dir/bin"
  cd "$dir"
  git init -q --initial-branch=main
  git config user.email "test@example.com"
  git config user.name "test"
  echo "evidence" > evidence.txt
  git add evidence.txt
  git commit -q -F - <<'EOF'
fix: ci-uploaded evidence fixture

Ref: REQ-091
Sdlc-Implementer-Sentinel: [{"currentPhase":"2","initializedBy":"skill","status":"active"}]
EOF

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

D2="$WORK/case2-trailer-only"
make_fixture_trailer_only "$D2"
LOG_FILE="$D2/upload.log"
touch "$LOG_FILE"
export PATH="$D2/bin:$PATH"
export UPLOAD_TEST_LOG="$LOG_FILE"

bash "$HELPER" fixture-project REQ-091 test_report evidence.txt \
  --release v2026.07.13 \
  --environment uat \
  --category test_report \
  --change-type fix > "$D2/stdout.log" 2>&1

assert_contains "CI checkout (no local sentinel file) forwards sentinelContent from the git trailer" \
  'FORM:sentinelContent=[{"currentPhase":"2","initializedBy":"skill","status":"active"}]' \
  "$LOG_FILE"

D3="$WORK/case3-no-sentinel"
rm -rf "$D3"
mkdir -p "$D3/bin"
cd "$D3"
git init -q --initial-branch=main
git config user.email "test@example.com"
git config user.name "test"
echo "evidence" > evidence.txt
git add evidence.txt
git commit -q -m "fix: genuinely untracked evidence fixture"
cp "$D2/bin/curl" "$D3/bin/curl"
LOG_FILE="$D3/upload.log"
touch "$LOG_FILE"
export PATH="$D3/bin:$PATH"
export UPLOAD_TEST_LOG="$LOG_FILE"

bash "$HELPER" fixture-project REQ-091 test_report evidence.txt \
  --release v2026.07.13 \
  --environment uat \
  --category test_report \
  --change-type fix > "$D3/stdout.log" 2>&1

assert_not_contains "no local file and no trailer: sentinelContent stays unset (genuine bypass)" \
  'FORM:sentinelContent=' \
  "$LOG_FILE"

# DevAudit-Installer#1018 — a multipart POST under the presigned threshold
# that the portal/proxy rejects with HTTP 400 ("Failed to parse body as
# FormData") must fall back to the presigned flow, and a total failure must
# leave attributable diagnostics (size, path, response headers).
make_fixture_multipart_400() {
  local dir="$1" presign_mode="$2"
  rm -rf "$dir"
  mkdir -p "$dir/bin"
  cd "$dir"
  git init -q --initial-branch=main
  git config user.email "test@example.com"
  git config user.name "test"
  head -c 2048 /dev/zero | tr '\0' 'a' > report.zip
  git add report.zip
  git commit -q -m "fix: multipart 400 fixture"
  cat > bin/curl <<EOF
#!/usr/bin/env bash
set -euo pipefail
LOG_FILE="\${UPLOAD_TEST_LOG:?}"
URL=""; OUT_FILE=""; HDR_FILE=""; WRITE_OUT=""
ARGS=("\$@")
for ((i=0; i<\${#ARGS[@]}; i++)); do
  arg="\${ARGS[\$i]}"
  case "\$arg" in
    -o) OUT_FILE="\${ARGS[\$((i+1))]}" ;;
    -D) HDR_FILE="\${ARGS[\$((i+1))]}" ;;
    -w) WRITE_OUT="\${ARGS[\$((i+1))]}" ;;
    http://*|https://*) URL="\$arg" ;;
  esac
done
echo "URL:\${URL}" >> "\$LOG_FILE"
CODE=200
BODY='{"ok":true}'
case "\$URL" in
  */api/evidence/upload)
    CODE=400; BODY='{"error":"Failed to parse body as FormData."}'
    [ -n "\$HDR_FILE" ] && printf 'HTTP/2 400\r\nserver: test-proxy\r\ncontent-type: application/json\r\n' > "\$HDR_FILE"
    ;;
  */api/evidence/upload-url)
    if [ "$presign_mode" = "ok" ]; then
      BODY='{"uploadUrl":"https://r2.example.test/put","evidenceId":"ev-1"}'
    else
      CODE=501; BODY='{"error":"Presigned uploads require R2 storage configuration"}'
    fi
    ;;
esac
[ -n "\$OUT_FILE" ] && printf '%s' "\$BODY" > "\$OUT_FILE"
[ -n "\$HDR_FILE" ] && [ ! -s "\$HDR_FILE" ] && : > "\$HDR_FILE"
[ -n "\$WRITE_OUT" ] && printf '%s' "\$CODE"
exit 0
EOF
  chmod +x bin/curl
}

D4="$WORK/case4-multipart-400-fallback"
make_fixture_multipart_400 "$D4" ok
LOG_FILE="$D4/upload.log"
touch "$LOG_FILE"
export PATH="$D4/bin:$PATH"
export UPLOAD_TEST_LOG="$LOG_FILE"
RC=0
bash "$HELPER" fixture-project REQ-091 e2e_report report.zip \
  --release v2026.07.13 --category e2e_report > "$D4/stdout.log" 2>&1 || RC=$?
assert_contains "multipart HTTP 400 triggers the presigned fallback" \
  'URL:https://devaudit.example.test/api/evidence/upload-url' "$LOG_FILE"
assert_contains "presigned fallback completes the upload" \
  'URL:https://devaudit.example.test/api/evidence/upload-complete' "$LOG_FILE"
assert_contains "fallback success is reported as OK" \
  'OK (2048 bytes, presigned R2 upload after multipart HTTP 400)' "$D4/stdout.log"
if [ "$RC" -eq 0 ]; then
  echo "  PASS: fallback upload exits 0"; PASS=$((PASS + 1))
else
  echo "  FAIL: fallback upload exits 0 (got $RC)"; FAIL=$((FAIL + 1))
fi

D5="$WORK/case5-multipart-400-no-presign"
make_fixture_multipart_400 "$D5" unsupported
LOG_FILE="$D5/upload.log"
touch "$LOG_FILE"
export PATH="$D5/bin:$PATH"
export UPLOAD_TEST_LOG="$LOG_FILE"
RC=0
bash "$HELPER" fixture-project REQ-091 e2e_report report.zip \
  --release v2026.07.13 --category e2e_report > "$D5/stdout.log" 2>&1 || RC=$?
assert_contains "total failure logs the portal response body" \
  'Failed to parse body as FormData.' "$D5/stdout.log"
assert_contains "total failure logs size, path and evidence type" \
  'Diagnostics: file=report.zip size=2048B path=multipart evidenceType=e2e_report' "$D5/stdout.log"
assert_contains "total failure logs response headers" \
  'server: test-proxy' "$D5/stdout.log"
if [ "$RC" -ne 0 ]; then
  echo "  PASS: total failure exits non-zero"; PASS=$((PASS + 1))
else
  echo "  FAIL: total failure exits non-zero"; FAIL=$((FAIL + 1))
fi

# --- devaudit-installer#1019: a PR that changes no code must not bind SHA/branch ---
make_pr_fixture() { # <dir> <doc|code>
  local dir="$1" kind="$2"
  rm -rf "$dir"; mkdir -p "$dir/bin"; cd "$dir"
  git init -q --initial-branch=develop
  git config user.email "test@example.com"; git config user.name "test"; git config commit.gpgsign false
  mkdir -p src compliance/evidence/REQ-109
  echo a > src/app.ts; echo base > README.md
  git add -A; git commit -q -m "chore: init"
  git update-ref refs/remotes/origin/develop HEAD
  git checkout -q -b topic
  if [ "$kind" = doc ]; then echo triage > compliance/evidence/REQ-109/triage.md; else echo b >> src/app.ts; fi
  git add -A; git commit -q -m "compliance: [REQ-109] triage

Ref: REQ-109"
  cp "$D1/bin/curl" "$dir/bin/curl"
  echo "evidence" > evidence.txt
}

run_pr_upload() { # <dir> [extra args...]
  local dir="$1"; shift
  cd "$dir"
  : > "$dir/upload.log"
  UPLOAD_TEST_LOG="$dir/upload.log" PATH="$dir/bin:$PATH" GITHUB_EVENT_NAME=pull_request GITHUB_BASE_REF=develop \
    bash "$HELPER" fixture-project REQ-109 test_report evidence.txt --release REQ-109 --create-release-if-missing \
    --git-sha deadbeef --branch topic --category test_report "$@" > "$dir/stdout.log" 2>&1
}

D6="$WORK/case6-doc-pr"
make_pr_fixture "$D6" doc
run_pr_upload "$D6"
assert_not_contains "doc-only PR: the release is not created from the PR" 'FORM:createReleaseIfMissing' "$D6/upload.log"
assert_not_contains "doc-only PR: the PR branch is not bound to the release" 'FORM:releaseBranch=topic' "$D6/upload.log"
assert_contains "doc-only PR: the document itself is still uploaded" 'URL:https://devaudit.example.test/api/evidence/upload' "$D6/upload.log"
assert_contains "doc-only PR: the skip is visible as a warning" "changes no code (doc-only)" "$D6/stdout.log"

D7="$WORK/case7-code-pr"
make_pr_fixture "$D7" code
run_pr_upload "$D7"
assert_contains "code PR: attaches as before (creates the release)" 'FORM:createReleaseIfMissing=true' "$D7/upload.log"
assert_contains "code PR: attaches as before (binds the branch)" 'FORM:releaseBranch=topic' "$D7/upload.log"

D8="$WORK/case8-doc-pr-override"
make_pr_fixture "$D8" doc
run_pr_upload "$D8" --no-attribution-guard
assert_contains "--no-attribution-guard restores the old attribution" 'FORM:releaseBranch=topic' "$D8/upload.log"

D9="$WORK/case9-push"
make_pr_fixture "$D9" doc
cd "$D9"; : > "$D9/upload.log"
UPLOAD_TEST_LOG="$D9/upload.log" PATH="$D9/bin:$PATH" GITHUB_EVENT_NAME=push \
  bash "$HELPER" fixture-project REQ-109 test_report evidence.txt --release REQ-109 --create-release-if-missing \
  --git-sha deadbeef --branch topic --category test_report > "$D9/stdout.log" 2>&1
assert_contains "non-PR events are never guarded" 'FORM:releaseBranch=topic' "$D9/upload.log"

echo ""
echo "=== upload-evidence.test.sh: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
