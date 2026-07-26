#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EVIDENCE="$ROOT/sdlc/files/ci/compliance-evidence.yml.template"
NODE_CI="$ROOT/sdlc/files/ci/ci.yml.template"
PYTHON_CI="$ROOT/sdlc/files/ci/python/ci.yml.template"

housekeeping_line="$(grep -n 'No tracked REQ was executed for standalone/integration housekeeping' "$EVIDENCE" | cut -d: -f1)"
deployment_failure_line="$(grep -n 'Deployment-origin E2E evidence requires tagged or in-scope REQ attribution' "$EVIDENCE" | cut -d: -f1)"
if [ "$housekeeping_line" -ge "$deployment_failure_line" ]; then
  echo "Bare-date housekeeping must exit before the tracked deployment attribution failure." >&2
  exit 1
fi

expected="github.event_name != 'pull_request' && github.ref_name == '{{INTEGRATION_BRANCH}}' && needs.register-release.result == 'success'"
grep -Fq "$expected" "$NODE_CI"
grep -Fq "$expected" "$PYTHON_CI"

if grep -A12 '^  upload-evidence:' "$NODE_CI" | grep -Fq 'if: ${{ always()'; then
  echo "Node Upload Evidence must not use always() for inapplicable PR jobs." >&2
  exit 1
fi
if grep -A12 '^  upload-evidence:' "$PYTHON_CI" | grep -Fq 'if: ${{ always()'; then
  echo "Python Upload Evidence must not use always() for inapplicable PR jobs." >&2
  exit 1
fi

echo "release routing contract passed"
