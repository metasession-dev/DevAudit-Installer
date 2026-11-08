#!/usr/bin/env bash
# resolve-e2e-upload-targets.test.sh — tests for resolve-e2e-upload-targets.sh and
# e2e-json-tags-req.sh (devaudit-installer#1213).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/resolve-e2e-upload-targets.sh"
TAGS="$SCRIPT_DIR/e2e-json-tags-req.sh"

PASS=0
FAIL=0
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    echo "    expected: $expected"
    echo "    actual:   $actual"
    FAIL=$((FAIL + 1))
  fi
}

make_manifest() {
  # make_manifest <dir> <core> <member...>
  local dir="$1" core="$2"
  shift 2
  mkdir -p "$dir/compliance/pending-releases"
  local members_json="[]" m
  for m in "$@"; do
    members_json="$(jq -c --arg v "$m" '. + [{version: $v, role: "co_tracked", relationship: "bundled"}]' <<<"$members_json")"
  done
  jq -n --argjson members "$members_json" --arg core "$core" \
    '{schemaVersion: 2, coreRelease: {version: $core}, members: $members}' \
    > "$dir/compliance/pending-releases/BUNDLED-CHANGES-${core}.json"
}

# A Playwright report with one executed test tagged REQ-201 and one skipped test tagged REQ-202.
REPORT="$WORK/results.json"
cat > "$REPORT" <<'EOF'
{"suites":[{"title":"checkout","specs":[
  {"title":"[REQ-201][AC1] pays","tests":[{"results":[{"status":"passed"}]}]},
  {"title":"[REQ-202][AC1] refunds","tests":[{"results":[{"status":"skipped"}]}]}
]}]}
EOF

targets() {
  # targets <dir> <args...> — stdout on one line, `;`-separated
  local dir="$1"
  shift
  (cd "$dir" && bash "$HELPER" "$@" 2>/dev/null | paste -sd';' -)
}

echo "=== resolve-e2e-upload-targets.sh tests ==="

D1="$WORK/two-independent"
mkdir -p "$D1"
assert_eq "two independent pending tickets: only the derived release's REQ is filed, under itself" \
  "REQ-119 REQ-119 yes" "$(targets "$D1" REQ-119 "$REPORT" REQ-118 REQ-119)"

DROPPED="$(cd "$D1" && bash "$HELPER" REQ-119 "$REPORT" REQ-118 REQ-119 2>&1 >/dev/null)"
assert_eq "the other pending REQ is reported as dropped" "Dropped REQ-118 (not in scope of REQ-119)" "$DROPPED"

D2="$WORK/bundle"
make_manifest "$D2" REQ-200 REQ-201 REQ-202
assert_eq "bundle: core always gets the JSON, a tagged member gets it, an untagged (skipped-only) member does not" \
  "REQ-200 REQ-200 yes;REQ-201 REQ-200 yes;REQ-202 REQ-200 no" \
  "$(targets "$D2" REQ-200 "$REPORT" REQ-200 REQ-201 REQ-202)"
assert_eq "bundle with no JSON: members get no JSON, the core still does" \
  "REQ-200 REQ-200 yes;REQ-201 REQ-200 no" "$(targets "$D2" REQ-200 "" REQ-201)"

D3="$WORK/other"
mkdir -p "$D3"
assert_eq "a bare-date release with several REQs files none of them (#1214)" \
  "" "$(targets "$D3" v2026.11.08 "$REPORT" REQ-007 REQ-008)"
DROPPED_BD="$(cd "$D3" && bash "$HELPER" v2026.11.08 "$REPORT" REQ-007 REQ-008 2>&1 >/dev/null)"
assert_eq "the bare-date drop is logged" "Dropped REQ-007 REQ-008 (bare-date release v2026.11.08 holds no per-REQ evidence)" "$DROPPED_BD"
assert_eq "a bare-date release with one REQ keeps it" \
  "REQ-007 v2026.11.08 yes" "$(targets "$D3" v2026.11.08 "$REPORT" REQ-007)"
assert_eq "_compliance-docs is filed under the derived release with the JSON" \
  "_compliance-docs v2026.11.08 yes" "$(targets "$D3" v2026.11.08 "$REPORT" _compliance-docs)"
assert_eq "another non-REQ release keeps its REQs" \
  "REQ-007 hotfix-1 yes;REQ-008 hotfix-1 yes" "$(targets "$D3" hotfix-1 "$REPORT" REQ-007 REQ-008)"

if (cd "$D3" && bash "$HELPER" REQ-119 >/dev/null 2>&1); then
  assert_eq "missing JSON argument is a usage error" "1" "0"
else
  assert_eq "missing JSON argument is a usage error" "1" "1"
fi

echo "=== e2e-json-tags-req.sh tests ==="
tagged() { if bash "$TAGS" "$1" "$2" 2>/dev/null; then echo yes; else echo no; fi; }
assert_eq "an executed tagged test counts" "yes" "$(tagged REQ-201 "$REPORT")"
assert_eq "a skipped-only tagged test does not count" "no" "$(tagged REQ-202 "$REPORT")"
assert_eq "an untagged REQ does not count" "no" "$(tagged REQ-300 "$REPORT")"
assert_eq "a missing file does not count" "no" "$(tagged REQ-201 "$WORK/absent.json")"
printf 'not json' > "$WORK/bad.json"
assert_eq "an unreadable file does not count" "no" "$(tagged REQ-201 "$WORK/bad.json")"

echo ""
echo "Passed: $PASS  Failed: $FAIL"
[ "$FAIL" -eq 0 ]
