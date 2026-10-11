#!/usr/bin/env bash
# provenance-gated-commit.sh — helpers for quality-gates-provenance.yml
# (devaudit-installer#971). A release PR must not show Quality Gates green
# for code that never ran the real gates: the docs-only `CI Status Fallback`
# success on a trailing compliance commit says nothing about the code beneath.
#
# Subcommands:
#   gated-commit <base_ref> <head_sha>
#       Walk the first-parent commits in <base_ref>..<head_sha> and print
#       "<sha> code" for the latest commit touching at least one path NOT
#       covered by PATHS_IGNORE (the same patterns ci.yml's push paths-ignore
#       uses), or "<head_sha> docs-only" when every commit is docs-only.
#       PATHS_IGNORE: newline-separated list; lines may be YAML list items
#       (`- 'docs/**'`) as rendered from the {{PATHS_IGNORE_LIST}} token.
#   real-ci-success <sha> <current_run_id>
#       Exit 0 only if <sha> has a completed+successful check-run named
#       $QG_NAME (default "Quality Gates") whose workflow run path is
#       $CI_WORKFLOW_PATH (default .github/workflows/ci.yml), ignoring the
#       current run. Requires GITHUB_REPOSITORY (or REPO) and the gh CLI.
#   any-success <sha> <current_run_id>
#       Like real-ci-success but accepts any workflow (all-docs ranges).
set -euo pipefail

QG_NAME="${QG_NAME:-Quality Gates}"
CI_WORKFLOW_PATH="${CI_WORKFLOW_PATH:-.github/workflows/ci.yml}"
REPO="${REPO:-${GITHUB_REPOSITORY:-}}"

# Does PATH $1 match any ignore pattern? Semantics follow GitHub paths-ignore:
# `*` = any chars except `/`, `**` = any chars incl. `/`, `?` = one non-`/`
# char, `[...]` character class, leading `!` re-includes.
path_ignored() {
  PATHS_IGNORE="${PATHS_IGNORE:-}" python3 -I - "$1" <<'PY'
import os, re, sys

def to_regex(glob):
    out, i = "", 0
    while i < len(glob):
        c = glob[i]
        if glob.startswith("**", i):
            out += ".*"; i += 2
            if glob.startswith("/", i) and out.endswith(".*"):
                out = out[:-2] + "(?:.*/)?"; i += 1
        elif c == "*": out += "[^/]*"; i += 1
        elif c == "?": out += "[^/]"; i += 1
        elif c == "[":
            j = glob.find("]", i + 1)
            if j == -1: out += re.escape(c); i += 1
            else: out += glob[i:j + 1]; i = j + 1
        else: out += re.escape(c); i += 1
    return re.compile("^" + out + "$")

path = sys.argv[1]
ignored = False
for line in os.environ["PATHS_IGNORE"].splitlines():
    p = line.strip()
    if p.startswith("- "): p = p[2:].strip()
    if len(p) >= 2 and p[0] == p[-1] and p[0] in "'\"": p = p[1:-1]
    if not p or p.startswith("#"): continue
    neg = p.startswith("!")
    if neg: p = p[1:]
    if to_regex(p).match(path):
        ignored = not neg
sys.exit(0 if ignored else 1)
PY
}

commit_has_code() {
  local sha="$1" file
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    if ! path_ignored "$file"; then
      return 0
    fi
  done < <(git diff-tree -r --root --no-commit-id --name-only -m --first-parent "$sha")
  return 1
}

cmd_gated_commit() {
  local base="$1" head="$2" sha
  while IFS= read -r sha; do
    if commit_has_code "$sha"; then
      echo "$sha code"
      return 0
    fi
  done < <(git rev-list --first-parent "${base}..${head}")
  echo "$head docs-only"
}

# Print details_url of each completed+successful $QG_NAME check-run on $1,
# excluding the current run.
successful_check_urls() {
  local sha="$1" current="$2"
  gh api "/repos/${REPO}/commits/${sha}/check-runs?name=$(python3 -I -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$QG_NAME")&per_page=100" \
    --jq ".check_runs[]
      | select(.name == \"${QG_NAME}\" and .status == \"completed\" and .conclusion == \"success\")
      | select((.details_url // \"\") | contains(\"/actions/runs/${current}/\") or endswith(\"/actions/runs/${current}\") | not)
      | (.details_url // \"\")"
}

cmd_success() {
  local mode="$1" sha="$2" current="$3" url run_id run_path
  while IFS= read -r url; do
    [ -n "$url" ] || continue
    if [ "$mode" = any ]; then
      echo "Quality Gates success: $url"
      return 0
    fi
    run_id=$(printf '%s' "$url" | sed -n 's#.*/actions/runs/\([0-9][0-9]*\).*#\1#p')
    [ -n "$run_id" ] || continue
    run_path=$(gh api "/repos/${REPO}/actions/runs/${run_id}" --jq '.path' 2>/dev/null || true)
    # `path` may carry an "@ref" suffix on some event types.
    if [ "${run_path%%@*}" = "$CI_WORKFLOW_PATH" ]; then
      echo "Real ${CI_WORKFLOW_PATH} Quality Gates success: $url"
      return 0
    fi
    echo "Ignoring Quality Gates success from '${run_path:-unknown}' (run ${run_id}); only ${CI_WORKFLOW_PATH} counts." >&2
  done < <(successful_check_urls "$sha" "$current")
  return 1
}

case "${1:-}" in
  gated-commit) [ $# -eq 3 ] || { echo "usage: $0 gated-commit <base_ref> <head_sha>" >&2; exit 2; }; cmd_gated_commit "$2" "$3" ;;
  real-ci-success) [ $# -eq 3 ] || { echo "usage: $0 real-ci-success <sha> <current_run_id>" >&2; exit 2; }; cmd_success real "$2" "$3" ;;
  any-success) [ $# -eq 3 ] || { echo "usage: $0 any-success <sha> <current_run_id>" >&2; exit 2; }; cmd_success any "$2" "$3" ;;
  *) echo "usage: $0 {gated-commit|real-ci-success|any-success} ..." >&2; exit 2 ;;
esac
