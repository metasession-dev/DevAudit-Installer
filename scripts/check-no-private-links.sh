#!/usr/bin/env bash
# check-no-private-links.sh — fail when a tracked file links into the private portal repository.
#
# This repository is public. The portal repository (metasession-dev/devaudit) is private and has no
# licence, so a link into it is a 404 for every reader outside the organisation, including every
# consumer whose repository receives the synced templates (DevAudit-Installer#1128).
#
# It fails when a tracked file contains `github.com/metasession-dev/devaudit` followed by /blob/,
# /tree/, /issues/, /pull/, a closing parenthesis, a quote, a space or the end of the line (a link to the
# repository root), except in:
#   - docs/issues/, docs/articles/, docs/SRS.md and cli/CHANGELOG.md (historical records);
#   - the machine references in ALLOWLIST below (contract $id URLs, a string check, the contract-sync
#     workflow, whose pull request body link is for maintainers).
#
# Usage: scripts/check-no-private-links.sh [repo-root]   (default: the repository containing this script)

set -uo pipefail

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT" || exit 2

PATTERN='github\.com/metasession-dev/devaudit(/blob/|/tree/|/issues/|/pull/|[)"'"'"' ]|$)'

# Prefixes (or exact paths) that are exempt.
EXCLUDED=(
  'docs/issues/'
  'docs/articles/'
  'docs/SRS.md'
  'cli/CHANGELOG.md'
)
ALLOWLIST=(
  'contracts/*.json'
  'cli/src/update/validation.ts'
  '.github/workflows/sync-evidence-contract.yml'
  'scripts/check-no-private-links.sh'
  'scripts/check-no-private-links.test.sh'
)

is_exempt() {
  local f="$1" p
  for p in "${EXCLUDED[@]}"; do
    case "$f" in "$p"*) return 0 ;; esac
  done
  for p in "${ALLOWLIST[@]}"; do
    # shellcheck disable=SC2254
    case "$f" in $p) return 0 ;; esac
  done
  return 1
}

FOUND=0
while IFS= read -r -d '' f; do
  is_exempt "$f" && continue
  [ -f "$f" ] || continue
  if hits="$(grep -nE -I -- "$PATTERN" "$f" 2>/dev/null)" && [ -n "$hits" ]; then
    while IFS= read -r line; do
      echo "private link: $f:$line" | cut -c1-240
    done <<< "$hits"
    FOUND=$((FOUND + 1))
  fi
done < <(git ls-files -z)

if [ "$FOUND" -gt 0 ]; then
  echo "check-no-private-links: $FOUND file(s) link into the private portal repository. Link to https://devaudit.ai/ or to a document in this repository instead (DevAudit-Installer#1128)." >&2
  exit 1
fi
echo "check-no-private-links: no links into the private portal repository."
