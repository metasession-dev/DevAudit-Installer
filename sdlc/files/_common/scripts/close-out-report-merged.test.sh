#!/usr/bin/env bash
# close-out-report-merged.test.sh — tests for close-out-report-merged.sh (DevAudit-Installer#1334), with a fake gh and
# a fake curl that records each portal call.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

PASS=0
FAIL=0
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

check() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $name"
    echo "    Expected: $expected"
    echo "    Actual:   $actual"
    FAIL=$((FAIL + 1))
  fi
}

SCRIPTS="$WORK/scripts"; mkdir -p "$SCRIPTS"
cp "$SCRIPT_DIR/close-out-report-merged.sh" "$SCRIPT_DIR/close-out-contract.sh" "$SCRIPTS/"
BIN="$WORK/bin"; mkdir -p "$BIN"
FX="$WORK/fx"; mkdir -p "$FX"
LOG="$WORK/curl.log"

# fake gh: `gh pr list ...` prints $FX/prs.json (fails when $FX/prs.fail exists).
cat > "$BIN/gh" <<'GH'
#!/usr/bin/env bash
[ "$1" = "pr" ] && [ "$2" = "list" ] || exit 2
[ ! -e "$FX/prs.fail" ] || exit 1
cat "$FX/prs.json"
GH
# fake curl: a resolve GET answers from $FX/release-<REQ>.json (or {}), a POST is recorded and succeeds unless
# $FX/post.fail exists.
cat > "$BIN/curl" <<'CURL'
#!/usr/bin/env bash
method=GET url="" data="" prefix=""
while [ $# -gt 0 ]; do
  case "$1" in
    -X) method="$2"; shift 2 ;;
    --data) data="$2"; shift 2 ;;
    --data-urlencode) case "$2" in versionPrefix=*) prefix="${2#versionPrefix=}" ;; esac; shift 2 ;;
    -H|-G) [ "$1" = "-H" ] && shift 2 || shift ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
if [ "$method" = "POST" ]; then
  [ ! -e "$FX/post.fail" ] || exit 22
  printf '%s %s %s\n' "$method" "$url" "$data" >> "$LOG"
  exit 0
fi
if [ -f "$FX/release-$prefix.json" ]; then cat "$FX/release-$prefix.json"; else echo '{}'; fi
CURL
chmod +x "$BIN/gh" "$BIN/curl"

NOW=1764151200 # 2025-11-26T10:00:00Z
iso() { date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ; }
RECENT="$(iso $((NOW - 3600)))"
OLD="$(iso $((NOW - 5 * 86400)))"

prs() { # writes prs.json from "number head merged_at" triples
  local out="[" first=1
  while [ $# -ge 3 ]; do
    [ "$first" = 1 ] || out="$out,"
    out="$out{\"number\":$1,\"headRefName\":\"$2\",\"url\":\"https://github.com/o/r/pull/$1\",\"mergeCommit\":{\"oid\":\"sha$1\"},\"mergedAt\":\"$3\"}"
    first=0; shift 3
  done
  echo "$out]" > "$FX/prs.json"
}
release() { echo "{\"latest\":{\"id\":\"rel-$1\",\"version\":\"$1\"}}" > "$FX/release-$1.json"; }

run() {
  : > "$LOG"
  (env -i PATH="$BIN:$PATH" FX="$FX" LOG="$LOG" REPOSITORY=o/r INTEGRATION_BRANCH=develop BASE_URL=https://portal.example.test \
    DEVAUDIT_API_KEY=k PROJECT_SLUG=example-app WORKFLOW_RUN_ID=42 WORKFLOW_URL=https://github.com/o/r/actions/runs/42 NOW="$NOW" "$@" \
    bash "$SCRIPTS/close-out-report-merged.sh" > "$WORK/out" 2>&1) && echo 0 || echo $?
}
posts() { grep -c '^POST' "$LOG" || true; }

echo "close-out-report-merged.sh"

rm -f "$FX"/*.json "$FX"/*.fail
prs 11 chore/close-out-REQ-101 "$RECENT" 12 feature/x "$RECENT" 13 chore/close-out-REQ-102 "$OLD" 14 chore/close-out-housekeeping "$RECENT"
release REQ-101; release REQ-102
check "exits 0" "0" "$(run)"
check "reports only the recent close-out pull request of a REQ" "1" "$(posts)"
check "posts to the release the portal resolved" "1" "$(grep -c '^POST https://portal.example.test/api/ci/releases/rel-REQ-101/close-out ' "$LOG")"
check "the payload says completed with the pull request and merge commit" "1" "$(grep -c '"status":"completed","workflowRunId":"42","workflowUrl":"https://github.com/o/r/actions/runs/42","pullRequestNumber":11,"pullRequestUrl":"https://github.com/o/r/pull/11","mergeSha":"sha11"' "$LOG")"

prs 13 chore/close-out-REQ-102 "$OLD"
check "an older merge is outside the window" "0" "$(run >/dev/null; posts)"
check "a wider window includes it" "1" "$(run SINCE_DAYS=7 >/dev/null; posts)"

prs 15 chore/close-out-REQ-103 "$RECENT"
check "a REQ the portal cannot resolve is skipped with a warning (exit 0)" "0" "$(run)"
check "no post for an unresolved REQ" "0" "$(posts)"
check "the warning names it" "1" "$(grep -c 'Unable to resolve REQ-103' "$WORK/out")"

echo '{"latest":{"id":"rel-x","version":"REQ-1030"}}' > "$FX/release-REQ-103.json"
check "a release whose version is not exactly the REQ is not used" "0" "$(run >/dev/null; posts)"

prs 11 chore/close-out-REQ-101 "$RECENT"
touch "$FX/post.fail"
check "a failed post is a warning, exit 0" "0" "$(run)"
check "the failed post is named" "1" "$(grep -c 'Failed to report close-out completion of REQ-101' "$WORK/out")"
rm -f "$FX/post.fail"

touch "$FX/prs.fail"
check "an unreadable pull request list is a warning, exit 0" "0" "$(run)"
check "and nothing is posted" "0" "$(posts)"
rm -f "$FX/prs.fail"

check "no base URL: nothing is reported, exit 0" "0" "$(run BASE_URL=)"
check "no base URL: no post" "0" "$(posts)"
check "no API key: exit 0" "0" "$(run DEVAUDIT_API_KEY=)"
check "no PROJECT_SLUG is a usage error" "2" "$(run PROJECT_SLUG=)"
check "a SINCE_DAYS that is not a number is a usage error" "2" "$(run SINCE_DAYS=soon)"

prs 16 chore/close-out-REQ-104 "$(iso $((NOW - 60)) | sed 's/Z$/.123Z/')"
release REQ-104
check "a merge time with fractional seconds is read" "1" "$(run >/dev/null; posts)"

echo '[]' > "$FX/prs.json"
check "no merged pull requests: exit 0" "0" "$(run)"
check "and says so" "1" "$(grep -c 'No close-out pull request merged' "$WORK/out")"

echo
echo "Passed: $PASS  Failed: $FAIL"
[ "$FAIL" -eq 0 ]
