#!/usr/bin/env bash
# check-operator-signoffs.test.sh — tests for check-operator-signoffs.sh (devaudit-installer#1200).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/check-operator-signoffs.sh"
[ -x "$HELPER" ] || chmod +x "$HELPER"

PASS=0
FAIL=0
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    echo "    expected: $expected"
    echo "    actual:   $actual"
    FAIL=$((FAIL + 1))
  fi
}

# run <dir> <args...> — prints "<exit>|<stdout>"
run() {
  local dir="$1" out rc
  shift
  set +e
  out="$(cd "$dir" && bash "$HELPER" "$@" 2>/dev/null)"
  rc=$?
  set -e
  printf '%s|%s' "$rc" "$out"
}

write_evidence() {
  # write_evidence <dir> <name> <body>
  mkdir -p "$1/compliance/evidence/REQ-100"
  printf '%s\n' "$3" > "$1/compliance/evidence/REQ-100/$2"
}

PENDING_ADR='# ADR
## Operator sign-off

- [ ] The verdict matches.
- [ ] The rationale is specific.

**Reviewer:** <operator-name>
**Date:** <YYYY-MM-DD>'

SIGNED_ADR='# ADR
## Operator sign-off

- [x] The verdict matches.
- [x] The rationale is specific.

**Reviewer:** alice (Alice A)
**Date:** 2026-11-08

_Approved by alice in the Claude Code session on 2026-11-08; recorded by the agent from the operator reply._'

echo "=== check-operator-signoffs.sh tests ==="

D1="$WORK/signed"
write_evidence "$D1" architecture-decision.md "$SIGNED_ADR"
assert_eq "a fully signed block exits 0 and prints nothing" "0|" "$(run "$D1" REQ-100)"

D2="$WORK/pending"
write_evidence "$D2" architecture-decision.md "$PENDING_ADR"
assert_eq "unticked boxes and placeholders exit 1 and name the file" \
  "1|compliance/evidence/REQ-100/architecture-decision.md: 2 unticked box(es), reviewer missing, date missing" \
  "$(run "$D2" REQ-100)"

D3="$WORK/one-box"
write_evidence "$D3" risk-assessment.md '## Operator sign-off
- [x] a
- [ ] b

**Reviewer:** alice
**Date:** 2026-11-08'
assert_eq "one unticked box alone is pending" \
  "1|compliance/evidence/REQ-100/risk-assessment.md: 1 unticked box(es)" "$(run "$D3" REQ-100)"

D4="$WORK/placeholder-only"
write_evidence "$D4" e2e-scope-decision.md '## Operator sign-off

I have reviewed the e2e-scope verdict above.

**Reviewer:** <operator-name>
**Date:** <YYYY-MM-DD>'
assert_eq "a block with no boxes but placeholder reviewer and date is pending" \
  "1|compliance/evidence/REQ-100/e2e-scope-decision.md: 0 unticked box(es), reviewer missing, date missing" \
  "$(run "$D4" REQ-100)"

D5="$WORK/pending-word"
write_evidence "$D5" srs-alignment.md '## Operator sign-off
- [x] a

**Reviewer:** PENDING
**Date:** 2026-11-08'
assert_eq "Reviewer: PENDING is pending" \
  "1|compliance/evidence/REQ-100/srs-alignment.md: 0 unticked box(es), reviewer missing" "$(run "$D5" REQ-100)"

D6="$WORK/no-heading"
write_evidence "$D6" test-plan.md '# Plan
- [ ] an unrelated checklist item'
assert_eq "a file with no sign-off heading is not checked" "0|" "$(run "$D6" REQ-100)"

D7="$WORK/later-heading"
write_evidence "$D7" architecture-decision.md '## Operator sign-off
- [x] a

**Reviewer:** alice
**Date:** 2026-11-08

## Appendix
- [ ] an unrelated item after the block'
assert_eq "boxes after the next heading are ignored" "0|" "$(run "$D7" REQ-100)"

D8="$WORK/json"
write_evidence "$D8" architecture-decision.md "$PENDING_ADR"
assert_eq "--json lists file, boxes and flags" \
  '1|[{"file":"compliance/evidence/REQ-100/architecture-decision.md","unticked":["The verdict matches.","The rationale is specific."],"reviewerMissing":true,"dateMissing":true}]' \
  "$(run "$D8" REQ-100 --json)"
assert_eq "--json prints an empty array when nothing is pending" "0|[]" "$(run "$D1" REQ-100 --json)"

D9="$WORK/no-dir"
mkdir -p "$D9"
assert_eq "no evidence directory exits 0" "0|" "$(run "$D9" REQ-100)"

assert_eq "no argument is a usage error" "2|" "$(run "$D9")"

# --- devaudit-installer#1211 ---

D10="$WORK/not-applicable"
write_evidence "$D10" architecture-decision.md '## Operator sign-off
- [x] The verdict matches.
- [x] If ADR: the file is edited.
- [~] If no-ADR: the rationale is specific.

**Reviewer:** alice
**Date:** 2026-11-08'
assert_eq "a conditional box marked - [~] counts as answered" "0|" "$(run "$D10" REQ-100)"

D11="$WORK/name-email"
write_evidence "$D11" risk-assessment.md '## Operator sign-off
- [x] a

**Reviewer:** Jane Doe <jane@example.com>
**Date:** 2026-11-08'
assert_eq "a reviewer written Name <email> is a real reviewer" "0|" "$(run "$D11" REQ-100)"

D12="$WORK/plain-fields"
write_evidence "$D12" srs-alignment.md '## Operator sign-off
- [x] a

Reviewer: alice
**Date**: 2026-11-08'
assert_eq "Reviewer: without bold and **Date**: are read" "0|" "$(run "$D12" REQ-100)"

D13="$WORK/indented"
write_evidence "$D13" risk-assessment.md '## Operator sign-off
  - [ ] an indented box

**Reviewer:** alice
**Date:** 2026-11-08'
assert_eq "an indented unticked box is pending" \
  "1|compliance/evidence/REQ-100/risk-assessment.md: 1 unticked box(es)" "$(run "$D13" REQ-100)"

D14="$WORK/placeholder-angle"
write_evidence "$D14" risk-assessment.md '## Operator sign-off
- [x] a

**Reviewer:** <your name>
**Date:** 2026-11-08'
assert_eq "a reviewer that is only a <placeholder> is pending" \
  "1|compliance/evidence/REQ-100/risk-assessment.md: 0 unticked box(es), reviewer missing" "$(run "$D14" REQ-100)"

# Text output must not need jq; --json without jq is a usage error.
NOJQ="$WORK/nojq-bin"
mkdir -p "$NOJQ"
for tool in sed grep; do ln -s "$(command -v "$tool")" "$NOJQ/$tool"; done
BASH_BIN="$(command -v bash)"
nojq_run() {
  local dir="$1" out rc
  shift
  set +e
  out="$(cd "$dir" && PATH="$NOJQ" "$BASH_BIN" "$HELPER" "$@" 2>/dev/null)"
  rc=$?
  set -e
  printf '%s|%s' "$rc" "$out"
}
assert_eq "text output works without jq (pending)" \
  "1|compliance/evidence/REQ-100/architecture-decision.md: 2 unticked box(es), reviewer missing, date missing" \
  "$(nojq_run "$D2" REQ-100)"
assert_eq "text output works without jq (signed)" "0|" "$(nojq_run "$D1" REQ-100)"
assert_eq "--json without jq exits 2" "2|" "$(nojq_run "$D1" REQ-100 --json)"

echo ""
echo "Passed: $PASS  Failed: $FAIL"
[ "$FAIL" -eq 0 ]
