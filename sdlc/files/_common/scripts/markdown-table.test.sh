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
[ "$(markdown_table_column_index_for_row "$WORK/RTM.md" REQ-100 Status REQ-ID/ID Status)" = "6" ]

if markdown_table_cell "$WORK/RTM.md" REQ-404 Status REQ-ID/ID Status >/dev/null; then
  echo "missing row unexpectedly matched" >&2
  exit 1
fi

if markdown_table_cell "$WORK/RTM.md" Draft Status REQ-ID/ID Status >/dev/null; then
  echo "legend row unexpectedly matched" >&2
  exit 1
fi

# devaudit-installer#583 — a blank line inside an otherwise-continuous
# table (accumulated editing/merge noise in a large RTM.md) must not end
# the active table region. The header appears once; rows after a stray
# blank line must still resolve, not become permanently unreachable for
# the rest of the file.
cat > "$WORK/RTM-blank-lines.md" <<'MARKDOWN'
| REQ-ID | Issue | Risk | Evidence | Status |
| --- | --- | --- | --- | --- |
| REQ-001 | #1 | LOW | evidence/REQ-001/ | RELEASED |

| REQ-002 | #2 | LOW | evidence/REQ-002/ | RELEASED |


| REQ-003 | #3 | HIGH | evidence/REQ-003/ | TESTED - PENDING SIGN-OFF |
MARKDOWN

[ "$(markdown_table_cell "$WORK/RTM-blank-lines.md" REQ-001 Status REQ-ID/ID Status)" = "RELEASED" ]
[ "$(markdown_table_cell "$WORK/RTM-blank-lines.md" REQ-002 Status REQ-ID/ID Status)" = "RELEASED" ]
[ "$(markdown_table_cell "$WORK/RTM-blank-lines.md" REQ-003 Status REQ-ID/ID Status)" = \
  "TESTED - PENDING SIGN-OFF" ]
[ "$(markdown_table_column_index_for_row "$WORK/RTM-blank-lines.md" REQ-003 Status REQ-ID/ID Status)" = "6" ]

echo "markdown table tests passed"
