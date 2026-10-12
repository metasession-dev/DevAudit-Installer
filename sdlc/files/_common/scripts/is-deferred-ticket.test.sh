#!/usr/bin/env bash
# is-deferred-ticket.test.sh — tests for the shared deferred-ticket helper (#956).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PASS=0
FAIL=0
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

check() {
  local desc="$1" want="$2" file="$3" got=0
  bash "$SCRIPT_DIR/is-deferred-ticket.sh" "$file" || got=$?
  if [ "$got" = "$want" ]; then echo "  PASS: $desc"; PASS=$((PASS + 1))
  else echo "  FAIL: $desc (want exit $want, got $got)"; FAIL=$((FAIL + 1)); fi
}

printf '# t\n\n- **Absorbed predecessor releases:** None\n- **Release intent:** deferred-to-next — PR #9 closed unmerged\n' > "$WORK/deferred.md"
printf '# t\n\n- **Absorbed predecessor releases:** None\n' > "$WORK/plain.md"
printf '# t\n\n- **Release intent:** deferred-to-next — x\r\n' > "$WORK/crlf.md"
printf '# t\n\n    - **Release intent:** deferred-to-next — indented template comment\n' > "$WORK/indented.md"
printf '# t\n\n- **Release intent:** none\n' > "$WORK/other.md"
printf '# t\n\n- **Release intent:** deferred-to-nextish\n' > "$WORK/prefix.md"

echo "is-deferred-ticket.sh"
check "deferred field -> 0" 0 "$WORK/deferred.md"
check "CRLF checkout -> 0" 0 "$WORK/crlf.md"
check "no field -> 1" 1 "$WORK/plain.md"
check "indented template example does not match -> 1" 1 "$WORK/indented.md"
check "other intent value -> 1" 1 "$WORK/other.md"
check "missing file -> 1" 1 "$WORK/nope.md"

# usage error
got=0; bash "$SCRIPT_DIR/is-deferred-ticket.sh" >/dev/null 2>&1 || got=$?
if [ "$got" = 2 ]; then echo "  PASS: no args -> 2"; PASS=$((PASS + 1)); else echo "  FAIL: no args (got $got)"; FAIL=$((FAIL + 1)); fi

# sourced use defines the function without running main or leaking set -e
out=$(bash -c "source '$SCRIPT_DIR/is-deferred-ticket.sh'; is_deferred_ticket '$WORK/deferred.md' && echo yes; is_deferred_ticket '$WORK/plain.md' || echo no")
if [ "$out" = "yes
no" ]; then echo "  PASS: sourced function"; PASS=$((PASS + 1)); else echo "  FAIL: sourced function ($out)"; FAIL=$((FAIL + 1)); fi

# agrees with the derive-release-version.sh copy on the same fixtures
for f in deferred plain crlf indented other prefix; do
  a=0; bash "$SCRIPT_DIR/is-deferred-ticket.sh" "$WORK/$f.md" || a=$?
  b=0
  line=$(grep -m1 '^\- \*\*Release intent:\*\*' "$WORK/$f.md" 2>/dev/null || true)
  printf '%s' "$line" | grep -qE '^- \*\*Release intent:\*\*[[:space:]]+deferred-to-next' || b=$?
  if [ "$a" = "$b" ]; then echo "  PASS: parity with derive-release-version pattern ($f)"; PASS=$((PASS + 1))
  else echo "  FAIL: parity ($f: $a vs $b)"; FAIL=$((FAIL + 1)); fi
done

echo
echo "Results: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
