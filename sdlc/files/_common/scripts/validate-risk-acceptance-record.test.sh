#!/usr/bin/env bash
# validate-risk-acceptance-record.test.sh -- tests for validate-risk-acceptance-record.sh
# (devaudit-installer#1016, #1017).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/validate-risk-acceptance-record.sh"
TEMPLATE="$SCRIPT_DIR/../skills/sdlc-implementer/references/e2e-accepted-failure.md.template"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
PASS=0; FAIL=0
TODAY="2026-10-17"

expect_ok() { # <desc> <args...>
  local desc="$1"; shift
  if out=$(bash "$HELPER" "$@" --today "$TODAY" 2>&1); then echo "  PASS: $desc"; PASS=$((PASS + 1)); else echo "  FAIL: $desc"; echo "$out" | sed 's/^/    /'; FAIL=$((FAIL + 1)); fi
}
expect_fail() { # <desc> <needle> <args...>
  local desc="$1" needle="$2"; shift 2
  local out rc=0
  out=$(bash "$HELPER" "$@" --today "$TODAY" 2>&1) || rc=$?
  if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -Fq -- "$needle"; then echo "  PASS: $desc"; PASS=$((PASS + 1)); else echo "  FAIL: $desc (rc=$rc, wanted '$needle')"; echo "$out" | sed 's/^/    /'; FAIL=$((FAIL + 1)); fi
}

valid_e2e() { # <file>
  cat > "$1" <<'REC'
---
record_kind: "accepted_e2e_failure"
req: "REQ-109"
release: "REQ-109"
failing_specs:
  - "e2e/critical/webhook-idempotency-replay.spec.ts"
ci_run: "https://github.com/acme/app/actions/runs/36659647566"
head_sha: "389bf6f0000000000000000000000000000000aa"
classification: "flake"
decision_maker: "A. Operator"
decided_at: "2026-10-15"
review_by: "2026-11-15"
tracking_issue: "https://github.com/acme/app/issues/910"
---

# Accepted E2E failure — REQ-109

## Failure

| Spec | Test | CI run / attempt | Error excerpt |
| --- | --- | --- | --- |
| webhook-idempotency-replay | 2nd delivery is 200 | 36659647566/1 | expected /already/i |

## Evidence of classification

Five isolated re-runs warm and cold all passed; the code under test is unchanged since REQ-049.

## Impact assessment

Covers webhook replay idempotency only. No data exposure; a real regression would double-process a delivery. Manual replay verified on staging 2026-10-15.

## Why this does not block this release

Same SHA passes on re-run (attempt 2); the spec has no overlap with this change.

## Remediation

Tracked in the issue above; owner A. Operator; target 2026-11-01.

## Sign-off

| Role | Name | Date |
| --- | --- | --- |
| Decision maker | A. Operator | 2026-10-15 |
REC
}

echo "=== validate-risk-acceptance-record.sh tests ==="

valid_e2e "$WORK/ok.md"
expect_ok "a complete e2e record is valid" --kind e2e "$WORK/ok.md"

expect_fail "the unedited template is rejected" "placeholder" --kind e2e "$TEMPLATE"

sed 's/review_by: "2026-11-15"/review_by: "2026-10-01"/' "$WORK/ok.md" > "$WORK/past.md"
expect_fail "a review date in the past is rejected" "not in the future" --kind e2e "$WORK/past.md"

sed 's|tracking_issue: .*|tracking_issue: "#910"|' "$WORK/ok.md" > "$WORK/badissue.md"
expect_fail "a bare #N tracking issue is rejected (must be an exact URL)" "exact GitHub issue URL" --kind e2e "$WORK/badissue.md"

sed 's/classification: "flake"/classification: "probably fine"/' "$WORK/ok.md" > "$WORK/badclass.md"
expect_fail "an unknown classification is rejected" "classification" --kind e2e "$WORK/badclass.md"

awk '/^## Impact assessment/{skip=1;next} /^## /{skip=0} !skip' "$WORK/ok.md" > "$WORK/noimpact.md"
expect_fail "a missing impact assessment is rejected" "Impact assessment" --kind e2e "$WORK/noimpact.md"

sed 's/Covers webhook replay idempotency only.*/REPLACE/' "$WORK/ok.md" > "$WORK/replace.md"
expect_fail "REPLACE inside a section is rejected" "REPLACE" --kind e2e "$WORK/replace.md"

sed 's/record_kind: "accepted_e2e_failure"/record_kind: "accepted_dependency_risk"/' "$WORK/ok.md" > "$WORK/wrongkind.md"
expect_fail "a record of the wrong kind is rejected" "record_kind" --kind e2e "$WORK/wrongkind.md"

awk '/^failing_specs:/{print "failing_specs: []"; skip=1; next} skip&&/^  -/{next} {skip=0; print}' "$WORK/ok.md" > "$WORK/nospecs.md"
expect_fail "an empty failing_specs list is rejected" "failing_specs" --kind e2e "$WORK/nospecs.md"

expect_fail "an unknown kind is a usage error" "--kind must be" --kind other "$WORK/ok.md"
expect_fail "a missing file is rejected" "not found" --kind e2e "$WORK/nope.md"

echo ""
echo "=== validate-risk-acceptance-record.test.sh: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
