#!/usr/bin/env bash
# show-sdlc-config.test.sh - tests for show-sdlc-config.sh (devaudit-installer#1247).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/show-sdlc-config.sh"

PASS=0
FAIL=0
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

ok() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
bad() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

# show <risk> <json> - prints the block; sets RC
show() {
  printf '%s\n' "$2" > "$WORK/cfg.json"
  set +e
  OUT="$(bash "$HELPER" "$1" "$WORK/cfg.json" 2>&1)"
  RC=$?
  set -e
}
has() { if printf '%s\n' "$OUT" | grep -qF -- "$2"; then ok "$1"; else bad "$1 (missing: $2)"; fi; }
hasnt() { if printf '%s\n' "$OUT" | grep -qF -- "$2"; then bad "$1 (found: $2)"; else ok "$1"; fi; }

echo "Case 1: an empty config shows the documented defaults"
show MEDIUM '{}'
[ "$RC" = "0" ] && ok "exits 0" || bad "exits 0 (got $RC)"
has "default approval" 'approval.mode = dual_actor'
has "no E2E gate without e2e_regression_enabled" 'e2e_regression_enabled is off (unset or false)'
hasnt "no gate is claimed" 'the critical tier must pass'
has "pack written at MEDIUM" 'WILL be written for this change'
has "manual by default" 'uat.mode = manual'
hasnt "no post-deploy regression is claimed" 'the full regression runs after a successful production deploy'
hasnt "no warnings" 'WORTH A LOOK'

echo "Case 2: LOW risk does not get the pack under risk, but does under always"
show LOW '{}'
has "not written at LOW" 'not written, because risk is LOW'
show low '{"uat":{"human_pack":"always"}}'
has "always writes it at LOW (risk is case-insensitive)" 'WILL be written for this change'

echo "Case 3: never says what is missing and warns when iso-29119 is declared"
show HIGH '{"uat":{"human_pack":"never"},"compliance_frameworks":["iso-29119"]}'
has "never named" 'NOT written'
has "portal check still applies" "UAT readiness check still looks for a successful UAT cycle"
has "iso-29119 warning" 'uat.human_pack = never with iso-29119 declared'

echo "Case 4: auto with a solo approver warns twice over"
show MEDIUM '{"uat":{"mode":"auto"},"approval":{"mode":"solo_with_gap"},"compliance_frameworks":["soc-2","iso-27001"]}'
has "auto described" 'the agent executes the procedure on the UAT environment'
has "solo described" 'approval.mode = solo_with_gap: you approve'
has "standards warning" 'those standards expect an approver other than the author'
has "auto and solo warning" 'no one independent of the change looks at it'
has "points to doctor" 'devaudit doctor'

echo "Case 4b: auto needs a UAT environment (#1253)"
show MEDIUM '{"uat":{"mode":"auto"}}'
has "no-environment warning" 'uat.mode = auto but uat.enabled is not true'
show MEDIUM '{"uat":{"mode":"auto","enabled":true}}'
hasnt "no warning with an environment" 'uat.mode = auto but uat.enabled is not true'
show MEDIUM '{"uat":{"mode":"auto","human_pack":"never"}}'
hasnt "no warning when the pack is off" 'uat.mode = auto but uat.enabled is not true'

echo "Case 5: false is a value, not an unset key"
show MEDIUM '{"e2e_regression_enabled":false,"post_deploy_full_regression":false}'
has "regression off" 'e2e_regression_enabled is off (unset or false)'
has "no regression after deploy" 'No E2E regression runs'

echo "Case 6: tiers, schedule, terminal status and the custom host"
show MEDIUM '{"e2e_regression_enabled":true,"release_gate_tier":"smoke","scheduled_full_regression":"0 3 * * *","production_review.terminal_status":"released","production_review":{"terminal_status":"released"},"host":"custom","deploy_trigger":"git_tag","release_branch_required_reviews":0}'
has "smoke tier" 'the smoke tier must pass'
has "schedule shown" 'scheduled_full_regression = "0 3 * * *"'
has "terminal status" 'the release completes automatically'
has "custom deploy trigger" 'deploy_trigger = git_tag'
has "zero reviews warned" 'release_branch_required_reviews = 0: the author can merge'

echo "Case 6b: with the regression workflow on, the documented defaults show"
show MEDIUM '{"e2e_regression_enabled":true}'
has "default gate" 'release_gate_tier = critical: the critical tier must pass'
has "post-deploy default" 'post_deploy_full_regression = true'
has "no schedule" 'scheduled_full_regression: none'

echo "Case 6c: an invalid cron expression and an unknown tier are reported as the generator reads them"
show MEDIUM '{"e2e_regression_enabled":true,"scheduled_full_regression":"every day"}'
has "invalid cron" 'not a valid five-field cron expression, so no schedule runs'
hasnt "no schedule is claimed" 'also runs on develop on that schedule'
show MEDIUM '{"e2e_regression_enabled":true,"release_gate_tier":"strict"}'
has "unknown tier falls back" 'the critical tier is used'

echo "Case 7: UAT environment check"
show MEDIUM '{"uat":{"enabled":true,"required_risk_classes":["payment"]}}'
has "enabled with classes" 'changes classed as: payment'

echo "Case 8: usage errors exit 2"
set +e
bash "$HELPER" >/dev/null 2>&1; R1=$?
bash "$HELPER" SEVERE "$WORK/cfg.json" >/dev/null 2>&1; R2=$?
bash "$HELPER" HIGH "$WORK/missing.json" >/dev/null 2>&1; R3=$?
printf 'not json' > "$WORK/bad.json"
bash "$HELPER" HIGH "$WORK/bad.json" >/dev/null 2>&1; R4=$?
set -e
[ "$R1" = "2" ] && ok "no risk" || bad "no risk (got $R1)"
[ "$R2" = "2" ] && ok "bad risk" || bad "bad risk (got $R2)"
[ "$R3" = "2" ] && ok "missing config" || bad "missing config (got $R3)"
[ "$R4" = "2" ] && ok "invalid JSON" || bad "invalid JSON (got $R4)"

echo
echo "=== show-sdlc-config.test.sh: $PASS passed, $FAIL failed ==="
[ "$FAIL" = "0" ]
