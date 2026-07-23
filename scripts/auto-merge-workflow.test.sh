#!/usr/bin/env bash
# Workflow contract coverage for DevAudit-Installer#454.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/auto-merge.yml"

rg -q --fixed-strings 'GITHUB_EVENT_PATH' "$WORKFLOW"
if rg -q --fixed-strings 'EVENT_PATH: ${{ github.event_path }}' "$WORKFLOW"; then
  echo 'Auto Merge must use the runner event file, not github.event_path.' >&2
  exit 1
fi
rg -q --fixed-strings "github.event.check_run.conclusion == 'success'" "$WORKFLOW"
rg -q --fixed-strings 'group: auto-merge-${{ github.event.check_run.head_sha }}' "$WORKFLOW"
rg -q --fixed-strings 'actions/checkout@v4' "$WORKFLOW"
rg -q --fixed-strings 'ref: ${{ github.event.repository.default_branch }}' "$WORKFLOW"
rg -q --fixed-strings 'persist-credentials: false' "$WORKFLOW"
rg -q --fixed-strings 'resolve-auto-merge-pr.sh' "$WORKFLOW"
rg -q --fixed-strings 'verify-auto-merge-checks.sh' "$WORKFLOW"

checkout_line="$(rg -n --fixed-strings 'actions/checkout@v4' "$WORKFLOW" | cut -d: -f1)"
helper_line="$(rg -n --fixed-strings 'resolve-auto-merge-pr.sh' "$WORKFLOW" | head -n1 | cut -d: -f1)"
if [ "$checkout_line" -ge "$helper_line" ]; then
  echo 'Auto Merge must check out the default branch before invoking its helper.' >&2
  exit 1
fi

echo 'auto-merge workflow contract passed'
