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

  echo ""
done

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "=== All test execution summary checks passed ==="
else
  echo "=== FAILED: Invalid gate states found in test execution summary ==="
fi

exit $EXIT_CODE
