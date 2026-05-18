#!/bin/bash
# validate-commits.sh — Validates commit conventions on PRs.
#
# Usage:
#   ./scripts/validate-commits.sh [base-branch]
#
# Checks all commits in the PR for:
# - Conventional Commits format (type: description or type(scope): description)
# - Co-Authored-By tag on commits touching code files (warning)
# - Ref: REQ-XXX on commits related to tracked requirements (warning)
#
# Install: cp this file to your project's scripts/ directory && chmod +x scripts/validate-commits.sh

set -euo pipefail

BASE_BRANCH="${1:-origin/main}"
EXIT_CODE=0
WARN_COUNT=0

echo "=== Commit Convention Validation ==="
echo "Comparing: $BASE_BRANCH...HEAD"
echo ""

# Conventional Commit regex: type(optional-scope): description
CC_REGEX='^(feat|fix|docs|test|refactor|chore|compliance|security|perf|ci|build|revert)(\([a-zA-Z0-9_-]+\))?!?: .+'

COMMITS=$(git log "$BASE_BRANCH"..HEAD --format='%H' || true)

if [ -z "$COMMITS" ]; then
  echo "No commits found between $BASE_BRANCH and HEAD."
  exit 0
fi

TOTAL=0
FAILED=0

while IFS= read -r sha; do
  TOTAL=$((TOTAL + 1))
  SUBJECT=$(git log -1 --format='%s' "$sha")
  BODY=$(git log -1 --format='%B' "$sha")
  SHORT=$(git log -1 --format='%h' "$sha")

  # Check Conventional Commits format
  if ! echo "$SUBJECT" | grep -qE "$CC_REGEX"; then
    # Allow merge commits
    if echo "$SUBJECT" | grep -q '^Merge '; then
      continue
    fi
    echo "ERROR [$SHORT]: Not Conventional Commits format: \"$SUBJECT\""
    FAILED=$((FAILED + 1))
    EXIT_CODE=1
    continue
  fi

  # Check Co-Authored-By on commits that touch code files
  CODE_FILES=$(git diff-tree --no-commit-id --name-only -r "$sha" -- '*.ts' '*.tsx' '*.js' '*.jsx' '*.py' 2>/dev/null || true)
  if [ -n "$CODE_FILES" ]; then
    if ! echo "$BODY" | grep -qi 'Co-Authored-By:'; then
      echo "WARNING [$SHORT]: Touches code files but missing Co-Authored-By tag"
      WARN_COUNT=$((WARN_COUNT + 1))
    fi
  fi

  # Check Ref: REQ-XXX on requirement-related commits
  if echo "$BODY" | grep -qi 'compliance\|requirement\|REQ-'; then
    if ! echo "$BODY" | grep -qP 'Ref:\s*REQ-\d+'; then
      echo "WARNING [$SHORT]: Appears requirement-related but missing Ref: REQ-XXX"
      WARN_COUNT=$((WARN_COUNT + 1))
    fi
  fi

done <<< "$COMMITS"

echo ""
echo "Checked $TOTAL commits: $FAILED errors, $WARN_COUNT warnings."

if [ $EXIT_CODE -eq 0 ]; then
  echo "=== Commit convention check passed ==="
else
  echo "=== FAILED: $FAILED commits do not follow Conventional Commits format ==="
fi

exit $EXIT_CODE
