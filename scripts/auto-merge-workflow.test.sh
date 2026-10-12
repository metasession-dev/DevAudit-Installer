#!/usr/bin/env bash
# Workflow contract coverage for DevAudit-Installer#454.
# Uses grep -F (not rg) so it runs on stock runners (#984).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/auto-merge.yml"

grep -qF -- 'GITHUB_EVENT_PATH' "$WORKFLOW"
if grep -qF -- 'EVENT_PATH: ${{ github.event_path }}' "$WORKFLOW"; then
  echo 'Auto Merge must use the runner event file, not github.event_path.' >&2
  exit 1
fi
grep -qF -- "github.event.check_run.conclusion == 'success'" "$WORKFLOW"
grep -qF -- 'group: auto-merge-${{ github.event.check_run.head_sha }}' "$WORKFLOW"
grep -qF -- 'actions/checkout@v6' "$WORKFLOW"
grep -qF -- 'ref: ${{ github.event.repository.default_branch }}' "$WORKFLOW"
grep -qF -- 'persist-credentials: false' "$WORKFLOW"
grep -qF -- 'resolve-auto-merge-pr.sh' "$WORKFLOW"
grep -qF -- 'verify-auto-merge-checks.sh' "$WORKFLOW"

checkout_line="$(grep -nF -- 'actions/checkout@v6' "$WORKFLOW" | cut -d: -f1)"
helper_line="$(grep -nF -- 'resolve-auto-merge-pr.sh' "$WORKFLOW" | head -n1 | cut -d: -f1)"
if [ "$checkout_line" -ge "$helper_line" ]; then
  echo 'Auto Merge must check out the default branch before invoking its helper.' >&2
  exit 1
fi

echo 'auto-merge workflow contract passed'
