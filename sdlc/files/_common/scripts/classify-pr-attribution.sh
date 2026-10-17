#!/usr/bin/env bash
# classify-pr-attribution.sh -- decide whether a pull request's CI evidence may
# be attached to a REQ's release as test executions / tested SHA / branch
# (devaudit-installer#1019).
#
# CI that runs on ANY PR whose commits carry `Ref: REQ-XXX` used to attribute
# that PR's head SHA, branch and executions to REQ-XXX's release, even when the
# PR is an unrelated, doc-only compliance PR. A reviewer could then approve a
# release whose recorded "tested SHA" is a commit from a branch they never
# reviewed. The release is bound to code, so a PR that changes no code must not
# move it.
#
# Usage:
#   bash scripts/classify-pr-attribution.sh --base <ref> [--head <ref>]
#
#   --base   the PR base (e.g. origin/develop); the range is merge-base(base, head)..head
#   --head   defaults to HEAD
#
# Prints exactly one line on stdout:
#   attach                     the PR changes code (or something not documentation): attach as before
#   skip:doc-only              every changed path is documentation / compliance records
#   skip:compliance-record     a commit carries `Compliance-Record: REQ-XXX` and nothing but
#                              documentation changed (an explicit "attach document evidence only")
#   skip:no-changes            the range is empty
# Reasons and warnings go to stderr. Exit 0 always for a classification; 2 for usage errors.
# Any failure to compute the range degrades to `attach` (the pre-#1019 behaviour), loudly.
#
# Documentation paths: compliance/, docs/, SDLC/, .devaudit/, .github/ISSUE_TEMPLATE/,
# and any *.md at any depth. Override with DEVAUDIT_DOC_PATH_REGEX (extended regex).

set -uo pipefail

BASE=""; HEAD_REF="HEAD"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --base) BASE="${2:-}"; shift 2 ;;
    --head) HEAD_REF="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "Error: unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$BASE" ] || { echo "Error: --base is required" >&2; exit 2; }

DOC_REGEX="${DEVAUDIT_DOC_PATH_REGEX:-^(compliance|docs|SDLC|\.devaudit)/|^\.github/ISSUE_TEMPLATE/|\.md$}"

MERGE_BASE="$(git merge-base "$BASE" "$HEAD_REF" 2>/dev/null || true)"
if [ -z "$MERGE_BASE" ]; then
  echo "::warning::classify-pr-attribution: cannot compute merge-base($BASE, $HEAD_REF); attaching as before." >&2
  echo attach
  exit 0
fi

CHANGED="$(git diff --name-only "$MERGE_BASE" "$HEAD_REF" 2>/dev/null || true)"
if [ -z "$CHANGED" ]; then
  echo "classify-pr-attribution: no changed files in ${MERGE_BASE:0:7}..$HEAD_REF" >&2
  echo skip:no-changes
  exit 0
fi

NON_DOC="$(printf '%s\n' "$CHANGED" | grep -Ev "$DOC_REGEX" || true)"
HAS_MARKER=0
if git log "$MERGE_BASE..$HEAD_REF" --format=%B 2>/dev/null | grep -Eiq '^[[:space:]]*Compliance-Record:[[:space:]]*REQ-[0-9]+'; then
  HAS_MARKER=1
fi

if [ -z "$NON_DOC" ]; then
  if [ "$HAS_MARKER" = 1 ]; then
    echo "classify-pr-attribution: documentation-only PR with a Compliance-Record trailer; it attaches document evidence only, never test executions, SHA or branch." >&2
    echo skip:compliance-record
  else
    echo "classify-pr-attribution: documentation-only PR ($(printf '%s\n' "$CHANGED" | wc -l | tr -d ' ') file(s)); it must not move a release's test executions, tested SHA or branch." >&2
    echo skip:doc-only
  fi
  exit 0
fi

if [ "$HAS_MARKER" = 1 ]; then
  echo "::warning::classify-pr-attribution: a commit carries 'Compliance-Record:' but the PR also changes non-documentation files ($(printf '%s\n' "$NON_DOC" | head -3 | tr '\n' ' ')); treating it as a code-bearing PR." >&2
fi
echo attach
