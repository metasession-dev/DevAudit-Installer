#!/usr/bin/env bash
# delivery-gh.sh — the `gh` shim of a DevAudit Delivery run (DevAudit-Installer#1286).
#
# devaudit-delivery.yml puts a `gh` wrapper ahead of the real one on PATH; the wrapper runs this script. The agent's
# GitHub token lasts about an hour and a run can last longer, and `gh` reads one token for the whole process, so each
# call asks `devaudit delivery github-token` for a current one (it caches the token until ten minutes before it
# expires) and runs the real `gh` with it.
#
# It fails closed: when no token can be had it exits 1 and runs nothing. It never falls back to GH_TOKEN or the
# default token, because a pull request made with those starts no CI.
#
# Environment: DEVAUDIT_REAL_GH (the real gh, set by the workflow).
set -uo pipefail

real="${DEVAUDIT_REAL_GH:-}"
if [ -z "$real" ] || [ ! -x "$real" ]; then
  echo "delivery-gh: DEVAUDIT_REAL_GH does not name an executable gh" >&2
  exit 1
fi

if ! token="$(devaudit delivery github-token)"; then
  echo "delivery-gh: no GitHub token for the delivery agent (see the message above); not running gh" >&2
  exit 1
fi
[ -n "$token" ] || { echo "delivery-gh: the token is empty; not running gh" >&2; exit 1; }

GH_TOKEN="$token" exec "$real" "$@"
