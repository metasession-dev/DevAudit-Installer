#!/usr/bin/env bash
# release-declared-requirements.test.sh — tests for release-declared-requirements.sh (devaudit-installer#1209).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/release-declared-requirements.sh"
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
  # make_manifest <dir> <subdir> <core> <member...> — members are co_tracked, plus one predecessor
  local dir="$1" sub="$2" core="$3"
  shift 3
  mkdir -p "$dir/compliance/$sub"
  local members_json='[{"version":"REQ-150","role":"predecessor"}]' m
  for m in "$@"; do
    members_json="$(jq -c --arg v "$m" '. + [{version: $v, role: "co_tracked", relationship: "bundled"}]' <<<"$members_json")"
  done
  jq -n --argjson members "$members_json" --arg core "$core" \
    '{schemaVersion: 2, coreRelease: {version: $core}, members: $members}' \
    > "$dir/compliance/$sub/BUNDLED-CHANGES-${core}.json"
}

declared() { (cd "$1" && bash "$HELPER" "$2"); }

echo "=== release-declared-requirements.sh tests ==="

D1="$WORK/single"
mkdir -p "$D1"
assert_eq "a single REQ release declares itself" "REQ-119" "$(declared "$D1" REQ-119)"

for sub in pending-releases approved-releases superseded-releases; do
  D="$WORK/bundle-$sub"
  make_manifest "$D" "$sub" REQ-200 REQ-202 REQ-201
  assert_eq "bundle core declares itself and its co_tracked members ($sub), sorted" \
    "REQ-200,REQ-201,REQ-202" "$(declared "$D" REQ-200)"
done

D2="$WORK/predecessor-only"
make_manifest "$D2" pending-releases REQ-300
assert_eq "a predecessor is not declared (it has its own release)" "REQ-300" "$(declared "$D2" REQ-300)"

D3="$WORK/other"
mkdir -p "$D3"
assert_eq "a bare-date release declares nothing" "" "$(declared "$D3" v2026.11.08)"
assert_eq "_compliance-docs declares nothing" "" "$(declared "$D3" _compliance-docs)"

if (cd "$D3" && bash "$HELPER" >/dev/null 2>&1); then
  assert_eq "no argument is a usage error" "1" "0"
else
  assert_eq "no argument is a usage error" "1" "1"
fi

echo ""
echo "Passed: $PASS  Failed: $FAIL"
[ "$FAIL" -eq 0 ]
