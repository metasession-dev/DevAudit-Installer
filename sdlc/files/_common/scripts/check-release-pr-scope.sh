#!/usr/bin/env bash
# check-release-pr-scope.sh — fail closed when a release PR's declared scope
# drifts from the release currently derived from the integration branch head.
#
# Usage:
#   PR_TITLE="..." PR_BODY="..." HEAD_REF="develop" \
#     bash scripts/check-release-pr-scope.sh

set -euo pipefail

is_hotfix_branch() {
  case "${1:-}" in
    hotfix/*|fix/hotfix-*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

extract_declared_scope() {
  python3 - <<'PY'
import os
import re

title = os.environ.get("PR_TITLE", "")
body = os.environ.get("PR_BODY", "")
text = f"{title}\n{body}"
patterns = [
    r"^[ \t\-*]*Release:\s*((?:REQ-\d+)|(?:v\d+\.\d+\.\d+)|(?:v\d{4}\.\d{2}\.\d{2}(?:\.\d+)?))\b",
    r"\b(REQ-\d+)\b",
    r"\b(v\d+\.\d+\.\d+)\b",
    r"\b(v\d{4}\.\d{2}\.\d{2}(?:\.\d+)?)\b",
]
flags = re.MULTILINE
for pattern in patterns:
    match = re.search(pattern, text, flags)
    if match:
        print(match.group(1))
        break
PY
}

HEAD_REF="${HEAD_REF:-}"
if is_hotfix_branch "$HEAD_REF"; then
  echo "Hotfix PR detected (${HEAD_REF}) — release scope integrity check skipped."
  exit 0
fi

if [ ! -x scripts/derive-release-version.sh ]; then
  chmod +x scripts/derive-release-version.sh 2>/dev/null || true
fi
CURRENT_RELEASE=$(bash scripts/derive-release-version.sh)
if [ -z "$CURRENT_RELEASE" ]; then
  echo "::error::Could not derive the effective release scope from the current branch head."
  exit 1
fi

DECLARED_SCOPE=$(extract_declared_scope)
if [ -z "$DECLARED_SCOPE" ]; then
  echo "::error::Release Scope Integrity: the PR title/body do not declare a release scope."
  echo "::error::Derived effective scope: ${CURRENT_RELEASE}"
  echo "::error::Update the PR metadata or regenerate the release PR from the current integration head."
  exit 1
fi

if [ "$DECLARED_SCOPE" != "$CURRENT_RELEASE" ]; then
  echo "::error::Release Scope Integrity mismatch."
  echo "::error::Declared PR scope: ${DECLARED_SCOPE}"
  echo "::error::Derived effective scope: ${CURRENT_RELEASE}"
  echo "::error::Update the PR metadata or regenerate the release PR from the current integration head."
  exit 1
fi

if [[ "$CURRENT_RELEASE" =~ ^v[0-9]{4}\.[0-9]{2}\.[0-9]{2}(\.[0-9]+)?$ ]]; then
  DECLARATION="compliance/standalone-housekeeping/STANDALONE-HOUSEKEEPING-${CURRENT_RELEASE}.json"
  if ! printf '%s\n%s\n' "${PR_TITLE:-}" "${PR_BODY:-}" | grep -Fqi "Standalone housekeeping promotion"; then
    echo "::error::Bare-date releases may only be promoted with an explicit standalone housekeeping exception."
    echo "::error::Add 'Standalone housekeeping promotion' to the PR title or body and include ${DECLARATION}."
    exit 1
  fi
  chmod +x scripts/standalone-housekeeping-release.sh 2>/dev/null || true
  bash scripts/standalone-housekeeping-release.sh validate "$CURRENT_RELEASE" "$DECLARATION"
fi

if [[ "$CURRENT_RELEASE" =~ ^REQ-[0-9]+$ ]]; then
  if [ ! -x scripts/extract-release-metadata.sh ]; then
    chmod +x scripts/extract-release-metadata.sh 2>/dev/null || true
  fi
  # shellcheck disable=SC1091
  source scripts/extract-release-metadata.sh
  extract_release_metadata "$CURRENT_RELEASE"
  if printf '%s' "${RELEASE_SUMMARY:-}" | grep -q 'Bundled release context:'; then
    if ! printf '%s\n%s\n' "${PR_TITLE:-}" "${PR_BODY:-}" | grep -q "BUNDLED-CHANGES-${CURRENT_RELEASE}.md"; then
      echo "::error::Release Scope Integrity mismatch."
      echo "::error::Declared PR scope: ${DECLARED_SCOPE}"
      echo "::error::Derived effective scope: ${CURRENT_RELEASE} with bundled release context."
      echo "::error::PR metadata is missing the bundled release context marker for BUNDLED-CHANGES-${CURRENT_RELEASE}.md."
      echo "::error::Update the PR body or regenerate the release PR from the current integration head."
      exit 1
    fi
  fi
fi

echo "Release Scope Integrity verified for ${CURRENT_RELEASE}."
