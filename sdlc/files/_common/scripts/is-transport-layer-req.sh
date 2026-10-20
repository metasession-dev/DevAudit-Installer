#!/usr/bin/env bash
# is-transport-layer-req.sh — is every e2e spec tagged with <REQ-XXX> a
# transport-layer spec (devaudit-installer#1067)?
#
# A transport-layer spec exercises a webhook, API or socket directly (Node
# `fetch`, `request.post()`, a database client) and never uses Playwright's
# `page`. There is nothing to screenshot, so feature-e2e.yml must not demand an
# evidenceShot for a REQ whose only coverage is of this kind. Its evidence is the
# e2e JSON report and test-execution-summary.md (e2e-test-engineer skill,
# "Specs with no page object").
#
# Usage:   scripts/is-transport-layer-req.sh <REQ-XXX> [spec-dir...]
#          spec dirs default to e2e and tests/e2e, relative to the current directory
# Exit:    0  at least one spec is tagged `@requirement <REQ-XXX>` and none of them
#             uses the `page` fixture (`{ page }` or `page.`)
#          1  no tagged spec was found, or at least one tagged spec uses `page`
#          2  usage error
#
# A spec that merely mentions `page` in code counts as a UI spec: the gate then
# stays on, which is the safe direction.
#
# Install: cp this file to your project's scripts/ directory && chmod +x scripts/is-transport-layer-req.sh

set -euo pipefail

REQ="${1:-}"
if ! printf '%s' "$REQ" | grep -qE '^REQ-[0-9]+$'; then
  echo "usage: is-transport-layer-req.sh <REQ-XXX> [spec-dir...]" >&2
  exit 2
fi
shift

DIRS=("$@")
if [ "${#DIRS[@]}" -eq 0 ]; then
  DIRS=(e2e tests/e2e)
fi

EXISTING=()
for d in "${DIRS[@]}"; do
  if [ -d "$d" ]; then EXISTING+=("$d"); fi
done
[ "${#EXISTING[@]}" -gt 0 ] || exit 1

# `REQ-11` must not match a spec tagged REQ-111
TAGGED="$(grep -rlE "@requirement[[:space:]]+${REQ}([^0-9A-Za-z]|$)" \
  --include='*.spec.ts' --include='*.spec.tsx' "${EXISTING[@]}" 2>/dev/null || true)"
[ -n "$TAGGED" ] || exit 1

while IFS= read -r spec; do
  if grep -qE '(\bpage\.|\{[^}]*\bpage\b[^}]*\})' "$spec"; then
    exit 1
  fi
done <<<"$TAGGED"

exit 0
