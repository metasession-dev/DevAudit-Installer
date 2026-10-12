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

# 4. usage errors exit 2
if bash "$ROOT/scripts/release-validation.sh" >/dev/null 2>&1; then no "no args is a usage error"; else
  rc=$?; [ "$rc" -eq 2 ] && ok "no args exits 2" || no "no args exits 2 (got $rc)"; fi
if bash "$ROOT/scripts/release-validation.sh" bogus >/dev/null 2>&1; then no "unknown command is a usage error"; else
  rc=$?; [ "$rc" -eq 2 ] && ok "unknown command exits 2" || no "unknown command exits 2 (got $rc)"; fi

echo ""
echo "release-validation.test.sh: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
