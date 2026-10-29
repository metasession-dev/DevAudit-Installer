#!/usr/bin/env bash
# Tests for scripts/check-package-contents.sh (devaudit-installer#1091 D24). `npm pack` is replaced
# by canned JSON through PACK_CMD, so no build or network is needed.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/check-package-contents.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok - $1"; }
no() { FAIL=$((FAIL + 1)); echo "not ok - $1"; }

# A fake repository: cli plus one library package, each with a package.json.
mkdir -p "$TMP/repo/cli" "$TMP/repo/lib"
cat > "$TMP/repo/cli/package.json" <<'JSON'
{ "name": "@x/cli", "version": "1.0.0", "main": "./dist/index.js", "bin": { "x": "./bin/devaudit.js" } }
JSON
cat > "$TMP/repo/lib/package.json" <<'JSON'
{ "name": "@x/lib", "version": "1.0.0", "main": "./dist/index.js", "types": "./dist/index.d.ts" }
JSON
echo readme > "$TMP/repo/cli/README.md"
echo readme > "$TMP/repo/lib/README.md"

# Run the script against the fake repo: a copy of the script whose ROOT is the fake repo.
mkdir -p "$TMP/repo/scripts"
cp "$SCRIPT" "$TMP/repo/scripts/check-package-contents.sh"

# The canned tarball listings, chosen per package directory by the stub PACK_CMD.
GOOD_CLI_FILES=(README.md bin/devaudit.js dist/index.js sdlc/src/bin/devaudit-sdlc.cjs sdlc/files/_common/scripts/upload-evidence.sh)
for i in 1 2 3 4 5 6; do GOOD_CLI_FILES+=("sdlc/src/blueprints/$i-x.raw.md"); done
for i in 1 2 3 4 5 6 7 8 9; do GOOD_CLI_FILES+=("sdlc/files/_common/skills/skill$i/SKILL.md"); done

# emit_json <file...>: npm pack --dry-run --json shape, preceded by lifecycle noise like prepack's.
emit_json() {
  echo "> prepack"; echo "CLI Building entry: src/index.ts"; echo "[tsup] done"
  printf '[\n  {\n    "files": [\n'
  local first=1 f
  for f in "$@"; do
    [ "$first" = 1 ] || printf ',\n'
    first=0
    printf '      { "path": "%s", "size": 1 }' "$f"
  done
  printf '\n    ]\n  }\n]\n'
}

# stub-pack.sh reads the case file $CASE_DIR/<basename of cwd>.files and prints JSON for it.
cat > "$TMP/stub-pack.sh" <<STUB
#!/usr/bin/env bash
$(declare -f emit_json)
mapfile -t files < "\$CASE_DIR/\$(basename "\$PWD").files"
emit_json "\${files[@]}"
STUB
chmod +x "$TMP/stub-pack.sh"

run_case() { # <case-dir> [package dirs...]
  local dir="$1"; shift
  CASE_DIR="$dir" PACK_CMD="$TMP/stub-pack.sh" bash "$TMP/repo/scripts/check-package-contents.sh" "$@"
}

new_case() { # <name> -> prints dir with the good listings
  local d="$TMP/cases/$1"
  mkdir -p "$d"
  printf '%s\n' "${GOOD_CLI_FILES[@]}" > "$d/cli.files"
  printf '%s\n' README.md dist/index.js dist/index.d.ts > "$d/lib.files"
  echo "$d"
}

# 1. a complete listing passes
d="$(new_case good)"
out="$(run_case "$d" cli lib 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q 'all 2 package(s) pass'; then ok "complete tarballs pass (lifecycle noise before the JSON is ignored)"; else no "complete tarballs pass (rc=$rc): $out"; fi

# 2. each required CLI path, removed, fails and is named
for missing in "sdlc/src/bin/devaudit-sdlc.cjs" "sdlc/files/_common/scripts/upload-evidence.sh" "bin/devaudit.js" "dist/index.js" "README.md"; do
  d="$(new_case "miss-$(echo "$missing" | tr '/.' '__')")"
  grep -vxF "$missing" "$d/cli.files" > "$d/cli.files.new" && mv "$d/cli.files.new" "$d/cli.files"
  out="$(run_case "$d" cli 2>&1)"; rc=$?
  if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -qF "$missing"; then ok "missing $missing fails"; else no "missing $missing fails (rc=$rc): $out"; fi
done

# 3. too few blueprints or skills
d="$(new_case few-blueprints)"
grep -v 'blueprints/6-x' "$d/cli.files" > "$d/cli.files.new" && mv "$d/cli.files.new" "$d/cli.files"
out="$(run_case "$d" cli 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q '5 blueprints'; then ok "5 blueprints fails"; else no "5 blueprints fails: $out"; fi
d="$(new_case few-skills)"
grep -v 'skills/skill9/' "$d/cli.files" > "$d/cli.files.new" && mv "$d/cli.files.new" "$d/cli.files"
out="$(run_case "$d" cli 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q '8 skills'; then ok "8 skills fails"; else no "8 skills fails: $out"; fi

# 4. a library whose main / types file is missing fails
d="$(new_case lib-no-types)"
printf '%s\n' README.md dist/index.js > "$d/lib.files"
out="$(run_case "$d" lib 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -qF "dist/index.d.ts"; then ok "a missing types entry fails"; else no "a missing types entry fails: $out"; fi

# 5. env files and *.local files fail
for bad in ".env" ".env.production" "scripts/release-validation/consumers.local" "notes.local"; do
  d="$(new_case "bad-$(echo "$bad" | tr '/.' '__')")"
  echo "$bad" >> "$d/cli.files"
  out="$(run_case "$d" cli 2>&1)"; rc=$?
  if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -qF "forbidden"; then ok "$bad in the tarball fails"; else no "$bad in the tarball fails (rc=$rc): $out"; fi
done
d="$(new_case env-lookalike)"
echo "docs/environment.md" >> "$d/cli.files"
echo "src/.envelope.ts" >> "$d/cli.files"
if run_case "$d" cli >/dev/null 2>&1; then ok "environment.md / .envelope.ts are not env files"; else no "environment.md / .envelope.ts are not env files"; fi

# 6. a package with no README in its directory does not need one in the tarball
mkdir -p "$TMP/repo/noreadme"
echo '{ "name": "@x/n", "version": "1.0.0", "bin": { "n": "./src/n.cjs" } }' > "$TMP/repo/noreadme/package.json"
d="$(new_case no-readme)"
echo src/n.cjs > "$d/noreadme.files"
if run_case "$d" noreadme >/dev/null 2>&1; then ok "no README needed when the package has none"; else no "no README needed when the package has none"; fi

# 7. an empty pack result is a failure, not a pass
d="$(new_case empty)"
: > "$d/lib.files"
cat > "$TMP/stub-empty.sh" <<'STUB'
#!/usr/bin/env bash
echo "npm error something"
STUB
chmod +x "$TMP/stub-empty.sh"
if CASE_DIR="$d" PACK_CMD="$TMP/stub-empty.sh" bash "$TMP/repo/scripts/check-package-contents.sh" lib >/dev/null 2>&1; then no "an empty pack result fails"; else ok "an empty pack result fails"; fi

# 7b. every `exports` target is a promised file: a package with a "./node" entry (core) whose
# tarball lacks it fails, and one that has it passes
mkdir -p "$TMP/repo/core"
cat > "$TMP/repo/core/package.json" <<'JSON'
{ "name": "@x/core", "version": "1.0.0", "main": "./dist/index.js", "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
               "./node": { "types": "./dist/node/index.d.ts", "import": "./dist/node/index.js" } } }
JSON
d="$(new_case core-missing-node)"
printf '%s\n' dist/index.js dist/index.d.ts dist/node/index.d.ts > "$d/core.files"
out="$(run_case "$d" core 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -qF "dist/node/index.js"; then ok "a missing exports entry (dist/node/index.js) fails"; else no "a missing exports entry fails (rc=$rc): $out"; fi
d="$(new_case core-complete)"
printf '%s\n' dist/index.js dist/index.d.ts dist/node/index.js dist/node/index.d.ts > "$d/core.files"
if run_case "$d" core >/dev/null 2>&1; then ok "a package with every exports entry passes"; else no "a package with every exports entry passes"; fi

# 7c. core is one of the default packages
if grep -q '^PACKAGES=(plugin-sdk core cli ' "$SCRIPT"; then ok "core is checked by default"; else no "core is checked by default"; fi

# 8. the real repository: every listed package has a package.json the script can read
for p in plugin-sdk core cli sdlc plugins/devaudit-plugin-prisma plugins/devaudit-plugin-evidence-export; do
  if [ -f "$ROOT/$p/package.json" ]; then ok "real package.json: $p"; else no "real package.json: $p"; fi
done

echo ""
echo "check-package-contents.test.sh: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
