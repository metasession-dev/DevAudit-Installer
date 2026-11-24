#!/usr/bin/env bash
# find-tested-run.test.sh — tests for find-tested-run.sh (DevAudit-Installer#1298), with a fake gh and a real git repository.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/find-tested-run.sh"

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

# A repository with one commit; its tree is what the pull request run must have tested.
REPO_DIR="$WORK/repo"
mkdir -p "$REPO_DIR"
(
  cd "$REPO_DIR"
  git init -q -b develop
  git config user.email t@example.com
  git config user.name tester
  echo a > a.txt
  git add a.txt
  git commit -q -m one
)
SHA="$(git -C "$REPO_DIR" rev-parse HEAD)"
TREE="$(git -C "$REPO_DIR" rev-parse 'HEAD^{tree}')"

# fake gh: `gh api <endpoint> [--jq expr]` prints the fixture for the endpoint (through jq when --jq is given);
# `gh run download <id> -R <repo> -n <name> -D <dir>` copies the fixture directory. A missing fixture, or a
# fixture named *.fail, makes the call fail.
FAKE="$WORK/fake"
BIN="$WORK/bin"
mkdir -p "$BIN"
cat > "$BIN/gh" <<'GH'
#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "run" ] && [ "$2" = "download" ]; then
  dir=""
  while [ $# -gt 0 ]; do [ "$1" = "-D" ] && dir="$2"; shift; done
  [ ! -e "$FAKE/download.fail" ] || exit 1
  [ -d "$FAKE/artifact" ] || exit 1
  mkdir -p "$dir"
  cp -R "$FAKE/artifact/." "$dir/"
  exit 0
fi
[ "$1" = "api" ] || exit 2
endpoint="$2"; shift 2
jqexpr=""
while [ $# -gt 0 ]; do [ "$1" = "--jq" ] && jqexpr="$2"; shift; done
case "$endpoint" in
  repos/*/commits/*/pulls*) file="pulls" ;;
  repos/*/actions/runs/*/artifacts*) file="artifacts" ;;
  repos/*/actions/workflows/*/runs*) file="runs" ;;
  repos/*/actions/runs/*) file="run" ;;
  *) exit 2 ;;
esac
[ ! -e "$FAKE/$file.fail" ] || exit 1
[ -f "$FAKE/$file.json" ] || exit 1
if [ -n "$jqexpr" ]; then jq -r "$jqexpr" "$FAKE/$file.json"; else cat "$FAKE/$file.json"; fi
GH
chmod +x "$BIN/gh"

# Builds the fixtures of a reusable merge, which each case then breaks in one way.
good() {
  rm -rf "$FAKE"; mkdir -p "$FAKE/artifact"
  cat > "$FAKE/pulls.json" <<JSON
[{"number":42,"merged_at":"2026-11-24T10:00:00Z","merge_commit_sha":"$SHA","base":{"ref":"develop","repo":{"full_name":"o/r"}},
  "head":{"sha":"headsha1","repo":{"full_name":"o/r"}},"user":{"login":"alice","type":"User"}}]
JSON
  echo '{"workflow_id":7}' > "$FAKE/run.json"
  cat > "$FAKE/runs.json" <<'JSON'
{"workflow_runs":[
  {"id":100,"event":"pull_request","head_sha":"headsha1","status":"completed","conclusion":"failure","head_repository":{"full_name":"o/r"}},
  {"id":101,"event":"pull_request","head_sha":"headsha1","status":"completed","conclusion":"success","head_repository":{"full_name":"o/r"}}]}
JSON
  cat > "$FAKE/artifacts.json" <<'JSON'
{"artifacts":[
  {"name":"ci-results","expired":false,"workflow_run":{"id":101}},
  {"name":"tested-tree","expired":false,"workflow_run":{"id":101}}]}
JSON
  echo "$TREE" > "$FAKE/artifact/tested-tree.txt"
  echo '{"typescript":"success","sast":"success","dependency_audit":"success","build":"success"}' > "$FAKE/artifact/gate-outcomes.json"
}

run() {
  local out="$WORK/out"
  : > "$out"
  (cd "$REPO_DIR" && FAKE="$FAKE" PATH="$BIN:$PATH" GITHUB_OUTPUT="$out" REPOSITORY=o/r SHA="$SHA" INTEGRATION_BRANCH=develop CURRENT_RUN_ID=999 bash "$HELPER" 2>/dev/null) || echo "exit:$?" >> "$out"
  cat "$out"
}
field() { printf '%s\n' "$1" | sed -n "s/^$2=//p" | head -1; }

echo "find-tested-run.sh"

good
OUT="$(run)"
check "reuses a successful pull request run of an equal tree" "true" "$(field "$OUT" reuse)"
check "names the source run (the latest, not the failed earlier one)" "101" "$(field "$OUT" source_run_id)"
check "names the source pull request" "42" "$(field "$OUT" source_pr)"
check "names the tested tree" "$TREE" "$(field "$OUT" tested_tree)"
check "exits 0" "" "$(printf '%s\n' "$OUT" | sed -n 's/^exit:.*//p')"

expect_no_reuse() {
  local name="$1" fragment="$2" out
  out="$(run)"
  check "$name: no reuse" "false" "$(field "$out" reuse)"
  case "$(field "$out" reason)" in
    *"$fragment"*) check "$name: reason mentions '$fragment'" "ok" "ok" ;;
    *) check "$name: reason mentions '$fragment'" "mentions" "$(field "$out" reason)" ;;
  esac
  check "$name: exit 0" "" "$(printf '%s\n' "$out" | sed -n 's/^exit:.*//p')"
}

good; echo "0000000000000000000000000000000000000000" > "$FAKE/artifact/tested-tree.txt"
expect_no_reuse "a different tree (the branch moved)" "differs"

good; echo '[]' > "$FAKE/pulls.json"
expect_no_reuse "no pull request" "0 pull requests"

good; jq -c '. + .' "$FAKE/pulls.json" > "$FAKE/p2" && mv "$FAKE/p2" "$FAKE/pulls.json"
expect_no_reuse "two pull requests" "2 pull requests"

good; sed -i 's/"merged_at":"2026-11-24T10:00:00Z"/"merged_at":null/' "$FAKE/pulls.json"
expect_no_reuse "a pull request that was not merged" "0 pull requests"

good; sed -i 's/"ref":"develop"/"ref":"release"/' "$FAKE/pulls.json"
expect_no_reuse "a pull request into another branch" "0 pull requests"

good; sed -i 's/"head":{"sha":"headsha1","repo":{"full_name":"o\/r"}}/"head":{"sha":"headsha1","repo":{"full_name":"fork\/r"}}/' "$FAKE/pulls.json"
expect_no_reuse "a fork" "fork"

good; sed -i 's/"head":{"sha":"headsha1","repo":{"full_name":"o\/r"}}/"head":{"sha":"headsha1","repo":null}/' "$FAKE/pulls.json"
expect_no_reuse "a deleted head repository" "fork"

good; sed -i 's/"login":"alice","type":"User"/"login":"dependabot[bot]","type":"Bot"/' "$FAKE/pulls.json"
expect_no_reuse "a Dependabot pull request" "dependabot"

good; sed -i 's/"login":"alice","type":"User"/"login":"some-app","type":"Bot"/' "$FAKE/pulls.json"
expect_no_reuse "another bot" "bot"

good; sed -i 's/"merge_commit_sha":"[0-9a-f]*"/"merge_commit_sha":"deadbeef"/' "$FAKE/pulls.json"
expect_no_reuse "a pull request whose merge commit is another commit" "0 pull requests"

good; sed -i 's/"id":101,\("event":"pull_request","head_sha":"headsha1","status":"completed",\)"conclusion":"success"/"id":101,\1"conclusion":"failure"/' "$FAKE/runs.json"
expect_no_reuse "the latest run failed" "failure"

good; sed -i 's/"status":"completed","conclusion":"success"/"status":"in_progress","conclusion":null/' "$FAKE/runs.json"
expect_no_reuse "the latest run is still running" "in_progress"

good; echo '{"workflow_runs":[]}' > "$FAKE/runs.json"
expect_no_reuse "no pull request run" "no run"

good; sed -i 's/"head_repository":{"full_name":"o\/r"}}\]/"head_repository":{"full_name":"fork\/r"}}]/' "$FAKE/runs.json"
expect_no_reuse "a run from a fork repository" "not from this repository"

good; sed -i 's/"expired":false,"workflow_run":{"id":101}},$/"expired":true,"workflow_run":{"id":101}},/' "$FAKE/artifacts.json"
expect_no_reuse "an expired ci-results artifact" "ci-results"

good; echo '{"artifacts":[{"name":"ci-results","expired":false,"workflow_run":{"id":101}}]}' > "$FAKE/artifacts.json"
expect_no_reuse "no tested-tree artifact" "tested-tree"

good; echo '{"artifacts":[{"name":"ci-results","expired":false,"workflow_run":{"id":55}},{"name":"tested-tree","expired":false,"workflow_run":{"id":55}}]}' > "$FAKE/artifacts.json"
expect_no_reuse "artifacts of another run" "ci-results"

good; rm "$FAKE/artifact/tested-tree.txt"
expect_no_reuse "an unreadable tested-tree.txt" "did not record"

good; : > "$FAKE/artifact/tested-tree.txt"
expect_no_reuse "an empty tested-tree.txt" "empty"

good; echo '{"typescript":"success","sast":"failure","dependency_audit":"success","build":"success"}' > "$FAKE/artifact/gate-outcomes.json"
expect_no_reuse "a gate that is not success" "not every gate"

good; echo '{"typescript":"success","sast":"skipped"}' > "$FAKE/artifact/gate-outcomes.json"
expect_no_reuse "a skipped gate" "not every gate"

good; echo '{}' > "$FAKE/artifact/gate-outcomes.json"
expect_no_reuse "an empty gate-outcomes.json" "not every gate"

good; rm "$FAKE/artifact/gate-outcomes.json"
expect_no_reuse "no gate-outcomes.json" "no gate outcomes"

good; touch "$FAKE/download.fail"
expect_no_reuse "a download failure" "could not be downloaded"

good; touch "$FAKE/pulls.fail"
expect_no_reuse "an API error on the pull requests" "could not be read"

good; touch "$FAKE/run.fail"
expect_no_reuse "an API error on this run" "workflow of this run"

good; touch "$FAKE/runs.fail"
expect_no_reuse "an API error on the runs" "could not be read"

good; touch "$FAKE/artifacts.fail"
expect_no_reuse "an API error on the artifacts" "could not be read"

good; echo 'not json' > "$FAKE/pulls.json"
expect_no_reuse "unparseable pull requests" "could not be parsed"

good
OUT="$( (cd "$REPO_DIR" && FAKE="$FAKE" PATH="$BIN:$PATH" GITHUB_OUTPUT="$WORK/o2" REPOSITORY=o/r SHA="0000000000000000000000000000000000000001" INTEGRATION_BRANCH=develop CURRENT_RUN_ID=999 bash "$HELPER" 2>/dev/null; cat "$WORK/o2") )"
check "a commit that is not in the repository" "false" "$(field "$OUT" reuse)"

OUT="$( (cd "$REPO_DIR" && FAKE="$FAKE" PATH="$BIN:$PATH" GITHUB_OUTPUT="$WORK/o3" REPOSITORY=o/r SHA="$SHA" INTEGRATION_BRANCH="" CURRENT_RUN_ID=999 bash "$HELPER" 2>/dev/null; cat "$WORK/o3") )"
check "a missing input" "false" "$(field "$OUT" reuse)"

echo
echo "Passed: $PASS  Failed: $FAIL"
[ "$FAIL" -eq 0 ]
