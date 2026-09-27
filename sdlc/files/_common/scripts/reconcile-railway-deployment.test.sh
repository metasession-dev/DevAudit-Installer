#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"; HELPER="$ROOT/reconcile-railway-deployment.sh"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT; PASS=0; FAIL=0
ok(){ echo "  ok $1"; PASS=$((PASS+1)); }; no(){ echo "  FAIL $1"; FAIL=$((FAIL+1)); }
mock() { mkdir -p "$1/bin"; cat >"$1/bin/railway" <<'EOF'
#!/usr/bin/env bash
printf '%s' "$MOCK_RAILWAY_JSON"
EOF
cat >"$1/bin/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s' "${MOCK_HTTP:-200}"
EOF
cat >"$1/bin/gh" <<'EOF'
#!/usr/bin/env bash
if [[ "$*" == *"--jq"* ]]; then
  FILTER=""; prev=""
  for a in "$@"; do [ "$prev" = "--jq" ] && FILTER="$a"; prev="$a"; done
  printf '%s' "${MOCK_EXISTING:-[]}" | jq -cer "$FILTER"
elif [[ "$*" == *"--method POST"* ]] && [ -n "${MOCK_GH_STATUS_FAIL:-}" ]; then
  echo "$*" >> "$MOCK_GH_LOG"
  echo 'gh: Validation Failed (HTTP 422)' >&2
  echo '{"message":"Validation Failed","errors":[{"resource":"DeploymentStatus","code":"custom"}]}' >&2
  exit 1
else echo "$*" >> "$MOCK_GH_LOG"; fi
EOF
chmod +x "$1/bin/"*; }
run(){ local d="$1"; shift; (cd "$d"; PATH="$d/bin:$PATH" MOCK_GH_LOG="$d/gh.log" "$@" bash "$HELPER" --repo=org/app --sha=abc --github-deployment-id=42 --railway-deployment-id=r1 --railway-project=p --railway-service=s --health-url=https://health.test); }
mock "$WORK"
GOOD='[{"id":"r1","status":"SUCCESS","meta":{"repo":"org/app","branch":"main","commitHash":"abc"}}]'
if run "$WORK" env MOCK_RAILWAY_JSON="$GOOD"; then ok valid; else no valid; fi
grep -q '"provenance": "manual_reconciliation"' "$WORK/deployment-reconciliation.json" && ok provenance_evidence || no provenance_evidence
if run "$WORK" env MOCK_RAILWAY_JSON='[{"id":"r1","status":"SUCCESS","meta":{"repo":"org/app","branch":"main","commitHash":"wrong"}}]'; then no sha_mismatch; else ok sha_mismatch; fi
if run "$WORK" env MOCK_RAILWAY_JSON='[{"id":"r1","status":"FAILED","meta":{"repo":"org/app","branch":"main","commitHash":"abc"}}]'; then no provider_failure; else ok provider_failure; fi
if run "$WORK" env MOCK_RAILWAY_JSON="$GOOD" MOCK_HTTP=500; then no health_failure; else ok health_failure; fi
rm -f "$WORK/gh.log"
if run "$WORK" env MOCK_RAILWAY_JSON="$GOOD" MOCK_EXISTING='[{"state":"success","description":"railway_deployment=r1"}]'; then ok idempotent; else no idempotent; fi
[ ! -f "$WORK/gh.log" ] && ok no_duplicate_post || no no_duplicate_post
rm -f "$WORK/gh.log"
if run "$WORK" env MOCK_RAILWAY_JSON="$GOOD" MOCK_GH_STATUS_FAIL=1 >"$WORK/output.log" 2>&1; then no status_post_failure_surfaces_and_fails; else ok status_post_failure_surfaces_and_fails; fi
grep -q 'errors' "$WORK/output.log" && ok status_post_failure_body_captured || no status_post_failure_body_captured
echo "$PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
