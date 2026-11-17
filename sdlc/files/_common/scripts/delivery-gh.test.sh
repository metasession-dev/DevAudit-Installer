#!/usr/bin/env bash
# delivery-gh.test.sh — tests for delivery-gh.sh (DevAudit-Installer#1286).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SHIM="$SCRIPT_DIR/delivery-gh.sh"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
PASS=0
FAIL=0

check() {
  local desc="$1" cond="$2"
  if eval "$cond"; then echo "  PASS: $desc"; PASS=$((PASS + 1)); else echo "  FAIL: $desc"; FAIL=$((FAIL + 1)); fi
}

echo "=== delivery-gh.sh tests ==="

mkdir -p "$WORK/bin"
# A fake real gh: reports the token it was given and its arguments.
cat > "$WORK/real-gh" <<'EOF'
#!/usr/bin/env bash
echo "gh token=${GH_TOKEN:-<none>} args=$*"
EOF
chmod +x "$WORK/real-gh"
# A fake devaudit: answers `delivery github-token` with a token that changes on every call, or fails.
cat > "$WORK/bin/devaudit" <<'EOF'
#!/usr/bin/env bash
[ "$1 $2" = "delivery github-token" ] || { echo "unexpected: $*" >&2; exit 2; }
if [ -n "${FAKE_NO_TOKEN:-}" ]; then echo "no token for the agent" >&2; exit 1; fi
n=$(cat "$FAKE_COUNTER" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$FAKE_COUNTER"
echo "ghs_token_$n"
EOF
chmod +x "$WORK/bin/devaudit"
export FAKE_COUNTER="$WORK/counter"

out=$(PATH="$WORK/bin:$PATH" DEVAUDIT_REAL_GH="$WORK/real-gh" bash "$SHIM" pr create --title x 2>&1); rc=$?
check "runs the real gh with the arguments" "[ $rc -eq 0 ] && echo \"\$out\" | grep -q 'args=pr create --title x'"
check "gives it the token devaudit returned" "echo \"\$out\" | grep -q 'token=ghs_token_1'"

out=$(PATH="$WORK/bin:$PATH" DEVAUDIT_REAL_GH="$WORK/real-gh" bash "$SHIM" api user 2>&1)
check "asks for a current token on every call" "echo \"\$out\" | grep -q 'token=ghs_token_2'"

out=$(PATH="$WORK/bin:$PATH" GH_TOKEN="the-default-token" DEVAUDIT_REAL_GH="$WORK/real-gh" bash "$SHIM" api user 2>&1)
check "ignores a GH_TOKEN already in the environment" "echo \"\$out\" | grep -q 'token=ghs_token_3' && ! echo \"\$out\" | grep -q the-default-token"

out=$(FAKE_NO_TOKEN=1 PATH="$WORK/bin:$PATH" GH_TOKEN="the-default-token" DEVAUDIT_REAL_GH="$WORK/real-gh" bash "$SHIM" pr create 2>&1); rc=$?
check "fails closed when no token can be had" "[ $rc -eq 1 ]"
check "does not run gh, and does not fall back to GH_TOKEN" "! echo \"\$out\" | grep -q 'gh token=' && echo \"\$out\" | grep -q 'not running gh'"

out=$(PATH="$WORK/bin:$PATH" bash "$SHIM" pr list 2>&1); rc=$?
check "refuses without DEVAUDIT_REAL_GH" "[ $rc -eq 1 ] && echo \"\$out\" | grep -q DEVAUDIT_REAL_GH"

echo ""
echo "=== delivery-gh.test.sh: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
