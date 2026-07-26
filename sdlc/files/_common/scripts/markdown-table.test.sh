#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=markdown-table.sh
source "$SCRIPT_DIR/markdown-table.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cat > "$WORK/RTM.md" <<'MARKDOWN'
| Status | Description |
| --- | --- |
| Draft | This is not the requirements table |

| REQ-ID | Issue | Risk | Evidence | Status |
| --- | --- | --- | --- | --- |
| REQ-100 | #100 | HIGH | report.md | TESTED - PENDING SIGN-OFF (note \| retained) |
MARKDOWN

[ "$(markdown_table_cell "$WORK/RTM.md" REQ-100 Status REQ-ID/ID Status)" = \
  'TESTED - PENDING SIGN-OFF (note \| retained)' ]
[ "$(markdown_table_cell "$WORK/RTM.md" REQ-100 Risk REQ-ID/ID Risk)" = "HIGH" ]
[ "$(markdown_table_column_index_for_row "$WORK/RTM.md" REQ-100 Status REQ-ID/ID Status)" = "5" ]

if markdown_table_cell "$WORK/RTM.md" REQ-404 Status REQ-ID/ID Status >/dev/null; then
  echo "missing row unexpectedly matched" >&2
  exit 1
fi

if markdown_table_cell "$WORK/RTM.md" Draft Status REQ-ID/ID Status >/dev/null; then
  echo "legend row unexpectedly matched" >&2
  exit 1
fi

echo "markdown table tests passed"
