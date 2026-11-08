#!/usr/bin/env bash
# extract-e2e-reqs.sh — list the REQ ids named anywhere in a Playwright JSON
# results file (devaudit-installer#311, moved out of the workflow in #1201 to
# keep its run block under GitHub's size limit).
#
# Usage:   scripts/extract-e2e-reqs.sh <results.json>
# Output:  one REQ-NNN per line, sorted, de-duplicated. Every string in the
#          file is scanned, so a full-regression run names many REQs: callers
#          scope the result with scope-e2e-reqs-to-release.sh.
# Exit:    0 always for an unreadable or invalid file (prints nothing); 1 on a
#          usage error.
#
# Install: cp this file to your project's scripts/ directory && chmod +x scripts/extract-e2e-reqs.sh

set -euo pipefail

FILE="${1:-}"
if [ -z "$FILE" ]; then
  echo "Usage: $0 <results.json>" >&2
  exit 1
fi

python3 - "$FILE" <<'PY'
import json
import re
import sys

try:
    with open(sys.argv[1], 'r', encoding='utf-8') as handle:
        data = json.load(handle)
except Exception:
    sys.exit(0)

seen = set()

def walk(value):
    if isinstance(value, str):
        for req in re.findall(r'REQ-[0-9]+', value):
            seen.add(req)
    elif isinstance(value, dict):
        for item in value.values():
            walk(item)
    elif isinstance(value, list):
        for item in value:
            walk(item)

walk(data)
for req in sorted(seen):
    print(req)
PY
