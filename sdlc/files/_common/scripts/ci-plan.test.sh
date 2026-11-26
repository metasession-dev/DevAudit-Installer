#!/usr/bin/env bash
# ci-plan.test.sh — tests for ci-plan.sh (DevAudit-Installer#1335), with real git repositories, the real
# provenance-gated-commit.sh and classify-pr-attribution.sh, and a fake find-tested-run.sh and gh.

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

# The scripts the plan calls, copied so a case can remove one or replace find-tested-run.sh.
SCRIPTS="$WORK/scripts"
fresh_scripts() {
  rm -rf "$SCRIPTS"; mkdir -p "$SCRIPTS"
  cp "$SCRIPT_DIR/ci-plan.sh" "$SCRIPT_DIR/provenance-gated-commit.sh" "$SCRIPT_DIR/classify-pr-attribution.sh" "$SCRIPTS/"
  # fake find-tested-run.sh: writes the fixture's outputs.
  cat > "$SCRIPTS/find-tested-run.sh" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "reuse=${FAKE_REUSE:-false}" "reason=${FAKE_REASON:-fake reason}" >> "$GITHUB_OUTPUT"
if [ "${FAKE_REUSE:-false}" = true ]; then
  printf '%s\n' "source_run_id=101" "source_pr=42" "tested_tree=abc123" >> "$GITHUB_OUTPUT"
fi
SH
}
BIN="$WORK/bin"; mkdir -p "$BIN"
printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/gh"; chmod +x "$BIN/gh"

IGNORE="      - 'SDLC/**'
      - 'compliance/**'
      - 'docs/**'
      - '*.md'
      - '**/*.md'
      - 'sdlc-config.json'"

# An origin with main and develop, and a clone to work in.
ORIGIN="$WORK/origin.git"
REPO="$WORK/repo"
git init -q --bare -b main "$ORIGIN"
git clone -q "$ORIGIN" "$REPO" 2>/dev/null
(
  cd "$REPO"
  git config user.email t@example.com
  git config user.name tester
  git config commit.gpgsign false
  git checkout -q -b main
  echo base > README.md
  mkdir -p src && echo 'export const a = 1;' > src/a.ts
  git add -A && git commit -q -m base
  git push -q origin main
  git checkout -q -b develop
  git push -q origin develop
)

# branch <name> from develop, with one commit per "path:message" argument.
branch() {
  local name="$1"; shift
  (
    cd "$REPO"
    git checkout -q develop
    git branch -D -q "$name" 2>/dev/null || true
    git checkout -q -b "$name"
    local spec path msg
    for spec in "$@"; do
      path="${spec%%:*}"; msg="${spec#*:}"
      mkdir -p "$(dirname "$path")"
      echo "$RANDOM" >> "$path"
      git add -A && git commit -q -m "$msg"
    done
  )
}

# plan [VAR=value ...]: runs ci-plan.sh in the clone and prints its outputs, plus `exit:<n>` when it fails.
plan() {
  local out="$WORK/out" err="$WORK/err"
  : > "$out"
  (cd "$REPO" && env -i PATH="$BIN:$PATH" HOME="$HOME" GITHUB_OUTPUT="$out" PATHS_IGNORE="$IGNORE" \
    INTEGRATION_BRANCH=develop RELEASE_BRANCH=main REPOSITORY=o/r CURRENT_RUN_ID=999 "$@" \
    bash "$SCRIPTS/ci-plan.sh" >/dev/null 2>"$err") || echo "exit:$?" >> "$out"
  cat "$out"
}
field() { printf '%s\n' "$1" | sed -n "s/^$2=//p" | head -1; }
exitcode() { printf '%s\n' "$1" | sed -n 's/^exit://p' | head -1; }
KEYS="mode change run_gates reuse reuse_reason source_run_id source_pr tested_tree run_register run_upload req_id has_tests run_feature run_scope_decision run_release_checks reason"
all_keys() {
  local k
  for k in $KEYS; do printf '%s\n' "$1" | grep -q "^$k=" || { echo "missing:$k"; return; }; done
  echo ok
}
# A pull request run checks out the pull request's branch.
feature_pr() { git -C "$REPO" checkout -q "$1"; plan EVENT_NAME=pull_request BASE_REF=develop HEAD_REF="$1" "${@:2}"; }

fresh_scripts
echo "ci-plan.sh: mode"

branch feat/code "src/b.ts:feat: b"
OUT="$(feature_pr feat/code)"
check "a pull request into the integration branch is feature" "feature" "$(field "$OUT" mode)"
check "every output key is written" "ok" "$(all_keys "$OUT")"

branch hotfix/urgent "src/c.ts:fix: c"
OUT="$(plan EVENT_NAME=pull_request BASE_REF=main HEAD_REF=hotfix/urgent)"
check "hotfix/* into the release branch is hotfix" "hotfix" "$(field "$OUT" mode)"
OUT="$(plan EVENT_NAME=pull_request BASE_REF=main HEAD_REF=fix/hotfix-urgent)"
check "fix/hotfix-* into the release branch is hotfix" "hotfix" "$(field "$OUT" mode)"

(cd "$REPO" && git checkout -q develop)
OUT="$(plan EVENT_NAME=pull_request BASE_REF=main HEAD_REF=develop)"
check "the integration branch into the release branch is release" "release" "$(field "$OUT" mode)"
check "release: the release checks run" "true" "$(field "$OUT" run_release_checks)"
check "release: the gates do not run" "false" "$(field "$OUT" run_gates)"
check "release: every output key is written" "ok" "$(all_keys "$OUT")"

OUT="$(plan EVENT_NAME=pull_request BASE_REF=staging HEAD_REF=x)"
check "a pull request into another branch exits 2" "2" "$(exitcode "$OUT")"
OUT="$(plan EVENT_NAME=push REF_NAME=feature/x)"
check "a push to another branch exits 2" "2" "$(exitcode "$OUT")"
OUT="$(plan EVENT_NAME=schedule)"
check "an unknown event exits 2" "2" "$(exitcode "$OUT")"
check "an unknown event writes an ::error::" "1" "$(grep -c '::error::' "$WORK/err")"

echo "ci-plan.sh: change kind"

branch docs/only "compliance/evidence/REQ-7/notes.md:docs: notes" "docs/guide.txt:docs: guide"
OUT="$(feature_pr docs/only)"
check "a docs-only pull request" "docs-only" "$(field "$OUT" change)"
check "docs-only: the gates do not run" "false" "$(field "$OUT" run_gates)"
check "docs-only: no feature E2E" "false" "$(field "$OUT" run_feature)"
check "docs-only: no scope decision" "false" "$(field "$OUT" run_scope_decision)"
check "docs-only: every output key is written" "ok" "$(all_keys "$OUT")"

OUT="$(feature_pr feat/code)"
check "a code pull request" "code" "$(field "$OUT" change)"
check "code: the gates run" "true" "$(field "$OUT" run_gates)"
check "code: no release registration on a pull request" "false" "$(field "$OUT" run_register)"

branch ci/workflow ".github/workflows/ci.yml:ci: change the workflow"
OUT="$(feature_pr ci/workflow PATHS_IGNORE="$IGNORE
      - '.github/**'")"
check "a pull request that changes only a workflow file is code" "code" "$(field "$OUT" change)"

branch empty/branch
OUT="$(feature_pr empty/branch)"
check "an empty diff is code (fail safe)" "code" "$(field "$OUT" change)"

echo "ci-plan.sh: feature pull requests"

branch feat/tagged "e2e/req7.spec.ts:feat: thing

Ref: REQ-7"
(cd "$REPO" && printf '// @requirement REQ-7\n' > e2e/req7.spec.ts && git add -A && git commit -q -m "test: tag

Ref: REQ-7")
OUT="$(feature_pr feat/tagged)"
check "one trailer REQ with a tagged spec: req_id" "REQ-7" "$(field "$OUT" req_id)"
check "one trailer REQ with a tagged spec: feature E2E runs" "true" "$(field "$OUT" run_feature)"
check "one trailer REQ with a tagged spec: no scope decision" "false" "$(field "$OUT" run_scope_decision)"

branch feat/untagged "src/d.ts:feat: d

Ref: REQ-8"
OUT="$(feature_pr feat/untagged)"
check "an untagged REQ: req_id" "REQ-8" "$(field "$OUT" req_id)"
check "an untagged REQ: no feature E2E" "false" "$(field "$OUT" run_feature)"
check "an untagged REQ: the scope decision runs" "true" "$(field "$OUT" run_scope_decision)"

branch feature/REQ-9-bundle "src/e.ts:feat: e

Ref: REQ-10" "src/f.ts:feat: f

Ref: REQ-11"
OUT="$(feature_pr feature/REQ-9-bundle)"
check "several trailer REQs fall back to the branch name" "REQ-9" "$(field "$OUT" req_id)"

branch feat/two-reqs "src/g.ts:feat: g

Ref: REQ-10" "src/h.ts:feat: h

Ref: REQ-11"
OUT="$(feature_pr feat/two-reqs)"
check "several trailer REQs and no REQ in the branch: none" "none" "$(field "$OUT" req_id)"
check "several trailer REQs and no REQ in the branch: the gates still run" "true" "$(field "$OUT" run_gates)"

branch docs/attribution "docs/howto.md:docs: howto

Ref: REQ-7"
OUT="$(feature_pr docs/attribution PATHS_IGNORE="      - 'nothing/**'")"
check "code for the gates but documentation for attribution: the gates run" "true" "$(field "$OUT" run_gates)"
check "code for the gates but documentation for attribution: req_id none (#1019)" "none" "$(field "$OUT" req_id)"

branch feat/pytest "src/i.py:feat: i

Ref: REQ-12"
(cd "$REPO" && mkdir -p tests && printf '# REQ-12\ndef test_x(): pass\n' > tests/test_i.py && git add -A && git commit -q -m "test: i

Ref: REQ-12")
OUT="$(feature_pr feat/pytest TEST_RUNNER=pytest)"
check "pytest: a test under tests/ naming the REQ counts" "true" "$(field "$OUT" has_tests)"
OUT="$(feature_pr feat/pytest)"
check "playwright: the pytest test does not count" "false" "$(field "$OUT" has_tests)"

echo "ci-plan.sh: merges"

(cd "$REPO" && git checkout -q develop && git merge -q --no-ff feat/code -m "Merge feat/code" && git push -q origin develop)
BEFORE="$(git -C "$REPO" rev-parse HEAD^1)"
AFTER="$(git -C "$REPO" rev-parse HEAD)"
merge() { plan EVENT_NAME=push REF_NAME=develop SHA="$AFTER" BEFORE_SHA="$BEFORE" "$@"; }

OUT="$(merge FAKE_REUSE=true)"
check "a code merge with reuse: mode" "merge" "$(field "$OUT" mode)"
check "a code merge with reuse: the gates do not run" "false" "$(field "$OUT" run_gates)"
check "a code merge with reuse: reuse" "true" "$(field "$OUT" reuse)"
check "a code merge with reuse: source run" "101" "$(field "$OUT" source_run_id)"
check "a code merge with reuse: source pull request" "42" "$(field "$OUT" source_pr)"
check "a code merge with reuse: tested tree" "abc123" "$(field "$OUT" tested_tree)"
check "a code merge with reuse: the release is registered" "true" "$(field "$OUT" run_register)"
check "a code merge with reuse: evidence is uploaded" "true" "$(field "$OUT" run_upload)"
check "a code merge with reuse: every output key is written" "ok" "$(all_keys "$OUT")"

OUT="$(merge FAKE_REUSE=false FAKE_REASON="the merged tree differs")"
check "a code merge without reuse: the gates run" "true" "$(field "$OUT" run_gates)"
check "a code merge without reuse: the reason is kept" "the merged tree differs" "$(field "$OUT" reuse_reason)"

OUT="$(plan EVENT_NAME=push REF_NAME=develop SHA="$AFTER" BEFORE_SHA=0000000000000000000000000000000000000000)"
check "a push with an all-zero previous commit is code" "code" "$(field "$OUT" change)"
check "a push with an all-zero previous commit runs the gates" "true" "$(field "$OUT" run_gates)"
OUT="$(plan EVENT_NAME=push REF_NAME=develop SHA="$AFTER" BEFORE_SHA=1234567890abcdef1234567890abcdef12345678)"
check "a push with an unknown previous commit is code" "code" "$(field "$OUT" change)"

(cd "$REPO" && git merge -q --no-ff docs/only -m "Merge docs/only" && git push -q origin develop)
OUT="$(plan EVENT_NAME=push REF_NAME=develop SHA="$(git -C "$REPO" rev-parse HEAD)" BEFORE_SHA="$(git -C "$REPO" rev-parse HEAD^1)" FAKE_REUSE=true)"
check "a docs-only merge: change" "docs-only" "$(field "$OUT" change)"
check "a docs-only merge: no release registration" "false" "$(field "$OUT" run_register)"
check "a docs-only merge: no upload" "false" "$(field "$OUT" run_upload)"
check "a docs-only merge: no gates" "false" "$(field "$OUT" run_gates)"
check "a docs-only merge: no reuse looked up" "false" "$(field "$OUT" reuse)"

echo "ci-plan.sh: hotfix and manual runs"

branch hotfix/docs "compliance/x.md:docs: x"
OUT="$(plan EVENT_NAME=pull_request BASE_REF=main HEAD_REF=hotfix/docs)"
check "a docs-only hotfix still runs the gates" "true" "$(field "$OUT" run_gates)"

OUT="$(plan EVENT_NAME=workflow_dispatch REF_NAME=develop)"
check "manual on the integration branch: the gates run" "true" "$(field "$OUT" run_gates)"
check "manual on the integration branch: registers the release" "true" "$(field "$OUT" run_register)"
check "manual on the integration branch: uploads evidence" "true" "$(field "$OUT" run_upload)"
check "manual on the integration branch: no reuse" "false" "$(field "$OUT" reuse)"
OUT="$(plan EVENT_NAME=workflow_dispatch REF_NAME=feature/x)"
check "manual elsewhere: the gates run" "true" "$(field "$OUT" run_gates)"
check "manual elsewhere: no release registration" "false" "$(field "$OUT" run_register)"

echo "ci-plan.sh: missing scripts fail loudly (#1331)"

for helper in provenance-gated-commit.sh classify-pr-attribution.sh find-tested-run.sh; do
  fresh_scripts; rm "$SCRIPTS/$helper"
  OUT="$(feature_pr feat/code)"
  check "a missing $helper fails" "1" "$(exitcode "$OUT")"
  check "a missing $helper names it in an ::error::" "1" "$(grep -c "::error::.*$helper" "$WORK/err")"
done
fresh_scripts

echo
echo "Passed: $PASS  Failed: $FAIL"
[ "$FAIL" -eq 0 ]
