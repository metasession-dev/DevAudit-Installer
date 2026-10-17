#!/bin/bash
# validate-test-summary.sh — Validates test-execution-summary.md content.
#
# Usage:
#   ./scripts/validate-test-summary.sh [base-branch]
#
# Checks that test-execution-summary.md files for in-scope REQs do not
# contain invalid gate states like "deferred" or "Deferred to CI".
# E2E gate results must be one of: PASS, FAIL, NOT_NEEDED (with reason),
# or SKIPPED (with operator-approved rationale). "Deferred to CI" is not
# a valid SDLC state (devaudit-installer#240).
#
# Also rejects Stage-3 pre-PR draft placeholder language ("not yet a CI
# run", "CI run: not yet available", "Production promotion remains
# blocked") surviving into the release PR — this script only runs on PRs
# to main, so by definition real CI has already run on develop by the
# time it executes; that language means the evidence was never refreshed
# after the fact (devaudit-installer#607).
#
# Failure integrity (devaudit-installer#1016): a summary may not read PASS
# while a failure is unaccounted for. If the summary records any failed
# execution ("3 failed", an outcome of failed/timed_out in the Test
# executions table) it must carry a "## E2E failures & triage" table with one
# row per failing spec/check:
#
#   | Spec / check | Source | Classification | Evidence | Disposition | Reference |
#
# Classification: flake | test bug | app defect | seed-data gap.
# Disposition: "Fix" (PR #N or URL), "Accepted exception" (path to the
# accepted-e2e-failure record or its tracking issue URL) or "Deferral"
# (tracking issue). "Known unrelated flakes" is not a disposition.
# When E2E_RESULTS_JSON (or e2e-artifacts/e2e-regression-results.json) exists
# the summary is also reconciled with the CI results
# (reconcile-e2e-summary.sh; E2E_RUN_ID / E2E_RUN_ATTEMPT narrow it to one run).
#
# New-format summaries (those carrying a "CI as of: <run>/<attempt> @ <sha>"
# stamp) are held to the stricter rules: the Test executions table must be the
# generated one, and the stamp must match DEVAUDIT_PR_HEAD_SHA when it is set.
# Summaries without the stamp get a warning instead of an error, so releases
# already in flight are not broken by the new rules.
#
# Designed to run as a CI job on PRs to main, alongside
# validate-compliance-artifacts.sh.
#
# Install: cp this file to your project's scripts/ directory && chmod +x scripts/validate-test-summary.sh

set -euo pipefail

BASE_BRANCH="${1:-origin/main}"
EXIT_CODE=0

echo "=== Test Execution Summary Validation ==="
echo "Comparing: $BASE_BRANCH...HEAD"
echo ""

# Extract the requirement(s) THIS PR implements — same logic as
# validate-compliance-artifacts.sh
PR_MSGS=$(git log "$BASE_BRANCH"..HEAD --format='%B' || true)
REQUIREMENTS=$(
  {
    printf '%s\n' "$PR_MSGS" | grep -oP '\[\KREQ-\d{3,}(?=\])' || true
    printf '%s\n' "$PR_MSGS" | grep -iP '^\s*Ref:' | grep -oP 'REQ-\d{3,}' || true
  } | sort -u
)

if [ -z "$REQUIREMENTS" ]; then
  echo "No REQ-XXX references found in PR commits — skipping test summary validation."
  exit 0
fi

echo "Requirements found in PR commits: $REQUIREMENTS"
echo ""

for REQ in $REQUIREMENTS; do
  echo "--- Checking $REQ ---"

  SUMMARY="compliance/evidence/$REQ/test-execution-summary.md"

  if [ ! -f "$SUMMARY" ]; then
    echo "  INFO: $SUMMARY not found — skipping (validate-compliance-artifacts.sh checks existence)"
    echo ""
    continue
  fi

  echo "  OK: test-execution-summary.md exists"

  # Check 1: Reject "deferred" (case-insensitive) anywhere in the file
  if grep -qi 'deferred' "$SUMMARY"; then
    echo "  ERROR: 'deferred' found in $SUMMARY — 'Deferred to CI' is not a valid gate state (devaudit-installer#238, #240)."
    echo "         E2E gate results must be: PASS, FAIL, NOT_NEEDED (with reason), or SKIPPED (with operator-approved rationale)."
    echo "         Offending lines:"
    grep -in 'deferred' "$SUMMARY" | sed 's/^/           /'
    EXIT_CODE=1
  fi

  # Check 2: Reject "browsers not installed" as a gate outcome
  if grep -qi 'browsers not installed' "$SUMMARY"; then
    echo "  ERROR: 'browsers not installed' found in $SUMMARY — this is an environment setup issue, not a gate state (devaudit-installer#238, #240)."
    echo "         Install browsers with 'npx playwright install' and re-run the E2E suite."
    echo "         Offending lines:"
    grep -in 'browsers not installed' "$SUMMARY" | sed 's/^/           /'
    EXIT_CODE=1
  fi

  # Check 3: Reject "Deferred to CI" explicitly (catches the exact pattern from #238)
  if grep -qi 'deferred to ci' "$SUMMARY"; then
    echo "  ERROR: 'Deferred to CI' found in $SUMMARY — CI is a safety net, not a replacement for local E2E execution (devaudit-installer#238, #240)."
    echo "         Offending lines:"
    grep -in 'deferred to ci' "$SUMMARY" | sed 's/^/           /'
    EXIT_CODE=1
  fi

  # Check 4: Validate E2E gate result in the gate results table
  # Look for lines matching "| E2E ... | <result> |" pattern
  E2E_LINES=$(grep -i '| *e2e' "$SUMMARY" 2>/dev/null || true)
  if [ -n "$E2E_LINES" ]; then
    while IFS= read -r line; do
      # Extract the result column (2nd | field after "E2E")
      RESULT=$(echo "$line" | grep -oP '\|\s*\K[^|]+(?=\s*\|)' | head -2 | tail -1 | xargs || true)
      if [ -n "$RESULT" ]; then
        RESULT_LOWER=$(echo "$RESULT" | tr '[:upper:]' '[:lower:]')
        # Skip empty or separator lines
        if [ -z "$RESULT_LOWER" ] || echo "$RESULT_LOWER" | grep -q '^[|-]*$'; then
          continue
        fi
        # Check for invalid "deferred" state
        if echo "$RESULT_LOWER" | grep -qi 'defer'; then
          echo "  ERROR: E2E gate result '$RESULT' is not valid — 'deferred' is not a gate state (devaudit-installer#240)"
          EXIT_CODE=1
        fi
      fi
    done <<< "$E2E_LINES"
  fi

  # Check 5: If E2E result is SKIPPED or NOT_NEEDED, require a rationale on the same line
  if grep -qi '| *e2e.*| *skipped' "$SUMMARY" 2>/dev/null; then
    SKIPPED_LINE=$(grep -i '| *e2e.*| *skipped' "$SUMMARY" | head -1)
    # Rationale can be in the details column (after the result column) or inline with the state
    if echo "$SKIPPED_LINE" | grep -qi 'skipped.*[—–-].*\|| *skipped.*|.*[a-z]'; then
      echo "  OK: E2E gate result is SKIPPED with rationale"
    else
      echo "  ERROR: E2E gate result is SKIPPED but no rationale provided. Add a reason in the Details column (e.g. 'SKIPPED — API-only change, no UI surface (operator-approved)') (devaudit-installer#240)"
      EXIT_CODE=1
    fi
  fi

  if grep -qi '| *e2e.*| *not_needed' "$SUMMARY" 2>/dev/null; then
    NN_LINE=$(grep -i '| *e2e.*| *not_needed' "$SUMMARY" | head -1)
    if echo "$NN_LINE" | grep -qi 'not_needed.*[—–-].*\|| *not_needed.*|.*[a-z]'; then
      echo "  OK: E2E gate result is NOT_NEEDED with rationale"
    else
      echo "  ERROR: E2E gate result is NOT_NEEDED but no rationale provided. Add a reason in the Details column (e.g. 'NOT_NEEDED — schema-only change, no UI surface') (devaudit-installer#240)"
      EXIT_CODE=1
    fi
  fi

  # Check 6: Reject "E2E deferred to CI" in final assessment lines
  if grep -qi 'e2e deferred\|e2e.*deferred to ci' "$SUMMARY" 2>/dev/null; then
    echo "  ERROR: 'E2E deferred' language found in final assessment — 'deferred' is not a valid gate state (devaudit-installer#240)"
    echo "         Offending lines:"
    grep -in 'e2e deferred\|e2e.*deferred to ci' "$SUMMARY" | sed 's/^/           /'
    EXIT_CODE=1
  fi

  # Check 7: If E2E gate result is SKIPPED, require an ## Accepted skips section (devaudit-installer#279)
  if grep -qi '| *e2e.*| *skipped' "$SUMMARY" 2>/dev/null; then
    if ! grep -qi '## Accepted skips' "$SUMMARY" 2>/dev/null; then
      echo "  ERROR: E2E gate result is SKIPPED but no '## Accepted skips' section found (devaudit-installer#279)"
      echo "         Add an '## Accepted skips' section with a table row for each accepted skip."
      EXIT_CODE=1
    else
      # Extract the Accepted skips section and check for data rows
      ACCEPTED_SKIPS_SECTION=$(awk '/^## Accepted skips/{found=1; next} /^## /{found=0} found' "$SUMMARY")
      # Count rows that look like table data (start with |, not separator, not header)
      # Separator rows contain only dashes and pipes: |------|------|
      # Header rows contain column names: | Spec | Test | ...
      # Data rows contain actual values: | e2e/foo.spec.ts | ... |
      DATA_ROWS=$(echo "$ACCEPTED_SKIPS_SECTION" | grep '^|' | grep -v '^|[[:space:]]*-' | grep -v 'Spec.*Test.*REQ/AC' | wc -l || true)
      if [ "$DATA_ROWS" -lt 1 ] 2>/dev/null; then
        echo "  ERROR: '## Accepted skips' section exists but has no table data rows (devaudit-installer#279)"
        echo "         Add at least one row with: Spec, Test, REQ/AC, Classification, Resolution attempted, Approved by, Rationale"
        EXIT_CODE=1
      else
        # Check that each data row has a non-empty "Approved by" column (6th content column = field 7 with awk -F|)
        SKIP_FAIL=0
        echo "$ACCEPTED_SKIPS_SECTION" | grep '^|' | grep -v '^|[[:space:]]*-' | grep -v 'Spec.*Test.*REQ/AC' | while IFS= read -r row; do
          APPROVED_BY=$(echo "$row" | awk -F'|' '{gsub(/^[[:space:]]+|[[:space:]]+$/,"",$7); print $7}')
          if [ -z "$APPROVED_BY" ]; then
            echo "  ERROR: Accepted skip row has empty 'Approved by' value (devaudit-installer#279)"
            echo "         Row: $row"
          fi
        done | grep -q ERROR && SKIP_FAIL=1
        if [ "$SKIP_FAIL" -eq 1 ]; then
          EXIT_CODE=1
        else
          echo "  OK: E2E gate result is SKIPPED with '## Accepted skips' section"
        fi
      fi
    fi
  fi

  # Check 8: Reject pre-PR draft placeholder language surviving into the
  # release PR (devaudit-installer#607). test-execution-summary.md is
  # authored once, locally, at Stage 3 — before the integration PR even
  # opens — and this script only ever runs on PRs to main (the final
  # release gate). By the time a release PR exists, real CI has already
  # run on develop; any of this language still present means the evidence
  # was never refreshed and is actively misleading for a release that's
  # about to (or already did) ship.
  if grep -qi 'not yet a ci run' "$SUMMARY"; then
    echo "  ERROR: 'not yet a CI run' found in $SUMMARY — this evidence pack was never refreshed after the integration PR's real CI run completed (devaudit-installer#607)."
    echo "         Replace with the actual CI workflow run link/ID before this release PR merges."
    echo "         Offending lines:"
    grep -in 'not yet a ci run' "$SUMMARY" | sed 's/^/           /'
    EXIT_CODE=1
  fi

  if grep -qi 'ci run.*not yet available' "$SUMMARY"; then
    echo "  ERROR: 'CI run: not yet available' found in $SUMMARY — a release PR to main means real CI already ran on develop; this evidence pack was never refreshed (devaudit-installer#607)."
    echo "         Offending lines:"
    grep -in 'ci run.*not yet available' "$SUMMARY" | sed 's/^/           /'
    EXIT_CODE=1
  fi

  if grep -qi 'production promotion remains blocked' "$SUMMARY"; then
    echo "  ERROR: 'Production promotion remains blocked' found in $SUMMARY — this is Stage-3 draft boilerplate; it cannot still be true once a release PR to main exists for this REQ (devaudit-installer#607)."
    echo "         Update the Final assessment to reflect the actual, current state before this release PR merges."
    echo "         Offending lines:"
    grep -in 'production promotion remains blocked' "$SUMMARY" | sed 's/^/           /'
    EXIT_CODE=1
  fi


  # Check 9: failure integrity (devaudit-installer#1016, R4/R12). A summary
  # that records a failed execution must account for every failure in an
  # "## E2E failures & triage" table; "known unrelated flakes" is an assertion,
  # not evidence.
  TRIAGE_SECTION=$(awk '/^## E2E failures & triage/{found=1; next} /^## /{found=0} found' "$SUMMARY")
  HAS_FAILURE=0
  if grep -Eiq '(^|[^0-9])[1-9][0-9]* failed' "$SUMMARY"; then HAS_FAILURE=1; fi
  if grep -Eiq '^\|.*\|[[:space:]]*(failed|timed_out)[[:space:]]*\|' "$SUMMARY"; then HAS_FAILURE=1; fi
  TRIAGE_ROWS=$(printf '%s\n' "$TRIAGE_SECTION" | grep '^|' | grep -Ev '^\|[[:space:]|:-]*$' | grep -Eiv 'classification.*disposition' || true)
  TRIAGE_COUNT=$(printf '%s' "$TRIAGE_ROWS" | grep -c . || true)

  if [ "$HAS_FAILURE" -eq 1 ] && [ "$TRIAGE_COUNT" -lt 1 ]; then
    echo "  ERROR: $SUMMARY records a failed execution but has no '## E2E failures & triage' table with a row per failure (devaudit-installer#1016)."
    echo "         Add | Spec / check | Source | Classification | Evidence | Disposition | Reference | rows: classify each failure"
    echo "         (flake / test bug / app defect / seed-data gap) and give its disposition (Fix PR, Accepted exception record, or Deferral issue)."
    EXIT_CODE=1
  fi
  if grep -Eiq 'known (unrelated )?(e2e )?flake|known unrelated' "$SUMMARY" && [ "$TRIAGE_COUNT" -lt 1 ]; then
    echo "  ERROR: 'known unrelated flakes' is asserted in $SUMMARY without a triage table (devaudit-installer#1016) — name each failing spec, its classification and disposition in '## E2E failures & triage'."
    EXIT_CODE=1
  fi
  if [ "$TRIAGE_COUNT" -ge 1 ]; then
    TRIAGE_BAD=0
    while IFS= read -r row; do
      [ -n "$row" ] || continue
      SPEC=$(printf '%s' "$row" | awk -F'|' '{gsub(/^[[:space:]]+|[[:space:]]+$/,"",$2); print $2}')
      CLASS=$(printf '%s' "$row" | awk -F'|' '{gsub(/^[[:space:]]+|[[:space:]]+$/,"",$4); print tolower($4)}' | tr '_-' '  ')
      DISP=$(printf '%s' "$row" | awk -F'|' '{gsub(/^[[:space:]]+|[[:space:]]+$/,"",$6); print tolower($6)}')
      REFC=$(printf '%s' "$row" | awk -F'|' '{gsub(/^[[:space:]]+|[[:space:]]+$/,"",$7); print $7}')
      case "$CLASS" in
        flake*|"test bug"*|"app defect"*|"application defect"*|"seed data gap"*) ;;
        *) echo "  ERROR: triage row for '$SPEC' has no valid classification (flake / test bug / app defect / seed-data gap), got '$CLASS' (devaudit-installer#1016)"; TRIAGE_BAD=1 ;;
      esac
      case "$DISP" in
        fix*|"accepted exception"*|deferral*) ;;
        *) echo "  ERROR: triage row for '$SPEC' has no disposition (Fix / Accepted exception / Deferral), got '$DISP' — an unresolved failure cannot ship under a PASS summary (devaudit-installer#1016)"; TRIAGE_BAD=1 ;;
      esac
      if [ -z "$REFC" ] || printf '%s' "$REFC" | grep -Eiq '^(replace|tbd|none|n/a|-)$|REPLACE'; then
        echo "  ERROR: triage row for '$SPEC' has no reference (fix PR, accepted-exception record path, or tracking issue) (devaudit-installer#1016)"; TRIAGE_BAD=1
      else
        case "$DISP" in
          "accepted exception"*)
            if ! printf '%s' "$REFC" | grep -Eq 'accepted-e2e-failure|\.md|https://github\.com/[^ ]+/issues/[0-9]+'; then
              echo "  ERROR: 'Accepted exception' row for '$SPEC' must reference its accepted-e2e-failure record or tracking issue URL (devaudit-installer#1016)"; TRIAGE_BAD=1
            fi ;;
          fix*|deferral*)
            if ! printf '%s' "$REFC" | grep -Eq '#[0-9]+|https?://'; then
              echo "  ERROR: '$DISP' row for '$SPEC' must reference a PR/issue (#N or URL) (devaudit-installer#1016)"; TRIAGE_BAD=1
            fi ;;
        esac
      fi
    done <<< "$TRIAGE_ROWS"
    if [ "$TRIAGE_BAD" -eq 1 ]; then EXIT_CODE=1; else echo "  OK: $TRIAGE_COUNT failure(s) triaged with classification, disposition and reference"; fi
  fi

  # Check 10: new-format rules (devaudit-installer#1016, R9/R11). Strict only
  # when the summary carries a "CI as of:" stamp; otherwise warn so a release
  # already in flight is not broken by rules it could not have followed.
  CI_STAMP=$(grep -Eio 'CI as of:[[:space:]]*[^[:space:]]+/[^[:space:]]+[[:space:]]*@[[:space:]]*[0-9a-f]{7,40}' "$SUMMARY" | head -1 || true)
  if [ -n "$CI_STAMP" ]; then
    STAMP_SHA=$(printf '%s' "$CI_STAMP" | grep -Eio '[0-9a-f]{7,40}$')
    if [ -n "${DEVAUDIT_PR_HEAD_SHA:-}" ]; then
      # Either may be abbreviated: they match when one is a prefix of the other.
      case "$DEVAUDIT_PR_HEAD_SHA" in
        "$STAMP_SHA"*) ;;
        *)
          case "$STAMP_SHA" in
            "$DEVAUDIT_PR_HEAD_SHA"*) ;;
            *)
              echo "  ERROR: the summary's '$CI_STAMP' does not match the release PR head ${DEVAUDIT_PR_HEAD_SHA:0:12} — regenerate the summary after the release PR's CI reached a terminal state (devaudit-installer#1016)."
              EXIT_CODE=1 ;;
          esac ;;
      esac
    fi
    if ! grep -q 'generated-by: render-test-executions.sh' "$SUMMARY"; then
      echo "  ERROR: the Test executions table is not the generated one (no '<!-- generated-by: render-test-executions.sh -->' marker). Render it from the release journey with scripts/render-test-executions.sh instead of typing rows by hand (devaudit-installer#1016)."
      EXIT_CODE=1
    fi
  else
    echo "  WARN: $SUMMARY has no 'CI as of: <run>/<attempt> @ <sha>' stamp — regenerate the summary after the release PR's CI reaches a terminal state and after any re-run, triage or fix (devaudit-installer#1016)."
  fi

  # Check 11: reconcile with the CI results when they are available (R13).
  RECON_RESULTS="${E2E_RESULTS_JSON:-e2e-artifacts/e2e-regression-results.json}"
  if [ -f "$RECON_RESULTS" ] && [ -f "$(dirname "${BASH_SOURCE[0]}")/reconcile-e2e-summary.sh" ]; then
    RECON_ARGS=(--summary "$SUMMARY" --results "$RECON_RESULTS")
    [ -n "${E2E_RUN_ID:-}" ] && RECON_ARGS+=(--run-id "$E2E_RUN_ID")
    [ -n "${E2E_RUN_ATTEMPT:-}" ] && RECON_ARGS+=(--attempt "$E2E_RUN_ATTEMPT")
    if ! bash "$(dirname "${BASH_SOURCE[0]}")/reconcile-e2e-summary.sh" "${RECON_ARGS[@]}" 2>&1 | sed 's/^/  /'; then
      EXIT_CODE=1
    fi
  fi

  echo ""
done

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "=== All test execution summary checks passed ==="
else
  echo "=== FAILED: Invalid gate states found in test execution summary ==="
fi

exit $EXIT_CODE
