#!/usr/bin/env bash
# provenance-gated-commit.sh — helpers for the release-PR provenance check
# (devaudit-installer#971) and for the CI plan (DevAudit-Installer#1335). A release PR must not show Quality Gates green
# for code that never ran the real gates: a docs-only success on a trailing
# compliance commit says nothing about the code beneath.
#
# Subcommands:
#   gated-commit <base_ref> <head_sha>
#       Walk the first-parent commits in <base_ref>..<head_sha> and print
#       "<sha> code" for the latest commit touching at least one path NOT
#       covered by PATHS_IGNORE (the same patterns ci.yml's push paths-ignore
#       uses), or "<head_sha> docs-only" when every commit is docs-only. A
#       commit that changes any .github/workflows/ file is code, whatever
#       PATHS_IGNORE says (the rule pr-docs-only applies, #1299, #1335).
#       PATHS_IGNORE: newline-separated list; lines may be YAML list items
#       (`- 'docs/**'`) as rendered from the {{PATHS_IGNORE_LIST}} token.
#   pr-docs-only   (changed files on standard input, one per line)
#       Print "docs-only" when every file is covered by PATHS_IGNORE, else "code"
#       (an empty list, or one of 3000 files or more, is "code"). Used by
#       scripts/ci-plan.sh (DevAudit-Installer#1335).
#   real-ci-success <sha> <current_run_id>
#       Exit 0 only if <sha> has a completed+successful check-run named
#       $QG_NAME (default "Quality Gates") whose workflow run path is the CI
#       workflow and whose event is push or workflow_dispatch, ignoring the
#       current run. The CI workflow path is $CI_WORKFLOW_PATH when set, else it
#       is derived from $WORKFLOW_REF (`owner/repo/.github/workflows/ci.yml@ref`),
#       else .github/workflows/ci.yml. A pull_request run never counts
#       (DevAudit-Installer#1335): a release-PR run's own check sits on the
#       release PR's head and must not certify itself. Requires
#       GITHUB_REPOSITORY (or REPO) and the gh CLI. One check name only: a reused
#       merge reports `Quality Gates` itself (DevAudit-Installer#1335).
#   any-success <sha> <current_run_id>
#       Like real-ci-success but accepts any workflow path (all-docs ranges);
#       the event rule still applies.
set -euo pipefail

QG_NAME="${QG_NAME:-Quality Gates}"
REPO="${REPO:-${GITHUB_REPOSITORY:-}}"
# The CI workflow's path: an explicit override, else this workflow's own path from WORKFLOW_REF
# (`owner/repo/.github/workflows/ci-api.yml@refs/...` -> `.github/workflows/ci-api.yml`), else ci.yml.
if [ -z "${CI_WORKFLOW_PATH:-}" ]; then
  CI_WORKFLOW_PATH=".github/workflows/ci.yml"
  if [ -n "${WORKFLOW_REF:-}" ]; then
    ref_path="${WORKFLOW_REF%%@*}"
    case "$ref_path" in
      */.github/workflows/*) CI_WORKFLOW_PATH=".github/workflows/${ref_path##*/.github/workflows/}" ;;
    esac
  fi
fi

# Are ALL the given paths covered by PATHS_IGNORE? Semantics follow GitHub paths-ignore:
# `*` = any chars except `/`, `**` = any chars incl. `/`, `?` = one non-`/`
# char, `[...]` character class, leading `!` re-includes. Exit 0 when every
# path is ignored, 1 when at least one is not. One path as an argument, or `-`
# to read newline-separated paths from standard input (one process for a whole
# pull request instead of one per file, DevAudit-Installer#1290).
read -r -d '' IGNORE_PY <<'PY' || true
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

rules = []
for line in os.environ["PATHS_IGNORE"].splitlines():
    p = line.strip()
    if p.startswith("- "): p = p[2:].strip()
    if len(p) >= 2 and p[0] == p[-1] and p[0] in "'\"": p = p[1:-1]
    if not p or p.startswith("#"): continue
    neg = p.startswith("!")
    if neg: p = p[1:]
    rules.append((neg, to_regex(p)))

args = sys.argv[1:]
paths = [l.rstrip("\n") for l in sys.stdin] if args == ["-"] else args
for path in paths:
    if not path: continue
    ignored = False
    for neg, rx in rules:
        if rx.match(path):
            ignored = not neg
    if not ignored:
        sys.exit(1)
sys.exit(0)
PY

path_ignored() {
  PATHS_IGNORE="${PATHS_IGNORE:-}" python3 -I -c "$IGNORE_PY" "$1"
}

commit_has_code() {
  local sha="$1" file
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    # A workflow change is code, as in pr-docs-only (DevAudit-Installer#1335).
    case "$file" in .github/workflows/*) return 0 ;; esac
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
  local sha="$1" current="$2" names_filter query
  names_filter=".name == \"${QG_NAME}\""
  query="name=$(python3 -I -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$QG_NAME")&per_page=100"
  gh api "/repos/${REPO}/commits/${sha}/check-runs?${query}" \
    --jq ".check_runs[]
      | select(${names_filter} and .status == \"completed\" and .conclusion == \"success\")
      | select((.details_url // \"\") | contains(\"/actions/runs/${current}/\") or endswith(\"/actions/runs/${current}\") | not)
      | (.details_url // \"\")"
}

cmd_success() {
  local mode="$1" sha="$2" current="$3" url run_id run_info run_path run_event
  while IFS= read -r url; do
    [ -n "$url" ] || continue
    run_id=$(printf '%s' "$url" | sed -n 's#.*/actions/runs/\([0-9][0-9]*\).*#\1#p')
    [ -n "$run_id" ] || continue
    run_info=$(gh api "/repos/${REPO}/actions/runs/${run_id}" --jq '[.path, .event] | @tsv' 2>/dev/null || true)
    run_path="${run_info%%$'\t'*}"
    run_event="${run_info#*$'\t'}"
    [ "$run_info" != "$run_path" ] || run_event=""
    # DevAudit-Installer#1335 — only integration-branch runs (push, manual) count; a pull request run never does.
    case "$run_event" in
      push|workflow_dispatch) ;;
      *)
        echo "Ignoring Quality Gates success from a '${run_event:-unknown}' run (run ${run_id}); only push and workflow_dispatch runs count." >&2
        continue
        ;;
    esac
    if [ "$mode" = any ]; then
      echo "Quality Gates success: $url"
      return 0
    fi
    # `path` may carry an "@ref" suffix on some event types.
    if [ "${run_path%%@*}" = "$CI_WORKFLOW_PATH" ]; then
      echo "Real ${CI_WORKFLOW_PATH} Quality Gates success: $url"
      return 0
    fi
    echo "Ignoring Quality Gates success from '${run_path:-unknown}' (run ${run_id}); only ${CI_WORKFLOW_PATH} counts." >&2
  done < <(successful_check_urls "$sha" "$current")
  return 1
}

# DevAudit-Installer#1290 — classify a pull request from the list of its changed files (newline-separated on
# standard input, as `gh api repos/<repo>/pulls/<n>/files --paginate --jq '.[].filename'` prints them): print
# `docs-only` when every file is covered by PATHS_IGNORE, else `code`. It fails safe: an empty list, or one at the
# 3000-file limit of the files API (the list may be cut short), is `code`, so nothing is skipped on a guess.
cmd_pr_docs_only() {
  local files count
  files="$(cat)"
  count="$(printf '%s' "$files" | grep -c . || true)"
  if [ "$count" -eq 0 ] || [ "$count" -ge 3000 ]; then
    echo code
    return 0
  fi
  # DevAudit-Installer#1299 — a pull request that edits a workflow always runs the gates, whatever PATHS_IGNORE says.
  # Only here: the push-side `gated-commit` keeps its rules, because ci.yml's push filter is unchanged.
  if printf '%s\n' "$files" | grep -q '^\.github/workflows/'; then
    echo code
    return 0
  fi
  if printf '%s\n' "$files" | PATHS_IGNORE="${PATHS_IGNORE:-}" python3 -I -c "$IGNORE_PY" -; then
    echo docs-only
  else
    echo code
  fi
}

case "${1:-}" in
  pr-docs-only) [ $# -eq 1 ] || { echo "usage: <file list> | $0 pr-docs-only" >&2; exit 2; }; cmd_pr_docs_only ;;
  gated-commit) [ $# -eq 3 ] || { echo "usage: $0 gated-commit <base_ref> <head_sha>" >&2; exit 2; }; cmd_gated_commit "$2" "$3" ;;
  real-ci-success) [ $# -eq 3 ] || { echo "usage: $0 real-ci-success <sha> <current_run_id>" >&2; exit 2; }; cmd_success real "$2" "$3" ;;
  any-success) [ $# -eq 3 ] || { echo "usage: $0 any-success <sha> <current_run_id>" >&2; exit 2; }; cmd_success any "$2" "$3" ;;
  *) echo "usage: $0 {gated-commit|real-ci-success|any-success|pr-docs-only} ..." >&2; exit 2 ;;
esac
