#!/usr/bin/env bash
# e2e-data-lifecycle.test.sh — tests for e2e-data-lifecycle.sh (DevAudit-Installer#1116 WP15).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$SCRIPT_DIR/e2e-data-lifecycle.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  PASS: $desc"; PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"; echo "    expected: $expected"; echo "    actual:   $actual"; FAIL=$((FAIL + 1))
  fi
}

# fresh project dir with a config; usage: project <config-json>
project() {
  local dir="$WORK/p$RANDOM$RANDOM"
  mkdir -p "$dir"
  printf '%s' "$1" > "$dir/sdlc-config.json"
  echo "$dir"
}
run() { # run <dir> <args...>; prints the exit code, output to $WORK/out
  local dir="$1"; shift
  ( cd "$dir" && bash "$SCRIPT" "$@" > "$WORK/out" 2>&1 ) && echo 0 || echo $?
}
log_of() { cat "$1/calls.log" 2>/dev/null | tr '\n' ',' ; }

echo "does nothing unless e2e_data_isolation is set and not none"
d="$(project '{"e2e_seed_command":"echo seed >> calls.log","e2e_reset_command":"echo reset >> calls.log"}')"
assert_eq "unset: exit 0" 0 "$(run "$d" before)"
assert_eq "unset: nothing ran, even with a seed command" "" "$(log_of "$d")"
d="$(project '{"e2e_data_isolation":"none","e2e_seed_command":"echo seed >> calls.log"}')"
assert_eq "none: exit 0" 0 "$(run "$d" before)"
assert_eq "none: nothing ran" "" "$(log_of "$d")"

echo "before: reset, seed, preflight in order, each only when set"
d="$(project '{"e2e_data_isolation":"shared_serialised","e2e_reset_command":"echo reset >> calls.log","e2e_seed_command":"echo seed >> calls.log","e2e_preflight_command":"echo preflight >> calls.log"}')"
assert_eq "all set: exit 0" 0 "$(run "$d" before)"
assert_eq "all set: order" "reset,seed,preflight," "$(log_of "$d")"
d="$(project '{"e2e_data_isolation":"ephemeral","e2e_seed_command":"echo seed >> calls.log"}')"
assert_eq "only seed set: exit 0" 0 "$(run "$d" before)"
assert_eq "only seed set: only seed ran" "seed," "$(log_of "$d")"
d="$(project '{"e2e_data_isolation":"ephemeral"}')"
assert_eq "none of the commands set: exit 0" 0 "$(run "$d" before)"

echo "before: a failed command fails the run"
d="$(project '{"e2e_data_isolation":"ephemeral","e2e_seed_command":"echo seed >> calls.log","e2e_preflight_command":"echo preflight >> calls.log; exit 3"}')"
assert_eq "failed preflight: exit 1" 1 "$(run "$d" before)"
assert_eq "failed preflight: the seed ran first" "seed,preflight," "$(log_of "$d")"
assert_eq "failed preflight: says so" 1 "$(grep -c 'e2e_preflight_command failed' "$WORK/out")"
d="$(project '{"e2e_data_isolation":"ephemeral","e2e_seed_command":"exit 4","e2e_preflight_command":"echo preflight >> calls.log"}')"
assert_eq "failed seed: exit 1, preflight never ran" "1|" "$(run "$d" before)|$(log_of "$d")"

echo "after: best-effort reset, leak check, run record"
d="$(project '{"e2e_data_isolation":"shared","e2e_reset_command":"echo reset >> calls.log","e2e_leak_check_command":"echo noise; echo 7","e2e_seed_paths":[]}')"
echo '{"outcome":"passed","exit_code":0}' > "$d/e2e-regression-metadata.json"
echo '{"config":{"workers":2},"suites":[]}' > "$d/results.json"
assert_eq "exit 0" 0 "$(run "$d" before)"
assert_eq "after: exit 0" 0 "$(run "$d" after --results results.json)"
assert_eq "reset ran again after the tests" "reset,reset," "$(log_of "$d")"
assert_eq "data.isolation" shared "$(jq -r '.data.isolation' "$d/e2e-regression-metadata.json")"
assert_eq "data.leakCheck.count is the last line" 7 "$(jq -r '.data.leakCheck.count' "$d/e2e-regression-metadata.json")"
assert_eq "data.leakCheck.ran" true "$(jq -r '.data.leakCheck.ran' "$d/e2e-regression-metadata.json")"
assert_eq "data.reset.ran" true "$(jq -r '.data.reset.ran' "$d/e2e-regression-metadata.json")"
assert_eq "data.workers from the results file" 2 "$(jq -r '.data.workers' "$d/e2e-regression-metadata.json")"
assert_eq "existing fields did not move" "passed" "$(jq -r '.outcome' "$d/e2e-regression-metadata.json")"
assert_eq "only runData field names (absent values are omitted, never null)" "isolation,leakCheck,preflight,reset,skipped,workers" "$(jq -r '.data | del(.seedCommit) | keys | join(",")' "$d/e2e-regression-metadata.json")"
assert_eq "no host, URL or credential in the record" 0 "$(grep -ciE 'https?://|password|token' "$d/e2e-regression-metadata.json" || true)"

echo "after: the leak check never changes the outcome"
d="$(project '{"e2e_data_isolation":"shared","e2e_leak_check_command":"echo not-a-number; exit 9"}')"
echo '{"outcome":"passed"}' > "$d/e2e-regression-metadata.json"
assert_eq "exit 0 despite a failing leak check" 0 "$(run "$d" after)"
assert_eq "count is null when the last line is not an integer" null "$(jq -r '.data.leakCheck.count' "$d/e2e-regression-metadata.json")"

echo "after: reset runs even when the tests failed (the script does not care)"
d="$(project '{"e2e_data_isolation":"shared","e2e_reset_command":"echo reset >> calls.log"}')"
echo '{"outcome":"failed"}' > "$d/e2e-regression-metadata.json"
assert_eq "exit 0" 0 "$(run "$d" after)"
assert_eq "reset ran" "reset," "$(log_of "$d")"
assert_eq "outcome untouched" failed "$(jq -r '.outcome' "$d/e2e-regression-metadata.json")"

echo "skip budget: Playwright JSON"
pw='{"config":{"workers":1},"suites":[{"specs":[{"tests":[
 {"status":"skipped","annotations":[{"type":"skip","description":"no seed user"}]},
 {"status":"skipped","annotations":[{"type":"skip","description":"no seed user"}]},
 {"status":"skipped","annotations":[]},
 {"status":"expected","annotations":[]}]}]}]}'
d="$(project '{"e2e_data_isolation":"ephemeral","e2e_max_skipped":2}')"
echo '{"outcome":"passed"}' > "$d/e2e-regression-metadata.json"; echo "$pw" > "$d/r.json"
assert_eq "3 skipped over a budget of 2: exit 1" 1 "$(run "$d" after --results r.json)"
assert_eq "skipped count" 3 "$(jq -r '.data.skipped.count' "$d/e2e-regression-metadata.json")"
assert_eq "reasons counted, no reason is unspecified" "2,1" "$(jq -r '[.data.skipped.byReason["no seed user"], .data.skipped.byReason["unspecified"]] | join(",")' "$d/e2e-regression-metadata.json")"
assert_eq "the recorded outcome becomes failed" failed "$(jq -r '.outcome' "$d/e2e-regression-metadata.json")"
d="$(project '{"e2e_data_isolation":"ephemeral","e2e_max_skipped":3}')"
echo '{"outcome":"passed"}' > "$d/e2e-regression-metadata.json"; echo "$pw" > "$d/r.json"
assert_eq "3 skipped within a budget of 3: exit 0" 0 "$(run "$d" after --results r.json)"
d="$(project '{"e2e_data_isolation":"ephemeral"}')"
echo '{"outcome":"passed"}' > "$d/e2e-regression-metadata.json"; echo "$pw" > "$d/r.json"
assert_eq "no budget: report only, exit 0" 0 "$(run "$d" after --results r.json)"
assert_eq "no budget: still counted" 3 "$(jq -r '.data.skipped.count' "$d/e2e-regression-metadata.json")"

echo "run record: what the portal accepts"
d="$(project '{"e2e_data_isolation":"ephemeral"}')"
echo '{"outcome":"passed"}' > "$d/e2e-regression-metadata.json"
( cd "$d" && GITHUB_SHA=abc123 bash "$SCRIPT" before >/dev/null 2>&1; GITHUB_SHA=abc123 bash "$SCRIPT" after >/dev/null 2>&1 )
assert_eq "seedFilesHash is omitted when there are no seed files" false "$(jq 'has("seedFilesHash") or (.data | has("seedFilesHash"))' "$d/e2e-regression-metadata.json")"
assert_eq "workers is omitted when unknown" false "$(jq '.data | has("workers")' "$d/e2e-regression-metadata.json")"
assert_eq "seedCommit is kept" abc123 "$(jq -r '.data.seedCommit' "$d/e2e-regression-metadata.json")"
d="$(project '{"e2e_data_isolation":"ephemeral","e2e_seed_paths":["seed/"]}')"
( cd "$d" && git init -q && mkdir -p seed && printf 'a' > seed/a.sql && git add -A )
echo '{"outcome":"passed"}' > "$d/e2e-regression-metadata.json"
( cd "$d" && bash "$SCRIPT" before >/dev/null 2>&1; bash "$SCRIPT" after >/dev/null 2>&1 )
assert_eq "seedFilesHash is 64 lowercase hex when there are seed files" true "$(jq '.data.seedFilesHash | test("^[a-f0-9]{64}$")' "$d/e2e-regression-metadata.json")"
long="$(printf 'x%.0s' $(seq 1 250))"
many="$(jq -nc --arg long "$long" '([range(0;60)] | map({status:"skipped",annotations:[{type:"skip",description:("r"+tostring)}]})) as $a | {config:{workers:1},suites:[{specs:[{tests: ($a + [{status:"skipped",annotations:[{type:"skip",description:$long}]}])}]}]}')"
d="$(project '{"e2e_data_isolation":"ephemeral"}')"
echo '{"outcome":"passed"}' > "$d/e2e-regression-metadata.json"; echo "$many" > "$d/r.json"
assert_eq "many skip reasons: exit 0" 0 "$(run "$d" after --results r.json)"
assert_eq "at most 50 distinct reasons" true "$(jq '(.data.skipped.byReason | length) <= 50' "$d/e2e-regression-metadata.json")"
assert_eq "no reason is longer than 200 characters" true "$(jq '[.data.skipped.byReason | keys[] | length] | max <= 200' "$d/e2e-regression-metadata.json")"
assert_eq "the count still counts every skipped test" 61 "$(jq '.data.skipped.count' "$d/e2e-regression-metadata.json")"

echo "isolation unknown does nothing (like unset)"
d="$(project '{"e2e_data_isolation":"unknown","e2e_seed_command":"echo seed >> calls.log"}')"
assert_eq "unknown: exit 0" 0 "$(run "$d" before)"
assert_eq "unknown: nothing ran" "" "$(log_of "$d")"

echo "skip budget: pytest JUnit XML"
xml='<testsuites><testsuite><testcase name="a"><skipped message="needs seed row" type="pytest.skip"/></testcase><testcase name="b"><skipped type="pytest.skip"/></testcase><testcase name="c"/></testsuite></testsuites>'
d="$(project '{"e2e_data_isolation":"ephemeral","e2e_max_skipped":1}')"
echo '{"outcome":"passed"}' > "$d/e2e-regression-metadata.json"; echo "$xml" > "$d/r.xml"
assert_eq "2 skipped over a budget of 1: exit 1" 1 "$(run "$d" after --results r.xml)"
assert_eq "reasons from the message attribute" "1,1" "$(jq -r '[.data.skipped.byReason["needs seed row"], .data.skipped.byReason["unspecified"]] | join(",")' "$d/e2e-regression-metadata.json")"

echo "after without a results file or metadata does not fail"
d="$(project '{"e2e_data_isolation":"ephemeral"}')"
assert_eq "exit 0" 0 "$(run "$d" after)"

echo "hash: git-tracked files, sorted bytewise, one line per file, sha256 of the lines"
d="$(project '{"e2e_data_isolation":"ephemeral","e2e_seed_paths":["seed/"]}')"
( cd "$d" && git init -q && mkdir -p seed && printf 'b' > seed/b.sql && printf 'a' > seed/a.sql && printf 'x' > seed/untracked.sql \
  && git add sdlc-config.json seed/a.sql seed/b.sql && true )
expected="$( { printf '%s  %s\n' "$(printf 'a' | sha256sum | cut -d' ' -f1)" seed/a.sql; printf '%s  %s\n' "$(printf 'b' | sha256sum | cut -d' ' -f1)" seed/b.sql; } | sha256sum | cut -d' ' -f1 )"
actual="$( cd "$d" && bash "$SCRIPT" hash )"
assert_eq "hash of the tracked seed files (untracked ignored)" "$expected" "$actual"
assert_eq "explicit paths give the same hash" "$expected" "$( cd "$d" && bash "$SCRIPT" hash seed/ )"
assert_eq "no paths: empty" "" "$( cd "$d" && bash "$SCRIPT" hash nothing-here-xyz | grep -v '^e3b0' || true )"

echo "usage"
d="$(project '{"e2e_data_isolation":"ephemeral"}')"
assert_eq "unknown mode: exit 2" 2 "$(run "$d" bogus)"

echo ""
echo "e2e-data-lifecycle.test.sh: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
