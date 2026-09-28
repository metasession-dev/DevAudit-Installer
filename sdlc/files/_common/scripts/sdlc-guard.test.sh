#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GUARD="$SCRIPT_DIR/sdlc-guard.sh"

PASS=0
FAIL=0

ok() {
  echo "  PASS: $1"
  PASS=$((PASS + 1))
}

no() {
  echo "  FAIL: $1"
  FAIL=$((FAIL + 1))
}

WORK="$(mktemp -d -t sdlc-guard-test-XXXX)"
trap 'rm -rf "$WORK"' EXIT

git -C "$WORK" init -q
git -C "$WORK" config user.email "test@example.com"
git -C "$WORK" config user.name "Test"
git -C "$WORK" commit -q --allow-empty -m "chore: init"

run_guard() {
  local branch="$1"; shift
  git -C "$WORK" checkout -q -B "$branch"
  OUT="$(mktemp)"
  set +e
  ( cd "$WORK" && "$@" bash "$GUARD" ) >"$OUT" 2>&1
  CODE=$?
  set -e
}

# Case 1: housekeeping branch, no sentinel at all -> exempt
rm -f "$WORK/.sdlc-implementer-invoked"
run_guard "chore/whatever"
[ "$CODE" -eq 0 ] && ok "housekeeping branch with no sentinel is exempt" || no "housekeeping branch should be exempt"

# Case 2: tracked branch, no sentinel at all -> blocked
rm -f "$WORK/.sdlc-implementer-invoked"
run_guard "feat/123-thing"
[ "$CODE" -eq 1 ] && grep -q "Manual SDLC execution detected" "$OUT" && ok "tracked branch with no sentinel is blocked" || no "tracked branch with no sentinel should be blocked"

# Case 3: SDLC_IMPLEMENTER_ACTIVE=true overrides everything
rm -f "$WORK/.sdlc-implementer-invoked"
run_guard "feat/123-thing" env SDLC_IMPLEMENTER_ACTIVE=true
[ "$CODE" -eq 0 ] && ok "SDLC_IMPLEMENTER_ACTIVE=true overrides the guard" || no "env override should pass"

# Case 4: tracked branch, sentinel has a freshness record -> pass
cat > "$WORK/.sdlc-implementer-invoked" <<'EOF'
[
  {"freshnessCheckedAt": "2026-09-28T01:00:00.000Z", "freshnessCheckedVersion": "1.6.1", "reqId": "042"},
  {"activatedAt": "2026-09-28T01:05:00.000Z", "currentPhase": "issue", "reqId": "042"}
]
EOF
run_guard "feat/123-thing"
[ "$CODE" -eq 0 ] && ok "tracked branch with a freshness record passes" || no "freshness record present should pass"

# Case 5: tracked branch, sentinel has phase records but NO freshness record,
# and the earliest phase record postdates the enforcement date -> blocked
cat > "$WORK/.sdlc-implementer-invoked" <<'EOF'
[
  {"activatedAt": "2026-09-29T01:05:00.000Z", "currentPhase": "issue", "reqId": "043"}
]
EOF
run_guard "feat/123-thing"
[ "$CODE" -eq 1 ] && grep -q "Freshness check not recorded" "$OUT" && ok "post-enforcement REQ with no freshness record is blocked" || no "post-enforcement REQ missing freshness record should be blocked"

# Case 6: tracked branch, sentinel has phase records but NO freshness record,
# and the earliest phase record predates the enforcement date -> grandfathered
cat > "$WORK/.sdlc-implementer-invoked" <<'EOF'
[
  {"activatedAt": "2026-09-20T01:05:00.000Z", "currentPhase": "issue", "reqId": "044"}
]
EOF
run_guard "feat/123-thing"
[ "$CODE" -eq 0 ] && grep -q "grandfathered" "$OUT" && ok "pre-enforcement REQ with no freshness record is grandfathered" || no "pre-enforcement REQ missing freshness record should be grandfathered"

rm -f "$WORK/.sdlc-implementer-invoked"

echo
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
