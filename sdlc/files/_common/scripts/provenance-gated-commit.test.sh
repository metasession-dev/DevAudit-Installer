#!/usr/bin/env bash
# provenance-gated-commit.test.sh — tests for provenance-gated-commit.sh (#971).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/provenance-gated-commit.sh"

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

IGNORE="      - 'compliance/**'
      - '*.md'
      - 'SDLC/**'
      - 'docs/**/*.txt'
      - 'sdlc-config.json'"

new_repo() {
  local dir="$WORK/$1"
  rm -rf "$dir"; mkdir -p "$dir"
  (
    cd "$dir"
    git init -q -b main
    git config user.email t@example.com
    git config user.name tester
    echo base > README.md
    git add -A && git commit -q -m base
    git checkout -q -b develop
  )
  echo "$dir"
}

commit_file() { # dir path
  mkdir -p "$(dirname "$1/$2")"
  echo "$RANDOM" >> "$1/$2"
  git -C "$1" add -A && git -C "$1" commit -q -m "change $2"
}

gated() { # dir
  (cd "$1" && PATHS_IGNORE="$IGNORE" bash "$HELPER" gated-commit main "$(git rev-parse HEAD)")
}

echo "provenance-gated-commit.sh: gated-commit"

d=$(new_repo allcode)
commit_file "$d" src/a.ts
commit_file "$d" src/b.ts
check "all-code range: head is the gated commit" "$(git -C "$d" rev-parse HEAD) code" "$(gated "$d")"

d=$(new_repo example-platform)
commit_file "$d" src/service.ts
CODE=$(git -C "$d" rev-parse HEAD)
commit_file "$d" compliance/evidence/pack.json
commit_file "$d" compliance/RTM.md
check "docs-only head over code merge: gated is the code commit (example-platform #153/#157)" "$CODE code" "$(gated "$d")"

d=$(new_repo alldocs)
commit_file "$d" compliance/a.json
commit_file "$d" notes.md
check "all-docs range: head, docs-only" "$(git -C "$d" rev-parse HEAD) docs-only" "$(gated "$d")"

d=$(new_repo glob)
commit_file "$d" docs/guide/readme.txt
commit_file "$d" docs/api.md
# docs/**/*.txt matches the txt; *.md only matches at the root, so docs/api.md is code
check "glob: '*.md' does not match nested md; nested md counts as code" "$(git -C "$d" rev-parse HEAD) code" "$(gated "$d")"
commit_file "$d" docs/guide/more.txt
check "glob: 'docs/**/*.txt' is ignored (gated stays on docs/api.md commit)" "$(git -C "$d" rev-parse HEAD~1) code" "$(gated "$d")"

d=$(new_repo mixed)
commit_file "$d" src/a.ts
mkdir -p "$d/compliance"
echo x > "$d/compliance/x.json"
echo y >> "$d/CHANGELOG.md"
git -C "$d" add -A && git -C "$d" commit -q -m "docs plus changelog"
check "commit with docs files only (compliance + root md) is not code-bearing" "$(git -C "$d" rev-parse HEAD~1) code" "$(gated "$d")"

d=$(new_repo workflow)
commit_file "$d" src/a.ts
commit_file "$d" .github/workflows/ci.yml
check "a workflow-only commit is code even when a pattern covers it (#1335)" "$(git -C "$d" rev-parse HEAD) code" "$(cd "$d" && PATHS_IGNORE="$IGNORE
      - '.github/**'" bash "$HELPER" gated-commit main "$(git rev-parse HEAD)")"

echo "provenance-gated-commit.sh: real-ci-success (stub gh)"

STUB="$WORK/bin"; mkdir -p "$STUB"
if ! command -v jq >/dev/null 2>&1; then
  echo "  - jq not available; skipping real-ci-success cases"
else
  cat > "$STUB/gh" <<'STUBEOF'
#!/usr/bin/env bash
url="$2"; expr=""
[ "${3:-}" = "--jq" ] && expr="$4"
case "$url" in
  */check-runs*) f="$FIXTURE_DIR/check-runs.json" ;;
  */actions/runs/*) f="$FIXTURE_DIR/run-${url##*/}.json" ;;
esac
if [ -n "$expr" ]; then jq -r "$expr" "$f"; else cat "$f"; fi
STUBEOF
  chmod +x "$STUB/gh"

  fx="$WORK/fx"; mkdir -p "$fx"
  run_helper() { PATH="$STUB:$PATH" FIXTURE_DIR="$fx" REPO=o/r bash "$HELPER" "$@" >/dev/null 2>&1 && echo ok || echo fail; }
  cr() { # id url conclusion
    printf '{"name":"Quality Gates","status":"completed","conclusion":"%s","details_url":"https://github.com/o/r/actions/runs/%s/job/9"}' "$3" "$1"
  }
  echo '{"path":".github/workflows/ci.yml","event":"push"}' > "$fx/run-100.json"
  echo '{"path":".github/workflows/ci-status-fallback.yml","event":"push"}' > "$fx/run-200.json"
  echo '{"path":".github/workflows/quality-gates-provenance.yml","event":"pull_request"}' > "$fx/run-300.json"
  # DevAudit-Installer#1335 — a release-PR run of ci.yml itself, and a manual ci.yml run.
  echo '{"path":".github/workflows/ci.yml","event":"pull_request"}' > "$fx/run-400.json"
  echo '{"path":".github/workflows/ci.yml","event":"workflow_dispatch"}' > "$fx/run-500.json"
  echo '{"path":".github/workflows/ci-api.yml","event":"push"}' > "$fx/run-600.json"

  echo "{\"check_runs\":[$(cr 100 x success)]}" > "$fx/check-runs.json"
  check "real ci.yml success counts" ok "$(run_helper real-ci-success abc 999)"

  echo "{\"check_runs\":[$(cr 200 x success)]}" > "$fx/check-runs.json"
  check "gated commit with only a fallback success fails" fail "$(run_helper real-ci-success abc 999)"
  check "any-success accepts the fallback (all-docs range)" ok "$(run_helper any-success abc 999)"

  echo "{\"check_runs\":[$(cr 300 x success)]}" > "$fx/check-runs.json"
  check "provenance workflow's own success does not count" fail "$(run_helper real-ci-success abc 999)"

  echo "{\"check_runs\":[$(cr 100 x skipped)]}" > "$fx/check-runs.json"
  check "skipped ci.yml job does not count" fail "$(run_helper real-ci-success abc 999)"

  echo "{\"check_runs\":[$(cr 100 x failure)]}" > "$fx/check-runs.json"
  check "failed ci.yml job does not count" fail "$(run_helper real-ci-success abc 999)"

  echo "{\"check_runs\":[$(cr 100 x success)]}" > "$fx/check-runs.json"
  check "current run is excluded" fail "$(run_helper real-ci-success abc 100)"

  echo "{\"check_runs\":[$(cr 200 x success),$(cr 100 x success)]}" > "$fx/check-runs.json"
  check "fallback plus real ci.yml success passes" ok "$(run_helper real-ci-success abc 999)"

  # DevAudit-Installer#1335 — only push and workflow_dispatch runs count, in both modes.
  echo "{\"check_runs\":[$(cr 400 x success)]}" > "$fx/check-runs.json"
  check "a pull_request run of ci.yml does not count (no self-certification)" fail "$(run_helper real-ci-success abc 999)"
  check "any-success does not accept a pull_request run either" fail "$(run_helper any-success abc 999)"
  echo "{\"check_runs\":[$(cr 500 x success)]}" > "$fx/check-runs.json"
  check "a workflow_dispatch run of ci.yml counts" ok "$(run_helper real-ci-success abc 999)"
  echo "{\"check_runs\":[$(cr 300 x success)]}" > "$fx/check-runs.json"
  check "any-success does not accept the old provenance workflow's pull_request run" fail "$(run_helper any-success abc 999)"

  # The CI workflow path comes from WORKFLOW_REF (multi-target ci-<target>.yml); CI_WORKFLOW_PATH overrides it.
  echo "{\"check_runs\":[$(cr 600 x success)]}" > "$fx/check-runs.json"
  check "the default path is ci.yml, so ci-api.yml does not count" fail "$(run_helper real-ci-success abc 999)"
  check "WORKFLOW_REF selects ci-api.yml" ok "$(WORKFLOW_REF='o/r/.github/workflows/ci-api.yml@refs/pull/7/merge' run_helper real-ci-success abc 999)"
  check "CI_WORKFLOW_PATH overrides WORKFLOW_REF" fail "$(CI_WORKFLOW_PATH=.github/workflows/ci.yml WORKFLOW_REF='o/r/.github/workflows/ci-api.yml@refs/heads/x' run_helper real-ci-success abc 999)"
fi

echo
echo "provenance-gated-commit.sh: pr-docs-only (DevAudit-Installer#1290)"

classify() { # file list on standard input
  PATHS_IGNORE="$IGNORE" bash "$HELPER" pr-docs-only
}

check "only ignored paths: docs-only" "docs-only" "$(printf 'compliance/RTM.md\nSDLC/1-plan.md\nsdlc-config.json\nREADME.md\n' | classify)"
check "one code file among docs: code" "code" "$(printf 'compliance/RTM.md\nsrc/app.ts\n' | classify)"
check "a nested .md is not covered by *.md (a root-only glob)" "code" "$(printf 'docs/guide.md\n' | classify)"
check "a ** pattern with a suffix matches nested files" "docs-only" "$(printf 'docs/a/b/notes.txt\n' | classify)"
check "an empty list fails safe: code" "code" "$(printf '' | classify)"
check "a single file: docs-only" "docs-only" "$(printf 'compliance/x.json\n' | classify)"
check "a negated pattern re-includes a path" "code" "$(printf 'compliance/keep.json\n' | PATHS_IGNORE="      - 'compliance/**'
      - '!compliance/keep.json'" bash "$HELPER" pr-docs-only)"
check "the files API limit (3000) fails safe: code" "code" "$(for i in $(seq 1 3000); do echo "compliance/f$i.md"; done | classify)"
check "just under the limit is classified normally" "docs-only" "$(for i in $(seq 1 2999); do echo "compliance/f$i.md"; done | classify)"
check "an empty PATHS_IGNORE ignores nothing: code" "code" "$(printf 'compliance/x.json\n' | PATHS_IGNORE='' bash "$HELPER" pr-docs-only)"
check "a workflow file is code even when a pattern covers it (#1299)" "code" "$(printf 'compliance/x.json\n.github/workflows/ci.yml\n' | PATHS_IGNORE="      - 'compliance/**'
      - '.github/**'" bash "$HELPER" pr-docs-only)"
check "a file elsewhere under .github is still classified by the patterns" "docs-only" "$(printf '.github/ISSUE_TEMPLATE/bug.md\n' | PATHS_IGNORE="      - '.github/**'" bash "$HELPER" pr-docs-only)"
check "extra arguments are a usage error" "2" "$(printf 'a\n' | bash "$HELPER" pr-docs-only extra >/dev/null 2>&1; echo $?)"

# DevAudit-Installer#1335 — the event and the path decide which `Quality Gates` successes count; the opt-in reuse name
# (#1298) is still read until the generated workflows stop sending it.
GHBIN="$WORK/ghbin"
mkdir -p "$GHBIN"
cat > "$GHBIN/gh" <<'GH'
#!/usr/bin/env bash
endpoint="$2"; shift 2
jqexpr=""
while [ $# -gt 0 ]; do [ "$1" = "--jq" ] && jqexpr="$2"; shift; done
case "$endpoint" in
  /repos/*/commits/*/check-runs*) jq -r "$jqexpr" "$CHECKS_JSON" ;;
  /repos/*/actions/runs/*) printf '%s\t%s\n' ".github/workflows/${RUN_FILE:-ci.yml}" "${RUN_EVENT:-push}" ;;
  *) exit 2 ;;
esac
GH
chmod +x "$GHBIN/gh"
CHECKS="$WORK/checks.json"
checks() { # name conclusion run_id ...
  local out='{"check_runs":[' first=1
  while [ $# -ge 3 ]; do
    [ "$first" = 1 ] || out="$out,"
    out="$out{\"name\":\"$1\",\"status\":\"completed\",\"conclusion\":\"$2\",\"details_url\":\"https://github.com/o/r/actions/runs/$3/job/1\"}"
    first=0; shift 3
  done
  echo "$out]}" > "$CHECKS"
}
real_ci() { CHECKS_JSON="$CHECKS" PATH="$GHBIN:$PATH" GITHUB_REPOSITORY=o/r "$@" bash "$HELPER" real-ci-success abc123 999 >/dev/null 2>&1; echo $?; }

checks "Quality Gates" success 10
check "a Quality Gates success counts (as before)" "0" "$(real_ci env)"
checks "Quality Gates" skipped 10
check "a skipped Quality Gates does not count" "1" "$(real_ci env)"
checks "Quality Gates" success 999
check "the current run is excluded" "1" "$(real_ci env)"
checks "Quality Gates" success 10
check "a success from another workflow does not count" "1" "$(real_ci env RUN_FILE=other.yml)"
check "a success from a pull_request run does not count" "1" "$(real_ci env RUN_EVENT=pull_request)"
check "a success from a workflow_dispatch run counts" "0" "$(real_ci env RUN_EVENT=workflow_dispatch)"
checks "Quality Gates" skipped 10 "Reused Quality Gates" success 10
check "a skipped heavy job and a reuse success do not count without QG_REUSED_NAME" "1" "$(real_ci env)"
check "the reuse success counts when QG_REUSED_NAME names it (#1298, until WP2)" "0" "$(real_ci env QG_REUSED_NAME='Reused Quality Gates')"
check "a reuse success from a pull_request run does not count" "1" "$(real_ci env QG_REUSED_NAME='Reused Quality Gates' RUN_EVENT=pull_request)"
checks "Quality Gates" skipped 10 "Reused Quality Gates" failure 10
check "a failed reuse job does not count" "1" "$(real_ci env QG_REUSED_NAME='Reused Quality Gates')"
checks "Reused Quality Gates (web)" success 10
check "a namespaced reuse name is selected by QG_REUSED_NAME" "0" "$(real_ci env QG_NAME='Quality Gates (web)' QG_REUSED_NAME='Reused Quality Gates (web)')"
checks "Quality Gates (web)" success 10
check "a namespaced name is selected by QG_NAME" "0" "$(real_ci env QG_NAME='Quality Gates (web)')"

echo
echo "Passed: $PASS  Failed: $FAIL"
[ "$FAIL" -eq 0 ]
