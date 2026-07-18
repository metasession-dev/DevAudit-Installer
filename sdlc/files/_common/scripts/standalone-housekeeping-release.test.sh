#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/standalone-housekeeping-release.sh"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

MANIFEST="$WORK/standalone.json"
cat > "$MANIFEST" <<'JSON'
{"schemaVersion":1,"version":"v2026.07.18","releaseMode":"standalone_housekeeping","reason":"Urgent production CI repair cannot wait for the next tracked requirement."}
JSON

bash "$HELPER" validate v2026.07.18 "$MANIFEST"

MOCK_BIN="$WORK/bin"
mkdir -p "$MOCK_BIN"
cat > "$MOCK_BIN/curl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *"/resolve?"* ]]; then
  printf '{"latest":{"id":"rel_123","version":"v2026.07.18"}}'
  exit 0
fi
output_file=""
for ((i=1; i <= $#; i++)); do
  if [ "${!i}" = "-o" ]; then
    next=$((i + 1))
    output_file="${!next}"
  fi
done
[ -z "$output_file" ] || printf '{"ok":true}' > "$output_file"
printf '200'
MOCK
chmod +x "$MOCK_BIN/curl"

PATH="$MOCK_BIN:$PATH" DEVAUDIT_BASE_URL=https://devaudit.example.test DEVAUDIT_API_KEY=mc_test \
  bash "$HELPER" promote fixture-project v2026.07.18 "$MANIFEST"

if bash "$HELPER" validate REQ-999 "$MANIFEST" >/dev/null 2>&1; then
  echo "Expected tracked version validation to fail" >&2
  exit 1
fi

echo "standalone-housekeeping-release: PASS"
