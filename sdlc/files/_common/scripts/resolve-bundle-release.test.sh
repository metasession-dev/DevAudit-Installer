#!/usr/bin/env bash
# resolve-bundle-release.test.sh — tests for resolve-bundle-release.sh (devaudit-installer#955).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/resolve-bundle-release.sh"
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

make_bundle() {
  # make_bundle <dir> <core> <member...> — a declared bundle: md section + json members
  local dir="$1" core="$2"
  shift 2
  mkdir -p "$dir/compliance/pending-releases"
  {
    echo "## Bundled Changes"
    echo ""
    echo "### Co-Tracked Bundle Members"
    echo ""
    local m
    for m in "$@"; do
      echo "- \`${m}\` (co-tracked/bundled) — ${m} title"
    done
  } > "$dir/compliance/pending-releases/BUNDLED-CHANGES-${core}.md"
  local members_json="[]" m
  for m in "$@"; do
    members_json="$(jq -c --arg v "$m" '. + [{version: $v, role: "co_tracked", relationship: "bundled"}]' <<<"$members_json")"
  done
  jq -n --argjson members "$members_json" --arg core "$core" \
    '{schemaVersion: 2, approvalRelease: {version: $core}, coreRelease: {version: $core}, members: $members, nonReleaseWorkItems: []}' \
    > "$dir/compliance/pending-releases/BUNDLED-CHANGES-${core}.json"
}

resolve() {
  # resolve <dir> <arg> — run the helper inside the fixture, print stdout
  local dir="$1" arg="$2"
  (cd "$dir" && bash "$HELPER" "$arg")
}

echo "=== resolve-bundle-release.sh tests ==="

D1="$WORK/bundle"
make_bundle "$D1" REQ-035 REQ-036 REQ-037 REQ-038
assert_eq "a co_tracked member resolves to the core" "REQ-035" "$(resolve "$D1" REQ-036)"
assert_eq "every member resolves to the core" "REQ-035" "$(resolve "$D1" REQ-038)"
assert_eq "the core resolves to itself" "REQ-035" "$(resolve "$D1" REQ-035)"
assert_eq "an unrelated pending REQ resolves to itself" "REQ-034" "$(resolve "$D1" REQ-034)"
assert_eq "a bare-date version passes through" "v2026.10.04" "$(resolve "$D1" v2026.10.04)"
assert_eq "_compliance-docs passes through" "_compliance-docs" "$(resolve "$D1" _compliance-docs)"

D2="$WORK/predecessor-only"
mkdir -p "$D2/compliance/pending-releases"
cat > "$D2/compliance/pending-releases/BUNDLED-CHANGES-REQ-042.md" <<'EOF'
## Bundled Changes
- **Absorbed predecessor releases:** REQ-041
EOF
jq -n '{schemaVersion: 2, members: [{version: "REQ-041", role: "predecessor", relationship: "superseded"}], nonReleaseWorkItems: []}' \
  > "$D2/compliance/pending-releases/BUNDLED-CHANGES-REQ-042.json"
assert_eq "a predecessor is not remapped" "REQ-041" "$(resolve "$D2" REQ-041)"

D3="$WORK/no-pending-dir"
mkdir -p "$D3"
assert_eq "no pending-releases directory resolves to itself" "REQ-036" "$(resolve "$D3" REQ-036)"

D4="$WORK/stale"
make_bundle "$D4" REQ-035 REQ-036
mkdir -p "$D4/compliance/approved-releases"
: > "$D4/compliance/approved-releases/RELEASE-TICKET-REQ-035.md"
assert_eq "a stale manifest (core ticket archived) is ignored" "REQ-036" "$(resolve "$D4" REQ-036)"

D5="$WORK/md-fallback"
make_bundle "$D5" REQ-035 REQ-036
rm -f "$D5/compliance/pending-releases/BUNDLED-CHANGES-REQ-035.json"
assert_eq "falls back to the markdown member list when the json is absent" "REQ-035" "$(resolve "$D5" REQ-036)"

D6="$WORK/conflict"
make_bundle "$D6" REQ-035 REQ-036
make_bundle "$D6" REQ-050 REQ-036
set +e
CONFLICT_OUT="$(cd "$D6" && bash "$HELPER" REQ-036 2>&1)"
CONFLICT_RC=$?
set -e
assert_eq "membership in two live bundles exits 3" "3" "$CONFLICT_RC"
case "$CONFLICT_OUT" in
  *"more than one live declared bundle"*) assert_eq "conflict message names the problem" "ok" "ok" ;;
  *) assert_eq "conflict message names the problem" "ok" "missing: $CONFLICT_OUT" ;;
esac

set +e
(cd "$D1" && bash "$HELPER" >/dev/null 2>&1)
USAGE_RC=$?
set -e
assert_eq "no argument is a usage error" "1" "$USAGE_RC"

echo ""
echo "=== resolve-bundle-release.test.sh: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
