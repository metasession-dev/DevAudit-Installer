#!/usr/bin/env bash
# Regression coverage for DevAudit-Installer#454.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="$ROOT/scripts/resolve-auto-merge-pr.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cat > "$WORK/associated.json" <<'EOF'
{"check_run":{"pull_requests":[{"number":454}]}}
EOF
cat > "$WORK/unassociated.json" <<'EOF'
{"check_run":{"pull_requests":[]}}
EOF
printf '{not json' > "$WORK/malformed.json"

[ "$(bash "$HELPER" "$WORK/associated.json")" = "454" ]
[ -z "$(bash "$HELPER" "$WORK/unassociated.json")" ]
[ -z "$(bash "$HELPER" "$WORK/malformed.json")" ]
[ -z "$(bash "$HELPER" "$WORK/missing.json")" ]

echo 'resolve-auto-merge-pr regression test passed'
