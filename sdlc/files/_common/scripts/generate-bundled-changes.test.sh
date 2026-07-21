#!/usr/bin/env bash
# generate-bundled-changes.test.sh — Tests for generate-bundled-changes.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/generate-bundled-changes.sh"
[ -x "$HELPER" ] || chmod +x "$HELPER"

PASS=0
FAIL=0

TMPDIR_BASE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_BASE"' EXIT

make_fixture() {
  local dir="$1"
  rm -rf "$dir"
  mkdir -p "$dir"
  cd "$dir"
  git init -q --initial-branch=main
  git config user.email "test@example.com"
  git config user.name "test"
  echo "x" > f.txt
  git add f.txt
  git commit -q -m "feat: initial commit [REQ-001]"
}

add_commit() {
  local msg="$1"
  echo "$(date +%s%N)" >> f.txt
  git add f.txt
  git commit -q -m "$msg"
}

write_release_ticket() {
  local version="$1"
  local requirement_line="$2"
  local summary="$3"
  local predecessors="$4"
  mkdir -p compliance/pending-releases
  cat > "compliance/pending-releases/RELEASE-TICKET-${version}.md" <<EOF
# Release Ticket - ${version}

**Requirement:** ${requirement_line}
**PR:** #123 https://github.com/example/repo/pull/123

## Summary

${summary}

## Bundled Changes

- **Core tracked release:** \`${version}\`
- **Absorbed predecessor releases:** ${predecessors}
EOF
}

assert_contains() {
  local desc="$1" want="$2" got="$3"
  if echo "$got" | grep -qF "$want"; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    echo "    want (substring): $want"
    echo "    got:"
    echo "$got" | sed 's/^/      /'
    FAIL=$((FAIL + 1))
  fi
}

assert_not_contains() {
  local desc="$1" want="$2" got="$3"
  if echo "$got" | grep -qF "$want"; then
    echo "  FAIL: $desc"
    echo "    should not contain: $want"
    echo "    got:"
    echo "$got" | sed 's/^/      /'
    FAIL=$((FAIL + 1))
  else
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  fi
}

assert_eq() {
  local desc="$1" want="$2" got="$3"
  if [ "$want" = "$got" ]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    echo "    want: $want"
    echo "    got:  $got"
    FAIL=$((FAIL + 1))
  fi
}

assert_file_exists() {
  local desc="$1" path="$2"
  if [ -f "$path" ]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    echo "    missing file: $path"
    FAIL=$((FAIL + 1))
  fi
}

# Test 1: only REQ-free housekeeping inside the tracked REQ window is bundled.
echo "Test 1: release ownership excludes tagged and historical work"
DIR1="$TMPDIR_BASE/test1"
make_fixture "$DIR1"
add_commit "chore: sync DevAudit templates from v0.1.69 to v0.1.70 [skip ci]"
add_commit "docs: update API reference for /bookings endpoint"
add_commit "feat: add booking widget [REQ-042]"
add_commit "test: verify booking widget [REQ-042]"
add_commit "chore(deps): bump eslint 9.0.5 to 9.0.6"
add_commit "docs: document booking widget\n\nRef: REQ-042"
add_commit "fix: resolve null pointer in booking service [REQ-042]"
SINCE=$(git rev-list --max-parents=0 HEAD)
JSON_OUT="$DIR1/bundle.json"
OUTPUT=$(bash "$HELPER" "$SINCE" "REQ-042" --json-out "$JSON_OUT" 2>&1)
assert_contains "markdown includes scoped chore commit" "chore(deps): bump eslint" "$OUTPUT"
assert_not_contains "markdown excludes historical chore commit" "chore: sync DevAudit templates" "$OUTPUT"
assert_not_contains "markdown excludes historical docs commit" "docs: update API reference" "$OUTPUT"
assert_not_contains "markdown excludes tagged test commit" "test: verify booking widget" "$OUTPUT"
assert_not_contains "markdown excludes Ref-tagged docs commit" "docs: document booking widget" "$OUTPUT"
assert_not_contains "markdown excludes feat commit" "feat: add booking widget" "$OUTPUT"
assert_not_contains "markdown excludes fix commit" "fix: resolve null pointer" "$OUTPUT"
assert_file_exists "json manifest emitted" "$JSON_OUT"
assert_eq "non-release work count" "1" "$(jq -r '.nonReleaseWorkItems | length' "$JSON_OUT")"
assert_eq "member count with no tickets" "0" "$(jq -r '.members | length' "$JSON_OUT")"
assert_eq "first housekeeping kind" "housekeeping_commit" "$(jq -r '.nonReleaseWorkItems[0].kind' "$JSON_OUT")"
echo

# Test 2: explicit predecessor tickets become manifest members.
echo "Test 2: explicit predecessor membership emitted"
DIR2="$TMPDIR_BASE/test2"
make_fixture "$DIR2"
add_commit "feat: predecessor scope [REQ-041]"
add_commit "fix: predecessor bugfix [REQ-041]"
add_commit "feat: current release scope [REQ-042]"
write_release_ticket "REQ-041" "REQ-041 - Prior tracked release" "Prior release summary." "None"
write_release_ticket "REQ-042" "REQ-042 - Current tracked release" "Current release summary." "\`REQ-041\`"
SINCE=$(git rev-list --max-parents=0 HEAD)
JSON_OUT="$DIR2/bundle.json"
OUTPUT=$(bash "$HELPER" "$SINCE" "REQ-042" --json-out "$JSON_OUT" 2>&1)
assert_contains "markdown shows predecessor section" "REQ-041" "$OUTPUT"
assert_eq "manifest contains one explicit member" "1" "$(jq -r '.members | length' "$JSON_OUT")"
assert_eq "member version recorded" "REQ-041" "$(jq -r '.members[0].version' "$JSON_OUT")"
assert_eq "member role recorded" "predecessor" "$(jq -r '.members[0].role' "$JSON_OUT")"
assert_eq "member relationship recorded" "superseded" "$(jq -r '.members[0].relationship' "$JSON_OUT")"
assert_eq "manifest hash present" "true" "$(jq -r 'has("manifestHash")' "$JSON_OUT")"
assert_eq "manifest schema v2" "2" "$(jq -r '.schemaVersion' "$JSON_OUT")"
assert_eq "original title recorded" "Prior tracked release" "$(jq -r '.members[0].originalTitle' "$JSON_OUT")"
assert_eq "inheritance policy explicit" "all_eligible" "$(jq -r '.members[0].evidenceInheritancePolicy.mode' "$JSON_OUT")"
EXPECTED_HASH="sha256:$(jq -cS 'del(.manifestHash, .generator.generatedAt)' "$JSON_OUT" | tr -d '\n' | sha256sum | awk '{print $1}')"
assert_eq "canonical manifest hash verifies" "$EXPECTED_HASH" "$(jq -r '.manifestHash' "$JSON_OUT")"
echo

# Test 3: ambiguous predecessor ownership fails.
echo "Test 3: ambiguous predecessor ownership is rejected"
DIR3="$TMPDIR_BASE/test3"
make_fixture "$DIR3"
write_release_ticket "REQ-041" "REQ-041 - Prior tracked release" "Prior release summary." "None"
write_release_ticket "REQ-042" "REQ-042 - Current tracked release" "Current release summary." "None"
set +e
OUTPUT=$(bash "$HELPER" "$(git rev-list --max-parents=0 HEAD)" "REQ-042" 2>&1)
RC=$?
set -e
if [ "$RC" -ne 0 ]; then
  echo "  PASS: non-zero exit for ambiguous predecessor set"
  PASS=$((PASS + 1))
else
  echo "  FAIL: expected non-zero exit for ambiguous predecessor set"
  FAIL=$((FAIL + 1))
fi
assert_contains "ambiguous error text" "ambiguous predecessor ownership" "$OUTPUT"
echo

# Test 4: self-supersession is rejected.
echo "Test 4: self-supersession is rejected"
DIR4="$TMPDIR_BASE/test4"
make_fixture "$DIR4"
write_release_ticket "REQ-042" "REQ-042 - Current tracked release" "Current release summary." "\`REQ-042\`"
set +e
OUTPUT=$(bash "$HELPER" "$(git rev-list --max-parents=0 HEAD)" "REQ-042" 2>&1)
RC=$?
set -e
if [ "$RC" -ne 0 ]; then
  echo "  PASS: non-zero exit for self-supersession"
  PASS=$((PASS + 1))
else
  echo "  FAIL: expected non-zero exit for self-supersession"
  FAIL=$((FAIL + 1))
fi
assert_contains "self-supersession error text" "cannot self-supersede" "$OUTPUT"
echo

# Test 5: duplicate explicit predecessors are rejected.
echo "Test 5: duplicate explicit predecessors are rejected"
DIR5="$TMPDIR_BASE/test5"
make_fixture "$DIR5"
write_release_ticket "REQ-041" "REQ-041 - Prior tracked release" "Prior release summary." "None"
write_release_ticket "REQ-042" "REQ-042 - Current tracked release" "Current release summary." "\`REQ-041\`, \`REQ-041\`"
set +e
OUTPUT=$(bash "$HELPER" "$(git rev-list --max-parents=0 HEAD)" "REQ-042" 2>&1)
RC=$?
set -e
if [ "$RC" -ne 0 ]; then
  echo "  PASS: non-zero exit for duplicate predecessors"
  PASS=$((PASS + 1))
else
  echo "  FAIL: expected non-zero exit for duplicate predecessors"
  FAIL=$((FAIL + 1))
fi
assert_contains "duplicate predecessor error text" "duplicate explicit predecessor" "$OUTPUT"
echo

# Test 6: regeneration is deterministic apart from generatedAt.
echo "Test 6: manifest regeneration is deterministic"
DIR6="$TMPDIR_BASE/test6"
make_fixture "$DIR6"
add_commit "docs: update release notes"
write_release_ticket "REQ-042" "REQ-042 - Current tracked release" "Current release summary." "None"
SINCE=$(git rev-list --max-parents=0 HEAD)
JSON_ONE="$DIR6/bundle-one.json"
JSON_TWO="$DIR6/bundle-two.json"
bash "$HELPER" "$SINCE" "REQ-042" --json-out "$JSON_ONE" >/dev/null
sleep 1
bash "$HELPER" "$SINCE" "REQ-042" --json-out "$JSON_TWO" >/dev/null
NORMALIZED_ONE="$(jq -S 'del(.generator.generatedAt)' "$JSON_ONE")"
NORMALIZED_TWO="$(jq -S 'del(.generator.generatedAt)' "$JSON_TWO")"
assert_eq "normalized manifests match" "$NORMALIZED_ONE" "$NORMALIZED_TWO"
assert_eq "manifest hashes match" "$(jq -r '.manifestHash' "$JSON_ONE")" "$(jq -r '.manifestHash' "$JSON_TWO")"
echo

echo "=== Summary: ${PASS} pass / ${FAIL} fail ==="
[ "$FAIL" -eq 0 ]
