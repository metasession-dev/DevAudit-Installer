#!/usr/bin/env bash
# derive-release-version.sh — Pick the release version for CI uploads from
# the latest commit's REQ tag, falling back to a bare date.
#
# Usage:
#   VERSION=$(./scripts/derive-release-version.sh)
#
# Priority:
#   1. REQ tag in commit subject: "[REQ-037] feat(kitchen): ..." -> REQ-037
#   2. Ref in commit body:        "Ref: REQ-037"                 -> REQ-037
#   3. Fallback:                  bare date                      -> v2026.05.17
#
# Multi-REQ commits: first match wins; subject takes priority over body.
# Output: single line on stdout. Exit 0 in all normal cases.
#
# This ties a release record (project_id, version) to the feature the
# commits belong to, so all CI uploads for one REQ converge on one
# release container — fixing the fragmentation described in DevAudit #310.
#
# Install: cp this file to your project's scripts/ directory && chmod +x scripts/derive-release-version.sh

set -euo pipefail

SUBJECT=$(git log -1 --format='%s' 2>/dev/null || echo '')
BODY=$(git log -1 --format='%b' 2>/dev/null || echo '')

# 1. Subject: [REQ-XXX]
if echo "$SUBJECT" | grep -qE '\[REQ-[0-9]+\]'; then
  echo "$SUBJECT" | grep -oE 'REQ-[0-9]+' | head -1
  exit 0
fi

# 2. Body: Ref: REQ-XXX (case-insensitive on "Ref" and "REQ")
if echo "$BODY" | grep -qiE 'Ref:[[:space:]]*REQ-[0-9]+'; then
  echo "$BODY" | grep -ioE 'REQ-[0-9]+' | head -1 | tr '[:lower:]' '[:upper:]'
  exit 0
fi

# 3. Fallback: bare date in UTC
echo "v$(date -u +%Y.%m.%d)"
