#!/usr/bin/env bash
# record-custom-deployment.test.sh -- tests for record-custom-deployment.sh (devaudit-installer#1022).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"; HELPER="$ROOT/record-custom-deployment.sh"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT; PASS=0; FAIL=0
ok(){ echo "  ok $1"; PASS=$((PASS+1)); }; no(){ echo "  FAIL $1"; FAIL=$((FAIL+1)); }
mkdir -p "$WORK/bin"
cat >"$WORK/bin/gh" <<'EOF2'
#!/usr/bin/env bash
echo "gh $*" >> "$MOCK_GH_LOG"
# capture stdin of --input -
if [[ "$*" == *"--input -"* ]]; then cat > "$MOCK_GH_STDIN"; fi
if [ -n "${MOCK_GH_FAIL:-}" ]; then echo '{"message":"Validation Failed","errors":[{"code":"custom"}]}' >&2; exit 1; fi
if [[ "$*" == *"/deployments "* ]] && [[ "$*" != *"statuses"* ]]; then R="${MOCK_GH_RESPONSE-}"; [ -n "$R" ] || R='{"id":4242}'; printf '%s' "$R"; fi
EOF2
cat >"$WORK/bin/curl" <<'EOF2'
#!/usr/bin/env bash
# Counts calls; MOCK_SHA_AFTER=N makes the Nth+ call return the new SHA, earlier calls the old one.
N=$(( $(cat "$MOCK_COUNT" 2>/dev/null || echo 0) + 1 )); echo "$N" > "$MOCK_COUNT"
echo "curl $*" >> "$MOCK_CURL_LOG"
URL=""; WRITE=""; prev=""
for a in "$@"; do [ "$prev" = "-w" ] && WRITE="$a"; prev="$a"; case "$a" in http*) URL="$a" ;; esac; done
if [ -n "$WRITE" ]; then printf '%s' "${MOCK_HTTP:-200}"; exit 0; fi
if [ "$N" -ge "${MOCK_SHA_AFTER:-1}" ]; then printf '%s' "${MOCK_BODY_NEW:-}"; else printf '%s' "${MOCK_BODY_OLD:-}"; fi
EOF2
chmod +x "$WORK/bin/"*
run(){ (cd "$WORK"; env PATH="$WORK/bin:$PATH" MOCK_GH_LOG="$WORK/gh.log" MOCK_GH_STDIN="$WORK/stdin.json" MOCK_CURL_LOG="$WORK/curl.log" MOCK_COUNT="$WORK/count" "$@"); }
reset(){ rm -f "$WORK/gh.log" "$WORK/stdin.json" "$WORK/curl.log" "$WORK/count"; }

echo "== create"
reset
ID=$(run bash "$HELPER" create --repo=org/app --sha=abc123 --description="deploy abc123")
[ "$ID" = "4242" ] && ok create_prints_id || no create_prints_id
jq -e '.ref == "abc123" and .environment == "production" and .required_contexts == [] and .auto_merge == false and .production_environment == true' "$WORK/stdin.json" >/dev/null && ok create_payload || no create_payload
if run env MOCK_GH_RESPONSE='{"message":"nope"}' bash "$HELPER" create --repo=org/app --sha=abc >/dev/null 2>&1; then no create_without_id_fails; else ok create_without_id_fails; fi
if bash "$HELPER" create --repo=org/app >/dev/null 2>&1; then no create_requires_sha; else ok create_requires_sha; fi

echo "== status"
reset
run bash "$HELPER" status --repo=org/app --deployment-id=4242 --state=success --url=https://app.test --description=done >/dev/null && ok status_success || no status_success
grep -q 'deployments/4242/statuses' "$WORK/gh.log" && grep -q 'state=success' "$WORK/gh.log" && grep -q 'environment_url=https://app.test' "$WORK/gh.log" && ok status_args || no status_args
if bash "$HELPER" status --repo=org/app --deployment-id=1 --state=bogus >/dev/null 2>&1; then no status_rejects_bad_state; else ok status_rejects_bad_state; fi
if run env MOCK_GH_FAIL=1 bash "$HELPER" status --repo=org/app --deployment-id=1 --state=failure >"$WORK/out.log" 2>&1; then no status_failure_propagates; else ok status_failure_propagates; fi
grep -q 'errors' "$WORK/out.log" && ok status_failure_body_captured || no status_failure_body_captured

echo "== verify"
reset
run env MOCK_BODY_NEW='{"version":{"sha":"abc123def"}}' bash "$HELPER" verify --sha=abc123def --sha-url=https://app.test/version --sha-jq=.version.sha --max-attempts=3 --poll-seconds=0 >/dev/null && ok verify_jq_match || no verify_jq_match
reset
run env MOCK_BODY_NEW='{"sha":"abc123"}' bash "$HELPER" verify --sha=abc123def456 --sha-url=https://app.test/v --sha-jq=.sha --max-attempts=2 --poll-seconds=0 >/dev/null && ok verify_abbreviated_sha_matches || no verify_abbreviated_sha_matches
reset
run env MOCK_BODY_NEW='built from abc123def' bash "$HELPER" verify --sha=abc123def --sha-url=https://app.test/v --max-attempts=2 --poll-seconds=0 >/dev/null && ok verify_body_contains_sha || no verify_body_contains_sha
reset
# the old build answers first, the new one on the 3rd poll
run env MOCK_SHA_AFTER=3 MOCK_BODY_OLD='{"sha":"oldoldold"}' MOCK_BODY_NEW='{"sha":"abc123def"}' bash "$HELPER" verify --sha=abc123def --sha-url=https://app.test/v --sha-jq=.sha --max-attempts=5 --poll-seconds=0 >/dev/null && ok verify_waits_for_the_new_build || no verify_waits_for_the_new_build
[ "$(cat "$WORK/count")" = "3" ] && ok verify_polled_until_new_build || no verify_polled_until_new_build
reset
if run env MOCK_BODY_NEW='{"sha":"oldoldold"}' bash "$HELPER" verify --sha=abc123def --sha-url=https://app.test/v --sha-jq=.sha --max-attempts=2 --poll-seconds=0 >"$WORK/out.log" 2>&1; then no verify_times_out_on_old_build; else ok verify_times_out_on_old_build; fi
grep -q 'was not confirmed after 2 attempts' "$WORK/out.log" && ok verify_timeout_message || no verify_timeout_message
reset
run env MOCK_HTTP=204 bash "$HELPER" verify --sha=abc --health-url=https://app.test/health --max-attempts=2 --poll-seconds=0 >"$WORK/out.log" 2>&1 && ok verify_health_fallback || no verify_health_fallback
grep -q 'does not prove the new build' "$WORK/out.log" && ok verify_health_is_flagged_as_weaker || no verify_health_is_flagged_as_weaker
reset
if run env MOCK_HTTP=503 bash "$HELPER" verify --sha=abc --health-url=https://app.test/health --max-attempts=2 --poll-seconds=0 >/dev/null 2>&1; then no verify_health_failure; else ok verify_health_failure; fi
reset
run env DEVAUDIT_PROBE_HEADER='x-gate: tok' MOCK_BODY_NEW='abc' bash "$HELPER" verify --sha=abc --sha-url=https://app.test/v --max-attempts=1 --poll-seconds=0 >/dev/null 2>&1 || true
grep -q 'x-gate: tok' "$WORK/curl.log" && ok verify_sends_probe_header || no verify_sends_probe_header
if bash "$HELPER" verify --sha=abc >/dev/null 2>&1; then no verify_needs_a_url; else ok verify_needs_a_url; fi
if bash "$HELPER" nosuchcommand >/dev/null 2>&1; then no unknown_command_fails; else ok unknown_command_fails; fi

echo "$PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
