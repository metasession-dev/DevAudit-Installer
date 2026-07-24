#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
mkdir -p "$WORK_DIR/bin"

cat > "$WORK_DIR/bin/npm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
counter_file="${NPM_FAKE_COUNTER:?}"
count="$(cat "$counter_file" 2>/dev/null || echo 0)"
field="$3"
if [ "$field" = "version" ]; then
  count=$((count + 1))
  printf '%s' "$count" > "$counter_file"
  if [ "$count" -lt "${NPM_FAKE_SUCCEED_AFTER:-1}" ]; then
    exit 1
  fi
  echo "${NPM_FAKE_VERSION:-0.3.26}"
elif [ "$field" = "dist.tarball" ]; then
  echo "https://registry.example.test/package.tgz"
else
  exit 2
fi
EOF
chmod +x "$WORK_DIR/bin/npm"

cat > "$WORK_DIR/bin/curl" <<'EOF'
#!/usr/bin/env bash
exit "${CURL_FAKE_EXIT_CODE:-0}"
EOF
chmod +x "$WORK_DIR/bin/curl"

export PATH="$WORK_DIR/bin:$PATH"
export NPM_PUBLICATION_VERIFY_INTERVAL_SECONDS=0
export NPM_FAKE_COUNTER="$WORK_DIR/counter"

NPM_FAKE_SUCCEED_AFTER=2 "$ROOT/scripts/verify-npm-publication.sh" '@scope/example' '0.3.26'
test "$(cat "$WORK_DIR/counter")" = '2'

printf '0' > "$WORK_DIR/counter"
set +e
NPM_FAKE_SUCCEED_AFTER=9 NPM_PUBLICATION_VERIFY_ATTEMPTS=2 \
  "$ROOT/scripts/verify-npm-publication.sh" '@scope/example' '0.3.26' >"$WORK_DIR/timeout.out" 2>&1
status=$?
set -e
test "$status" -eq 1
grep -q 'Public npm verification timed out: @scope/example@0.3.26' "$WORK_DIR/timeout.out"

echo 'verify-npm-publication tests passed'
