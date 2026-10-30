#!/usr/bin/env bash
# check-package-contents.sh — does each package tarball contain what it must, and nothing it must
# not? (devaudit-installer#1091 D24; replaces the hand-rolled "bundle" check in the release steps.)
#
# For each of the six packages it runs `npm pack --dry-run --json` and fails when a required
# path is missing, or when the tarball contains an environment file, `consumers.local` or any
# `*.local` file (consumers are never named in this public repo, and a local file may hold a
# credential).
#
# Usage:   scripts/check-package-contents.sh [package-dir ...]
#          defaults to the six published packages, relative to the repository root
# Needs:   jq, npm; plugin-sdk, core and the two plugins built (`npm run build`) so their dist/ exists.
#          The CLI's `prepack` builds dist/ and bundles sdlc/ into the tarball itself.
# Env:     PACK_CMD  command that prints `npm pack --dry-run --json` output for the current
#                    directory (default: that npm command; the tests replace it)
# Exit:    0 every package passes; 1 at least one failure; 2 usage / missing tool
#
# Required paths live in ONE place, here, so a change to what ships is a change to this list.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACK_CMD="${PACK_CMD:-npm pack --dry-run --json}"

PACKAGES=(plugin-sdk core cli sdlc plugins/devaudit-plugin-prisma plugins/devaudit-plugin-evidence-export)

# ---- the required list ----------------------------------------------------------------------
# CLI: exact files, directory prefixes (at least one file under each), and minimum counts.
CLI_REQUIRED_FILES=(
  "bin/devaudit.js"
  "sdlc/src/bin/devaudit-sdlc.cjs"
  "sdlc/files/_common/scripts/upload-evidence.sh"
  "frameworks/schema.json"
  "frameworks/soc-2.json"
  "frameworks/iso-27001.json"
  "frameworks/iso-29119.json"
  "frameworks/gdpr.json"
  "frameworks/eu-ai-act.json"
)
CLI_REQUIRED_DIRS=("dist/")
CLI_MIN_BLUEPRINTS=6 # sdlc/src/blueprints/*.raw.md
CLI_MIN_SKILLS=9     # distinct directories under sdlc/files/_common/skills/
# Every package: its main / types / bin / exports entries from package.json, and README.md when the
# package directory has one (npm adds it on its own).
# Never in any tarball:
FORBIDDEN_RE='(^|/)\.env($|\.)|(^|/)consumers\.local$|\.local$'
# ----------------------------------------------------------------------------------------------

command -v jq >/dev/null || { echo "check-package-contents: jq is required" >&2; exit 2; }

FAILED=0
PKG_FAILED=0
fail() { echo "  FAIL: $*"; FAILED=1; PKG_FAILED=1; }

# pack_files <dir>: the tarball's file paths, one per line. Lifecycle scripts (the CLI's
# prepack) print build output before the JSON, so start at the line that is exactly "[".
pack_files() {
  ( cd "$1" && eval "$PACK_CMD" 2>/dev/null ) | awk '/^\[$/ { f = 1 } f' | jq -r '.[0].files[].path' 2>/dev/null
}

# manifest_paths <dir>: package.json main / types / bin / exports entries, without a leading "./".
# Every string under `exports` is a file the package promises (for example core's "./node" entry).
manifest_paths() {
  jq -r '[.main, .types, (.bin | if type == "string" then . elif type == "object" then (.[]) else empty end),
          ((.exports // empty) | .. | strings)]
         | map(select(. != null)) | unique | .[] | sub("^\\./"; "")' "$1/package.json"
}

check_package() { # <relative dir>
  local rel="$1" dir name files path n
  PKG_FAILED=0
  dir="$ROOT/$rel"
  [ -f "$dir/package.json" ] || { echo "== $rel"; fail "no package.json"; return; }
  name="$(jq -r .name "$dir/package.json")"
  echo "== $rel ($name)"
  files="$(pack_files "$dir")"
  if [ -z "$files" ]; then fail "npm pack --dry-run --json gave no file list"; return; fi

  while IFS= read -r path; do
    [ -n "$path" ] || continue
    printf '%s\n' "$files" | grep -qxF -- "$path" || fail "package.json entry '$path' is not in the tarball"
  done < <(manifest_paths "$dir")

  if [ -f "$dir/README.md" ]; then
    printf '%s\n' "$files" | grep -qxF "README.md" || fail "README.md is not in the tarball"
  fi

  if [ "$rel" = "cli" ]; then
    for path in "${CLI_REQUIRED_FILES[@]}"; do
      printf '%s\n' "$files" | grep -qxF -- "$path" || fail "required file '$path' is missing"
    done
    for path in "${CLI_REQUIRED_DIRS[@]}"; do
      printf '%s\n' "$files" | grep -q -- "^$path" || fail "nothing under required directory '$path'"
    done
    n="$(printf '%s\n' "$files" | grep -cE '^sdlc/src/blueprints/[^/]+\.raw\.md$' || true)"
    [ "$n" -ge "$CLI_MIN_BLUEPRINTS" ] || fail "$n blueprints in sdlc/src/blueprints/ (need >= $CLI_MIN_BLUEPRINTS)"
    n="$(printf '%s\n' "$files" | grep '^sdlc/files/_common/skills/' | cut -d/ -f5 | sort -u | grep -c . || true)"
    [ "$n" -ge "$CLI_MIN_SKILLS" ] || fail "$n skills in sdlc/files/_common/skills/ (need >= $CLI_MIN_SKILLS)"
  fi

  local bad
  bad="$(printf '%s\n' "$files" | grep -E -- "$FORBIDDEN_RE" || true)"
  [ -z "$bad" ] || fail "forbidden file(s) in the tarball: $(printf '%s' "$bad" | tr '\n' ' ')"

  [ "$PKG_FAILED" -eq 0 ] && echo "  ok: $(printf '%s\n' "$files" | grep -c .) files"
}

if [ "$#" -gt 0 ]; then PACKAGES=("$@"); fi
for p in "${PACKAGES[@]}"; do
  check_package "$p"
done

if [ "$FAILED" -ne 0 ]; then
  echo "check-package-contents: FAILED" >&2
  exit 1
fi
echo "check-package-contents: all ${#PACKAGES[@]} package(s) pass."
