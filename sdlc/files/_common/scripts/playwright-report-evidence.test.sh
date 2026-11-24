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

# zip: traces and videos are left out by default, kept when e2e_report_include_traces is true
# (DevAudit-Installer#1275). SDLC_CONFIG pins which config is read.
mkdir -p "$WORK/d/playwright-report/trace" "$WORK/d/playwright-report/data"
echo "<html></html>" > "$WORK/d/playwright-report/index.html"
echo viewer > "$WORK/d/playwright-report/trace/index.html"
echo trace > "$WORK/d/playwright-report/data/abc123.zip"
echo video > "$WORK/d/playwright-report/data/def456.webm"
echo shot > "$WORK/d/playwright-report/data/shot.png"
SDLC_CONFIG="$WORK/none.json" bash "$HELPER" zip "$WORK/d" REQ-4 >/dev/null 2>&1
listing=$(unzip -Z1 "$WORK/d/playwright-report.zip")
check "default zip keeps the HTML report" "echo \"\$listing\" | grep -q 'playwright-report/index.html'"
check "default zip keeps screenshots" "echo \"\$listing\" | grep -q 'playwright-report/data/shot.png'"
check "default zip leaves out the trace viewer" "! echo \"\$listing\" | grep -q 'playwright-report/trace/'"
check "default zip leaves out trace zips" "! echo \"\$listing\" | grep -q 'data/abc123.zip'"
check "default zip leaves out videos" "! echo \"\$listing\" | grep -q 'def456.webm'"
echo '{"e2e_report_include_traces": false}' > "$WORK/off.json"
SDLC_CONFIG="$WORK/off.json" bash "$HELPER" zip "$WORK/d" REQ-4 >/dev/null 2>&1
check "include_traces false behaves as the default" "! unzip -Z1 '$WORK/d/playwright-report.zip' | grep -q 'def456.webm'"
echo '{"e2e_report_include_traces": true}' > "$WORK/on.json"
out=$(SDLC_CONFIG="$WORK/on.json" bash "$HELPER" zip "$WORK/d" REQ-4 2>&1)
listing=$(unzip -Z1 "$WORK/d/playwright-report.zip")
check "include_traces true keeps the trace viewer" "echo \"\$listing\" | grep -q 'playwright-report/trace/'"
check "include_traces true keeps trace zips and videos" "echo \"\$listing\" | grep -q 'data/abc123.zip' && echo \"\$listing\" | grep -q 'def456.webm'"
check "include_traces true says so in the log" "echo \"\$out\" | grep -q 'e2e_report_include_traces is true'"

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
