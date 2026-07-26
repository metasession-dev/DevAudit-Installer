#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cat > "$WORK/good.sh" <<'SH'
safe_helper() {
  if [ -n "${VALUE:-}" ]; then
    printf '%s' "$VALUE"
  fi
  return 0
}
SH

bash "$ROOT/scripts/lint-shell-failure-modes.sh" "$WORK" >/dev/null

cat > "$WORK/bad.sh" <<'SH'
unsafe_helper() {
  [ -n "${VALUE:-}" ] && printf '%s' "$VALUE"
}
RESULT="$(unsafe_helper)"
SH

if bash "$ROOT/scripts/lint-shell-failure-modes.sh" "$WORK" >"$WORK/out" 2>&1; then
  echo "unsafe helper unexpectedly passed" >&2
  exit 1
fi
grep -q 'unsafe final conditional in unsafe_helper' "$WORK/out"
grep -q 'add an explicit return 0' "$WORK/out"

echo "shell failure-mode lint tests passed"
