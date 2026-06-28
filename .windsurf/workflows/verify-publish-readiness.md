---
description: Verify all DevAudit packages are version-aligned, built, bundled, and published correctly before consumers run devaudit update
---

# Verify Publish Readiness

Run this before cutting a release tag or when diagnosing why a consumer's `devaudit update` is stale or broken.

## What this checks

1. **Version alignment** — all 5 `package.json` files declare the same version
2. **Registry sync** — all 5 packages on npm match the local version
3. **Bundle integrity** — `prepack` produces a self-contained CLI tarball with `sdlc/` and `scripts/`
4. **Build health** — all packages compile (tsc + tsup) and tests pass
5. **Consumer sync simulation** — `devaudit update` against a temp fixture produces expected files

## Steps

### 1. Check version alignment across all 5 packages

Run this and verify all 5 lines print the same version:

```bash
// turbo
echo "plugin-sdk:  $(jq -r .version plugin-sdk/package.json)"
echo "cli:         $(jq -r .version cli/package.json)"
echo "sdlc-engine: $(jq -r .version sdlc/package.json)"
echo "prisma:      $(jq -r .version plugins/devaudit-plugin-prisma/package.json)"
echo "evidence:    $(jq -r .version plugins/devaudit-plugin-evidence-export/package.json)"
```

If any version differs, align them before proceeding. The release workflow publishes all 5 from their `package.json` — a mismatch means one package gets a stale or skipped release.

### 2. Check registry versions match local

```bash
// turbo
for pkg in \
  "@metasession.co/devaudit-plugin-sdk" \
  "@metasession.co/devaudit-cli" \
  "devaudit-sdlc" \
  "@metasession.co/devaudit-plugin-prisma" \
  "@metasession.co/devaudit-plugin-evidence-export"; do
  local_ver=""
  case "$pkg" in
    @metasession.co/devaudit-plugin-sdk) local_ver=$(jq -r .version plugin-sdk/package.json);;
    @metasession.co/devaudit-cli)         local_ver=$(jq -r .version cli/package.json);;
    devaudit-sdlc)                        local_ver=$(jq -r .version sdlc/package.json);;
    @metasession.co/devaudit-plugin-prisma) local_ver=$(jq -r .version plugins/devaudit-plugin-prisma/package.json);;
    @metasession.co/devaudit-plugin-evidence-export) local_ver=$(jq -r .version plugins/devaudit-plugin-evidence-export/package.json);;
  esac
  registry_ver=$(npm view "$pkg" version 2>/dev/null || echo "NOT_PUBLISHED")
  if [ "$local_ver" = "$registry_ver" ]; then
    echo "OK   $pkg @ $local_ver"
  else
    echo "MISMATCH  $pkg — local: $local_ver, registry: $registry_ver"
  fi
done
```

Any `MISMATCH` line means a package needs publishing. If `devaudit-sdlc` shows a mismatch, run `cd sdlc && npm publish` separately (it's not in `release.yml`).

### 3. Verify the release workflow publishes all packages

Check `.github/workflows/release.yml` includes a publish step for `devaudit-sdlc`. As of this writing, it publishes 4 packages but NOT `devaudit-sdlc` — that's a known gap tracked in #244. If #244 is still open, `devaudit-sdlc` must be published manually:

```bash
cd sdlc && npm publish --access public
```

### 4. Build all packages

```bash
// turbo
cd plugin-sdk && npm install --legacy-peer-deps && npm run build && cd ..
cd cli && npm install --legacy-peer-deps && npm run build && cd ..
cd plugins/devaudit-plugin-prisma && npm install --legacy-peer-deps && npm run build && cd ../..
cd plugins/devaudit-plugin-evidence-export && npm install --legacy-peer-deps && npm run build && cd ../..
```

If any build fails, fix before proceeding. The release workflow will fail at the same step.

### 5. Verify CLI bundle integrity

The CLI's `prepack` script runs `tsup` + `bundle-templates.mjs`. Verify the bundled snapshot contains the SDLC engine binary + blueprints (section 2h):

```bash
// turbo
cd cli && npm run bundle:templates && echo "---" && \
  echo "sdlc/bin exists:    $(test -f sdlc/src/bin/devaudit-sdlc.js && echo YES || echo NO)" && \
  echo "blueprints exist:   $(test -d sdlc/src/blueprints && echo YES || echo NO)" && \
  echo "blueprint count:    $(ls sdlc/src/blueprints/*.raw.md 2>/dev/null | wc -l)" && \
  echo "upload-evidence:    $(test -f scripts/upload-evidence.sh && echo YES || echo NO)" && \
  echo "files dir:          $(test -d sdlc/files && echo YES || echo NO)" && \
  echo "common skills:      $(ls sdlc/files/_common/skills/ 2>/dev/null | wc -l) skill(s)"
```

Expected: `sdlc/bin exists: YES`, `blueprints exist: YES`, `blueprint count: 6`, `upload-evidence: YES`, `files dir: YES`, `common skills: 2+`.

### 6. Run tests

```bash
// turbo
cd cli && npm test
```

If tests hang or fail, fix before proceeding. The release workflow does not run tests — CI (cli.yml) does, but a green CI on `main` doesn't guarantee the tag you're about to push is clean.

### 7. Dry-run npm pack to verify tarball contents

```bash
// turbo
cd plugin-sdk && npm pack --dry-run 2>&1 | grep -E '^npm notice' | head -20 && cd ..
cd cli && npm pack --dry-run 2>&1 | grep -E '^npm notice' | head -30 && cd ..
cd sdlc && npm pack --dry-run 2>&1 | grep -E '^npm notice' | head -10 && cd ..
```

Verify:
- `cli` tarball includes `dist/`, `bin/`, `sdlc/` (bundled templates), `scripts/`
- `sdlc` tarball includes `src/bin/devaudit-sdlc.js` and `src/blueprints/`
- `plugin-sdk` tarball includes `dist/`

### 8. Simulate consumer sync

```bash
// turbo
tmpdir=$(mktemp -d)
mkdir -p "$tmpdir/scripts" "$tmpdir/.husky" "$tmpdir/e2e/helpers" "$tmpdir/.github/workflows"
echo '{"stack":"node","host":"railway"}' > "$tmpdir/sdlc-config.json"
DEVAUDIT_INSTALLER_ROOT="$(pwd)" npx tsx -e "
import { syncProject } from './cli/src/update/index.ts';
syncProject('$tmpdir').then(r => {
  console.log('Total files synced:', r.totalFilesSynced);
  for (const s of r.sections) {
    console.log('  [' + s.name + ']:', s.filesSynced, 'file(s)', s.skipped ? '(SKIPPED)' : '');
  }
});
"
echo "---"
echo "SDLC/bin:     $(test -f $tmpdir/SDLC/bin/devaudit-sdlc.js && echo YES || echo NO)"
echo "SDLC/blueprints: $(ls $tmpdir/SDLC/blueprints/*.raw.md 2>/dev/null | wc -l) file(s)"
echo "SDLC docs:    $(ls $tmpdir/SDLC/*.md 2>/dev/null | wc -l) file(s)"
echo "Skills:       $(ls -d $tmpdir/.claude/skills/*/ 2>/dev/null | wc -l) skill(s)"
echo "CI workflow:  $(test -f $tmpdir/.github/workflows/ci.yml && echo YES || echo NO)"
rm -rf "$tmpdir"
```

If `SDLC/bin` shows `NO` or blueprints count is `0`, the `syncSdlcEngine` section (2h) is broken.

### 9. Cut the release (if all checks pass)

```bash
git tag "v$(jq -r .version cli/package.json)"
git push origin "v$(jq -r .version cli/package.json)"
```

This triggers `release.yml` which publishes plugin-sdk → cli → prisma → evidence-export and creates a GitHub release.

### 10. Post-release verification

After the release workflow completes:

```bash
// turbo
for pkg in \
  "@metasession.co/devaudit-plugin-sdk" \
  "@metasession.co/devaudit-cli" \
  "devaudit-sdlc" \
  "@metasession.co/devaudit-plugin-prisma" \
  "@metasession.co/devaudit-plugin-evidence-export"; do
  echo "$pkg: $(npm view "$pkg" version 2>/dev/null || echo 'NOT_FOUND')"
done
```

All 5 should print the version you just tagged. If `devaudit-sdlc` is still stale, publish it manually (step 3).

## Common failure modes

- **`devaudit-sdlc` stale on npm** — `release.yml` doesn't publish it. Manual `cd sdlc && npm publish` required. Tracked in #244.
- **CLI tarball missing `sdlc/`** — `bundle-templates.mjs` didn't run. Check `prepack` hook: `npm run build && npm run bundle:templates`.
- **Consumer gets `npx` prompt** — local `SDLC/bin/devaudit-sdlc.js` doesn't exist. Consumer needs `devaudit update` to sync section 2h.
- **Version mismatch** — one `package.json` wasn't bumped. The release workflow publishes whatever version is in each `package.json` independently.
- **`file:../plugin-sdk` in published tarball** — `release.yml` step 2 rewrites this to `^X.Y.Z` at publish time. If the rewrite fails, the published CLI can't resolve the plugin-sdk dependency.
