#!/usr/bin/env bash
# run-test-tier.sh — run one test tier with the project's configured command
# (devaudit-installer#1060).
#
# Tiers are about speed and risk; the `feature` scope is about what changed.
# The same names apply to every test runner, so every runner gets the same
# portal check labels and triage rules.
#
# Usage:   scripts/run-test-tier.sh <smoke|critical|full|feature> [REQ-XXX]
#          (`regression` is accepted as an alias of `full`)
# Config:  sdlc-config.json at the repo root ($GITHUB_WORKSPACE in CI), read with jq.
#            test_tier_smoke / test_tier_critical / test_tier_full
#                                shell command for that tier
#            test_feature_command shell command for the feature scope; {REQ}
#                                is replaced with the requirement id. The pytest
#                                default runs the test files under tests/ that
#                                mention the id (pytest -k cannot see docstrings)
#            test_runner          playwright (default) | pytest; picks the
#                                default when the tier's own key is unset
#            e2e_project          Playwright project of the smoke tier
# Env:     TEST_JUNIT_XML          pytest JUnit output path (default junit.xml)
#          RUN_TEST_TIER_DRY_RUN=1 print the command instead of running it
# Exit:    the command's exit code; 2 on a usage or config error.
#
# The command runs in the current directory (the job's working-directory).
# Playwright defaults are exactly what the generated workflows ran before
# these keys existed, so a project that sets none of them is unchanged.
#
# Install: cp this file to your project's scripts/ directory && chmod +x scripts/run-test-tier.sh

set -euo pipefail

TIER="${1:-}"
REQ="${2:-}"

die() {
  echo "run-test-tier: $*" >&2
  exit 2
}

case "$TIER" in
  smoke | critical | full | feature) ;;
  regression) TIER=full ;;
  *) die "usage: run-test-tier.sh <smoke|critical|full|feature> [REQ-XXX]" ;;
esac

if [ "$TIER" = feature ]; then
  [ -n "$REQ" ] || die "the feature scope needs a requirement id"
  # The id lands in a shell command; accept only what a REQ id can contain.
  printf '%s' "$REQ" | grep -qE '^[A-Za-z0-9._-]+$' || die "invalid requirement id: $REQ"
fi

CONFIG="${SDLC_CONFIG:-}"
if [ -z "$CONFIG" ]; then
  if [ -f "${GITHUB_WORKSPACE:-.}/sdlc-config.json" ]; then
    CONFIG="${GITHUB_WORKSPACE:-.}/sdlc-config.json"
  fi
fi

cfg() {
  # cfg <key> — the key's string value, empty when unset or no config
  if [ -n "$CONFIG" ] && [ -f "$CONFIG" ]; then
    jq -r --arg k "$1" '.[$k] // empty' "$CONFIG"
  fi
}

RUNNER="$(cfg test_runner)"
RUNNER="${RUNNER:-playwright}"
JUNIT="${TEST_JUNIT_XML:-junit.xml}"

has_playwright_project() {
  # has_playwright_project <name> — a project of that name in playwright.config.*
  local f
  for f in playwright.config.ts playwright.config.js playwright.config.mjs playwright.config.cjs; do
    if [ -f "$f" ] && grep -qE "name:[[:space:]]*['\"]$1['\"]" "$f" 2>/dev/null; then
      return 0
    fi
  done
  return 1
}

default_command() {
  case "$RUNNER:$TIER" in
    playwright:smoke)
      local project
      project="$(cfg e2e_project)"
      echo "npx playwright test --project=${project:-chromium} --reporter=json,html"
      ;;
    playwright:critical)
      # critical is optional: without a `critical` project fall back to smoke
      if has_playwright_project critical; then
        echo "npx playwright test --project=critical --reporter=json,html"
      else
        echo "::warning::No 'critical' Playwright project defined; falling back to smoke." >&2
        echo "npx playwright test --project=smoke --reporter=json,html"
      fi
      ;;
    playwright:full) echo "npx playwright test --project=regression --reporter=json,html" ;;
    playwright:feature) echo "npx playwright test --grep \"{REQ}\" --reporter=json,html" ;;
    pytest:smoke) echo "pytest -m smoke --junit-xml=$JUNIT" ;;
    pytest:critical) echo "pytest -m \"smoke or critical\" --junit-xml=$JUNIT" ;;
    pytest:full) echo "pytest --junit-xml=$JUNIT" ;;
    pytest:feature)
      # `pytest -k` matches test, class and marker names, never docstrings or
      # comments, and a Python name cannot hold "REQ-042", so it would select
      # nothing. Run the test files that mention the requirement id instead
      # (the id must end there: REQ-11 does not match REQ-111). No match is an
      # error, never a silent full run.
      local files f quoted=""
      files="$(grep -rlE "${REQ}([^0-9A-Za-z]|\$)" --include='*.py' tests 2>/dev/null | LC_ALL=C sort || true)"
      if [ -z "$files" ]; then
        echo "::error::No pytest file under tests/ mentions ${REQ}" >&2
        echo "exit 5"
        return
      fi
      while IFS= read -r f; do quoted="${quoted}$(printf '%q ' "$f")"; done <<<"$files"
      echo "pytest ${quoted}--junit-xml=$JUNIT"
      ;;
    *) die "unknown test_runner '$RUNNER' (expected playwright or pytest)" ;;
  esac
}

if [ "$TIER" = feature ]; then
  COMMAND="$(cfg test_feature_command)"
else
  COMMAND="$(cfg "test_tier_$TIER")"
fi
[ -n "$COMMAND" ] || COMMAND="$(default_command)"

COMMAND="${COMMAND//\{REQ\}/$REQ}"

if [ "${RUN_TEST_TIER_DRY_RUN:-}" = 1 ]; then
  echo "$COMMAND"
  exit 0
fi

echo "::notice::Running $TIER tier: $COMMAND"
set +e
bash -c "$COMMAND"
exit $?
