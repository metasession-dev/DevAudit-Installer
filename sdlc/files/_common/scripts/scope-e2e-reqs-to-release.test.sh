#!/usr/bin/env bash
# scope-e2e-reqs-to-release.test.sh — tests for scope-e2e-reqs-to-release.sh (devaudit-installer#1201).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/scope-e2e-reqs-to-release.sh"
[ -x "$HELPER" ] || chmod +x "$HELPER"

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
  # make_manifest <dir> <subdir> <core> <member...>
  local dir="$1" sub="$2" core="$3"
  shift 3
  mkdir -p "$dir/compliance/$sub"
  local members_json="[]" m
  for m in "$@"; do
    members_json="$(jq -c --arg v "$m" '. + [{version: $v, role: "co_tracked", relationship: "bundled"}]' <<<"$members_json")"
  done
  jq -n --argjson members "$members_json" --arg core "$core" \
    '{schemaVersion: 2, coreRelease: {version: $core}, members: $members}' \
    > "$dir/compliance/$sub/BUNDLED-CHANGES-${core}.json"
}

scope() {
  # scope <dir> <release> [REQ...] — run in the fixture, print stdout on one line
  local dir="$1"
  shift
  (cd "$dir" && bash "$HELPER" "$@" 2>/dev/null | paste -sd' ' -)
}

echo "=== scope-e2e-reqs-to-release.sh tests ==="

D1="$WORK/single"
mkdir -p "$D1"
assert_eq "single REQ drops every other REQ in the JSON" \
  "REQ-119" "$(scope "$D1" REQ-119 REQ-007 REQ-066 REQ-119)"
assert_eq "single REQ is kept even when the JSON never names it" \
  "REQ-119" "$(scope "$D1" REQ-119 REQ-007)"
assert_eq "single REQ with no input still names the release" \
  "REQ-119" "$(scope "$D1" REQ-119)"

DROPPED="$(cd "$D1" && bash "$HELPER" REQ-119 REQ-007 2>&1 >/dev/null)"
assert_eq "dropped REQs are logged to stderr" \
  "Dropped REQ-007 (not in scope of REQ-119)" "$DROPPED"

D2="$WORK/bundle-pending"
make_manifest "$D2" pending-releases REQ-200 REQ-201 REQ-202
assert_eq "bundle core keeps itself and its co_tracked members" \
  "REQ-200 REQ-201" "$(scope "$D2" REQ-200 REQ-201 REQ-007)"
assert_eq "bundle core output is de-duplicated" \
  "REQ-200 REQ-201" "$(scope "$D2" REQ-200 REQ-201 REQ-201 REQ-200)"

D3="$WORK/bundle-approved"
make_manifest "$D3" approved-releases REQ-200 REQ-201
assert_eq "manifest already moved to approved-releases/ is still read" \
  "REQ-200 REQ-201" "$(scope "$D3" REQ-200 REQ-201 REQ-007)"

D4="$WORK/bundle-superseded"
make_manifest "$D4" superseded-releases REQ-200 REQ-201
assert_eq "manifest in superseded-releases/ is still read" \
  "REQ-200 REQ-201" "$(scope "$D4" REQ-200 REQ-201 REQ-007)"

D5="$WORK/other"
mkdir -p "$D5"
assert_eq "bare-date release is passed through unchanged" \
  "REQ-007 REQ-008" "$(scope "$D5" v2026.11.08 REQ-007 REQ-008)"
assert_eq "_compliance-docs is passed through unchanged" \
  "REQ-007" "$(scope "$D5" _compliance-docs REQ-007)"

if (cd "$D5" && bash "$HELPER" >/dev/null 2>&1); then
  assert_eq "no release argument is a usage error" "1" "0"
else
  assert_eq "no release argument is a usage error" "1" "1"
fi

echo ""
echo "Passed: $PASS  Failed: $FAIL"
[ "$FAIL" -eq 0 ]
