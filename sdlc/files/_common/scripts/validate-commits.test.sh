#!/usr/bin/env bash
# validate-commits.test.sh — Fixture-based tests for validate-commits.sh.
#
# Covers the relaxed "exactly one active tracked release" behavior:
# implementation commits without REQ tags downgrade to warnings only when
# release context is unambiguous; otherwise they remain hard errors.
#
# Usage:
#   ./scripts/validate-commits.test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VALIDATOR="$SCRIPT_DIR/validate-commits.sh"
[ -x "$VALIDATOR" ] || chmod +x "$VALIDATOR"

PASS=0
FAIL=0

make_fixture() {
  local dir="$1" subject="$2" body="${3:-}"
  rm -rf "$dir"
  mkdir -p "$dir"
  cd "$dir"
  git init -q --initial-branch=main
  git config user.email "test@example.com"
  git config user.name "test"
  echo "base" > base.txt
  git add base.txt
  git commit -q -m "chore: base"

  git checkout -q -b feature
  echo "feature" > app.ts
  git add app.ts
  if [ -n "$body" ]; then
    git commit -q -m "$subject" -m "$body"
  else
    git commit -q -m "$subject"
  fi
}

run_validator() {
  set +e
  OUT_FILE=$(mktemp)
  bash "$VALIDATOR" main > "$OUT_FILE" 2>&1
  LAST_EXIT=$?
  set -e
}

assert_exit() {
  local desc="$1" want="$2"
  if [ "$LAST_EXIT" = "$want" ]; then
    echo "  PASS: $desc (exit=$LAST_EXIT)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (want=$want, got=$LAST_EXIT)"
    sed 's/^/    /' "$OUT_FILE"
    FAIL=$((FAIL + 1))
  fi
}

assert_grep() {
  local desc="$1" pattern="$2" want_match="$3"
  local found=0
  if grep -qE "$pattern" "$OUT_FILE"; then
    found=1
  fi
  if [ "$found" = "$want_match" ]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (want match=$want_match, got=$found, pattern=$pattern)"
    sed 's/^/    /' "$OUT_FILE"
    FAIL=$((FAIL + 1))
  fi
}

WORKDIR=$(mktemp -d -t validate-commits-test-XXXX)
trap 'rm -rf "$WORKDIR"' EXIT

echo "=== validate-commits.sh tests ==="

# Case 1: one active pending ticket makes a missing-REQ implementation
# commit a warning, not a hard failure.
echo "Case 1: single active pending release downgrades missing REQ to warning"
make_fixture "$WORKDIR/case1" "feat: implement kitchen workflow" "Co-Authored-By: Test <test@example.com>"
mkdir -p compliance/pending-releases
cat > compliance/pending-releases/RELEASE-TICKET-REQ-123.md <<'EOF'
# Release Ticket: REQ-123
EOF
git add compliance/pending-releases
git commit -q --amend --no-edit
run_validator
assert_exit "single active pending release exits 0" 0
assert_grep "warning emitted for missing REQ with one active release" 'WARNING .*one active tracked release \(REQ-123\)' 1
assert_grep "no hard error for missing requirement" "ERROR .*implementation commit but cites no requirement" 0

# Case 2: ambiguous pending release context keeps the missing-REQ path as
# a hard error.
echo "Case 2: two active pending releases keep missing REQ as hard error"
make_fixture "$WORKDIR/case2" "feat: implement kitchen workflow" "Co-Authored-By: Test <test@example.com>"
mkdir -p compliance/pending-releases
cat > compliance/pending-releases/RELEASE-TICKET-REQ-123.md <<'EOF'
# Release Ticket: REQ-123
EOF
cat > compliance/pending-releases/RELEASE-TICKET-REQ-124.md <<'EOF'
# Release Ticket: REQ-124
EOF
git add compliance/pending-releases
git commit -q --amend --no-edit
run_validator
assert_exit "ambiguous pending releases exits 1" 1
assert_grep "hard error emitted when active context is ambiguous" "ERROR .*implementation commit but cites no requirement" 1

# Case 3: no pending ticket, but exactly one active RTM row in the
# accepted statuses also downgrades to a warning.
echo "Case 3: RTM fallback with one active row downgrades missing REQ to warning"
make_fixture "$WORKDIR/case3" "fix: recover already-merged history" "Co-Authored-By: Test <test@example.com>"
mkdir -p compliance
cat > compliance/RTM.md <<'EOF'
# RTM
| REQ-ID  | Title | Status                    |
| ------- | ----- | ------------------------- |
| REQ-200 | Done  | APPROVED - DEPLOYED       |
| REQ-201 | Live  | TESTED - PENDING SIGN-OFF |
EOF
git add compliance/RTM.md
git commit -q --amend --no-edit
run_validator
assert_exit "single active RTM row exits 0" 0
assert_grep "warning emitted for RTM fallback context" 'WARNING .*one active tracked release \(REQ-201\)' 1
assert_grep "no hard error under single RTM fallback context" "ERROR .*implementation commit but cites no requirement" 0

# Case 4: zero active context remains a hard error.
echo "Case 4: no active release context keeps missing REQ as hard error"
make_fixture "$WORKDIR/case4" "perf: tune kitchen workflow" "Co-Authored-By: Test <test@example.com>"
run_validator
assert_exit "no active context exits 1" 1
assert_grep "hard error emitted without any active release context" "ERROR .*implementation commit but cites no requirement" 1

# Case 5: leading REQ prefix is accepted before the Conventional Commit type.
echo "Case 5: leading REQ prefix before type is accepted"
make_fixture "$WORKDIR/case5" "[REQ-123] fix(reports): map dynamic category reports" "Co-Authored-By: Test <test@example.com>"
run_validator
assert_exit "leading REQ prefix exits 0" 0
assert_grep "no conventional-commit error for leading REQ prefix" "Not Conventional Commits format" 0
assert_grep "no missing-requirement error for leading REQ prefix" "implementation commit but cites no requirement" 0

# Case 6: malformed leading REQ prefixes remain invalid.
echo "Case 6: malformed leading REQ prefix is rejected"
make_fixture "$WORKDIR/case6" "[REQ-12] fix: invalid short req prefix" "Co-Authored-By: Test <test@example.com>"
run_validator
assert_exit "malformed leading REQ prefix exits 1" 1
assert_grep "malformed prefix is not treated as conventional" "Not Conventional Commits format" 1

# Case 7: an exempt-typed commit touching configured source_dirs gets a
# visible warning (not a hard error) — devaudit-installer#768.
echo "Case 7: exempt type touching source_dirs is warned, not blocked"
rm -rf "$WORKDIR/case7"
mkdir -p "$WORKDIR/case7"
cd "$WORKDIR/case7"
git init -q --initial-branch=main
git config user.email "test@example.com"
git config user.name "test"
echo '{"source_dirs": "app/ lib/"}' > sdlc-config.json
git add sdlc-config.json
git commit -q -m "chore: base"
git checkout -q -b feature
mkdir -p app
echo "real feature code" > app/feature.ts
git add app/feature.ts
git commit -q -m "chore: sneak in a feature" -m "Co-Authored-By: Test <test@example.com>"
run_validator
assert_exit "exempt type touching source_dirs still exits 0" 0
assert_grep "warning emitted for exempt type touching source_dirs" "WARNING .*'chore' \(exempt from REQ tracking\) touches configured source_dirs" 1
assert_grep "flagged file path appears in the warning" "app/feature.ts" 1

# Case 8: an exempt-typed commit that stays outside source_dirs gets no
# warning at all.
echo "Case 8: exempt type outside source_dirs is silent"
rm -rf "$WORKDIR/case8"
mkdir -p "$WORKDIR/case8"
cd "$WORKDIR/case8"
git init -q --initial-branch=main
git config user.email "test@example.com"
git config user.name "test"
echo '{"source_dirs": "app/ lib/"}' > sdlc-config.json
git add sdlc-config.json
git commit -q -m "chore: base"
git checkout -q -b feature
echo "workflow tweak" > .github-workflow-note.txt
git add .github-workflow-note.txt
git commit -q -m "ci: tweak workflow" -m "Co-Authored-By: Test <test@example.com>"
run_validator
assert_exit "exempt type outside source_dirs exits 0" 0
assert_grep "no warning for exempt type outside source_dirs" "exempt from REQ tracking" 0

# Case 9: `style:` is a standard Conventional Commits type and must be
# accepted + treated as exempt from REQ tracking — devaudit-installer#813.
echo "Case 9: style: commit is accepted and exempt from REQ tracking"
make_fixture "$WORKDIR/case9" "style: reformat kitchen workflow" "Co-Authored-By: Test <test@example.com>"
run_validator
assert_exit "style: commit exits 0" 0
assert_grep "no conventional-commit error for style:" "Not Conventional Commits format" 0
assert_grep "no missing-requirement error for style:" "implementation commit but cites no requirement" 0

# Case 10: a declared bundle (core + co_tracked members + predecessor) is ONE
# active release, so the single-release downgrade applies — devaudit-installer#966.
write_bundle() {
  local core="$1"; shift
  mkdir -p compliance/pending-releases
  local members=""
  for m in "$@"; do
    printf '# Release Ticket: %s\n' "$m" > "compliance/pending-releases/RELEASE-TICKET-${m}.md"
    role="co_tracked"; [ "$m" = "REQ-034" ] && role="predecessor"
    members="${members}{\"version\":\"${m}\",\"role\":\"${role}\"},"
  done
  printf '# Release Ticket: %s\n' "$core" > "compliance/pending-releases/RELEASE-TICKET-${core}.md"
  printf '{"members":[%s{"version":"%s","role":"core"}]}\n' "$members" "$core" \
    > "compliance/pending-releases/BUNDLED-CHANGES-${core}.json"
  printf '# Bundled changes %s\n' "$core" > "compliance/pending-releases/BUNDLED-CHANGES-${core}.md"
  git add compliance/pending-releases
  git commit -q --amend --no-edit
}

echo "Case 10: declared bundle counts as one active release"
make_fixture "$WORKDIR/case10" "feat: untraced history" "Co-Authored-By: Test <test@example.com>"
write_bundle REQ-035 REQ-034 REQ-036 REQ-037 REQ-038
run_validator
assert_exit "declared bundle exits 0" 0
assert_grep "warning names the bundle core as the one active release" 'WARNING .*one active tracked release \(REQ-035\)' 1
assert_grep "no hard error under a declared bundle" "ERROR .*implementation commit but cites no requirement" 0

# Case 11: a bundle plus an unrelated pending release is still two releases.
echo "Case 11: bundle plus an independent release stays ambiguous"
make_fixture "$WORKDIR/case11" "feat: untraced history" "Co-Authored-By: Test <test@example.com>"
write_bundle REQ-035 REQ-034 REQ-036
printf '# Release Ticket: REQ-040\n' > compliance/pending-releases/RELEASE-TICKET-REQ-040.md
git add compliance/pending-releases
git commit -q --amend --no-edit
run_validator
assert_exit "bundle + independent release exits 1" 1
assert_grep "hard error when two releases are active" "ERROR .*implementation commit but cites no requirement" 1

# Case 12: a manifest whose core ticket is not pending is stale and must not
# collapse anything.
echo "Case 12: stale manifest (core ticket not pending) does not collapse tickets"
make_fixture "$WORKDIR/case12" "feat: untraced history" "Co-Authored-By: Test <test@example.com>"
write_bundle REQ-035 REQ-036 REQ-037
rm compliance/pending-releases/RELEASE-TICKET-REQ-035.md
git add -A compliance/pending-releases
git commit -q --amend --no-edit
run_validator
assert_exit "stale manifest leaves two tickets ambiguous" 1

echo
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
