#!/usr/bin/env bash
# e2e-data-lifecycle.sh — the test-data lifecycle of the regression run (DevAudit-Installer#1116 WP15).
#
# DevAudit owns the contract (what is declared), the checks and the run record; the project owns the
# implementation (schema, seed and reset scripts, fixtures). This script only runs the commands the
# project declares in sdlc-config.json, and records what happened. It never generates project data code.
#
# Usage:
#   e2e-data-lifecycle.sh before
#       e2e_reset_command, then e2e_seed_command, then e2e_preflight_command (each only when set).
#       A failed command fails the run: a failed preflight is never turned into a skip.
#   e2e-data-lifecycle.sh after [--results <file>] [--metadata <file>]
#       A best-effort e2e_reset_command, then e2e_leak_check_command (its last line of output is the
#       number of rows left behind; its exit code is ignored and it never changes the outcome), then the
#       skip budget (e2e_max_skipped) over the results file, and the `data` object of the run record is
#       written into the metadata file. Exits 1 only when the skip budget is exceeded.
#   e2e-data-lifecycle.sh hash [<seed path>...]
#       The seed files hash (paths default to e2e_seed_paths): the git-tracked files under the paths,
#       sorted bytewise, one line "<sha256 hex of the file>  <path>" each, then the sha256 of those lines.
#
# Does nothing unless e2e_data_isolation is set to something other than `none`.
#
# Environment (all optional): E2E_DATA_CONFIG (default sdlc-config.json), E2E_DATA_STATE (default
# .e2e-data-lifecycle.json), E2E_RESULTS_FILE, E2E_METADATA_FILE (default e2e-regression-metadata.json).

set -uo pipefail

CONFIG="${E2E_DATA_CONFIG:-sdlc-config.json}"
STATE="${E2E_DATA_STATE:-.e2e-data-lifecycle.json}"

cfg() { jq -r "${1} // empty" "$CONFIG" 2>/dev/null || true; }

sha256_of_stdin() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | cut -d' ' -f1; else shasum -a 256 | cut -d' ' -f1; fi
}

# The one hash definition shared with `@metasession.co/devaudit-core` (seedFilesHash).
seed_hash() {
  [ "$#" -gt 0 ] || { echo ""; return 0; }
  git ls-files -z -- "$@" 2>/dev/null | LC_ALL=C sort -z | while IFS= read -r -d '' f; do
    printf '%s  %s\n' "$(sha256_of_stdin < "$f")" "$f"
  done | sha256_of_stdin
}

seed_paths() { jq -r '(.e2e_seed_paths // []) | if type == "array" then .[] else empty end' "$CONFIG" 2>/dev/null || true; }

state_get() { jq -r "$1" "$STATE" 2>/dev/null || true; }
state_update() { # state_update <jq filter> [jq args...]
  local filter="$1"; shift
  [ -f "$STATE" ] || echo '{}' > "$STATE"
  jq "$@" "$filter" "$STATE" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"
}

run_declared() { # run_declared <label> <command>; echoes nothing, returns the command's exit code
  echo "::group::e2e data: $1"
  bash -c "$2"
  local code=$?
  echo "::endgroup::"
  return "$code"
}

MODE="${1:-}"
[ "$#" -gt 0 ] && shift

if [ "$MODE" = hash ]; then
  if [ "$#" -gt 0 ]; then seed_hash "$@"; else
    PATHS=(); while IFS= read -r p; do [ -n "$p" ] && PATHS+=("$p"); done < <(seed_paths)
    seed_hash "${PATHS[@]+"${PATHS[@]}"}"
  fi
  exit 0
fi

ISOLATION="$(cfg '.e2e_data_isolation')"
if [ -z "$ISOLATION" ] || [ "$ISOLATION" = none ]; then
  echo "e2e-data-lifecycle: e2e_data_isolation is not set (or none); nothing to do."
  exit 0
fi

RESET_CMD="$(cfg '.e2e_reset_command')"
SEED_CMD="$(cfg '.e2e_seed_command')"
PREFLIGHT_CMD="$(cfg '.e2e_preflight_command')"
LEAK_CMD="$(cfg '.e2e_leak_check_command')"
MAX_SKIPPED="$(cfg '.e2e_max_skipped')"

case "$MODE" in
  before)
    echo '{}' > "$STATE"
    PATHS=(); while IFS= read -r p; do [ -n "$p" ] && PATHS+=("$p"); done < <(seed_paths)
    HASH="$(seed_hash "${PATHS[@]+"${PATHS[@]}"}")"
    COMMIT="${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || true)}"
    state_update '. + {isolation: $iso, seedCommit: $commit, seedFilesHash: $hash, reset: {ran: false, exitCode: null}, preflight: {ran: false, exitCode: null}, leakCheck: {ran: false, count: null}}' \
      --arg iso "$ISOLATION" --arg commit "$COMMIT" --arg hash "$HASH"
    if [ -n "$RESET_CMD" ]; then
      run_declared "reset" "$RESET_CMD"; code=$?
      state_update '.reset = {ran: true, exitCode: $c}' --argjson c "$code"
      if [ "$code" -ne 0 ]; then echo "::error::e2e_reset_command failed (exit $code); the run cannot start from known data."; exit 1; fi
    fi
    if [ -n "$SEED_CMD" ]; then
      run_declared "seed" "$SEED_CMD"; code=$?
      if [ "$code" -ne 0 ]; then echo "::error::e2e_seed_command failed (exit $code); the run cannot start from known data."; exit 1; fi
    fi
    if [ -n "$PREFLIGHT_CMD" ]; then
      run_declared "preflight" "$PREFLIGHT_CMD"; code=$?
      state_update '.preflight = {ran: true, exitCode: $c}' --argjson c "$code"
      if [ "$code" -ne 0 ]; then echo "::error::e2e_preflight_command failed (exit $code): the seed fixtures the tests need are absent. The run fails here rather than skipping tests."; exit 1; fi
    fi
    exit 0
    ;;
  after)
    RESULTS="${E2E_RESULTS_FILE:-}"
    METADATA="${E2E_METADATA_FILE:-e2e-regression-metadata.json}"
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --results) RESULTS="$2"; shift 2 ;;
        --metadata) METADATA="$2"; shift 2 ;;
        *) echo "e2e-data-lifecycle: unknown flag $1" >&2; exit 2 ;;
      esac
    done
    [ -f "$STATE" ] || echo '{}' > "$STATE"
    state_update '. + {isolation: (.isolation // $iso)} | .reset //= {ran: false, exitCode: null} | .preflight //= {ran: false, exitCode: null}' --arg iso "$ISOLATION"
    # Best-effort teardown: a run killed part-way leaves shared data dirty, so reset again.
    if [ -n "$RESET_CMD" ]; then
      run_declared "reset (after)" "$RESET_CMD"; code=$?
      before_code="$(state_get '.reset.exitCode // 0')"
      [ "$before_code" = null ] && before_code=0
      [ "$before_code" -ne 0 ] && code="$before_code"
      state_update '.reset = {ran: true, exitCode: $c}' --argjson c "$code"
    fi
    # The leak check: its last line of output is the row count; the exit code is ignored.
    if [ -n "$LEAK_CMD" ]; then
      echo "::group::e2e data: leak check"
      out="$(bash -c "$LEAK_CMD" 2>&1)"; echo "$out"
      echo "::endgroup::"
      last="$(printf '%s\n' "$out" | awk 'NF{l=$0} END{print l}' | tr -d '[:space:]')"
      if printf '%s' "$last" | grep -Eq '^[0-9]+$'; then count="$last"; else count=null; fi
      state_update '.leakCheck = {ran: true, count: $n}' --argjson n "$count"
    fi
    # Skip budget and worker count from the results file (Playwright JSON or JUnit XML).
    reasons='[]'; workers=null
    if [ -n "$RESULTS" ] && [ -f "$RESULTS" ]; then
      case "$RESULTS" in
        *.json)
          reasons="$(jq -c '[.. | objects | select(.status? == "skipped" and (.annotations? != null)) | ((.annotations // []) | map(select(.type == "skip") | (.description // empty)) | first // "unspecified")]' "$RESULTS" 2>/dev/null || echo '[]')"
          workers="$(jq -c '.config.workers // null' "$RESULTS" 2>/dev/null || echo null)"
          ;;
        *.xml)
          reasons="$(grep -oE '<skipped[^>]*' "$RESULTS" 2>/dev/null | while IFS= read -r tag; do
            msg="$(printf '%s' "$tag" | sed -n 's/.*message="\([^"]*\)".*/\1/p')"
            printf '%s\n' "${msg:-unspecified}"
          done | jq -R . | jq -sc '.' 2>/dev/null || echo '[]')"
          [ -n "$reasons" ] || reasons='[]'
          ;;
      esac
    fi
    skipped="$(jq -nc --argjson r "$reasons" '{count: ($r | length), byReason: ($r | group_by(.) | map({key: .[0], value: length}) | from_entries)}')"
    state_update '.workers = $w | .skipped = $s' --argjson w "$workers" --argjson s "$skipped"
    if [ -f "$METADATA" ]; then
      jq --slurpfile d "$STATE" '. + {data: $d[0]}' "$METADATA" > "$METADATA.tmp" && mv "$METADATA.tmp" "$METADATA"
    fi
    count_skipped="$(printf '%s' "$skipped" | jq -r '.count')"
    echo "e2e-data-lifecycle: $count_skipped skipped test(s)$( [ "$count_skipped" -gt 0 ] && printf ' (%s)' "$(printf '%s' "$skipped" | jq -r '.byReason | to_entries | map("\(.value) x \(.key)") | join("; ")')" )"
    if [ -n "$MAX_SKIPPED" ] && printf '%s' "$MAX_SKIPPED" | grep -Eq '^[0-9]+$' && [ "$count_skipped" -gt "$MAX_SKIPPED" ]; then
      echo "::error::$count_skipped tests were skipped; e2e_max_skipped is $MAX_SKIPPED. Skipped: $(printf '%s' "$skipped" | jq -r '.byReason | to_entries | map("\(.value) x \(.key)") | join("; ")')"
      [ -f "$METADATA" ] && { jq '. + {outcome: "failed"}' "$METADATA" > "$METADATA.tmp" && mv "$METADATA.tmp" "$METADATA"; }
      exit 1
    fi
    exit 0
    ;;
  *)
    echo "usage: e2e-data-lifecycle.sh before | after [--results <file>] [--metadata <file>] | hash [paths...]" >&2
    exit 2
    ;;
esac
