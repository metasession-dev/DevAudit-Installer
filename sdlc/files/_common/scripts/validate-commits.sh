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
# Scope accepts anything except `)` so multi-scope subjects like
# `feat(auth,profile):` and `fix(rewards/expiry):` validate. The closing-paren
# guard prevents pathological inputs. DevAudit-Installer#93.
CC_REGEX='^(feat|fix|docs|test|refactor|chore|compliance|security|perf|ci|build|revert)(\([^)]+\))?!?: .+'

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

  # Requirement traceability: implementation commits (feat/fix/refactor/perf)
  # MUST cite a requirement — [REQ-XXX] in the subject or a Ref: REQ-XXX
  # trailer. Housekeeping types (docs/chore/ci/build/test/compliance/revert)
  # are exempt. Mirrors the commitlint rule; this is the PR-CI half that
  # `--no-verify` can't skip. Work starts from a requirement (which starts
  # from an issue) — use the sdlc-implementer skill to assign one.
  TYPE=$(echo "$SUBJECT" | grep -oE '^[a-z]+' || true)
  case "$TYPE" in
    feat|fix|refactor|perf)
      if ! echo "$SUBJECT" | grep -qP '\[REQ-\d{3,}\]' \
        && ! echo "$BODY" | grep -qiP 'Ref:\s*REQ-\d{3,}'; then
        echo "ERROR [$SHORT]: '$TYPE' is an implementation commit but cites no requirement."
        echo "       Add [REQ-XXX] to the subject or a 'Ref: REQ-XXX' trailer. Start work"
        echo "       from a requirement via the sdlc-implementer skill (it assigns the REQ"
        echo "       from the originating issue in Phase 1)."
        FAILED=$((FAILED + 1))
        EXIT_CODE=1
        continue
      fi

      # RTM provenance check (devaudit-installer#226): verify the REQ-XXX
      # cited in the commit has an sdlc-implementer@<version> provenance
      # stamp in compliance/RTM.md. Without the stamp, the skill was not
      # invoked and the RTM row was created manually.
      REQ_ID=$(echo "$SUBJECT" | grep -oP '\[REQ-\d{3,}\]' | tr -d '[]' || true)
      if [ -z "$REQ_ID" ]; then
        REQ_ID=$(echo "$BODY" | grep -oiP 'Ref:\s*REQ-\d{3,}' | grep -oP 'REQ-\d{3,}' | tail -1 || true)
      fi
      if [ -n "$REQ_ID" ] && [ -f compliance/RTM.md ]; then
        RTM_ROW=$(grep -m1 -E "^\| ${REQ_ID} " compliance/RTM.md || true)
        if [ -n "$RTM_ROW" ]; then
          if ! echo "$RTM_ROW" | grep -q 'sdlc-implementer@'; then
            echo "ERROR [$SHORT]: $REQ_ID in commit message has no sdlc-implementer provenance in RTM.md."
            echo "       The RTM row for $REQ_ID was not created by the sdlc-implementer skill."
            echo "       Either invoke sdlc-implementer and re-run, or add the provenance marker"
            echo "       'sdlc-implementer@<version>' to the RTM row manually with operator sign-off."
            FAILED=$((FAILED + 1))
            EXIT_CODE=1
            continue
          fi
        fi
      fi
      ;;
  esac

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
