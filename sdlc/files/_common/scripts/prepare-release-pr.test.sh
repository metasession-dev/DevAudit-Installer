#!/usr/bin/env bash
# prepare-release-pr.test.sh — tests for prepare-release-pr.sh (DevAudit-Installer#1283, #1288).
#
# Runs the real script against a throwaway git repository with a real origin and a fake `gh` that
# records what it was asked to do: the title and summary of a declared-bundle release PR name the
# co-tracked REQs, and a bundle manifest that omits commits merged after it was generated is refused.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
PASS=0
FAIL=0

check() {
  local desc="$1" cond="$2"
  if eval "$cond"; then echo "  PASS: $desc"; PASS=$((PASS + 1)); else echo "  FAIL: $desc"; FAIL=$((FAIL + 1)); fi
}

# make_repo <dir> <bundle|plain>: develop is one REQ commit ahead of main; for a bundle, its manifest is generated.
make_repo() {
  local dir="$1" kind="$2"
  rm -rf "$dir" "$dir.git"
  git init -q --bare --initial-branch=main "$dir.git"
  mkdir -p "$dir/scripts" "$dir/bin" "$dir/compliance/pending-releases"
  (
    cd "$dir"
    git init -q --initial-branch=main
    git config user.email t@example.com
    git config user.name t
    git remote add origin "$dir.git"
    cp "$SCRIPT_DIR/prepare-release-pr.sh" "$SCRIPT_DIR/derive-release-version.sh" "$SCRIPT_DIR/extract-release-metadata.sh" "$SCRIPT_DIR/generate-bundled-changes.sh" scripts/
    cp "$SCRIPT_DIR/list-reqs-in-range.sh" "$SCRIPT_DIR/is-deferred-ticket.sh" scripts/ 2>/dev/null || true
    chmod +x scripts/*.sh
    printf '{"integration_branch":"develop","release_branch":"main"}\n' > sdlc-config.json
    git add -A && git commit -q -m "chore: scaffold"
    git push -q origin main
    git checkout -q -b develop
    cat > compliance/pending-releases/RELEASE-TICKET-REQ-121.md <<'TICKET'
# Release Ticket — REQ-121

**Requirement:** REQ-121 — One-page checkout

## Summary
Customers check out on one page.

- **Absorbed predecessor releases:** None
TICKET
    echo feature > feature.txt
    git add -A && git commit -q -m "feat: one-page checkout [REQ-121]"
    if [ "$kind" = bundle ]; then
      echo member > member.txt
      git add -A && git commit -q -m "feat: payment step [REQ-122]"
      git commit -q --allow-empty -m "chore: first housekeeping"
      bash scripts/generate-bundled-changes.sh origin/main REQ-121 --declared-bundle REQ-122 --json-out compliance/pending-releases/BUNDLED-CHANGES-REQ-121.json > compliance/pending-releases/BUNDLED-CHANGES-REQ-121.md 2>/dev/null
      git add -A && git commit -q -m "docs(compliance): bundle manifest [REQ-121]"
    fi
    git push -q origin develop
  )
}

# A fake gh: `pr list` answers from $WORK/prs.json; everything else is recorded in $dir/gh.log.
install_gh() {
  local dir="$1" prs="$2"
  printf '%s\n' "$prs" > "$dir/prs.json"
  cat > "$dir/bin/gh" <<EOF
#!/usr/bin/env bash
if [ "\$1 \$2" = "pr list" ]; then cat "$dir/prs.json"; exit 0; fi
printf '%s\n' "\$*" >> "$dir/gh.log"
exit 0
EOF
  chmod +x "$dir/bin/gh"
  : > "$dir/gh.log"
}

run_prepare() { # <dir> [args]: output in $OUT, exit code in $RC
  local dir="$1"; shift
  OUT=$(cd "$dir" && PATH="$dir/bin:$PATH" bash scripts/prepare-release-pr.sh "$@" 2>&1); RC=$?
}

echo "=== prepare-release-pr.sh tests ==="

echo "--- a declared bundle: the title and the summary name the co-tracked REQs ---"
D="$WORK/bundle"; make_repo "$D" bundle; install_gh "$D" '[]'
run_prepare "$D"
check "dry run exits 0" "[ $RC -eq 0 ]"
check "dry run would create a title that names the co-tracked REQ" "echo \"\$OUT\" | grep -q \"titled 'Release: REQ-121 — One-page checkout + REQ-122'\""
run_prepare "$D" --apply
check "create exits 0" "[ $RC -eq 0 ]"
check "the created PR title ends with + REQ-122" "grep -q -- '--title Release: REQ-121 — One-page checkout + REQ-122' '$D/gh.log'"
check "the created PR body has a Co-tracked line" "grep -q 'Co-tracked: REQ-122' '$D/gh.log'"
check "the bundled marker is still in the body (the drift check keeps working)" "grep -q 'BUNDLED-CHANGES-REQ-121.md' '$D/gh.log'"

echo "--- an open PR without the co-tracked REQ is stale and is updated ---"
install_gh "$D" '[{"number":7,"title":"Release: REQ-121 — One-page checkout","body":"Release: REQ-121\nBUNDLED-CHANGES-REQ-121.md","url":"https://example.test/pull/7"}]'
run_prepare "$D"
check "dry run says it is stale" "echo \"\$OUT\" | grep -q 'is stale for current release REQ-121'"
run_prepare "$D" --apply
check "the PR title is rewritten with the co-tracked REQ" "grep -q 'pr edit 7 --title Release: REQ-121 — One-page checkout + REQ-122' '$D/gh.log'"

echo "--- an open PR that already names it is current ---"
install_gh "$D" '[{"number":7,"title":"Release: REQ-121 — One-page checkout + REQ-122","body":"Release: REQ-121\nCo-tracked: REQ-122\nBUNDLED-CHANGES-REQ-121.md","url":"https://example.test/pull/7"}]'
run_prepare "$D"
check "reported as already matching" "echo \"\$OUT\" | grep -q 'already matches REQ-121'"
check "nothing is edited" "[ ! -s '$D/gh.log' ]"

echo "--- a chore merged after the manifest was generated: refused, naming it and the fix ---"
(cd "$D" && git commit -q --allow-empty -m "chore: e2e shard count and job ceiling" && git push -q origin develop)
install_gh "$D" '[{"number":7,"title":"Release: REQ-121 — One-page checkout + REQ-122","body":"Release: REQ-121\nCo-tracked: REQ-122\nBUNDLED-CHANGES-REQ-121.md","url":"https://example.test/pull/7"}]'
run_prepare "$D"
check "exits 1 in a dry run" "[ $RC -eq 1 ]"
check "says the manifest is stale" "echo \"\$OUT\" | grep -q 'is stale for REQ-121'"
check "names the commit that is missing" "echo \"\$OUT\" | grep -q 'chore: e2e shard count and job ceiling'"
check "gives the regeneration command" "echo \"\$OUT\" | grep -q 'Regenerate it: bash scripts/generate-bundled-changes.sh origin/main REQ-121 --declared-bundle REQ-122'"
check "does not call it current" "! echo \"\$OUT\" | grep -q 'already matches'"
run_prepare "$D" --apply
check "exits 1 with --apply too" "[ $RC -eq 1 ]"
check "and touches no PR" "[ ! -s '$D/gh.log' ]"

echo "--- regenerating the manifest (and committing it with no REQ ref) makes it current again ---"
(
  cd "$D"
  bash scripts/generate-bundled-changes.sh origin/main REQ-121 --declared-bundle REQ-122 --json-out compliance/pending-releases/BUNDLED-CHANGES-REQ-121.json > compliance/pending-releases/BUNDLED-CHANGES-REQ-121.md 2>/dev/null
  git add compliance && git commit -q -m "docs: regenerate the bundle manifest" && git push -q origin develop
)
run_prepare "$D"
check "reported as already matching" "echo \"\$OUT\" | grep -q 'already matches REQ-121'"

echo "--- a release with no bundle is unchanged ---"
P="$WORK/plain"; make_repo "$P" plain; install_gh "$P" '[]'
run_prepare "$P" --apply
check "create exits 0" "[ $RC -eq 0 ]"
check "title has no co-tracked suffix" "grep -q -- '--title Release: REQ-121 — One-page checkout --body' '$P/gh.log'"
check "body has no Co-tracked line" "! grep -q 'Co-tracked' '$P/gh.log'"

echo ""
echo "=== prepare-release-pr.test.sh: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
