#!/usr/bin/env bash
# generate-security-summary.sh
#
# Writes a security-summary stub for a release. Resolves the dangling
# reference in META-COMPLY's release-checklist (the UI hint mentioned a
# generator script that didn't exist).
#
# Usage:
#   bash scripts/generate-security-summary.sh <version> > <out>
#
# - For housekeeping releases (bare-date version), the canonical
#   <out> is `compliance/security-summary-<version>.md` at the
#   compliance root.
# - For tracked releases (REQ-XXX version), the canonical <out> is
#   `compliance/evidence/REQ-XXX/security-summary.md`. The script
#   outputs the same body shape; only the caller decides the path.
#
# Scrapes:
# - `sast-results.json` (Semgrep) — high/critical findings count
# - `dependency-audit.json` (npm audit / pip-audit) — high/critical
#   vulnerability count
# - `dependency-risk-evaluation.json` — governed temporary acceptances
# - `gate-outcomes.json` (DevAudit-Installer v0.1.29) — per-gate
#   pass/fail/skip status
#
# Each source is optional — the stub gracefully reports "not found"
# rather than erroring out. The operator fills in any missing detail
# in the sign-off block before merging the auto-PR.
#
# DevAudit-Installer#116 WS4.

set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "usage: $(basename "$0") <version>" >&2
  exit 2
fi

TODAY=$(date -u +%Y-%m-%d)

# Escape freeform table-cell content so markdownlint does not misparse
# literal pipes as extra columns in generated release evidence.
markdown_table_cell() {
  printf '%s' "${1:-}" | perl -0pe 's/(?<!\\)\|/\\|/g'
}

# Detect release shape from the version.
SHAPE="unknown"
if [[ "$VERSION" =~ ^v[0-9]{4}\.[0-9]{2}\.[0-9]{2}(\.[0-9]+)?$ ]]; then
  SHAPE="housekeeping"
elif [[ "$VERSION" =~ ^REQ- ]]; then
  SHAPE="tracked"
fi

# Helper: scrape Semgrep JSON for high/critical counts. Soft-fails when
# the file is absent or jq isn't available.
sast_summary() {
  if [ ! -f sast-results.json ]; then
    echo "REPLACE — \`sast-results.json\` not present at CWD; check that the SAST gate ran on this commit"
    return
  fi
  if ! command -v jq >/dev/null 2>&1; then
    echo "REPLACE — \`jq\` not available; manually inspect \`sast-results.json\`"
    return
  fi
  local HIGH CRITICAL TOTAL
  HIGH=$(jq -r '[.results[]? | select(.extra.severity == "WARNING" or .extra.severity == "ERROR")] | length' sast-results.json 2>/dev/null || echo "?")
  CRITICAL=$(jq -r '[.results[]? | select(.extra.severity == "ERROR")] | length' sast-results.json 2>/dev/null || echo "?")
  TOTAL=$(jq -r '[.results[]?] | length' sast-results.json 2>/dev/null || echo "?")
  echo "$TOTAL total finding(s) · $HIGH high/warning · $CRITICAL critical/error"
}

# Helper: scrape npm audit JSON. Tolerant of both `npm audit --json`
# shape (vulnerabilities object) and pip-audit shape (vulnerabilities
# array).
dep_audit_summary() {
  if [ ! -f dependency-audit.json ]; then
    echo "REPLACE — \`dependency-audit.json\` not present at CWD; check that the dependency-audit gate ran on this commit"
    return
  fi
  if ! command -v jq >/dev/null 2>&1; then
    echo "REPLACE — \`jq\` not available; manually inspect \`dependency-audit.json\`"
    return
  fi
  # npm audit shape: .vulnerabilities is an object keyed by package
  # name with .severity per row.
  local HIGH CRITICAL TOTAL
  HIGH=$(jq -r '[.vulnerabilities | (if type == "object" then to_entries[] | .value else .[]? end) | select(.severity == "high")] | length' dependency-audit.json 2>/dev/null || echo "?")
  CRITICAL=$(jq -r '[.vulnerabilities | (if type == "object" then to_entries[] | .value else .[]? end) | select(.severity == "critical")] | length' dependency-audit.json 2>/dev/null || echo "?")
  TOTAL=$(jq -r '[.vulnerabilities | (if type == "object" then to_entries[] | .value else .[]? end)] | length' dependency-audit.json 2>/dev/null || echo "?")
  echo "$TOTAL total vulnerability/ies · $HIGH high · $CRITICAL critical"
}

risk_acceptance_summary() {
  if [ ! -f dependency-risk-evaluation.json ]; then
    echo "No dependency-risk decision artifact was present for this run."
    return
  fi
  if ! command -v jq >/dev/null 2>&1; then
    echo "REPLACE — \`jq\` not available; inspect \`dependency-risk-evaluation.json\` manually"
    return
  fi
  jq -r '
    if (.accepted | length) == 0 then
      "No temporary high/critical dependency risks were accepted."
    else
      .accepted[] | "- Accepted \(.advisoryId) — \(.package)@\(.vulnerableVersion), introduced by \(.introducedBy), expires \(.acceptance.expiresAt), owner \(.acceptance.approvedBy), remediation \(.acceptance.remediationIssue)"
    end
  ' dependency-risk-evaluation.json 2>/dev/null \
    || echo "REPLACE — could not parse \`dependency-risk-evaluation.json\`"
}

# Helper: gate-outcomes.json (DevAudit-Installer v0.1.29 onwards).
gate_outcomes_summary() {
  if [ ! -f gate-outcomes.json ]; then
    echo "REPLACE — \`gate-outcomes.json\` not present at CWD"
    return
  fi
  if ! command -v jq >/dev/null 2>&1; then
    echo "REPLACE — \`jq\` not available; manually inspect \`gate-outcomes.json\`"
    return
  fi
  jq -r 'to_entries[] | "- **\(.key)** — \(.value // "?")"' gate-outcomes.json 2>/dev/null \
    || echo "REPLACE — could not parse gate-outcomes.json"
}

SAST_SUMMARY=$(sast_summary)
DEP_SUMMARY=$(dep_audit_summary)
RISK_ACCEPTANCE_SUMMARY=$(risk_acceptance_summary)
GATES=$(gate_outcomes_summary)

cat <<EOF
---
version: "$VERSION"
release_shape: $SHAPE
generated_at: "$TODAY"
last_reviewed_at: "$TODAY"
generated_by: "generate-security-summary.sh (DevAudit-Installer#116)"
---

> ⚠️ **AUTO-GENERATED STUB — REVIEW BEFORE MERGE**
>
> This security summary was auto-generated by CI from the SAST and
> dependency-audit gate JSON. The operator should:
>
> 1. Confirm the **findings summary** matches what they saw on the
>    gate panel for this release.
> 2. Replace any \`REPLACE — …\` markers below (typically the access-
>    control + audit-log assessment, which the gates can't infer).
> 3. Sign off in the **Sign-off** block before this PR merges.

# Security Summary — $VERSION

**Release shape:** $SHAPE
**Generated:** $TODAY
**Source data:** \`sast-results.json\` + \`dependency-audit.json\` + \`dependency-risk-evaluation.json\` + \`gate-outcomes.json\` (this CI run)

## SAST findings (Semgrep)

$SAST_SUMMARY

> **Policy:** the SAST gate fails the build at \`high\` or \`critical\` severity. If this release shipped, both are zero.

## Dependency vulnerabilities

$DEP_SUMMARY

> **Policy:** the dependency-audit gate fails at \`high\` or \`critical\` severity unless every affected advisory has an exact, unexpired, reviewer-attributed acceptance. The raw audit count may therefore be non-zero only when the governed decision record below identifies the accepted risk.

## Governed temporary dependency risks

$RISK_ACCEPTANCE_SUMMARY

## Gate outcomes (per CI run)

$GATES

## Access control + audit log

> When editing any markdown table below, escape literal pipe characters in cell
> content as \`\\|\` so RTM/release-evidence tables stay lint-safe.

| Check | Result | Notes |
| --- | --- | --- |
| Access control unchanged | $(markdown_table_cell "REPLACE — yes/no") | If yes, no further work. If no, document the auth/RBAC delta and confirm it landed an audit event. |
| Audit log append-only invariant preserved | $(markdown_table_cell "REPLACE — yes/no") | If yes, no further work. If no, document why and confirm the change has independent review. |
| Sensitive data exposure | $(markdown_table_cell "REPLACE — yes/no") | If yes, escalate to the GDPR triage in \`compliance/governance/dpia.md\` before merging. |

## Risk Assessment

REPLACE — one paragraph summarising the security posture of this release. For housekeeping releases the typical wording is *"No code paths touched; security posture unchanged from the previous release."* For tracked releases name the touched modules + threat model assessment.

---

## Sign-off

| Role | Name | Date | Notes |
| --- | --- | --- | --- |
| Author | devaudit-bot (auto-generated) | $TODAY | Stub generated from CI gate JSON |
| Reviewer | REPLACE | REPLACE | REPLACE |

Once reviewed + signed off, this file is uploaded as evidence by the next \`compliance-evidence.yml\` run; the portal's release-completeness checklist flips the security-summary item to ✓.
EOF
