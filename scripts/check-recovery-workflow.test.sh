#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/recover-required-checks.yml"
HELPER="$ROOT/scripts/recover-required-checks.sh"

grep -Fq 'workflow_dispatch:' "$WORKFLOW"
grep -Fq 'actions: write' "$WORKFLOW"
grep -Fq 'scripts/recover-required-checks.sh' "$WORKFLOW"
grep -Fq 'gh run rerun' "$HELPER"
grep -Fq 'git commit --allow-empty' "$HELPER"
grep -Fq 'Do not fabricate a status or bypass protection' "$HELPER"

echo "required-check recovery workflow contract passed"
