#!/usr/bin/env bash
# submit-bundle-manifest.test.sh — Focused tests for bundle manifest submission.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/submit-bundle-manifest.sh"
[ -x "$HELPER" ] || chmod +x "$HELPER"

PASS=0
FAIL=0
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

assert_contains() {
  local desc="$1" needle="$2" file="$3"
  if grep -Fq "$needle" "$file"; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    echo "    missing: $needle"
    echo "    file:"
    sed 's/^/    /' "$file"
    FAIL=$((FAIL + 1))
  fi
}

make_fixture() {
  local dir="$1"
  rm -rf "$dir"
  mkdir -p "$dir/bin"
  cd "$dir"
  cat > bin/curl <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
LOG_FILE="${SUBMIT_TEST_LOG:?}"
URL=""
BODY_FILE=""
WRITE_OUT=""
METHOD="GET"
BODY=""
ARGS=("$@")
for ((i=0; i<${#ARGS[@]}; i++)); do
  arg="${ARGS[$i]}"
  case "$arg" in
    -X) METHOD="${ARGS[$((i+1))]}" ;;
    -o) BODY_FILE="${ARGS[$((i+1))]}" ;;
    -w) WRITE_OUT="${ARGS[$((i+1))]}" ;;
    --data) BODY="${ARGS[$((i+1))]}" ;;
    http://*|https://*) URL="$arg" ;;
  esac
done
echo "METHOD:${METHOD}" >> "$LOG_FILE"
echo "URL:${URL}" >> "$LOG_FILE"
if [ -n "$BODY" ]; then
  echo "BODY:${BODY}" >> "$LOG_FILE"
fi
if [[ "$URL" == *"/api/ci/releases/resolve"* ]]; then
  printf '{"latest":{"id":"rel_123","version":"REQ-042","status":"draft"}}'
  exit 0
fi
if [[ "$URL" == *"/api/ci/releases/rel_123/bundle-manifest" ]]; then
  if [ -n "$BODY_FILE" ]; then
    printf '{"ok":true}' > "$BODY_FILE"
  fi
  if [ -n "$WRITE_OUT" ]; then
    printf '201'
  fi
  exit 0
fi
printf '{"error":"unexpected url"}'
exit 1
EOF
  chmod +x bin/curl
}

echo "=== submit-bundle-manifest.sh tests ==="

D1="$WORK/case1"
make_fixture "$D1"
cat > "$D1/manifest.json" <<'EOF'
{
  "schemaVersion": 1,
  "approvalRelease": { "version": "REQ-042" },
  "coreRelease": { "version": "REQ-042" },
  "members": [
    {
      "version": "REQ-041",
      "role": "predecessor",
      "relationship": "superseded"
    }
  ],
  "nonReleaseWorkItems": [
    {
      "kind": "housekeeping_commit",
      "title": "docs: refresh release notes"
    }
  ],
  "manifestHash": "sha256:test"
}
EOF
LOG_FILE="$D1/submit.log"
touch "$LOG_FILE"
export PATH="$D1/bin:$PATH"
export SUBMIT_TEST_LOG="$LOG_FILE"
export DEVAUDIT_BASE_URL="https://devaudit.example.test"
export DEVAUDIT_API_KEY="mc_test_dummy"

bash "$HELPER" fixture-project REQ-042 "$D1/manifest.json" > "$D1/stdout.log" 2>&1
assert_contains "resolve endpoint called" "/api/ci/releases/resolve?projectSlug=fixture-project&versionPrefix=REQ-042" "$LOG_FILE"
assert_contains "bundle endpoint called" "/api/ci/releases/rel_123/bundle-manifest" "$LOG_FILE"
assert_contains "member payload submitted" "\"version\": \"REQ-041\"" "$LOG_FILE"

D2="$WORK/case2"
make_fixture "$D2"
cat > "$D2/manifest.json" <<'EOF'
{
  "schemaVersion": 1,
  "approvalRelease": { "version": "REQ-042" },
  "coreRelease": { "version": "REQ-042" },
  "members": [],
  "nonReleaseWorkItems": []
}
EOF
LOG_FILE="$D2/submit.log"
touch "$LOG_FILE"
export PATH="$D2/bin:$PATH"
export SUBMIT_TEST_LOG="$LOG_FILE"

bash "$HELPER" fixture-project REQ-042 "$D2/manifest.json" > "$D2/stdout.log" 2>&1
assert_contains "empty manifest skips submission" "Bundle manifest has no members or non-release work items; skipping submission." "$D2/stdout.log"

# devaudit-installer#955 — co_tracked members are never submitted to the portal,
# and the submitted manifestHash is recomputed for the stripped payload using
# the portal's own algorithm (hashCanonicalBundleManifest: canonical sorted-key
# JSON of {schemaVersion, approvalRelease, coreRelease, members,
# nonReleaseWorkItems, generator minus generatedAt}, sha256).
portal_hash() {
  node -e '
    const { createHash } = require("node:crypto");
    const input = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    const canon = (v) => Array.isArray(v) ? v.map(canon)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).filter(([, e]) => e !== undefined)
            .sort(([a], [b]) => a.localeCompare(b)).map(([k, e]) => [k, canon(e)]))
        : v;
    const generator = input.generator ? { ...input.generator } : null;
    if (generator) delete generator.generatedAt;
    const payload = { schemaVersion: input.schemaVersion, approvalRelease: input.approvalRelease ?? null,
      coreRelease: input.coreRelease ?? null, members: input.members,
      nonReleaseWorkItems: input.nonReleaseWorkItems ?? [], generator };
    process.stdout.write("sha256:" + createHash("sha256").update(JSON.stringify(canon(payload))).digest("hex"));
  '
}

D3="$WORK/case3"
make_fixture "$D3"
cat > "$D3/manifest.json" <<'EOF'
{
  "schemaVersion": 2,
  "approvalRelease": { "version": "REQ-042" },
  "coreRelease": { "version": "REQ-042" },
  "members": [
    { "version": "REQ-041", "role": "predecessor", "relationship": "superseded", "originalTitle": "Earlier", "evidenceInheritancePolicy": { "mode": "none" } },
    { "version": "REQ-043", "role": "co_tracked", "relationship": "bundled", "originalTitle": "Sibling", "evidenceInheritancePolicy": { "mode": "none" } },
    { "version": "REQ-044", "role": "co_tracked", "relationship": "bundled", "originalTitle": "Sibling 2", "evidenceInheritancePolicy": { "mode": "none" } }
  ],
  "nonReleaseWorkItems": [],
  "generator": { "name": "devaudit-installer", "version": "1.7.5", "repository": "acme/app", "generatedAt": "2026-10-04T00:00:00Z" },
  "manifestHash": "sha256:stale-hash-covering-co-tracked-members"
}
EOF
LOG_FILE="$D3/submit.log"
touch "$LOG_FILE"
export PATH="$D3/bin:$PATH"
export SUBMIT_TEST_LOG="$LOG_FILE"
bash "$HELPER" fixture-project REQ-042 "$D3/manifest.json" > "$D3/stdout.log" 2>&1
assert_contains "predecessor member is still submitted" "\"version\":\"REQ-041\"" "$LOG_FILE"
if grep -q 'co_tracked' "$LOG_FILE"; then
  echo "  FAIL: co_tracked members must not be submitted"
  FAIL=$((FAIL + 1))
else
  echo "  PASS: co_tracked members are not submitted"
  PASS=$((PASS + 1))
fi
assert_contains "operator is told why" "Not submitting co_tracked bundle members" "$D3/stdout.log"
SENT_BODY="$(grep '^BODY:' "$LOG_FILE" | head -1 | sed 's/^BODY://')"
SENT_HASH="$(jq -r '.manifestHash' <<<"$SENT_BODY")"
EXPECTED_HASH="$(jq -c 'del(.manifestHash)' <<<"$SENT_BODY" | portal_hash)"
if [ "$SENT_HASH" = "$EXPECTED_HASH" ] && [ "$SENT_HASH" != "sha256:stale-hash-covering-co-tracked-members" ]; then
  echo "  PASS: manifestHash is recomputed for the stripped payload (matches the portal algorithm)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: manifestHash mismatch"
  echo "    sent:     $SENT_HASH"
  echo "    expected: $EXPECTED_HASH"
  FAIL=$((FAIL + 1))
fi
if jq -e '(.members | length) == 3' "$D3/manifest.json" >/dev/null; then
  echo "  PASS: the committed manifest file is left untouched"
  PASS=$((PASS + 1))
else
  echo "  FAIL: the committed manifest file was modified"
  FAIL=$((FAIL + 1))
fi

D4="$WORK/case4"
make_fixture "$D4"
cat > "$D4/manifest.json" <<'EOF'
{
  "schemaVersion": 2,
  "approvalRelease": { "version": "REQ-042" },
  "coreRelease": { "version": "REQ-042" },
  "members": [
    { "version": "REQ-043", "role": "co_tracked", "relationship": "bundled" }
  ],
  "nonReleaseWorkItems": [],
  "manifestHash": "sha256:x"
}
EOF
LOG_FILE="$D4/submit.log"
touch "$LOG_FILE"
export PATH="$D4/bin:$PATH"
export SUBMIT_TEST_LOG="$LOG_FILE"
bash "$HELPER" fixture-project REQ-042 "$D4/manifest.json" > "$D4/stdout.log" 2>&1
assert_contains "a manifest holding only co_tracked members skips submission" "Bundle manifest has no members or non-release work items; skipping submission." "$D4/stdout.log"
if grep -q 'bundle-manifest' "$LOG_FILE"; then
  echo "  FAIL: nothing should be POSTed for a co_tracked-only manifest"
  FAIL=$((FAIL + 1))
else
  echo "  PASS: no portal call is made for a co_tracked-only manifest"
  PASS=$((PASS + 1))
fi

echo ""
echo "=== submit-bundle-manifest.test.sh: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
