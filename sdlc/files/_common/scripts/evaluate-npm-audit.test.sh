#!/usr/bin/env bash
# Regression coverage for advisory-specific, fail-closed npm risk evaluation.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/evaluate-npm-audit.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
APPROVED_AT="$(date -u -d 'yesterday' +%Y-%m-%d)"
EXPIRES_AT="$(date -u -d '+30 days' +%Y-%m-%d)"
EXPIRED_AT="$(date -u -d 'yesterday' +%Y-%m-%d)"

mkdir -p "$WORK/compliance/security"

write_audit() {
  cat > "$WORK/dependency-audit.json" <<'JSON'
{
  "vulnerabilities": {
    "postcss": {
      "name": "postcss",
      "severity": "high",
      "via": [
        {
          "name": "postcss",
          "dependency": "postcss",
          "url": "https://github.com/advisories/GHSA-test-high",
          "severity": "high",
          "range": "<=8.5.11"
        }
      ],
      "nodes": ["node_modules/next/node_modules/postcss"]
    }
  }
}
JSON
}

write_empty_audit() {
  printf '{"vulnerabilities":{}}\n' > "$WORK/dependency-audit.json"
}

write_meta_audit() {
  cat > "$WORK/dependency-audit.json" <<'JSON'
{
  "vulnerabilities": {
    "eslint": {
      "name": "eslint",
      "severity": "high",
      "via": ["@eslint/eslintrc"],
      "nodes": ["node_modules/eslint"]
    },
    "@eslint/eslintrc": {
      "name": "@eslint/eslintrc",
      "severity": "high",
      "via": ["minimatch"],
      "nodes": ["node_modules/@eslint/eslintrc"]
    },
    "minimatch": {
      "name": "minimatch",
      "severity": "high",
      "via": ["brace-expansion"],
      "nodes": ["node_modules/@eslint/eslintrc/node_modules/minimatch"]
    },
    "brace-expansion": {
      "name": "brace-expansion",
      "severity": "high",
      "via": [
        {
          "name": "brace-expansion",
          "dependency": "brace-expansion",
          "url": "https://github.com/advisories/GHSA-meta-chain",
          "severity": "high",
          "range": "<=5.0.7"
        }
      ],
      "nodes": ["node_modules/@eslint/eslintrc/node_modules/brace-expansion"]
    }
  }
}
JSON
}

write_lock() {
  cat > "$WORK/package-lock.json" <<'JSON'
{
  "lockfileVersion": 3,
  "packages": {
    "": {"name": "fixture"},
    "node_modules/next": {"version": "16.2.11"},
    "node_modules/next/node_modules/postcss": {"version": "8.4.31"}
  }
}
JSON
}

write_meta_lock() {
  cat > "$WORK/package-lock.json" <<'JSON'
{
  "lockfileVersion": 3,
  "packages": {
    "": {"name": "fixture"},
    "node_modules/eslint": {"version": "9.0.0"},
    "node_modules/@eslint/eslintrc": {"version": "3.0.0"},
    "node_modules/@eslint/eslintrc/node_modules/minimatch": {"version": "9.0.0"},
    "node_modules/@eslint/eslintrc/node_modules/brace-expansion": {"version": "2.0.1"}
  }
}
JSON
}

write_exception() {
  cat > "$WORK/compliance/security/accepted-vulnerabilities.json" <<'JSON'
{
  "schemaVersion": 1,
  "exceptions": [
    {
      "advisoryId": "GHSA-test-high",
      "package": "postcss",
      "vulnerableRange": "<=8.5.11",
      "vulnerableVersion": "8.4.31",
      "dependencyPath": "node_modules/next/node_modules/postcss",
      "introducedBy": "next@16.2.11",
      "approvedAt": "2026-07-01",
      "expiresAt": "2026-12-31",
      "approvedBy": "reviewer@example.test",
      "reason": "Fixture acceptance while the introducing dependency awaits an upstream repair.",
      "remediationIssue": "https://github.com/example/repo/issues/1",
      "compensatingControls": "Monitor upstream releases and retain the unaffected root package."
    }
  ]
}
JSON
  jq --arg approved "$APPROVED_AT" --arg expires "$EXPIRES_AT" \
    '.exceptions[0].approvedAt = $approved | .exceptions[0].expiresAt = $expires' \
    "$WORK/compliance/security/accepted-vulnerabilities.json" > "$WORK/changed.json"
  mv "$WORK/changed.json" "$WORK/compliance/security/accepted-vulnerabilities.json"
}

run_helper() {
  bash "$HELPER" \
    --audit "$WORK/dependency-audit.json" \
    --lock "$WORK/package-lock.json" \
    --exceptions "$WORK/compliance/security/accepted-vulnerabilities.json" \
    --output "$WORK/dependency-risk-evaluation.json"
}

expect_success() {
  if ! run_helper; then
    echo "Expected evaluation to succeed" >&2
    exit 1
  fi
}

expect_failure() {
  if run_helper >/dev/null 2>&1; then
    echo "Expected evaluation to fail" >&2
    exit 1
  fi
}

write_audit
write_lock
rm -f "$WORK/compliance/security/accepted-vulnerabilities.json"
expect_failure

write_empty_audit
expect_success
jq -e '.summary.accepted == 0 and .summary.unresolved == 0' "$WORK/dependency-risk-evaluation.json" >/dev/null

write_audit
write_exception
expect_success
jq -e '.summary.accepted == 1 and .summary.unresolved == 0 and .accepted[0].acceptance.remediationIssue == "https://github.com/example/repo/issues/1" and (.accepted[0].acceptance.compensatingControls | length > 0)' \
  "$WORK/dependency-risk-evaluation.json" >/dev/null

jq '.exceptions[0].advisoryId = "GHSA-wrong"' "$WORK/compliance/security/accepted-vulnerabilities.json" > "$WORK/changed.json"
mv "$WORK/changed.json" "$WORK/compliance/security/accepted-vulnerabilities.json"
expect_failure

write_exception
write_audit
jq '.exceptions[0].vulnerableRange = "<8.5.10"' "$WORK/compliance/security/accepted-vulnerabilities.json" > "$WORK/changed.json"
mv "$WORK/changed.json" "$WORK/compliance/security/accepted-vulnerabilities.json"
expect_failure

write_exception
write_audit
jq '.exceptions[0].vulnerableVersion = "8.5.15"' "$WORK/compliance/security/accepted-vulnerabilities.json" > "$WORK/changed.json"
mv "$WORK/changed.json" "$WORK/compliance/security/accepted-vulnerabilities.json"
expect_failure

write_exception
write_audit
jq '.exceptions[0].dependencyPath = "node_modules/postcss"' "$WORK/compliance/security/accepted-vulnerabilities.json" > "$WORK/changed.json"
mv "$WORK/changed.json" "$WORK/compliance/security/accepted-vulnerabilities.json"
expect_failure

write_exception
write_audit
jq '.exceptions[0].introducedBy = "next@16.2.10"' "$WORK/compliance/security/accepted-vulnerabilities.json" > "$WORK/changed.json"
mv "$WORK/changed.json" "$WORK/compliance/security/accepted-vulnerabilities.json"
expect_failure

write_exception
write_audit
jq --arg expired "$EXPIRED_AT" '.exceptions[0].expiresAt = $expired' "$WORK/compliance/security/accepted-vulnerabilities.json" > "$WORK/changed.json"
mv "$WORK/changed.json" "$WORK/compliance/security/accepted-vulnerabilities.json"
expect_failure

write_exception
write_audit
jq '.exceptions[0].expiresAt = "not-a-date"' "$WORK/compliance/security/accepted-vulnerabilities.json" > "$WORK/changed.json"
mv "$WORK/changed.json" "$WORK/compliance/security/accepted-vulnerabilities.json"
expect_failure

write_exception
write_audit
jq '.exceptions[0].remediationIssue = "https://github.com/example/repo"' "$WORK/compliance/security/accepted-vulnerabilities.json" > "$WORK/changed.json"
mv "$WORK/changed.json" "$WORK/compliance/security/accepted-vulnerabilities.json"
expect_failure

write_exception
write_audit
jq '.exceptions[0].compensatingControls = []' "$WORK/compliance/security/accepted-vulnerabilities.json" > "$WORK/changed.json"
mv "$WORK/changed.json" "$WORK/compliance/security/accepted-vulnerabilities.json"
expect_failure

write_exception
write_audit
jq 'del(.exceptions[0].approvedAt)' "$WORK/compliance/security/accepted-vulnerabilities.json" > "$WORK/changed.json"
mv "$WORK/changed.json" "$WORK/compliance/security/accepted-vulnerabilities.json"
expect_failure

write_exception
write_audit
jq '.vulnerabilities.postcss.via += [{"name":"postcss","dependency":"postcss","url":"https://github.com/advisories/GHSA-second-high","severity":"high","range":"<=8.5.11"}]' \
  "$WORK/dependency-audit.json" > "$WORK/changed.json"
mv "$WORK/changed.json" "$WORK/dependency-audit.json"
expect_failure

write_audit
write_exception
printf '{not-json}\n' > "$WORK/dependency-audit.json"
expect_failure

write_audit
write_exception
printf '{not-json}\n' > "$WORK/compliance/security/accepted-vulnerabilities.json"
expect_failure

write_meta_audit
write_meta_lock
rm -f "$WORK/compliance/security/accepted-vulnerabilities.json"
expect_failure
jq -e '
  .summary.unresolved == 1 and
  .unresolved[0].advisoryId == "GHSA-meta-chain" and
  .unresolved[0].dependencyPath == "node_modules/@eslint/eslintrc/node_modules/brace-expansion" and
  .unresolved[0].affectedFindings == ["@eslint/eslintrc", "brace-expansion", "eslint", "minimatch"]
' "$WORK/dependency-risk-evaluation.json" >/dev/null

write_meta_audit
jq '.vulnerabilities.minimatch.via = ["missing-package"]' \
  "$WORK/dependency-audit.json" > "$WORK/changed.json"
mv "$WORK/changed.json" "$WORK/dependency-audit.json"
expect_failure

write_meta_audit
jq '.vulnerabilities["brace-expansion"].via = ["eslint"]' \
  "$WORK/dependency-audit.json" > "$WORK/changed.json"
mv "$WORK/changed.json" "$WORK/dependency-audit.json"
expect_failure

write_meta_audit
jq '.vulnerabilities["brace-expansion"].via = []' \
  "$WORK/dependency-audit.json" > "$WORK/changed.json"
mv "$WORK/changed.json" "$WORK/dependency-audit.json"
expect_failure

# devaudit-installer#799 — a cyclic back-edge between two mutually-
# referencing findings (each carrying its own real severity-high advisory,
# mirroring the real-world vitest <-> @vitest/coverage-v8 shape) must not
# fail the whole gate: each node still gets its own independent top-level
# DFS from the driver loop, so both advisories remain reachable and are
# reported as unresolved, not silently dropped.
cat > "$WORK/dependency-audit.json" <<'JSON'
{
  "vulnerabilities": {
    "vitest": {
      "name": "vitest",
      "severity": "high",
      "via": [
        "@vitest/coverage-v8",
        {
          "name": "vitest",
          "dependency": "vitest",
          "url": "https://github.com/advisories/GHSA-vitest-cycle",
          "severity": "high",
          "range": "<=4.0.0"
        }
      ],
      "nodes": ["node_modules/vitest"]
    },
    "@vitest/coverage-v8": {
      "name": "@vitest/coverage-v8",
      "severity": "high",
      "via": [
        "vitest",
        {
          "name": "@vitest/coverage-v8",
          "dependency": "@vitest/coverage-v8",
          "url": "https://github.com/advisories/GHSA-coverage-cycle",
          "severity": "high",
          "range": "<=4.0.0"
        }
      ],
      "nodes": ["node_modules/@vitest/coverage-v8"]
    }
  }
}
JSON
cat > "$WORK/package-lock.json" <<'JSON'
{
  "lockfileVersion": 3,
  "packages": {
    "": {"name": "fixture"},
    "node_modules/vitest": {"version": "3.9.9"},
    "node_modules/@vitest/coverage-v8": {"version": "3.9.9"}
  }
}
JSON
rm -f "$WORK/compliance/security/accepted-vulnerabilities.json"
# Both advisories are genuinely unresolved (no accepted exception), so the
# gate correctly fails — the point of this fixture is that it fails via the
# normal "unresolved high-severity findings" path (both fully evaluated and
# reported below) rather than aborting early on the cycle itself.
expect_failure
jq -e '
  .summary.unresolved == 2 and
  (.unresolved | map(.advisoryId) | sort) == ["GHSA-coverage-cycle", "GHSA-vitest-cycle"]
' "$WORK/dependency-risk-evaluation.json" >/dev/null


# --- devaudit-installer#1017: schemaVersion 2 requires a valid acceptance record ---
write_record() { # <file> <advisory-id> <tracking-issue>
  mkdir -p "$(dirname "$1")"
  cat > "$1" <<REC
---
record_kind: "accepted_dependency_risk"
advisory_ids:
  - "$2"
package: "postcss"
severity: "high"
decision_maker: "A. Reviewer"
decided_at: "2026-01-01"
review_by: "2099-01-01"
remediation_deadline: "2099-01-01"
tracking_issue: "$3"
---

# Accepted dependency risk

## Advisories

| Advisory | Severity | Package@version | Dependency path | Introduced by | Fix available |
| --- | --- | --- | --- | --- | --- |
| $2 | high | postcss@8.4.31 | node_modules/next/node_modules/postcss | next@16.2.11 | none |

## Reachability and exploitability

Only used by the build-time CSS pipeline; no request-time input reaches it. Checked by tracing the imports.

## Impact assessment

A crafted stylesheet could cause ReDoS in the build only; no production exposure.

## Compensating controls

Build runs in an isolated CI container with no secrets; dependency pinned by the lockfile.

## Remediation

Tracked in the issue; waiting for the upstream next release that bumps postcss.

## Sign-off

| Role | Name | Date |
| --- | --- | --- |
| Decision maker | A. Reviewer | 2026-01-01 |
REC
}

run_v2() { (cd "$WORK" && bash "$HELPER" --audit dependency-audit.json --lock package-lock.json --exceptions compliance/security/accepted-vulnerabilities.json --output dependency-risk-evaluation.json); }
expect_v2_success() { if ! run_v2 >/dev/null 2>"$WORK/v2.err"; then echo "Expected v2 evaluation to succeed" >&2; cat "$WORK/v2.err" >&2; exit 1; fi; }
expect_v2_failure() { # <needle in stderr>
  if run_v2 >/dev/null 2>"$WORK/v2.err"; then echo "Expected v2 evaluation to fail ($1)" >&2; exit 1; fi
  grep -Fq -- "$1" "$WORK/v2.err" || { echo "Expected v2 failure to mention: $1" >&2; cat "$WORK/v2.err" >&2; exit 1; }
}
make_v2() { # <record-path>
  write_audit; write_lock; write_exception
  jq --arg rec "$1" '.schemaVersion = 2 | .exceptions[0].acceptanceRecord = $rec' \
    "$WORK/compliance/security/accepted-vulnerabilities.json" > "$WORK/changed.json"
  mv "$WORK/changed.json" "$WORK/compliance/security/accepted-vulnerabilities.json"
}
REC=compliance/security/risk-acceptances/GHSA-test-high.md
ISSUE=https://github.com/example/repo/issues/1

make_v2 "$REC"; write_record "$WORK/$REC" GHSA-test-high "$ISSUE"
expect_v2_success
jq -e --arg rec "$REC" '.summary.accepted == 1 and .accepted[0].acceptance.acceptanceRecord == $rec and (.accepted[0].acceptance.acceptanceRecordSha256 | length == 64)' \
  "$WORK/dependency-risk-evaluation.json" >/dev/null

make_v2 "$REC"; write_record "$WORK/$REC" GHSA-test-high "$ISSUE"
jq 'del(.exceptions[0].acceptanceRecord)' "$WORK/compliance/security/accepted-vulnerabilities.json" > "$WORK/changed.json"
mv "$WORK/changed.json" "$WORK/compliance/security/accepted-vulnerabilities.json"
expect_v2_failure "missing required field(s): acceptanceRecord"

make_v2 "$REC"; rm -f "$WORK/$REC"
expect_v2_failure "acceptanceRecord does not exist"

make_v2 "$REC"; write_record "$WORK/$REC" GHSA-some-other "$ISSUE"
expect_v2_failure "does not list advisory GHSA-test-high"

make_v2 "$REC"; write_record "$WORK/$REC" GHSA-test-high https://github.com/example/repo/issues/99
expect_v2_failure "differs from the record's tracking_issue"

make_v2 "$REC"; write_record "$WORK/$REC" GHSA-test-high "$ISSUE"
sed -i 's/review_by: "2099-01-01"/review_by: "2020-01-01"/' "$WORK/$REC"
expect_v2_failure "not in the future"

make_v2 "../outside.md"; write_record "$WORK/$REC" GHSA-test-high "$ISSUE"
expect_v2_failure "repo-root-relative"

make_v2 "$REC"; write_record "$WORK/$REC" GHSA-test-high "$ISSUE"
jq '.exceptions[0].expiresAt = "2020-01-01"' "$WORK/compliance/security/accepted-vulnerabilities.json" > "$WORK/changed.json"
mv "$WORK/changed.json" "$WORK/compliance/security/accepted-vulnerabilities.json"
expect_v2_failure "is expired on"

echo "evaluate-npm-audit: PASS"
