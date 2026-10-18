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
  echo '{"path":".github/workflows/ci.yml"}' > "$fx/run-100.json"
  echo '{"path":".github/workflows/ci-status-fallback.yml"}' > "$fx/run-200.json"
  echo '{"path":".github/workflows/quality-gates-provenance.yml"}' > "$fx/run-300.json"

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
fi

echo
echo "Passed: $PASS  Failed: $FAIL"
[ "$FAIL" -eq 0 ]
