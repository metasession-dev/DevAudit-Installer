#!/usr/bin/env bash
# show-sdlc-config.sh - print the "What happens when" block for one change
# (DevAudit-Installer#1247).
#
# sdlc-implementer prints this at the Phase 1 plan approval, before any
# implementation starts, so the operator sees when each activity will take
# place and can change a setting first. It only reads sdlc-config.json; it
# changes nothing and calls no network service.
#
# Usage:
#   bash scripts/show-sdlc-config.sh <LOW|MEDIUM|HIGH|CRITICAL> [path/to/sdlc-config.json]
#
# The risk class is the plan's. Defaults for an unset key are the ones
# `devaudit configure list` documents. Exit 2 on a usage error or when jq or
# the config file is missing.

set -euo pipefail

RISK_RAW="${1:-}"
CONFIG="${2:-${SDLC_CONFIG:-sdlc-config.json}}"

if [ -z "$RISK_RAW" ]; then
  echo "Usage: show-sdlc-config.sh <LOW|MEDIUM|HIGH|CRITICAL> [sdlc-config.json]" >&2
  exit 2
fi
RISK="$(printf '%s' "$RISK_RAW" | tr '[:lower:]' '[:upper:]')"
case "$RISK" in
  LOW|MEDIUM|HIGH|CRITICAL) ;;
  *) echo "show-sdlc-config.sh: risk must be LOW, MEDIUM, HIGH or CRITICAL (got \"$RISK_RAW\")" >&2; exit 2 ;;
esac
if ! command -v jq >/dev/null 2>&1; then
  echo "show-sdlc-config.sh: jq is required" >&2
  exit 2
fi
if [ ! -f "$CONFIG" ]; then
  echo "show-sdlc-config.sh: $CONFIG not found" >&2
  exit 2
fi
if ! jq -e . "$CONFIG" >/dev/null 2>&1; then
  echo "show-sdlc-config.sh: $CONFIG is not valid JSON" >&2
  exit 2
fi

# get <jq path> <default> - the value as text; a boolean false is a value, not "unset".
get() {
  jq -r --arg d "$2" "if ($1) == null then \$d else (($1) | tostring) end" "$CONFIG"
}

APPROVAL="$(get '.approval.mode' dual_actor)"
REVIEWS="$(get '.release_branch_required_reviews' 1)"
E2E_ON="$(get '.e2e_regression_enabled' false)"
GATE="$(get '.release_gate_tier' critical)"
POST_DEPLOY="$(get '.post_deploy_full_regression' true)"
SCHEDULE="$(get '.scheduled_full_regression' '')"
# The generator keeps a schedule only if it has five whitespace-separated fields and no quote
# (scheduledRegressionCron in cli/src/update/ci-templates.ts); anything else means no schedule.
SCHEDULE="$(printf '%s' "$SCHEDULE" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
SCHEDULE_DROPPED=""
if [ -n "$SCHEDULE" ]; then
  if ! printf '%s' "$SCHEDULE" | grep -qE "^[^'\"]+$" \
     || ! printf '%s' "$SCHEDULE" | grep -qE '^[^[:space:]]+([[:space:]]+[^[:space:]]+){4}$'; then
    SCHEDULE_DROPPED="$SCHEDULE"
    SCHEDULE=""
  fi
fi
TERMINAL="$(get '.production_review.terminal_status' prod_review)"
UAT_ENV="$(get '.uat.enabled' false)"
UAT_CLASSES="$(jq -r '(.uat.required_risk_classes // ["payment","destructive_migration","realtime","physical_ux"]) | join(", ")' "$CONFIG")"
PACK="$(get '.uat.human_pack' risk)"
UAT_MODE="$(get '.uat.mode' manual)"
HOST="$(get '.host' '(not set)')"
TRIGGER="$(get '.deploy_trigger' push_to_main)"
INTEGRATION="$(get '.integration_branch' develop)"
RELEASE_BRANCH="$(get '.release_branch' main)"
FRAMEWORKS="$(jq -r '(.compliance_frameworks // []) | join(", ")' "$CONFIG")"
ISOLATION="$(get '.e2e_data_isolation' '(not set)')"

echo "SDLC configuration for this change (risk: $RISK) - what happens when"
echo "Source: $CONFIG. Change a setting with: devaudit configure set <key> <value>"
echo

echo "PLAN AND APPROVALS"
case "$APPROVAL" in
  solo_with_gap)
    echo "- approval.mode = solo_with_gap: you approve your own UAT and production, and the control gap is recorded (a risk-register entry and a solo sign-off on the release ticket)." ;;
  dual_actor)
    echo "- approval.mode = dual_actor: UAT and production are approved by a person other than the release author." ;;
  *)
    echo "- approval.mode = $APPROVAL: not a value DevAudit knows; it is read as dual_actor." ;;
esac
echo "- release_branch_required_reviews = $REVIEWS: approving reviews GitHub requires on the PR into $RELEASE_BRANCH."
echo

echo "AT THE RELEASE PR (into $RELEASE_BRANCH)"
if [ "$E2E_ON" = "false" ]; then
  echo "- e2e_regression_enabled is off (unset or false): no E2E regression workflow exists, so no E2E tier blocks the release PR."
else
  case "$GATE" in
    none)     echo "- release_gate_tier = none: no E2E tier blocks the release PR." ;;
    smoke)    echo "- release_gate_tier = smoke: the smoke tier must pass before the release PR can merge." ;;
    critical) echo "- release_gate_tier = critical: the critical tier must pass before the release PR can merge." ;;
    full)     echo "- release_gate_tier = full: the full E2E pack must pass before the release PR can merge." ;;
    *)        echo "- release_gate_tier = $GATE: not a value DevAudit knows; the critical tier is used." ;;
  esac
fi
echo

echo "AFTER DEPLOY AND ON A SCHEDULE"
if [ "$E2E_ON" = "false" ]; then
  echo "- No E2E regression runs (e2e_regression_enabled is off: unset or false)."
else
  if [ "$POST_DEPLOY" = "false" ]; then
    echo "- post_deploy_full_regression = false: the full regression is not run after a production deploy."
  else
    echo "- post_deploy_full_regression = true: the full regression runs after a successful production deploy."
  fi
  if [ -n "$SCHEDULE" ]; then
    echo "- scheduled_full_regression = \"$SCHEDULE\": the full regression also runs on $INTEGRATION on that schedule (never release evidence, never blocks approval)."
  elif [ -n "$SCHEDULE_DROPPED" ]; then
    echo "- scheduled_full_regression = \"$SCHEDULE_DROPPED\": not a valid five-field cron expression, so no schedule runs."
  else
    echo "- scheduled_full_regression: none."
  fi
fi
if [ "$TERMINAL" = "released" ]; then
  echo "- production_review.terminal_status = released: the release completes automatically after the production evidence."
else
  echo "- production_review.terminal_status = prod_review: a person confirms production after the production evidence."
fi
echo

echo "UAT"
if [ "$UAT_ENV" = "true" ]; then
  echo "- UAT environment check (uat.enabled = true): the agent verifies on the UAT environment for changes classed as: $UAT_CLASSES."
else
  echo "- UAT environment check (uat.enabled = false): skipped; the change is not verified on a deployed UAT environment."
fi
PACK_APPLIES=no
case "$PACK" in
  always) PACK_APPLIES=yes ;;
  never) PACK_APPLIES=no ;;
  *) case "$RISK" in MEDIUM|HIGH|CRITICAL) PACK_APPLIES=yes ;; esac ;;
esac
if [ "$PACK_APPLIES" = "yes" ]; then
  echo "- Human UAT pack (uat.human_pack = $PACK): WILL be written for this change (briefing, procedure, execution record; risk is $RISK). For a bundle it is written once, on the core requirement."
  case "$UAT_MODE" in
    auto) echo "- Who runs it (uat.mode = auto): the agent executes the procedure on the UAT environment and fills the record; a named human who is independent of the author reviews and signs off. The reviewer can require a manual re-run." ;;
    *)    echo "- Who runs it (uat.mode = manual): a tester executes the procedure by hand and completes the record." ;;
  esac
elif [ "$PACK" = "never" ]; then
  echo "- Human UAT pack (uat.human_pack = never): NOT written. No briefing, procedure or execution record exists for this change; the portal's UAT readiness check still looks for a successful UAT cycle."
else
  echo "- Human UAT pack (uat.human_pack = $PACK): not written, because risk is $RISK and the pack applies from MEDIUM."
fi
echo

echo "WHERE IT RUNS"
echo "- host = $HOST; work lands on $INTEGRATION and is promoted to $RELEASE_BRANCH."
if [ "$HOST" = "custom" ]; then
  echo "- deploy_trigger = $TRIGGER: when deploy-custom.yml deploys."
fi
echo

echo "STANDARDS"
if [ -n "$FRAMEWORKS" ]; then
  echo "- compliance_frameworks = $FRAMEWORKS."
else
  echo "- compliance_frameworks: none declared in the file (the portal's claimed standards win when they differ)."
fi
echo

echo "TEST DATA"
echo "- e2e_data_isolation = $ISOLATION."
echo

# Settings weaker than a declared standard expects. devaudit doctor does the full check (it can read the portal).
WARN=""
if [ "$APPROVAL" = "solo_with_gap" ] && printf '%s' "$FRAMEWORKS" | grep -qE 'soc-2|iso-27001'; then
  WARN="${WARN}- approval.mode = solo_with_gap with $FRAMEWORKS declared: those standards expect an approver other than the author; the gap is recorded, not removed.\n"
fi
if [ "$REVIEWS" = "0" ]; then
  WARN="${WARN}- release_branch_required_reviews = 0: the author can merge their own release PR (a recorded control gap).\n"
fi
if [ "$UAT_MODE" = "auto" ] && [ "$APPROVAL" = "solo_with_gap" ] && [ "$PACK_APPLIES" = "yes" ]; then
  WARN="${WARN}- uat.mode = auto with approval.mode = solo_with_gap: the agent executes UAT and the author is the only reviewer, so no one independent of the change looks at it.\n"
fi
if [ "$UAT_MODE" = "auto" ] && [ "$PACK_APPLIES" = "yes" ] && [ "$UAT_ENV" != "true" ]; then
  WARN="${WARN}- uat.mode = auto but uat.enabled is not true: agent-executed UAT needs a deployed UAT environment.\n"
fi
if [ "$PACK" = "never" ] && printf '%s' "$FRAMEWORKS" | grep -q 'iso-29119'; then
  WARN="${WARN}- uat.human_pack = never with iso-29119 declared: there is no documented human acceptance testing to show for this change.\n"
fi
if [ -n "$WARN" ]; then
  echo "WORTH A LOOK"
  printf '%b' "$WARN"
  echo "Run \`devaudit doctor\` for the full check."
fi
