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

# DevAudit-Installer#1082 — sentinel trailer discovery: a window wider than 50
# commits, preference for the upload's own requirement, and a visible diagnostic.
# make_trailer_history <dir> <trailer-value> <filler-commits-after-it>: the first
# commit carries the REQ-091 trailer, `filler` commits without one follow it.
make_trailer_history() {
  local dir="$1" value="$2" filler="$3" i
  rm -rf "$dir"
  mkdir -p "$dir/bin"
  cd "$dir"
  git init -q --initial-branch=main
  git config user.email "test@example.com"
  git config user.name "test"
  echo "evidence" > evidence.txt
  git add evidence.txt
  git commit -q -F - <<EOF
fix: the sdlc-implementer commit

Ref: REQ-091
Sdlc-Implementer-Sentinel: ${value}
EOF
  for ((i = 0; i < filler; i++)); do
    git commit -q --allow-empty -m "chore: filler ${i}"
  done
  cp "$D2/bin/curl" "$dir/bin/curl"
}

run_sentinel_upload() {
  local dir="$1" req="$2"
  cd "$dir"
  : > "$dir/upload.log"
  UPLOAD_TEST_LOG="$dir/upload.log" PATH="$dir/bin:$PATH" \
    bash "$HELPER" fixture-project "$req" test_report evidence.txt \
    --release v2026.07.13 --environment uat --category test_report --change-type fix \
    > "$dir/stdout.log" 2>&1
}

D10="$WORK/case10-deep-history"
make_trailer_history "$D10" '[{"currentPhase":"2","initializedBy":"skill","status":"active"}]' 120
run_sentinel_upload "$D10" REQ-091
assert_contains "a trailer 120 commits back is still found (was lost beyond 50)" \
  'FORM:sentinelContent=[{"currentPhase":"2","initializedBy":"skill","status":"active"}]' "$D10/upload.log"
assert_contains "the diagnostic names the commit the trailer came from" 'sentinel: trailer from commit ' "$D10/stdout.log"

D11="$WORK/case11-scan-limit"
make_trailer_history "$D11" '[{"currentPhase":"2","initializedBy":"skill","status":"active"}]' 30
cd "$D11"; : > "$D11/upload.log"
UPLOAD_TEST_LOG="$D11/upload.log" PATH="$D11/bin:$PATH" SENTINEL_SCAN_LIMIT=10 \
  bash "$HELPER" fixture-project REQ-091 test_report evidence.txt \
  --release v2026.07.13 --environment uat --category test_report --change-type fix > "$D11/stdout.log" 2>&1
assert_not_contains "SENTINEL_SCAN_LIMIT narrows the scan" 'FORM:sentinelContent=' "$D11/upload.log"
assert_contains "no trailer: the diagnostic says so, with the scan size" 'sentinel: none found (change type fix, scanned up to 10 commits' "$D11/stdout.log"

D12="$WORK/case12-prefers-own-req"
make_trailer_history "$D12" '[{"currentPhase":"2","initializedBy":"skill","status":"active","who":"own"}]' 0
cd "$D12"
git commit -q --allow-empty -F - <<'EOF'
fix: another requirement, newer

Ref: REQ-222
Sdlc-Implementer-Sentinel: [{"currentPhase":"3","initializedBy":"skill","status":"active","who":"other"}]
EOF
run_sentinel_upload "$D12" REQ-091
assert_contains "the trailer on the upload's own requirement wins over a newer one" '"who":"own"' "$D12/upload.log"
assert_not_contains "the other requirement's trailer is not used" '"who":"other"' "$D12/upload.log"

D13="$WORK/case13-falls-back-to-newest"
make_trailer_history "$D13" '[{"currentPhase":"2","initializedBy":"skill","status":"active","who":"only"}]' 3
run_sentinel_upload "$D13" REQ-777
assert_contains "no trailer mentions this requirement: the newest trailer is used" '"who":"only"' "$D13/upload.log"

D14="$WORK/case14-malformed"
make_trailer_history "$D14" 'not-json' 0
run_sentinel_upload "$D14" REQ-091
assert_contains "a malformed sentinel is still forwarded" 'FORM:sentinelContent=not-json' "$D14/upload.log"
if command -v jq >/dev/null 2>&1; then
  assert_contains "a malformed sentinel is flagged" '::warning::sentinel from trailer from commit' "$D14/stdout.log"
fi

D15="$WORK/case15-legacy-invoked"
make_trailer_history "$D15" 'INVOKED' 0
run_sentinel_upload "$D15" REQ-091
assert_not_contains "the legacy plain INVOKED marker is not flagged" '::warning::sentinel' "$D15/stdout.log"

echo ""
echo "=== upload-evidence.test.sh: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
