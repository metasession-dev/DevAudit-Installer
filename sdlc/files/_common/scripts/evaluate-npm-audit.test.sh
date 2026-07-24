#!/usr/bin/env bash
# Regression coverage for advisory-specific, fail-closed npm risk evaluation.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/evaluate-npm-audit.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

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
      "remediationIssue": "https://github.com/example/repo/issues/1"
    }
  ]
}
JSON
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
jq -e '.summary.accepted == 1 and .summary.unresolved == 0 and .accepted[0].acceptance.remediationIssue == "https://github.com/example/repo/issues/1"' \
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
jq '.exceptions[0].expiresAt = "2026-01-01"' "$WORK/compliance/security/accepted-vulnerabilities.json" > "$WORK/changed.json"
mv "$WORK/changed.json" "$WORK/compliance/security/accepted-vulnerabilities.json"
expect_failure

write_exception
write_audit
jq '.exceptions[0].expiresAt = "not-a-date"' "$WORK/compliance/security/accepted-vulnerabilities.json" > "$WORK/changed.json"
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

echo "evaluate-npm-audit: PASS"
