#!/bin/bash
# check-requirement-jsdoc.sh — Validates that modified source files contain @requirement JSDoc tags.
#
# Usage:
#   ./scripts/check-requirement-jsdoc.sh [base-branch]
#
# Checks files changed between base-branch and HEAD for @requirement REQ-XXX JSDoc comments.
# Reports warnings for files missing the tag. Exits 0 (warnings only) by default.
# Set STRICT=1 to exit non-zero on missing tags.
#
# Install: cp this file to your project's scripts/ directory && chmod +x scripts/check-requirement-jsdoc.sh
# CI usage: add as a step in your PR validation job.

set -euo pipefail

BASE_BRANCH="${1:-origin/main}"
STRICT="${STRICT:-0}"
EXIT_CODE=0

# Get source files changed in this branch (exclude test files, configs, compliance docs)
CHANGED_FILES=$(git diff --name-only --diff-filter=ACMR "$BASE_BRANCH"...HEAD -- \
  '*.ts' '*.tsx' \
  ':!*.spec.ts' ':!*.spec.tsx' ':!*.test.ts' ':!*.test.tsx' \
  ':!*.config.*' ':!*.d.ts' \
  ':!compliance/' ':!e2e/' ':!__tests__/' ':!tests/' \
  2>/dev/null || true)

if [ -z "$CHANGED_FILES" ]; then
  echo "No source files changed — skipping @requirement check."
  exit 0
fi

MISSING_COUNT=0
TOTAL_COUNT=0

while IFS= read -r file; do
  [ -f "$file" ] || continue
  TOTAL_COUNT=$((TOTAL_COUNT + 1))

  if ! grep -q '@requirement REQ-' "$file"; then
    echo "WARNING: Missing @requirement JSDoc tag: $file"
    MISSING_COUNT=$((MISSING_COUNT + 1))
  fi
done <<< "$CHANGED_FILES"

echo ""
echo "Checked $TOTAL_COUNT source files: $((TOTAL_COUNT - MISSING_COUNT)) have @requirement, $MISSING_COUNT missing."

if [ "$MISSING_COUNT" -gt 0 ] && [ "$STRICT" = "1" ]; then
  echo "STRICT mode: failing due to missing @requirement tags."
  EXIT_CODE=1
fi

exit $EXIT_CODE
