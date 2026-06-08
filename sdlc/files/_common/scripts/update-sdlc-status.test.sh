#!/usr/bin/env bash
# update-sdlc-status.test.sh — Tests for the SDLC status sticky helper
# (devaudit#131). Exercises --dry-run so no real API call is needed.
#
# Usage:
#   ./scripts/update-sdlc-status.test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/update-sdlc-status.sh"
[ -x "$HELPER" ] || chmod +x "$HELPER"

PASS=0
FAIL=0
ok() { echo "  ✓ $1"; PASS=$((PASS + 1)); }
no() { echo "  ✗ $1"; FAIL=$((FAIL + 1)); }

case_missing_args() {
  echo "case: missing args exits non-zero with a usage line"
  local out exit_code
  out=$("$HELPER" 2>&1) && exit_code=0 || exit_code=$?
  if [ "$exit_code" -ne 0 ]; then
    ok "exit code non-zero ($exit_code)"
  else
    no "expected non-zero exit on missing args"
  fi
  if printf '%s\n' "$out" | grep -q "Usage:"; then
    ok "stderr includes Usage line"
  else
    no "stderr missing Usage; got:\n$out"
  fi
}

case_non_numeric_issue() {
  echo "case: non-numeric issue number fails fast"
  local out exit_code
  out=$("$HELPER" "abc" "last" "next" --dry-run 2>&1) && exit_code=0 || exit_code=$?
  if [ "$exit_code" -ne 0 ]; then
    ok "exit code non-zero"
  else
    no "expected failure on non-numeric issue number"
  fi
  if printf '%s\n' "$out" | grep -q "must be a positive integer"; then
    ok "error message names the problem"
  else
    no "wrong error message:\n$out"
  fi
}

case_dry_run_emits_body() {
  echo "case: --dry-run prints the body without invoking gh"
  local out exit_code
  out=$("$HELPER" 42 "Phase 1 complete — plan written" "Phase 2 — implement" --dry-run 2>&1) && exit_code=0 || exit_code=$?
  if [ "$exit_code" -eq 0 ]; then
    ok "exit code 0"
  else
    no "expected exit 0, got $exit_code"
    return
  fi
  if printf '%s\n' "$out" | grep -q '<!-- sdlc-implementer:status -->'; then
    ok "body includes marker comment"
  else
    no "body missing marker; got:\n$out"
  fi
  if printf '%s\n' "$out" | grep -qE '\*\*🟢 LAST STEP\*\* — Phase 1 complete'; then
    ok "body includes LAST STEP line"
  else
    no "LAST STEP line missing or wrong format; got:\n$out"
  fi
  if printf '%s\n' "$out" | grep -qE '\*\*🔵 NEXT STEP\*\* — Phase 2 — implement'; then
    ok "body includes NEXT STEP line"
  else
    no "NEXT STEP line missing or wrong format; got:\n$out"
  fi
  if printf '%s\n' "$out" | grep -q 'would update sticky on issue #42'; then
    ok "dry-run header names the issue"
  else
    no "dry-run header missing issue number; got:\n$out"
  fi
}

case_dry_run_repo_flag() {
  echo "case: --repo flag is reflected in the dry-run header"
  local out
  out=$("$HELPER" 5 "a" "b" --repo metasession-dev/example --dry-run 2>&1)
  if printf '%s\n' "$out" | grep -q 'in metasession-dev/example'; then
    ok "dry-run header includes repo"
  else
    no "dry-run header missing repo; got:\n$out"
  fi
}

case_unknown_flag_rejected() {
  echo "case: unknown flag rejected"
  local out exit_code
  out=$("$HELPER" 1 "a" "b" --bogus 2>&1) && exit_code=0 || exit_code=$?
  if [ "$exit_code" -ne 0 ] && printf '%s\n' "$out" | grep -q 'Unknown flag'; then
    ok "unknown flag rejected with message"
  else
    no "expected unknown-flag rejection; got exit $exit_code, output:\n$out"
  fi
}

case_marker_is_first_line() {
  echo "case: marker is the FIRST line of the body (find-existing relies on startswith)"
  local out
  out=$("$HELPER" 1 "a" "b" --dry-run 2>&1)
  # Extract just the body between the markers we print
  local body
  body=$(printf '%s\n' "$out" | awk '/^----- body -----$/,/^----- end body -----$/')
  local first
  first=$(printf '%s\n' "$body" | sed -n '2p') # line 1 is the "----- body -----" header; line 2 is the body's first line
  if printf '%s\n' "$first" | grep -q '<!-- sdlc-implementer:status -->'; then
    ok "marker is the body's first line"
  else
    no "marker not on first line; first line was: '$first'"
  fi
}

case_missing_args
case_non_numeric_issue
case_dry_run_emits_body
case_dry_run_repo_flag
case_unknown_flag_rejected
case_marker_is_first_line

echo ""
echo "=== update-sdlc-status.test.sh ==="
echo "PASS: $PASS  FAIL: $FAIL"
[ "$FAIL" -eq 0 ]
