#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if rg -n \
  'uses:\s*actions/(checkout|setup-node|upload-artifact)@v4|runs:\s*using:\s*["'\'']?node20' \
  "$ROOT/.github" "$ROOT/sdlc" \
  --glob '*.yml' --glob '*.yaml' --glob '*.template'; then
  echo "Unsupported Node 20 official-action runtime remains." >&2
  exit 1
fi

if rg -n 'ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION' "$ROOT/.github" "$ROOT/sdlc"; then
  echo "Node action-runtime compatibility bypasses are forbidden." >&2
  exit 1
fi

echo "action runtime contract passed"
