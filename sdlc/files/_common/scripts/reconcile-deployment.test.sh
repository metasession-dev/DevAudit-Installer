#!/usr/bin/env bash
# reconcile-deployment.test.sh -- tests for reconcile-deployment.sh and the per-host
# lookup scripts (devaudit-installer#1022; ported from reconcile-railway-deployment.test.sh, #841/#842).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT; PASS=0; FAIL=0
ok(){ echo "  ok $1"; PASS=$((PASS+1)); }; no(){ echo "  FAIL $1"; FAIL=$((FAIL+1)); }

# A consumer-shaped scripts/ dir plus mock railway / curl / gh on PATH.
mkdir -p "$WORK/scripts" "$WORK/bin"
for f in reconcile-deployment.sh lookup-deployment-railway.sh lookup-deployment-vercel.sh; do cp "$ROOT/$f" "$WORK/scripts/$f"; done
cat >"$WORK/bin/railway" <<'EOF2'
#!/usr/bin/env bash
printf '%s' "$MOCK_RAILWAY_JSON"
EOF2
cat >"$WORK/bin/curl" <<'EOF2'
#!/usr/bin/env bash
# Vercel API calls (api.vercel.com or VERCEL_API_BASE) write MOCK_VERCEL_JSON to the -o file and print
# MOCK_VERCEL_CODE; every other call is the health probe and prints MOCK_HTTP. Args are logged.
echo "curl $*" >> "${MOCK_CURL_LOG:-/dev/null}"
OUT=""; URL=""; prev=""
for a in "$@"; do [ "$prev" = "-o" ] && OUT="$a"; prev="$a"; case "$a" in http*) URL="$a" ;; esac; done
if [[ "$URL" == *"/v13/deployments/"* ]]; then
  J="${MOCK_VERCEL_JSON-}"; [ -n "$J" ] || J='{}'   # not ${VAR:-{}}: the first } would close the expansion
  [ -n "$OUT" ] && [ "$OUT" != "/dev/null" ] && printf '%s' "$J" > "$OUT"
  printf '%s' "${MOCK_VERCEL_CODE:-200}"
else
  printf '%s' "${MOCK_HTTP:-200}"
fi
EOF2
cat >"$WORK/bin/gh" <<'EOF2'
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
EOF2
chmod +x "$WORK/bin/"*

# run <provider> <ENV=VAL...> -- <extra args...>
run(){ local provider="$1"; shift; (cd "$WORK"; env PATH="$WORK/bin:$PATH" MOCK_GH_LOG="$WORK/gh.log" MOCK_CURL_LOG="$WORK/curl.log" "$@" \
  bash scripts/reconcile-deployment.sh --provider="$provider" --repo=org/app --sha=abc --github-deployment-id=42 \
  --provider-deployment-id=r1 --provider-project=p --provider-service=s --health-url=https://health.test); }

echo "== railway"
GOOD='[{"id":"r1","status":"SUCCESS","meta":{"repo":"org/app","branch":"main","commitHash":"abc"}}]'
if run railway MOCK_RAILWAY_JSON="$GOOD"; then ok valid; else no valid; fi
grep -q '"provenance": "manual_reconciliation"' "$WORK/deployment-reconciliation.json" && ok provenance_evidence || no provenance_evidence
grep -q '"provider": "railway"' "$WORK/deployment-reconciliation.json" && ok provider_recorded || no provider_recorded
grep -q 'provider_deployment=r1' "$WORK/gh.log" && ok status_description_names_the_deployment || no status_description_names_the_deployment
if run railway MOCK_RAILWAY_JSON='[{"id":"r1","status":"SUCCESS","meta":{"repo":"org/app","branch":"main","commitHash":"wrong"}}]'; then no sha_mismatch; else ok sha_mismatch; fi
if run railway MOCK_RAILWAY_JSON='[{"id":"r1","status":"FAILED","meta":{"repo":"org/app","branch":"main","commitHash":"abc"}}]'; then no provider_failure; else ok provider_failure; fi
if run railway MOCK_RAILWAY_JSON='[{"id":"other","status":"SUCCESS","meta":{"repo":"org/app","branch":"main","commitHash":"abc"}}]'; then no deployment_not_found; else ok deployment_not_found; fi
if run railway MOCK_RAILWAY_JSON="$GOOD" MOCK_HTTP=500; then no health_failure; else ok health_failure; fi
rm -f "$WORK/gh.log"
if run railway MOCK_RAILWAY_JSON="$GOOD" MOCK_EXISTING='[{"state":"success","description":"provider_deployment=r1"}]'; then ok idempotent; else no idempotent; fi
[ ! -f "$WORK/gh.log" ] && ok no_duplicate_post || no no_duplicate_post
rm -f "$WORK/gh.log"
if run railway MOCK_RAILWAY_JSON="$GOOD" MOCK_EXISTING='[{"state":"success","description":"railway_deployment=r1"}]'; then ok idempotent_with_the_pre_1022_description; else no idempotent_with_the_pre_1022_description; fi
[ ! -f "$WORK/gh.log" ] && ok no_duplicate_post_for_old_description || no no_duplicate_post_for_old_description
rm -f "$WORK/gh.log"
if run railway MOCK_RAILWAY_JSON="$GOOD" MOCK_GH_STATUS_FAIL=1 >"$WORK/output.log" 2>&1; then no status_post_failure_surfaces_and_fails; else ok status_post_failure_surfaces_and_fails; fi
grep -q 'errors' "$WORK/output.log" && ok status_post_failure_body_captured || no status_post_failure_body_captured

echo "== vercel"
VGOOD='{"id":"dpl_1","readyState":"READY","target":"production","projectId":"p","meta":{"githubCommitSha":"abc","githubCommitRef":"main","githubOrg":"org","githubRepo":"app"}}'
rm -f "$WORK/gh.log" "$WORK/curl.log"
if run vercel VERCEL_TOKEN=tok MOCK_VERCEL_JSON="$VGOOD"; then ok vercel_valid; else no vercel_valid; fi
grep -q '"provider": "vercel"' "$WORK/deployment-reconciliation.json" && ok vercel_provider_recorded || no vercel_provider_recorded
grep -q 'Authorization: Bearer tok' "$WORK/curl.log" && ok vercel_token_sent || no vercel_token_sent
grep -q 'teamId' "$WORK/curl.log" && no vercel_no_team_by_default || ok vercel_no_team_by_default
rm -f "$WORK/curl.log"
if run vercel VERCEL_TOKEN=tok VERCEL_TEAM_ID=team_9 MOCK_VERCEL_JSON="$VGOOD"; then ok vercel_team_valid; else no vercel_team_valid; fi
grep -q 'teamId=team_9' "$WORK/curl.log" && ok vercel_team_id_sent || no vercel_team_id_sent
if run vercel VERCEL_TOKEN=tok MOCK_VERCEL_JSON="${VGOOD/\"production\"/\"preview\"}"; then no vercel_rejects_preview; else ok vercel_rejects_preview; fi
if run vercel VERCEL_TOKEN=tok MOCK_VERCEL_JSON="${VGOOD/\"projectId\":\"p\"/\"projectId\":\"other\"}"; then no vercel_rejects_other_project; else ok vercel_rejects_other_project; fi
if run vercel VERCEL_TOKEN=tok MOCK_VERCEL_JSON="${VGOOD/READY/ERROR}"; then no vercel_rejects_failed_build; else ok vercel_rejects_failed_build; fi
if run vercel VERCEL_TOKEN=tok MOCK_VERCEL_JSON="${VGOOD/\"githubCommitSha\":\"abc\"/\"githubCommitSha\":\"zzz\"}"; then no vercel_sha_mismatch; else ok vercel_sha_mismatch; fi
if run vercel VERCEL_TOKEN=tok MOCK_VERCEL_JSON="${VGOOD/\"githubRepo\":\"app\"/\"githubRepo\":\"fork\"}"; then no vercel_repo_mismatch; else ok vercel_repo_mismatch; fi
if run vercel VERCEL_TOKEN=tok MOCK_VERCEL_CODE=404 MOCK_VERCEL_JSON='{}'; then no vercel_not_found; else ok vercel_not_found; fi
if run vercel MOCK_VERCEL_JSON="$VGOOD" >"$WORK/output.log" 2>&1; then no vercel_requires_token; else ok vercel_requires_token; fi
grep -q 'VERCEL_TOKEN is not set' "$WORK/output.log" && ok vercel_token_error_is_clear || no vercel_token_error_is_clear

echo "== host-neutral behaviour"
if run nosuchhost >"$WORK/output.log" 2>&1; then no unknown_provider_fails; else ok unknown_provider_fails; fi
grep -q "No provider lookup for host 'nosuchhost'" "$WORK/output.log" && ok unknown_provider_message || no unknown_provider_message
rm -f "$WORK/curl.log"
if run railway MOCK_RAILWAY_JSON="$GOOD" DEVAUDIT_PROBE_HEADER='x-vercel-protection-bypass: tok'; then ok probe_header_run; else no probe_header_run; fi
grep -q 'x-vercel-protection-bypass: tok' "$WORK/curl.log" && ok probe_header_sent_with_the_health_probe || no probe_header_sent_with_the_health_probe
rm -f "$WORK/curl.log"
run railway MOCK_RAILWAY_JSON="$GOOD" >/dev/null 2>&1 || true
grep -q 'x-vercel-protection-bypass' "$WORK/curl.log" && no no_header_when_unset || ok no_header_when_unset
if (cd "$WORK"; bash scripts/reconcile-deployment.sh --provider=railway >/dev/null 2>&1); then no missing_args_fail; else ok missing_args_fail; fi

echo "$PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
