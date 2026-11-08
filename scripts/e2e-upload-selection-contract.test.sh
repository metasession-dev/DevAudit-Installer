#!/usr/bin/env bash
# e2e-upload-selection-contract.test.sh — runs the REQ-selection block of
# compliance-evidence.yml.template (from the pending-ticket loop to just before
# the upload loop) against fixtures with the real synced scripts, and checks
# which REQs are uploaded, under which release, and with or without the run
# JSON (devaudit-installer#1201, #1213, #1214, #1225).
#
# Usage: bash scripts/e2e-upload-selection-contract.test.sh

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TPL="$ROOT/sdlc/files/ci/compliance-evidence.yml.template"
SCRIPTS="$ROOT/sdlc/files/_common/scripts"
START=$(grep -n '^          REQS=()$' "$TPL" | head -1 | cut -d: -f1)
END=$(grep -n 'EXECUTION_OUTCOME=""' "$TPL" | head -1 | cut -d: -f1)
if [ -z "$START" ] || [ -z "$END" ]; then
  echo "FAIL: could not find the REQ-selection block in $TPL"
  exit 1
fi
BLOCK="$(sed -n "${START},$((END - 1))p" "$TPL" | sed 's/^          //' | sed 's/{{E2E_XML_REQ_FALLBACK}}//')"

PASS=0
FAIL=0
assert_eq() {
  if [ "$2" = "$3" ]; then
    echo "  PASS: $1"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $1"
    echo "    expected: $2"
    echo "    actual:   $3"
    FAIL=$((FAIL + 1))
  fi
}

# select_reqs <bundle:yes|no> <derived-release> <pending REQ...> — prints "REQ@release:json ..." or the exit line
select_reqs() {
  local bundle="$1" derived="$2" d
  shift 2
  d="$(mktemp -d)"
  mkdir -p "$d/scripts" "$d/compliance/pending-releases" "$d/e2e-artifacts"
  cp "$SCRIPTS"/*.sh "$d/scripts/"
  for r in "$@"; do printf '# ticket\n' > "$d/compliance/pending-releases/RELEASE-TICKET-$r.md"; done
  # an executed test tagged REQ-201, one tagged REQ-007 (an old, released REQ), one skipped test tagged REQ-202
  printf '%s' '{"suites":[{"title":"s","specs":[{"title":"[REQ-201] a","tests":[{"results":[{"status":"passed"}]}]},{"title":"[REQ-007] b","tests":[{"results":[{"status":"passed"}]}]},{"title":"[REQ-202] c","tests":[{"results":[{"status":"skipped"}]}]}]}]}' \
    > "$d/e2e-artifacts/e2e-regression-results.json"
  if [ "$bundle" = "yes" ]; then
    printf '%s' '{"members":[{"version":"REQ-201","role":"co_tracked"},{"version":"REQ-202","role":"co_tracked"}]}' > "$d/compliance/pending-releases/BUNDLED-CHANGES-REQ-200.json"
    printf '%s\n' '### Co-Tracked Bundle Members' '- `REQ-201` (co-tracked/bundled)' '- `REQ-202` (co-tracked/bundled)' > "$d/compliance/pending-releases/BUNDLED-CHANGES-REQ-200.md"
  fi
  (
    cd "$d" || exit 1
    DERIVED_RELEASE="$derived"
    PRIOR_EVENT=pull_request
    set -euo pipefail
    eval "$BLOCK"
    out=""
    for REQ in "${REQS[@]}"; do out="$out ${REQ}@${REQ_RELEASE_OF[$REQ]:-$DERIVED_RELEASE}:${REQ_JSON_OF[$REQ]:-yes}"; done
    echo "${out# }"
  ) 2>/dev/null | grep -v '^E2E upload recovered' | tail -1
  rm -rf "$d"
}

echo "=== compliance-evidence.yml REQ selection ==="
assert_eq "two independent pending tickets: the untested one is not filed under this release" \
  "REQ-119@REQ-119:yes" "$(select_reqs no REQ-119 REQ-118 REQ-119)"
assert_eq "another pending ticket the run tested is filed under its own release (#1225)" \
  "REQ-119@REQ-119:yes REQ-201@REQ-201:yes" "$(select_reqs no REQ-119 REQ-119 REQ-201)"
assert_eq "REQs from the run's JSON only: old REQs are never filed anywhere (#1201, #1225)" \
  "REQ-119@REQ-119:yes" "$(select_reqs no REQ-119)"
assert_eq "bundle: members file under the core; an untested member gets no JSON" \
  "REQ-200@REQ-200:yes REQ-201@REQ-200:yes REQ-202@REQ-200:no" "$(select_reqs yes REQ-200 REQ-200 REQ-201 REQ-202)"
assert_eq "bare-date release with one pending REQ: promoted to that REQ" \
  "REQ-118@REQ-118:yes" "$(select_reqs no v2026.11.08 REQ-118)"
assert_eq "bare-date release with two pending REQs: nothing per-REQ is uploaded (#1214)" \
  "No tracked REQ was executed for standalone/integration housekeeping v2026.11.08; preserving this as GitHub historical CI without portal approval evidence." \
  "$(select_reqs no v2026.11.08 REQ-118 REQ-119)"

echo ""
echo "=== e2e-upload-selection-contract.test.sh: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
