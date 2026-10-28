#!/usr/bin/env bash
# Tests for scripts/release-validation.sh safety and reporting helpers
# (docs/release-validation-plan.md). The full gate needs network and consumer
# clones, so only the parts that keep it read-only and its output are tested.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok - $1"; }
no() { FAIL=$((FAIL + 1)); echo "not ok - $1"; }

export WORK_DIR="$TMP/work"
# shellcheck source=release-validation.sh
source "$ROOT/scripts/release-validation.sh"
set +e

# 1. the stub gh passes read-only calls to the real gh and refuses writes
mkdir -p "$TMP/realbin"
printf '#!/usr/bin/env bash\necho "REAL $*"\n' > "$TMP/realbin/gh"; chmod +x "$TMP/realbin/gh"
PATH="$TMP/realbin:$PATH" make_stub_gh
for w in "label create needs-triage --force" "repo edit o/r --default-branch develop" \
         "api -X PATCH repos/o/r" "api repos/o/r -f default_branch=develop" "variable set X --body y" "pr create"; do
  # shellcheck disable=SC2086
  if "$STUB_BIN/gh" $w >/dev/null 2>&1; then no "stub refuses: gh $w"; else ok "stub refuses: gh $w"; fi
done
for r in "repo view --json name" "label list" "api repos/o/r" "auth status"; do
  # shellcheck disable=SC2086
  out=$("$STUB_BIN/gh" $r 2>/dev/null)
  if [ "$out" = "REAL $r" ]; then ok "stub passes read: gh $r"; else no "stub passes read: gh $r ($out)"; fi
done
if grep -q 'BLOCKED gh label create needs-triage --force' "$GH_LOG" && grep -q 'ALLOWED gh label list' "$GH_LOG"; then
  ok "stub logs allowed and blocked calls"; else no "stub logs allowed and blocked calls"; fi

# 2. isolated() puts the stub first and strips portal/GitHub credentials
mkdir -p "$TMP/clone"
out=$(DEVAUDIT_USER_TOKEN=secret-pat DEVAUDIT_API_KEY=secret-key DEVAUDIT_VIEWER_API_KEY=secret-viewer \
      GH_TOKEN=secret-gh GITHUB_TOKEN=secret-gh2 \
      isolated "$TMP/clone" bash -c 'command -v gh; env | grep -E "^(DEVAUDIT_USER_TOKEN|DEVAUDIT_API_KEY|DEVAUDIT_VIEWER_API_KEY|GH_TOKEN|GITHUB_TOKEN)=" || true; echo "root=$DEVAUDIT_INSTALLER_ROOT"')
if printf '%s\n' "$out" | head -1 | grep -q "$STUB_BIN/gh"; then ok "isolated(): stub gh is first on PATH"; else no "isolated(): stub gh is first on PATH ($out)"; fi
if printf '%s' "$out" | grep -q 'secret'; then no "isolated(): credentials stripped"; else ok "isolated(): credentials stripped"; fi
if printf '%s' "$out" | grep -q "root=$ROOT"; then ok "isolated(): DEVAUDIT_INSTALLER_ROOT is the candidate"; else no "isolated(): DEVAUDIT_INSTALLER_ROOT"; fi
if [ "$(isolated "$TMP/clone" pwd)" = "$TMP/clone" ]; then ok "isolated(): runs inside the clone"; else no "isolated(): runs inside the clone"; fi

# 3. record + summarise: TSV, markdown table, exit status
: > "$RESULTS"
record demo check-a PASS "fine" >/dev/null
record demo check-b WARN "pipe | and	tab" >/dev/null
if summarise >/dev/null; then ok "summarise exits 0 with no FAIL"; else no "summarise exits 0 with no FAIL"; fi
if grep -q '^| demo | check-b | WARN | pipe \\| and tab |$' "$WORK_DIR/results.md"; then ok "markdown row escapes pipes and tabs"; else no "markdown row escapes pipes and tabs"; cat "$WORK_DIR/results.md"; fi
record demo check-c FAIL "broken" >/dev/null
if summarise >/dev/null; then no "summarise exits 1 with a FAIL"; else ok "summarise exits 1 with a FAIL"; fi

# 3b. layer 2b: path -> surface mapping, changed-surface detection, scenario completeness
sorted_words() { tr ' ' '\n' | sort | tr '\n' ' ' | sed 's/ $//'; }
got=$(surface_for_path sdlc/files/ci/check-release-approval.yml.template | sorted_words)
if [ "$got" = "approval-gate ci-workflows" ]; then ok "2b: gate template is approval-gate + ci-workflows"; else no "2b: gate template surfaces ($got)"; fi
got=$(surface_for_path cli/src/update/write-managed.ts | sorted_words)
if [ "$got" = "cli-core sync-safety" ]; then ok "2b: write-managed.ts is sync-safety + cli-core"; else no "2b: write-managed surfaces ($got)"; fi
if [ -z "$(surface_for_path docs/SRS.md)" ]; then ok "2b: docs map to no surface"; else no "2b: docs mapped to a surface"; fi

mkdir -p "$TMP/repo2b" && (
  cd "$TMP/repo2b" && git init -q -b main && git config user.name t && git config user.email t@t
  mkdir -p sdlc/files/ci cli/src/update sdlc/files/weird docs
  echo a > README.md && git add -A && git commit -q -m base && git tag v0.0.1
  echo b > sdlc/files/ci/ci.yml.template; echo c > cli/src/update/write-managed.ts
  echo d > docs/x.md; echo e > sdlc/files/weird/unknown.txt
  git add -A && git commit -q -m change
)
out=$(ROOT="$TMP/repo2b" changed_surfaces v0.0.1)
if printf '%s\n' "$out" | grep -qP '^ci-workflows\t1$' && printf '%s\n' "$out" | grep -qP '^sync-safety\t1$' \
   && printf '%s\n' "$out" | grep -qP '^cli-core\t1$' && printf '%s\n' "$out" | grep -q 'unclassified.*sdlc/files/weird/unknown.txt' \
   && ! printf '%s\n' "$out" | grep -q 'docs/x.md'; then
  ok "2b: changed surfaces counted; stray shipped path reported; docs ignored"
else no "2b: changed_surfaces output: $(printf '%s' "$out" | tr '\n' '|')"; fi

missing=""
while IFS=$'\t' read -r name _; do
  case "$name" in ''|'#'*) continue ;; esac
  declare -F "scenario_${name//-/_}" >/dev/null || missing="$missing $name"
done < "$ROOT/scripts/release-validation/surfaces.tsv"
if [ -z "$missing" ]; then ok "2b: every surface in surfaces.tsv has a scenario"; else no "2b: surfaces without a scenario:$missing"; fi

# 4. usage errors exit 2
if bash "$ROOT/scripts/release-validation.sh" >/dev/null 2>&1; then no "no args is a usage error"; else
  rc=$?; [ "$rc" -eq 2 ] && ok "no args exits 2" || no "no args exits 2 (got $rc)"; fi
if bash "$ROOT/scripts/release-validation.sh" bogus >/dev/null 2>&1; then no "unknown command is a usage error"; else
  rc=$?; [ "$rc" -eq 2 ] && ok "unknown command exits 2" || no "unknown command exits 2 (got $rc)"; fi

# 5. devaudit-installer#1091: `all` with the layers replaced by stubs
CALLED=()
L1=FAIL
ensure_build() { :; }
run_layer1() { record installer layer1-demo "$L1" "demo" >/dev/null; CALLED+=(layer1); }
validate_consumer() { CALLED+=("consumer:$1"); }
validate_fixture() { CALLED+=("fixture:$1"); }
run_layer2b() { CALLED+=(layer2b); }

run_all() { # <L1 result> <args...> -> sets RC and CALLED_STR
  L1="$1"; shift
  : > "$RESULTS"; CALLED=()
  main all "$@" >/dev/null 2>&1; RC=$?
  CALLED_STR="${CALLED[*]}"
}

# 5a. C13: no names and no consumers file fails, and says how to fix it (worktree hint)
RV_CONSUMERS_FILE="$TMP/does-not-exist.local"
run_all PASS
if [ "$RC" -eq 1 ] && grep -qP '^installer\tconsumers\tFAIL\t.*RV_CONSUMERS_FILE=<main checkout>' "$RESULTS"; then
  ok "all: no names and no consumers file fails with the worktree hint"; else no "all: no consumers file must fail (rc=$RC): $(cat "$RESULTS")"; fi
if [ "$CALLED_STR" = "layer1 fixture:node fixture:python layer2b" ]; then ok "all: the other layers still run"; else no "all: other layers (got: $CALLED_STR)"; fi

# 5b. --no-consumers is explicit, recorded as SKIP, and not a failure by itself
run_all PASS --no-consumers
if [ "$RC" -eq 0 ] && grep -qP '^installer\tconsumers\tSKIP\t--no-consumers' "$RESULTS"; then ok "all --no-consumers: SKIP row, exit 0"; else no "all --no-consumers (rc=$RC): $(cat "$RESULTS")"; fi

# 5c. C15: a layer-1 FAIL does not stop the consumer layers; everything is reported, exit 1
run_all FAIL alpha beta
if [ "$RC" -eq 1 ] && [ "$CALLED_STR" = "layer1 consumer:alpha consumer:beta fixture:node fixture:python layer2b" ]; then
  ok "all: a layer-1 FAIL still runs every consumer, both fixtures and layer 2b; exit 1"; else no "all after a layer-1 FAIL (rc=$RC, got: $CALLED_STR)"; fi

# 5d. consumers come from RV_CONSUMERS_FILE when no names are given
printf '# comment\nalpha node\nbeta python\n' > "$TMP/consumers.local"
RV_CONSUMERS_FILE="$TMP/consumers.local"
run_all PASS
if [ "$RC" -eq 0 ] && [ "$CALLED_STR" = "layer1 consumer:alpha consumer:beta fixture:node fixture:python layer2b" ]; then
  ok "all: consumers read from RV_CONSUMERS_FILE"; else no "all with RV_CONSUMERS_FILE (rc=$RC, got: $CALLED_STR)"; fi

# 6. C14: failing test names come out of a vitest log (ANSI codes removed) and reach results.md
printf ' \033[41m\033[1m FAIL \033[22m\033[49m test/doctor.test.ts\033[2m > \033[22mdoctor\033[2m > \033[22mruns without crashing\n FAIL  test/update.test.ts > syncProject > emits files\n FAIL  test/update.test.ts > syncProject > emits files\n \033[2m Tests \033[22m \033[31m2 failed\033[39m\n' > "$TMP/vitest.log"
got="$(failing_test_names "$TMP/vitest.log")"
want=$'test/doctor.test.ts > doctor > runs without crashing\ntest/update.test.ts > syncProject > emits files'
if [ "$got" = "$want" ]; then ok "failing_test_names: names listed once each, ANSI removed"; else no "failing_test_names: got '$got'"; fi
: > "$RESULTS"
record installer vitest FAIL "demo" >/dev/null
printf 'vitest: test/doctor.test.ts > doctor > runs without crashing\nshell: x.test.sh\n' > "$FAILING"
summarise >/dev/null 2>&1
if grep -q '^## Failing tests$' "$WORK_DIR/results.md" && grep -q '^- vitest: test/doctor.test.ts > doctor > runs without crashing$' "$WORK_DIR/results.md" && grep -q '^- shell: x.test.sh$' "$WORK_DIR/results.md"; then
  ok "results.md lists the failing tests"; else no "results.md failing-tests section"; cat "$WORK_DIR/results.md"; fi
: > "$FAILING"

# 7. C16: the bundling tool is a classified surface
got=$(surface_for_path cli/tools/bundle-templates.mjs | sorted_words)
if [ "$got" = "cli-core" ]; then ok "2b: cli/tools/bundle-templates.mjs is cli-core"; else no "2b: bundle-templates.mjs surfaces ($got)"; fi

echo ""
echo "release-validation.test.sh: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
