#!/usr/bin/env bash
# Contract test for docs/devaudit-release-procedure.md and its two wrappers (devaudit-installer#1091).
# Pins the properties the maintainer decided, so a later edit cannot quietly drop them.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROC="$ROOT/docs/devaudit-release-procedure.md"
CLAUDE_CMD="$ROOT/.claude/commands/release-devaudit.md"
DEVIN_WF="$ROOT/.devin/workflows/devaudit-build-release.md"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok - $1"; }
no() { FAIL=$((FAIL + 1)); echo "not ok - $1"; }
has() { grep -qF -- "$2" "$1"; }

# 1. the files exist
for f in "$PROC" "$CLAUDE_CMD" "$DEVIN_WF"; do
  if [ -f "$f" ]; then ok "exists: ${f#"$ROOT"/}"; else no "missing: ${f#"$ROOT"/}"; fi
done

# 2. both wrappers link to the procedure and carry no procedure steps of their own
if has "$CLAUDE_CMD" "docs/devaudit-release-procedure.md"; then ok "the Claude command links to the procedure"; else no "the Claude command links to the procedure"; fi
if has "$DEVIN_WF" "docs/devaudit-release-procedure.md"; then ok "the Devin workflow links to the procedure"; else no "the Devin workflow links to the procedure"; fi
for f in "$CLAUDE_CMD" "$DEVIN_WF"; do
  if [ "$(wc -l < "$f")" -le 30 ]; then ok "wrapper stays short: ${f#"$ROOT"/}"; else no "wrapper grew past 30 lines: ${f#"$ROOT"/}"; fi
  if grep -qE 'git tag|npm version|npm publish|release-validation\.sh' "$f"; then no "wrapper carries a procedure command: ${f#"$ROOT"/}"; else ok "wrapper carries no procedure command: ${f#"$ROOT"/}"; fi
done

# 3. neither wrapper references the other; /release-devaudit never mentions .devin/
if grep -qi 'devin' "$CLAUDE_CMD"; then no "the Claude command must not reference .devin/"; else ok "the Claude command does not reference .devin/"; fi
if grep -q 'release-devaudit' "$DEVIN_WF"; then no "the Devin workflow must not reference the Claude command"; else ok "the Devin workflow does not reference the Claude command"; fi

# 4. five phases, each with a "Done when" row and both state lines
for phase in "Phase 1: Prepare" "Phase 2: Validate" "Phase 3: Promote" "Phase 4: Publish" "Phase 5: Close out"; do
  has "$PROC" "## $phase" && ok "has $phase" || no "has $phase"
  section="$(awk -v h="## $phase" '$0 == h { f = 1; next } f && /^## / { exit } f' "$PROC")"
  printf '%s\n' "$section" | grep -q '^- \*\*Not onboarded:\*\*' && ok "$phase: Not onboarded line" || no "$phase: Not onboarded line"
  printf '%s\n' "$section" | grep -q '^- \*\*Onboarded:\*\*' && ok "$phase: Onboarded line" || no "$phase: Onboarded line"
done
has "$PROC" ".devaudit/sync-manifest.json" && has "$PROC" ".github/workflows/check-release-approval.yml" \
  && ok "states the onboarded test once" || no "states the onboarded test"

# 5. no portal step in the not-onboarded state: "portal" appears only on Onboarded lines
bad="$(grep -n -i 'portal' "$PROC" | grep -v 'Onboarded:\*\*' || true)"
if [ -z "$bad" ]; then ok "'portal' appears only on Onboarded lines"; else no "'portal' outside an Onboarded line: $bad"; fi

# 6. no local "build all" or "npm test" step; the tagged commit's own runs are checked instead
if grep -qE '^\s*(\(cd [^)]*&& )?npm (test|run build)|npm install --legacy-peer-deps && npm run build' "$PROC"; then no "the procedure contains a local build/test step"; else ok "no local build-all / npm test step"; fi
has "$PROC" 'gh run list --commit "$SHA"' && ok "checks the push runs for the exact tag SHA" || no "checks the push runs for the exact tag SHA"

# 7. tagging: annotated tag on an explicit SHA, confirmation naming version and SHA
has "$PROC" 'git tag -a "v$VERSION"' && ok "annotated tag" || no "annotated tag"
has "$PROC" 'origin/main' && has "$PROC" 'names **both the version and the SHA**' && ok "explicit SHA and a confirmation naming both" || no "explicit SHA / confirmation"
has "$PROC" 'npm version "$VERSION" --no-git-tag-version' && ok "bump with npm version --no-git-tag-version" || no "bump with npm version"

# 8. the 1.10.0 lessons are present
for needle in 'RV_CONSUMERS_FILE=<main checkout>' '--no-consumers' 'rerun it once' 'Never bump the version' 'gh api -X PATCH repos/<owner>/<repo>/pulls/<n>' \
              'Do not open a manual `backmerge/<version>` pull request' 'backmerge/$VERSION' 'Retarget' 'Dependabot' 'never attach'; do
  if grep -qiF -- "$needle" "$PROC"; then ok "mentions: $needle"; else no "missing: $needle"; fi
done

# 9. the validation plan agrees: worktree hint, no-consumers failure, counts-only reporting
PLAN="$ROOT/docs/release-validation-plan.md"
for needle in 'RV_CONSUMERS_FILE=<main checkout>' '--no-consumers' 'never attach it to a public pull request' 'package-contents' 'Hotfix from `main`'; do
  if grep -qiF -- "$needle" "$PLAN"; then ok "plan mentions: $needle"; else no "plan missing: $needle"; fi
done

echo ""
echo "release-procedure-contract.test.sh: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
