#!/usr/bin/env bash
# check-req-title-tags.sh — does every tagTest('REQ-XXX', n) sit in a test whose title (or an
# enclosing describe) carries the requirement id? (devaudit-installer#1095)
#
# Why: the portal joins results to requirements by the tagTest() annotation, but the
# feature-PR run selects tests with `npx playwright test --grep REQ-XXX`, and --grep matches
# the test title (including enclosing describe titles), never annotations. A test tagged only
# by annotation is silently left out of the feature run. The rule is both: the title (or a
# describe) contains [REQ-XXX] (and [ACn] where it proves an AC), and the body calls tagTest().
#
# Usage:   scripts/check-req-title-tags.sh [--req REQ-XXX] [dir...]
#          dirs default to e2e and tests/e2e, relative to the current directory
#          --req limits the check to tagTest() calls for that requirement
# Exit:    0  every checked tagTest() call has the id in its test or describe title
#          1  at least one offender (one `file:line: ...` line each on stdout)
#          2  usage error
#
# Static parsing only: the nearest enclosing `test(` / `it(` / `describe(` / `test.describe(`
# string literal (single, double or backtick quotes) found by tracking brace depth. Titles
# built dynamically (a variable, a concatenation, a template with the id in `${...}`) are not
# supported: put the id in a literal part of the title. The id must match exactly:
# REQ-11 does not satisfy REQ-111.
#
# Install: cp this file to your project's scripts/ directory && chmod +x scripts/check-req-title-tags.sh

set -euo pipefail

usage() {
  echo "usage: check-req-title-tags.sh [--req REQ-XXX] [dir...]" >&2
}

REQ_FILTER=""
DIRS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --req)
      REQ_FILTER="${2:-}"
      if ! printf '%s' "$REQ_FILTER" | grep -qE '^REQ-[0-9A-Za-z_-]*[0-9A-Za-z]$'; then
        usage
        exit 2
      fi
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      DIRS+=("$@")
      break
      ;;
    -*)
      usage
      exit 2
      ;;
    *)
      DIRS+=("$1")
      shift
      ;;
  esac
done

if [ "${#DIRS[@]}" -eq 0 ]; then
  for d in e2e tests/e2e; do
    [ -d "$d" ] && DIRS+=("$d")
  done
fi

if [ "${#DIRS[@]}" -eq 0 ]; then
  echo "check-req-title-tags: no e2e/ or tests/e2e/ directory here; nothing to check."
  exit 0
fi

AWK_PROGRAM='
function has_id(title, id,   start, p, before, after) {
  start = 1
  while ((p = index(substr(title, start), id)) > 0) {
    p = p + start - 1
    before = (p > 1) ? substr(title, p - 1, 1) : ""
    after = substr(title, p + length(id), 1)
    if (before !~ /[A-Za-z0-9_]/ && after !~ /[A-Za-z0-9]/) return 1
    start = p + 1
  }
  return 0
}
function in_scope_with_id(id,   i) {
  for (i = 1; i <= n; i++) if (has_id(title[i], id)) return 1
  return 0
}
BEGIN { depth = 0; n = 0; bad = 0; block = 0; want_title = 0 }
{
  line = $0
  # Comments: skip whole-line // and /* ... */ lines; ignore a trailing // comment.
  if (block) { if (line ~ /\*\//) block = 0; next }
  if (line ~ /^[ \t]*\/\*/) { if (line !~ /\*\//) block = 1; next }
  if (line ~ /^[ \t]*\/\//) next

  # 1) A scope-opening call on this line: test(), it(), describe(), test.describe(), ...
  #    The title may sit on the next line when the call is split: `test(\n  "title",`.
  rest = ""
  have_call = 0
  if (want_title) {
    rest = line
    base_at = want_base
    have_call = 1
    want_title = 0
  } else if (match(line, /(^|[^A-Za-z0-9_$.])(test|it|describe)(\.[A-Za-z]+)*[ \t]*\(/)) {
    rest = substr(line, RSTART + RLENGTH)
    base_at = depth
    have_call = 1
  }
  if (have_call) {
    sub(/^[ \t]+/, "", rest)
    if (rest == "") {
      want_title = 1
      want_base = base_at
    } else {
      q = substr(rest, 1, 1)
      if (q == "\047" || q == "\042" || q == "`") {
        body = substr(rest, 2)
        e = index(body, q)
        if (e > 0) {
          n++
          title[n] = substr(body, 1, e - 1)
          base[n] = base_at
          opened[n] = 0
        }
      }
    }
  }

  # 2) tagTest(\047REQ-x\047, ac) calls on this line, checked against every enclosing title.
  scan = line
  while (match(scan, /tagTest\([ \t]*[\047"]REQ-[0-9A-Za-z_-]*[0-9A-Za-z][\047"]/)) {
    call = substr(scan, RSTART, RLENGTH)
    after = substr(scan, RSTART + RLENGTH)
    req = call
    sub(/^tagTest\([ \t]*[\047"]/, "", req)
    sub(/[\047"]$/, "", req)
    args = after
    sub(/\).*/, "", args)
    sub(/^[ \t]*,[ \t]*/, "", args)
    scan = after
    if (REQ != "" && req != REQ) continue
    if (!in_scope_with_id(req)) {
      printf "%s:%d: tagTest(\047%s\047, %s) but neither the test title nor a describe contains %s\n", FILE, FNR, req, args, req
      bad = 1
    }
  }

  # 3) Brace depth, ignoring braces inside string literals and trailing comments.
  c = line
  gsub(/\047[^\047]*\047/, "", c)
  gsub(/"[^"]*"/, "", c)
  gsub(/`[^`]*`/, "", c)
  sub(/\/\/.*/, "", c)
  o = gsub(/\{/, "{", c)
  cl = gsub(/\}/, "}", c)
  depth += o - cl
  for (i = 1; i <= n; i++) if (!opened[i] && (o > 0 || depth > base[i])) opened[i] = 1
  while (n > 0 && opened[n] && depth <= base[n]) n--
}
END { exit bad }
'

rc=0
checked=0
while IFS= read -r f; do
  checked=$((checked + 1))
  if ! awk -v FILE="$f" -v REQ="$REQ_FILTER" "$AWK_PROGRAM" "$f"; then
    rc=1
  fi
done < <(find "${DIRS[@]}" -type f \( -name '*.spec.ts' -o -name '*.spec.tsx' \) -not -path '*/node_modules/*' | sort)

if [ "$rc" -ne 0 ]; then
  echo "check-req-title-tags: put [REQ-XXX] (and [ACn]) in the test title or a describe so the feature run's --grep selects the test." >&2
  exit 1
fi
echo "check-req-title-tags: $checked spec file(s) checked, no offenders."
