#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-sdlc/files}"
FAILURES=0

while IFS= read -r -d '' file; do
  while IFS=$'\t' read -r line_number function_name statement; do
    [ -n "$line_number" ] || continue
    printf '%s\n' \
      "${file}:${line_number}: unsafe final conditional in ${function_name}(): ${statement}" >&2
    printf '%s\n' \
      "  Rewrite as if/then/fi or add an explicit return 0." >&2
    FAILURES=$((FAILURES + 1))
  done < <(
    awk '
      function trimmed(value) {
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
        return value
      }
      /^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*[[:space:]]*\(\)[[:space:]]*\{/ {
        line=$0
        sub(/^[[:space:]]*/, "", line)
        function_name=line
        sub(/[[:space:]]*\(\).*/, "", function_name)
        in_function=1
        previous=""
        previous_line=0
        next
      }
      in_function && /^[[:space:]]*}[[:space:]]*$/ {
        if (previous ~ /^\[[^]]+\][[:space:]]*(&&|\|\|)/ ||
            previous ~ /^test[[:space:]].*[[:space:]](&&|\|\|)/) {
          printf "%d\t%s\t%s\n", previous_line, function_name, previous
        }
        in_function=0
        next
      }
      in_function {
        line=trimmed($0)
        if (line != "" && line !~ /^#/) {
          previous=line
          previous_line=NR
        }
      }
    ' "$file"
  )
done < <(find "$ROOT" -type f \( -name '*.sh' -o -path '*/hooks/*' \) -print0)

if [ "$FAILURES" -gt 0 ]; then
  echo "shell failure-mode lint: ${FAILURES} unsafe helper(s)" >&2
  exit 1
fi

echo "shell failure-mode lint: PASS"
