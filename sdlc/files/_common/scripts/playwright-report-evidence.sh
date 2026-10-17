#!/usr/bin/env bash
# playwright-report-evidence.sh — helpers for the Playwright HTML report
# bundle in the E2E Regression evidence upload (DevAudit-Installer#1018).
# Kept out of compliance-evidence.yml so that workflow's `run:` block stays
# under GitHub's 21,000-character expression-template limit.
#
#   zip <artifacts-dir> <REQ>          Build <artifacts-dir>/playwright-report.zip
#                                      from <artifacts-dir>/playwright-report/.
#                                      Zip errors are reported, never swallowed;
#                                      a failed build leaves no archive behind.
#   missing <REQ> <run-conclusion>     Record that the report could not be
#                                      uploaded. For a non-passing run this adds
#                                      a job-summary note (reviewers need the
#                                      report to inspect the failing spec);
#                                      for a passing run it stays a no-op.
set -uo pipefail

cmd="${1:-}"
case "$cmd" in
  zip)
    dir="${2:?artifacts dir required}"
    req="${3:-unknown}"
    rm -f "$dir/playwright-report.zip"
    [ -d "$dir/playwright-report" ] || exit 0
    if ! (cd "$dir" && zip -qr playwright-report.zip playwright-report/); then
      echo "::warning::playwright-report.zip creation failed for ${req}; the HTML report will be missing from the portal"
      rm -f "$dir/playwright-report.zip"
      exit 0
    fi
    size=$(stat -c%s "$dir/playwright-report.zip" 2>/dev/null || stat -f%z "$dir/playwright-report.zip")
    echo "playwright-report.zip size: ${size} bytes"
    ;;
  missing)
    req="${2:-unknown}"
    conclusion="${3:-unknown}"
    [ "$conclusion" = "success" ] && exit 0
    {
      echo "### :warning: Playwright report unavailable for ${req}"
      echo ""
      echo "The E2E run concluded \`${conclusion}\` and its HTML report/traces failed to upload,"
      echo "so reviewers cannot inspect the failing spec from the portal. Use the"
      echo "\`e2e-regression-report\` Actions artifact on the source run instead."
    } >> "${GITHUB_STEP_SUMMARY:-/dev/stderr}"
    ;;
  *)
    echo "usage: $0 zip <artifacts-dir> <REQ> | missing <REQ> <run-conclusion>" >&2
    exit 2
    ;;
esac
