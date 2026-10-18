#!/usr/bin/env bash
# check-no-consumer-names.sh — fail when a tracked file names a consuming project (#1042).
#
# This repository is public and its docs/code ship in the npm package, so consumers are
# never named in it. The names themselves must not be committed either, so the pattern
# comes from the environment (the CONSUMER_NAME_PATTERN repo secret in CI; an ERE,
# matched case-insensitively). Without it the check is skipped.
#
# On a hit it prints only file:line, never the matching text: Actions logs of a public
# repository are public.
set -euo pipefail

pattern="${CONSUMER_NAME_PATTERN:-}"
if [ -z "$pattern" ]; then
  echo "check-no-consumer-names: CONSUMER_NAME_PATTERN not set; skipped"
  exit 0
fi

root="$(git rev-parse --show-toplevel)"
hits="$(git -C "$root" grep -I -n -i -E -e "$pattern" -- . ':!cli/sdlc' | cut -d: -f1,2 || true)"
if [ -n "$hits" ]; then
  echo "check-no-consumer-names: tracked files name a consuming project (replace with generic wording, e.g. example-app / \"a consumer\"):"
  printf '%s\n' "$hits"
  exit 1
fi
echo "check-no-consumer-names: no consumer names in tracked files"
