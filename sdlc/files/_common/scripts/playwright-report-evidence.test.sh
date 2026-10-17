#!/usr/bin/env bash
# playwright-report-evidence.test.sh — tests for playwright-report-evidence.sh
# (DevAudit-Installer#1018).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/playwright-report-evidence.sh"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
PASS=0
FAIL=0

check() {
  local desc="$1" cond="$2"
  if eval "$cond"; then echo "  PASS: $desc"; PASS=$((PASS + 1)); else echo "  FAIL: $desc"; FAIL=$((FAIL + 1)); fi
}

echo "=== playwright-report-evidence.sh tests ==="

# zip: builds the archive and logs its size
mkdir -p "$WORK/a/playwright-report"
echo "<html></html>" > "$WORK/a/playwright-report/index.html"
out=$(bash "$HELPER" zip "$WORK/a" REQ-1 2>&1); rc=$?
check "zip succeeds" "[ $rc -eq 0 ]"
check "zip produces the archive" "[ -s '$WORK/a/playwright-report.zip' ]"
check "zip logs the archive size" "echo \"\$out\" | grep -q 'playwright-report.zip size: '"

# zip: a stale archive is removed when there is no report directory
mkdir -p "$WORK/b"
echo stale > "$WORK/b/playwright-report.zip"
bash "$HELPER" zip "$WORK/b" REQ-1 >/dev/null 2>&1
check "missing report dir removes a stale archive" "[ ! -e '$WORK/b/playwright-report.zip' ]"

# zip: a zip failure is reported and leaves no archive (fake zip on PATH)
mkdir -p "$WORK/c/playwright-report" "$WORK/bin"
printf '#!/usr/bin/env bash\nexit 12\n' > "$WORK/bin/zip"
chmod +x "$WORK/bin/zip"
out=$(PATH="$WORK/bin:$PATH" bash "$HELPER" zip "$WORK/c" REQ-2 2>&1); rc=$?
check "zip failure is surfaced as a warning" "echo \"\$out\" | grep -q '::warning::playwright-report.zip creation failed for REQ-2'"
check "zip failure leaves no archive" "[ ! -e '$WORK/c/playwright-report.zip' ]"
check "zip failure does not abort the upload job" "[ $rc -eq 0 ]"

# missing: non-passing run writes a summary note; passing run is a no-op
SUM="$WORK/summary.md"; : > "$SUM"
GITHUB_STEP_SUMMARY="$SUM" bash "$HELPER" missing REQ-3 failure
check "non-passing run adds a job-summary note" "grep -q 'Playwright report unavailable for REQ-3' '$SUM'"
: > "$SUM"
GITHUB_STEP_SUMMARY="$SUM" bash "$HELPER" missing REQ-3 success
check "passing run stays silent" "[ ! -s '$SUM' ]"

echo ""
echo "=== playwright-report-evidence.test.sh: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
