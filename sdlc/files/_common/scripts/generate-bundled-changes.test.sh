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

# Test 1: REQ-free housekeeping across the whole SINCE_REF..HEAD window is
# bundled (devaudit-installer#600 — do NOT re-narrow the scan floor to this
# REQ's own first commit); REQ-tagged commits are excluded via the per-commit
# tag filter regardless of their position in that window.
echo "Test 1: release ownership excludes tagged work, includes housekeeping across the full window"
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
assert_contains "markdown includes predecessor chore commit (#600)" "chore: sync DevAudit templates" "$OUTPUT"
assert_contains "markdown includes predecessor docs commit (#600)" "docs: update API reference" "$OUTPUT"
assert_not_contains "markdown excludes tagged test commit" "test: verify booking widget" "$OUTPUT"
assert_not_contains "markdown excludes Ref-tagged docs commit" "docs: document booking widget" "$OUTPUT"
assert_not_contains "markdown excludes feat commit" "feat: add booking widget" "$OUTPUT"
assert_not_contains "markdown excludes fix commit" "fix: resolve null pointer" "$OUTPUT"
assert_file_exists "json manifest emitted" "$JSON_OUT"
assert_eq "non-release work count" "3" "$(jq -r '.nonReleaseWorkItems | length' "$JSON_OUT")"
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

# Test 3: an explicit "None" declaration, with other unrelated pending
# releases open concurrently, is NOT ambiguous — devaudit-installer#746.
# extract_explicit_predecessors() previously couldn't distinguish "field
# absent" from "field explicitly None" (both yielded an empty predecessor
# list), so a ticket that correctly declared "None" was rejected as
# ambiguous whenever any other pending release ticket happened to exist,
# even though the field had already answered the question.
echo "Test 3: explicit 'None' with other pending releases open succeeds"
DIR3="$TMPDIR_BASE/test3"
make_fixture "$DIR3"
write_release_ticket "REQ-041" "REQ-041 - Prior tracked release" "Prior release summary." "None"
write_release_ticket "REQ-042" "REQ-042 - Current tracked release" "Current release summary." "None"
JSON_OUT3="$DIR3/bundle.json"
set +e
OUTPUT=$(bash "$HELPER" "$(git rev-list --max-parents=0 HEAD)" "REQ-042" --json-out "$JSON_OUT3" 2>&1)
RC=$?
set -e
if [ "$RC" -eq 0 ]; then
  echo "  PASS: zero exit for explicit None with unrelated pending release"
  PASS=$((PASS + 1))
else
  echo "  FAIL: expected zero exit for explicit None with unrelated pending release"
  echo "$OUTPUT"
  FAIL=$((FAIL + 1))
fi
assert_eq "no members absorbed" "0" "$(jq -r '.members | length' "$JSON_OUT3" 2>/dev/null || echo err)"
echo

# Test 3b: the field truly absent (no "Absorbed predecessor releases:" line
# at all) — this is the genuinely-ambiguous case and must still hard-fail,
# distinguishing it from Test 3's explicit "None" (devaudit-installer#746).
echo "Test 3b: field genuinely absent, other pending releases open, is rejected"
DIR3B="$TMPDIR_BASE/test3b"
make_fixture "$DIR3B"
mkdir -p compliance/pending-releases
cat > compliance/pending-releases/RELEASE-TICKET-REQ-041.md <<'EOF'
# Release Ticket - REQ-041

**Requirement:** REQ-041 - Prior tracked release

## Summary

Prior release summary.
EOF
cat > compliance/pending-releases/RELEASE-TICKET-REQ-042.md <<'EOF'
# Release Ticket - REQ-042

**Requirement:** REQ-042 - Current tracked release

## Summary

Current release summary, no bundle section at all.
EOF
set +e
OUTPUT=$(bash "$HELPER" "$(git rev-list --max-parents=0 HEAD)" "REQ-042" 2>&1)
RC=$?
set -e
if [ "$RC" -ne 0 ]; then
  echo "  PASS: non-zero exit for genuinely absent field"
  PASS=$((PASS + 1))
else
  echo "  FAIL: expected non-zero exit for genuinely absent field"
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

# Test 7: devaudit-installer#600 regression — a predecessor housekeeping
# commit landing as the very first commit after SINCE_REF, immediately
# followed (zero gap) by this REQ's own first commit, must still be
# detected. This mirrors the live example-app REQ-097 failure exactly:
# under the old SCAN_FROM="${FIRST_REQ_SHA}^" narrowing, the scan floor
# landed *on* the housekeeping commit itself, and `git log A..B` excludes
# `A`, silently dropping it from nonReleaseWorkItems.
echo "Test 7: adjacent predecessor housekeeping commit is detected (#600)"
DIR7="$TMPDIR_BASE/test7"
make_fixture "$DIR7"
add_commit "chore: sync DevAudit SDLC templates to 0.3.33"
add_commit "test: verify portion pricing fix [REQ-097]"
SINCE=$(git rev-list --max-parents=0 HEAD)
JSON_OUT="$DIR7/bundle.json"
OUTPUT=$(bash "$HELPER" "$SINCE" "REQ-097" --json-out "$JSON_OUT" 2>&1)
assert_contains "markdown includes the adjacent predecessor housekeeping commit" "chore: sync DevAudit SDLC templates" "$OUTPUT"
assert_not_contains "markdown excludes this REQ's own REQ-tagged commit" "test: verify portion pricing fix" "$OUTPUT"
assert_eq "non-release work count" "1" "$(jq -r '.nonReleaseWorkItems | length' "$JSON_OUT")"
assert_eq "adjacent housekeeping kind" "housekeeping_commit" "$(jq -r '.nonReleaseWorkItems[0].kind' "$JSON_OUT")"
echo

# Test 8: --declared-bundle emits co-tracked/bundled members, additive to
# (and independent of) predecessor absorption (devaudit-installer#736).
echo "Test 8: --declared-bundle emits co-tracked bundle members"
DIR8="$TMPDIR_BASE/test8"
make_fixture "$DIR8"
write_release_ticket "REQ-042" "REQ-042 - Current tracked release" "Current release summary." "None"
JSON_OUT8="$DIR8/bundle.json"
OUTPUT=$(bash "$HELPER" "$(git rev-list --max-parents=0 HEAD)" "REQ-042" --json-out "$JSON_OUT8" --declared-bundle "REQ-043, REQ-044" 2>&1)
assert_contains "markdown shows co-tracked bundle members section" "Co-Tracked Bundle Members" "$OUTPUT"
assert_eq "manifest has two co-tracked members" "2" "$(jq -r '[.members[] | select(.role == "co_tracked")] | length' "$JSON_OUT8")"
assert_eq "co-tracked role uses portal's underscore spelling (devaudit-installer#817)" "co_tracked" "$(jq -r '.members[0].role' "$JSON_OUT8")"
assert_eq "first co-tracked member version" "REQ-043" "$(jq -r '.members[0].version' "$JSON_OUT8")"
assert_eq "first co-tracked member relationship" "bundled" "$(jq -r '.members[0].relationship' "$JSON_OUT8")"
assert_eq "co-tracked member does not inherit evidence" "none" "$(jq -r '.members[0].evidenceInheritancePolicy.mode' "$JSON_OUT8")"
echo

# Test 9: --declared-bundle rejects self-inclusion and duplicates.
echo "Test 9: --declared-bundle rejects self and duplicate members"
DIR9="$TMPDIR_BASE/test9"
make_fixture "$DIR9"
write_release_ticket "REQ-042" "REQ-042 - Current tracked release" "Current release summary." "None"
set +e
OUTPUT=$(bash "$HELPER" "$(git rev-list --max-parents=0 HEAD)" "REQ-042" --declared-bundle "REQ-042" 2>&1)
RC=$?
set -e
assert_eq "self-inclusion rejected" "1" "$RC"
assert_contains "self-inclusion error text" "cannot include its own core release" "$OUTPUT"

set +e
OUTPUT=$(bash "$HELPER" "$(git rev-list --max-parents=0 HEAD)" "REQ-042" --declared-bundle "REQ-043,REQ-043" 2>&1)
RC=$?
set -e
assert_eq "duplicate member rejected" "1" "$RC"
assert_contains "duplicate member error text" "duplicate declared bundle member" "$OUTPUT"
echo

# Tests 10-14: Release intent / no-silent-absorption guards (#955).
add_intent() {
  printf '%s\n' "- **Release intent:** $2" >> "compliance/pending-releases/RELEASE-TICKET-$1.md"
}
run_gen() {
  set +e
  OUTPUT=$(bash "$HELPER" "$SINCE" "REQ-042" --json-out "$PWD/bundle.json" 2>&1)
  RC=$?
  set -e
}

echo "Test 10: None + candidate REQ commits in SINCE..HEAD fails"
DIR10="$TMPDIR_BASE/test10"
make_fixture "$DIR10"
SINCE="$(git rev-list --max-parents=0 HEAD)"
write_release_ticket "REQ-041" "REQ-041 - Deferred" "Prior." "None"
write_release_ticket "REQ-042" "REQ-042 - Current" "Current." "None"
add_commit "feat: deferred work [REQ-041]"
run_gen
assert_eq "None with in-range candidate commits rejected" "1" "$RC"
assert_contains "names the ticket" "RELEASE-TICKET-REQ-041.md" "$OUTPUT"
assert_contains "says to list it under Absorbed predecessor releases" "under 'Absorbed predecessor releases'" "$OUTPUT"
echo

echo "Test 10b: Ref: trailer also counts, REQ-04 does not match REQ-041"
DIR10B="$TMPDIR_BASE/test10b"
make_fixture "$DIR10B"
SINCE="$(git rev-list --max-parents=0 HEAD)"
write_release_ticket "REQ-04" "REQ-04 - Other" "Other." "None"
write_release_ticket "REQ-042" "REQ-042 - Current" "Current." "None"
add_commit "feat: other work [REQ-041]"
run_gen
assert_eq "REQ-04 not confused with REQ-041" "0" "$RC"
add_commit "$(printf 'fix: thing\n\nRef: REQ-04')"
run_gen
assert_eq "Ref: trailer for the candidate rejected" "1" "$RC"
echo

echo "Test 11: Release intent set + predecessor field None fails"
DIR11="$TMPDIR_BASE/test11"
make_fixture "$DIR11"
SINCE="$(git rev-list --max-parents=0 HEAD)"
write_release_ticket "REQ-041" "REQ-041 - Deferred" "Prior." "None"
add_intent "REQ-041" "deferred-to-next — PR #9 closed unmerged"
write_release_ticket "REQ-042" "REQ-042 - Current" "Current." "None"
run_gen
assert_eq "deferred candidate with None rejected" "1" "$RC"
assert_contains "names the deferred ticket" "RELEASE-TICKET-REQ-041.md" "$OUTPUT"
assert_contains "quotes the intent" "deferred-to-next" "$OUTPUT"
echo

echo "Test 11b: Release intent set + predecessor field omitted fails with the deferral message"
write_release_ticket "REQ-042" "REQ-042 - Current" "Current." "None"
sed -i '/Absorbed predecessor releases/d' compliance/pending-releases/RELEASE-TICKET-REQ-042.md
run_gen
assert_eq "deferred candidate with omitted field rejected" "1" "$RC"
assert_contains "deferral message, not generic ambiguity" "never absorbed silently" "$OUTPUT"
echo

echo "Test 12: Release intent set and candidate listed passes"
write_release_ticket "REQ-042" "REQ-042 - Current" "Current." "REQ-041"
add_commit "feat: deferred work [REQ-041]"
run_gen
assert_eq "listed deferral passes" "0" "$RC"
assert_eq "REQ-041 is a predecessor member" "predecessor" "$(jq -r '.members[0].role' bundle.json)"
echo

echo "Test 13: no intent and no candidate commits passes as before"
DIR13="$TMPDIR_BASE/test13"
make_fixture "$DIR13"
SINCE="$(git rev-list --max-parents=0 HEAD)"
write_release_ticket "REQ-041" "REQ-041 - Other" "Prior." "None"
write_release_ticket "REQ-042" "REQ-042 - Current" "Current." "None"
add_commit "feat: current work [REQ-042]"
run_gen
assert_eq "None without intent or commits passes" "0" "$RC"
echo

echo "Test 14: a declared-bundle member with an intent is not a candidate"
DIR14="$TMPDIR_BASE/test14"
make_fixture "$DIR14"
SINCE="$(git rev-list --max-parents=0 HEAD)"
write_release_ticket "REQ-043" "REQ-043 - Member" "Member." "None"
add_intent "REQ-043" "deferred-to-next — PR #9 closed unmerged"
write_release_ticket "REQ-042" "REQ-042 - Current" "Current." "None"
add_commit "feat: member work [REQ-043]"
set +e
OUTPUT=$(bash "$HELPER" "$SINCE" "REQ-042" --declared-bundle REQ-043 --json-out "$PWD/bundle.json" 2>&1)
RC=$?
set -e
assert_eq "declared member skipped by the guards" "0" "$RC"
echo

# --- DevAudit-Installer#1288: --check compares a manifest with what would be generated now ---
manifest_fixture() { # <dir>: a declared bundle REQ-042 + REQ-043 with one chore, its manifest generated
  local dir="$1"
  make_fixture "$dir"
  SINCE="$(git rev-list --max-parents=0 HEAD)"
  write_release_ticket "REQ-042" "REQ-042 - Current" "Current." "None"
  git add compliance && git commit -q -m "docs: release ticket [REQ-042]"
  add_commit "chore: first housekeeping"
  mkdir -p compliance/pending-releases
  MANIFEST="compliance/pending-releases/BUNDLED-CHANGES-REQ-042.json"
  bash "$HELPER" "$SINCE" "REQ-042" --declared-bundle REQ-043 --json-out "$MANIFEST" >/dev/null 2>&1
}
run_check() { # <manifest> [extra args]: sets CHECK_RC and CHECK_OUT (stdout and stderr)
  local manifest="$1"; shift
  set +e
  CHECK_OUT=$(bash "$HELPER" "$SINCE" "REQ-042" --declared-bundle REQ-043 --check "$manifest" "$@" 2>&1)
  CHECK_RC=$?
  set -e
}

echo "Test 15: --check passes on a manifest that was just generated, writes nothing and prints no report"
manifest_fixture "$TMPDIR_BASE/test15"
BEFORE="$(cat "$MANIFEST")"
run_check "$MANIFEST"
assert_eq "check exits 0" "0" "$CHECK_RC"
assert_contains "check says the manifest is current" "is current for REQ-042" "$CHECK_OUT"
assert_not_contains "check prints no markdown report" "## Bundled Changes" "$CHECK_OUT"
assert_eq "check leaves the manifest untouched" "$BEFORE" "$(cat "$MANIFEST")"
echo

echo "Test 16: a chore merged after the manifest was generated makes it stale (exit 3), naming the commit and the fix"
manifest_fixture "$TMPDIR_BASE/test16"
add_commit "chore: e2e shard count and job ceiling"
LATE_SHA="$(git rev-parse --short HEAD)"
run_check "$MANIFEST"
assert_eq "check exits 3" "3" "$CHECK_RC"
assert_contains "names the missing commit" "$LATE_SHA" "$CHECK_OUT"
assert_contains "names its subject" "chore: e2e shard count and job ceiling" "$CHECK_OUT"
assert_contains "says it is stale" "is stale for REQ-042" "$CHECK_OUT"
assert_contains "gives the regeneration command" "Regenerate it: bash scripts/generate-bundled-changes.sh $SINCE REQ-042 --declared-bundle REQ-043 --json-out $MANIFEST" "$CHECK_OUT"
bash "$HELPER" "$SINCE" "REQ-042" --declared-bundle REQ-043 --json-out "$MANIFEST" >/dev/null 2>&1
run_check "$MANIFEST"
assert_eq "regenerating makes it current again" "0" "$CHECK_RC"
echo

echo "Test 17: a REQ-tagged commit and a compliance-only commit that carries a REQ ref do not make it stale"
manifest_fixture "$TMPDIR_BASE/test17"
add_commit "feat: more member work [REQ-043]"
add_commit "docs(compliance): sign-off Ref: REQ-042"
run_check "$MANIFEST"
assert_eq "still current" "0" "$CHECK_RC"
echo

echo "Test 18: the commit that regenerates the manifest is not absorbed by it, even with no REQ ref"
manifest_fixture "$TMPDIR_BASE/test18"
add_commit "chore: second housekeeping"
bash "$HELPER" "$SINCE" "REQ-042" --declared-bundle REQ-043 --json-out "$MANIFEST" >/dev/null 2>&1
git add "$MANIFEST" && git commit -q -m "docs: regenerate the bundle manifest"
run_check "$MANIFEST"
assert_eq "current after committing the regenerated manifest" "0" "$CHECK_RC"
assert_eq "the manifest does not list its own commit" "0" "$(jq -r '[.nonReleaseWorkItems[] | select(.title == "docs: regenerate the bundle manifest")] | length' "$MANIFEST")"
assert_eq "it still lists the real chores" "2" "$(jq -r '.nonReleaseWorkItems | length' "$MANIFEST")"
echo

echo "Test 19: different members are stale; a shorter abbreviated hash still matches; a commit gone from the range is stale"
manifest_fixture "$TMPDIR_BASE/test19"
set +e
OUTPUT=$(bash "$HELPER" "$SINCE" "REQ-042" --declared-bundle REQ-044 --check "$MANIFEST" 2>&1)
RC=$?
set -e
assert_eq "other declared members: exit 3" "3" "$RC"
assert_contains "says the members differ" "members differ" "$OUTPUT"
SHORT="$(jq -c '.nonReleaseWorkItems[0].reference |= .[0:5]' "$MANIFEST")"
printf '%s\n' "$(jq -c --argjson i "$SHORT" '.nonReleaseWorkItems = $i.nonReleaseWorkItems' "$MANIFEST")" > "$MANIFEST"
run_check "$MANIFEST"
assert_eq "a 5-character abbreviation of the same commit matches" "0" "$CHECK_RC"
jq -c '.nonReleaseWorkItems += [{kind: "housekeeping_commit", title: "gone", reference: "deadbee"}]' "$MANIFEST" > "$MANIFEST.tmp" && mv "$MANIFEST.tmp" "$MANIFEST"
run_check "$MANIFEST"
assert_eq "a listed commit that is not in the range: exit 3" "3" "$CHECK_RC"
assert_contains "names it" "no longer in" "$CHECK_OUT"
echo

echo "Test 20: --check on a missing file is an error, not a pass"
manifest_fixture "$TMPDIR_BASE/test20"
run_check "compliance/pending-releases/NOPE.json"
assert_eq "exit 1" "1" "$CHECK_RC"
echo

echo "=== Summary: ${PASS} pass / ${FAIL} fail ==="
[ "$FAIL" -eq 0 ]
