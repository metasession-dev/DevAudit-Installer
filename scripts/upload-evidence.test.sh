#!/usr/bin/env bash
# upload-evidence.test.sh — Tests for upload-evidence.sh's central
# stub guard (devaudit#133).
#
# Hermetic: each case writes a temp file, runs the uploader with
# DEVAUDIT_BASE_URL pointing at an unreachable host so any real curl
# attempt would fail loud. The skip path never reaches curl, so
# stub-only runs return 0 cleanly; the run-with-non-stub path is
# checked separately by stubbing curl via PATH.
#
# Usage: ./scripts/upload-evidence.test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
UPLOADER="$SCRIPT_DIR/upload-evidence.sh"
[ -x "$UPLOADER" ] || chmod +x "$UPLOADER"

PASS=0
FAIL=0

ok() { echo "  ✓ $1"; PASS=$((PASS + 1)); }
no() { echo "  ✗ $1"; FAIL=$((FAIL + 1)); }

# Each case runs the uploader with stub env so it doesn't actually
# call out. The reach-curl path is short-circuited by SKIPPED files.
run_uploader() {
  DEVAUDIT_BASE_URL="https://127.0.0.1:1" \
  DEVAUDIT_API_KEY="mc_test_dummy" \
  UPLOAD_MAX_ATTEMPTS=1 \
  "$UPLOADER" "$@"
}

case_stub_skipped() {
  echo "case: unedited starter stub is skipped, exit 0"
  local tmp
  tmp=$(mktemp --suffix=.md)
  cat > "$tmp" <<'STUB'
---
title: "Incident Report"
---

> ⚠️ **STARTER TEMPLATE — REPLACE BEFORE COMMITTING.**
> Replace with the actual incident details.
STUB
  local out exit_code
  out=$(run_uploader my-project _compliance-docs incident_report "$tmp" 2>&1) && exit_code=0 || exit_code=$?
  rm -f "$tmp"
  if [ "$exit_code" -eq 0 ]; then
    ok "exit code 0"
  else
    no "exit code expected 0, got $exit_code; output:\n$out"
    return
  fi
  if printf '%s\n' "$out" | grep -q 'SKIPPED'; then
    ok "stdout includes SKIPPED line"
  else
    no "stdout missing SKIPPED line; output:\n$out"
  fi
  if printf '%s\n' "$out" | grep -qE '0 succeeded, 0 failed, 1 skipped'; then
    ok "summary reads 0 succeeded, 0 failed, 1 skipped"
  else
    no "summary line wrong; output:\n$out"
  fi
  # Belt-and-braces: the uploader must NOT have tried to call curl.
  # If it did, our unreachable URL would have surfaced a network
  # error in stdout.
  if printf '%s\n' "$out" | grep -qiE 'connection refused|curl|could not connect'; then
    no "uploader attempted a real network call despite skip; output:\n$out"
  else
    ok "no curl attempt on stub-only run"
  fi
}

case_pre_v0136_banner_skipped() {
  echo "case: pre-v0.1.36 banner phrasing ('GOING TO PRODUCTION') is also skipped"
  local tmp
  tmp=$(mktemp --suffix=.md)
  cat > "$tmp" <<'STUB'
---
title: "ROPA"
---

> ⚠️ **STARTER TEMPLATE — REPLACE BEFORE GOING TO PRODUCTION.**
STUB
  local out exit_code
  out=$(run_uploader my-project _compliance-docs ropa "$tmp" 2>&1) && exit_code=0 || exit_code=$?
  rm -f "$tmp"
  if [ "$exit_code" -eq 0 ]; then
    ok "exit code 0"
  else
    no "exit code expected 0, got $exit_code; output:\n$out"
  fi
  if printf '%s\n' "$out" | grep -q 'SKIPPED'; then
    ok "older banner also triggers skip"
  else
    no "older banner not detected; output:\n$out"
  fi
}

case_non_stub_attempts_upload() {
  echo "case: filled-in incident report is NOT skipped (attempts upload)"
  local tmp
  tmp=$(mktemp --suffix=.md)
  cat > "$tmp" <<'REAL'
---
title: "Incident Report"
incident_id: "INC-2026-007"
severity: "high"
---

# Real Incident — 2026-06-08

We detected a thing. We fixed the thing. Here is the post-mortem.
REAL
  local out exit_code
  out=$(run_uploader my-project _compliance-docs incident_report "$tmp" 2>&1) && exit_code=0 || exit_code=$?
  rm -f "$tmp"
  # Real upload to an unreachable host MUST fail — that's the proof
  # the script tried to call curl rather than skipping the file.
  if [ "$exit_code" -ne 0 ]; then
    ok "exit code non-zero (proves real curl was attempted)"
  else
    no "expected non-zero exit when curl unreachable; output:\n$out"
  fi
  if printf '%s\n' "$out" | grep -q 'Uploading'; then
    ok "stdout includes 'Uploading' line"
  else
    no "stdout missing 'Uploading' line; output:\n$out"
  fi
  if printf '%s\n' "$out" | grep -q 'SKIPPED'; then
    no "real file was incorrectly skipped; output:\n$out"
  else
    ok "real file not skipped"
  fi
}

case_md_template_not_matched_by_glob() {
  echo "case: '*.md' regex used by compliance-evidence.yml does not match '*.md.template'"
  # This is a guard against a typo or future glob change. It's
  # exercised here because we can do it purely with shell pattern
  # matching — no upload happens.
  shopt -s nullglob
  local tmpdir
  tmpdir=$(mktemp -d)
  touch "$tmpdir/incident-report.md.template"
  touch "$tmpdir/incident-report-001.md"
  local matched=()
  for f in "$tmpdir"/incident-report*.md; do
    matched+=("$(basename "$f")")
  done
  shopt -u nullglob
  rm -rf "$tmpdir"
  if [ "${#matched[@]}" -eq 1 ] && [ "${matched[0]}" = "incident-report-001.md" ]; then
    ok "glob picks up .md only, not .md.template"
  else
    no "glob mis-matched: ${matched[*]}"
  fi
}

case_upload_uses_bounded_curl_timeouts() {
  echo "case: upload curl call carries bounded connect and max-time options"
  local tmp tmpdir curl_log
  tmp=$(mktemp --suffix=.md)
  tmpdir=$(mktemp -d)
  curl_log="$tmpdir/curl.log"
  cat > "$tmp" <<'REAL'
---
title: "Incident Report"
---

# Real Incident
REAL
  cat > "$tmpdir/curl" <<'STUB'
#!/usr/bin/env bash
printf 'CALL:%s\n' "$*" >> "$CURL_LOG"
printf '201'
STUB
  chmod +x "$tmpdir/curl"
  local out exit_code
  out=$(PATH="$tmpdir:$PATH" \
    CURL_LOG="$curl_log" \
    DEVAUDIT_BASE_URL="https://devaudit.example.test" \
    DEVAUDIT_API_KEY="mc_test_dummy" \
    UPLOAD_MAX_ATTEMPTS=1 \
    UPLOAD_CONNECT_TIMEOUT_SECONDS=7 \
    UPLOAD_MAX_TIME_SECONDS=11 \
    "$UPLOADER" my-project _compliance-docs incident_report "$tmp" 2>&1) && exit_code=0 || exit_code=$?
  rm -f "$tmp"
  if [ "$exit_code" -eq 0 ]; then
    ok "exit code 0"
  else
    no "expected upload success through curl stub; output:\n$out"
  fi
  if grep -q -- '-X POST.*--connect-timeout 7.*--max-time 11' "$curl_log"; then
    ok "POST upload uses configured timeout bounds"
  else
    no "POST upload missing timeout bounds; curl log:\n$(cat "$curl_log")"
  fi
  rm -rf "$tmpdir"
}

case_stub_skipped
case_pre_v0136_banner_skipped
case_non_stub_attempts_upload
case_md_template_not_matched_by_glob
case_upload_uses_bounded_curl_timeouts

case_sdlc_stage_invalid_rejected() {
  echo "case: --sdlc-stage 9 is rejected (exit non-zero, error message)"
  local tmp
  tmp=$(mktemp --suffix=.png)
  echo "fake png" > "$tmp"
  local out exit_code
  out=$(run_uploader my-project REQ-001 screenshot "$tmp" --sdlc-stage 9 2>&1) && exit_code=0 || exit_code=$?
  rm -f "$tmp"
  if [ "$exit_code" -ne 0 ]; then
    ok "exit code non-zero for invalid --sdlc-stage"
  else
    no "expected non-zero exit for --sdlc-stage 9; output:\n$out"
    return
  fi
  if printf '%s\n' "$out" | grep -q -- '--sdlc-stage must be an integer'; then
    ok "stderr includes '--sdlc-stage must be an integer'"
  else
    no "stderr missing error message; output:\n$out"
  fi
}

case_sdlc_stage_valid_on_stub_skipped() {
  echo "case: --sdlc-stage 3 on a stub file is skipped (exit 0)"
  local tmp
  tmp=$(mktemp --suffix=.md)
  cat > "$tmp" <<'STUB'
> ⚠️ **STARTER TEMPLATE — REPLACE BEFORE COMMITTING.**
STUB
  local out exit_code
  out=$(run_uploader my-project _compliance-docs compliance_document "$tmp" --sdlc-stage 3 2>&1) && exit_code=0 || exit_code=$?
  rm -f "$tmp"
  if [ "$exit_code" -eq 0 ]; then
    ok "exit code 0 with --sdlc-stage 3 on stub"
  else
    no "expected exit 0 for --sdlc-stage 3 on stub; got $exit_code; output:\n$out"
  fi
  if printf '%s\n' "$out" | grep -q 'SKIPPED'; then
    ok "stub file skipped with --sdlc-stage 3"
  else
    no "stub file not skipped; output:\n$out"
  fi
}

case_sdlc_stage_invalid_rejected
case_sdlc_stage_valid_on_stub_skipped

echo ""
echo "=== upload-evidence.test.sh ==="
echo "PASS: $PASS  FAIL: $FAIL"
[ "$FAIL" -eq 0 ]
