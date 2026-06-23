#!/bin/bash
# validate-compliance-artifacts.sh — Validates compliance artifacts exist on PRs to main.
#
# Usage:
#   ./scripts/validate-compliance-artifacts.sh [base-branch]
#
# Checks that PRs containing tracked requirement commits have the required
# compliance artifacts (test-scope, RTM entry, release ticket, etc.).
# Designed to run as a CI job on PRs to main.
#
# Install: cp this file to your project's scripts/ directory && chmod +x scripts/validate-compliance-artifacts.sh

set -euo pipefail

BASE_BRANCH="${1:-origin/main}"
EXIT_CODE=0

echo "=== Compliance Artifact Validation ==="
echo "Comparing: $BASE_BRANCH...HEAD"
echo ""

# Extract the requirement(s) THIS PR implements — from the commit subject
# tag `[REQ-XXX]` and the `Ref: REQ-XXX` trailer only, NOT from arbitrary
# prose in commit bodies. A mention like "target close: REQ-002" or
# "prereq for REQ-034" is a forward-reference, not a requirement under
# change; scraping the whole body (%B) made CI demand evidence dirs for
# work that hasn't started (DevAudit: META-JOBS tracker, REQ-002 false
# positive). The RTM-row guard below is a secondary safety net.
#
# Requires ≥3 digits so placeholder patterns like `REQ-0XX` don't create
# phantom IDs. The project's stable id format is REQ-001 onwards (#232).
PR_MSGS=$(git log "$BASE_BRANCH"..HEAD --format='%B' || true)
REQUIREMENTS=$(
  {
    # Subject/anywhere tag, e.g. `feat: [REQ-001] …`
    printf '%s\n' "$PR_MSGS" | grep -oP '\[\KREQ-\d{3,}(?=\])' || true
    # `Ref:` line (may list several, e.g. `Ref: REQ-001, REQ-003`)
    printf '%s\n' "$PR_MSGS" | grep -iP '^\s*Ref:' | grep -oP 'REQ-\d{3,}' || true
  } | sort -u
)

if [ -z "$REQUIREMENTS" ]; then
  echo "No REQ-XXX references found in PR commits — skipping artifact validation."
  echo "If this PR contains tracked requirements, ensure commits include 'Ref: REQ-XXX'."
  exit 0
fi

echo "Requirements found in PR commits: $REQUIREMENTS"
echo ""

for REQ in $REQUIREMENTS; do
  echo "--- Checking $REQ ---"

  # Skip REQs that have no RTM row — they're forward-references or
  # design-discussion mentions in commit bodies, not tracked
  # requirements for this release. Two practical cases (#232):
  #   - "REQ-033 is a prereq for REQ-034" — REQ-034 hasn't started.
  #   - REQ scaffolded then descoped — RTM row removed but old
  #     `Ref: REQ-XXX` commits still grep-match.
  # The `| $REQ ` pattern (leading pipe + trailing space) matches the
  # markdown table row used in RTM, so a substring elsewhere doesn't
  # accidentally satisfy it.
  if ! grep -q "| $REQ " compliance/RTM.md 2>/dev/null; then
    echo "  INFO: $REQ is referenced in commits but has no RTM row — skipping (forward-reference, not a tracked requirement for this release)"
    continue
  fi

  # Check evidence directory exists
  if [ ! -d "compliance/evidence/$REQ" ]; then
    echo "  ERROR: Evidence directory missing: compliance/evidence/$REQ/"
    EXIT_CODE=1
    continue
  fi
  echo "  OK: Evidence directory exists"

  # Check for unrecognized .md filenames in the evidence directory
  # (DevAudit-Installer#205). The CI upload pipeline now skips unknown
  # filenames with a warning — this check surfaces the issue at PR
  # time so the operator can rename or add routing before merge.
  KNOWN_ARTIFACTS="test-scope.md test-plan.md test-execution-summary.md test-summary-report.md implementation-plan.md srs-alignment.md architecture-decision.md risk-assessment.md security-summary.md ai-use-note.md ai-prompts.md ai-agent-handoff.md"
  for ARTIFACT in compliance/evidence/$REQ/*.md; do
    [ -f "$ARTIFACT" ] || continue
    ARTIFACT_BASE=$(basename "$ARTIFACT")
    if ! echo " $KNOWN_ARTIFACTS " | grep -q " $ARTIFACT_BASE "; then
      echo "  WARNING: Unrecognized artifact filename: compliance/evidence/$REQ/$ARTIFACT_BASE — CI upload will skip this file. Use a known filename or add routing in compliance-evidence.yml. (DevAudit-Installer#205)"
    fi
  done

  # Check test-scope.md exists
  if [ ! -f "compliance/evidence/$REQ/test-scope.md" ]; then
    echo "  ERROR: Test scope missing: compliance/evidence/$REQ/test-scope.md"
    EXIT_CODE=1
  else
    echo "  OK: test-scope.md exists"
  fi

  # Check test-plan.md exists
  if [ ! -f "compliance/evidence/$REQ/test-plan.md" ]; then
    echo "  ERROR: Test plan missing: compliance/evidence/$REQ/test-plan.md"
    EXIT_CODE=1
  else
    echo "  OK: test-plan.md exists"

    # Verify test files referenced in test-plan.md exist in the tree.
    # Two alternatives: directory-prefixed paths (captured whole), and bare
    # filenames containing .test. / .spec. (captured from the stem, not the
    # dot — without the leading [\w./-]+ the match would start at `.test.`
    # and drop the filename entirely). See DevAudit #133.
    #
    # mapfile + quoted expansion: without this, tokens like `__tests__/**`
    # get pathname-expanded by the for-loop and produce phantom "missing"
    # errors for every real subdirectory. See DevAudit #137.
    mapfile -t TEST_FILES < <(
      grep -oP '(?:__tests__/|tests?/|e2e/|spec/)\S+|[\w./-]+\.(?:test|spec)\.\S+' \
        "compliance/evidence/$REQ/test-plan.md" 2>/dev/null \
        | sed 's/[`),.;:]*$//' | grep -v '/$' | sort -u || true
    )
    if [ "${#TEST_FILES[@]}" -gt 0 ]; then
      MISSING_TESTS=0
      for TF in "${TEST_FILES[@]}"; do
        # Prose glob references like `__tests__/**` describe a directory
        # set, not a specific file — skip instead of treating as missing.
        if [[ "$TF" == *[*?]* ]]; then
          echo "  INFO: Skipping glob reference (not a file path): $TF"
          continue
        fi
        # Try exact path; otherwise search the repo by basename, skipping
        # node_modules and build/coverage outputs. The previous
        # `compgen -G "**/X"` form relied on bash globstar to recurse,
        # but globstar is OFF by default — `**` collapsed to a single
        # `*` (depth-1 wildcard), so any bare-filename reference whose
        # actual file lived at depth ≥2 was falsely reported as missing.
        if [ ! -f "$TF" ] && ! find . \
             -type d \( -name node_modules -o -name .next -o -name .git \
                        -o -name playwright-report -o -name coverage \
                        -o -name dist -o -name build -o -name 'test-results' \) -prune \
             -o -type f -name "$(basename "$TF")" -print 2>/dev/null \
             | grep -q .; then
          echo "  ERROR: Test file referenced in test-plan.md not found: $TF"
          MISSING_TESTS=$((MISSING_TESTS + 1))
        fi
      done
      if [ "$MISSING_TESTS" -gt 0 ]; then
        echo "  ERROR: $MISSING_TESTS test file(s) from test-plan.md missing — tests must be written before merge"
        EXIT_CODE=1
      else
        echo "  OK: All test files referenced in test-plan.md exist"
      fi
    fi
  fi

  # Check test-execution-summary.md exists
  if [ ! -f "compliance/evidence/$REQ/test-execution-summary.md" ]; then
    echo "  WARNING: Test execution summary missing: compliance/evidence/$REQ/test-execution-summary.md"
  else
    echo "  OK: test-execution-summary.md exists"
  fi

  # Check RTM entry exists and has an accepted terminal status. Accepts
  # SUPERSEDED as a valid terminal state — used when a REQ is replaced
  # by a successor (e.g. REQ-030 superseded by REQ-031). Without this
  # branch every PR with a commit referencing a SUPERSEDED REQ blocks
  # CI (#232).
  if grep -q "$REQ" compliance/RTM.md 2>/dev/null; then
    if grep "$REQ" compliance/RTM.md | grep -q "TESTED - PENDING SIGN-OFF"; then
      echo "  OK: RTM status is TESTED - PENDING SIGN-OFF"
    elif grep "$REQ" compliance/RTM.md | grep -q "APPROVED"; then
      echo "  OK: RTM status is APPROVED"
    elif grep "$REQ" compliance/RTM.md | grep -q "SUPERSEDED"; then
      echo "  OK: RTM status is SUPERSEDED"
    else
      echo "  WARNING: RTM entry exists but status is not TESTED - PENDING SIGN-OFF"
    fi
  else
    echo "  ERROR: No RTM entry found for $REQ in compliance/RTM.md"
    EXIT_CODE=1
  fi

  # Check release ticket exists. Accepts the superseded-releases/
  # location as a valid terminal home (mirrors pending- and
  # approved-releases/) so SUPERSEDED REQs don't block CI (#232).
  TICKET_PATTERN="compliance/pending-releases/RELEASE-TICKET-${REQ}*"
  APPROVED_PATTERN="compliance/approved-releases/RELEASE-TICKET-${REQ}*"
  SUPERSEDED_PATTERN="compliance/superseded-releases/RELEASE-TICKET-${REQ}*"

  # devaudit-installer#193 — duplicate-ticket guard. A ticket must live
  # in exactly ONE release directory. A pending copy left behind after
  # close-out (e.g. carried back by a stale-branch merge) poisons the
  # evidence-completeness gate for unrelated REQs (#192). Fail fast with
  # an actionable message instead of letting the duplicate surface as an
  # opaque gate failure downstream.
  LOCATIONS=0
  compgen -G "$TICKET_PATTERN"     > /dev/null 2>&1 && LOCATIONS=$((LOCATIONS+1))
  compgen -G "$APPROVED_PATTERN"   > /dev/null 2>&1 && LOCATIONS=$((LOCATIONS+1))
  compgen -G "$SUPERSEDED_PATTERN" > /dev/null 2>&1 && LOCATIONS=$((LOCATIONS+1))
  if [ "$LOCATIONS" -gt 1 ]; then
    echo "  ERROR: RELEASE-TICKET-${REQ} exists in more than one release directory (pending/approved/superseded). Remove the stale pending copy — it will break the evidence-completeness gate (#192)."
    EXIT_CODE=1
  elif [ "$LOCATIONS" -eq 1 ]; then
    echo "  OK: Release ticket exists"
  else
    echo "  ERROR: Release ticket missing: compliance/pending-releases/RELEASE-TICKET-${REQ}.md"
    EXIT_CODE=1
  fi

  # Check implementation-plan.md for MEDIUM/HIGH risk (check RTM for risk level)
  if grep "$REQ" compliance/RTM.md 2>/dev/null | grep -qiE 'MEDIUM|HIGH'; then
    if [ ! -f "compliance/evidence/$REQ/implementation-plan.md" ]; then
      echo "  ERROR: Implementation plan missing for MEDIUM/HIGH risk: compliance/evidence/$REQ/implementation-plan.md"
      EXIT_CODE=1
    else
      echo "  OK: implementation-plan.md exists (MEDIUM/HIGH risk)"
    fi

    # Check AI prompt log for MEDIUM/HIGH with AI involvement
    if [ -f "compliance/evidence/$REQ/ai-use-note.md" ] && [ ! -f "compliance/evidence/$REQ/ai-prompts.md" ]; then
      echo "  WARNING: AI use noted but ai-prompts.md missing for MEDIUM/HIGH risk"
    fi
  fi

  echo ""
done

# Check that RTM was updated in this PR
if git diff --name-only "$BASE_BRANCH"...HEAD | grep -q 'compliance/RTM.md'; then
  echo "OK: compliance/RTM.md was updated in this PR"
else
  echo "WARNING: compliance/RTM.md was not modified in this PR"
fi

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "=== All compliance artifact checks passed ==="
else
  echo "=== FAILED: Missing required compliance artifacts ==="
fi

exit $EXIT_CODE
