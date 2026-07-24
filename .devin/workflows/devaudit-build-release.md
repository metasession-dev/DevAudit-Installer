---
description: Full release pipeline — verify, build, publish all 5 packages to npm, create GitHub release, and confirm consumers can install. Auto-detects when a version bump is needed. Run this after the release-ready version bump is merged to main and GitFlow is green.
---

# Verify, Build, Publish — Full Release Pipeline

This workflow takes you from "the release-ready commit is on main" to "all 5 packages are published on npm and consumers can install." No manual npm publish commands are needed — package publication and GitHub release creation are automated through the release workflow.

## Prerequisites

- The release-ready version bump is already merged to `main` through the allowed branch path
- `Enforce GitFlow` is green on `main`
- There is no outstanding hotfix back-merge PR waiting to be merged into `develop`
- You know the target version (e.g. `0.3.1`, `0.4.0`)
- `NPM_TOKEN` secret is set in the GitHub repo
- You have push access to create tags

## Branch policy for release bumps

This repo is `main` PR-only. Do not bump package versions with a direct push to `main`.

- Normal release path:
  - merge the intended changes to `develop`
  - open `develop -> main`
  - merge
  - tag `main`
- If you discover after merge that `main` still needs a release-only bump or fix:
  - branch `hotfix/*` from `main`
  - open a reviewed `hotfix/* -> main` PR
  - merge it
  - merge the resulting `backmerge/* -> develop` PR before the next `develop -> main` release

## Steps

### 1. Verify version alignment across all 5 packages

All `package.json` files must declare the same version before tagging. The release workflow publishes whatever version is in each file independently — a mismatch means one package gets a stale or skipped release.

```bash
// turbo
echo "plugin-sdk:  $(jq -r .version plugin-sdk/package.json)"
echo "cli:         $(jq -r .version cli/package.json)"
echo "sdlc-engine: $(jq -r .version sdlc/package.json)"
echo "prisma:      $(jq -r .version plugins/devaudit-plugin-prisma/package.json)"
echo "evidence:    $(jq -r .version plugins/devaudit-plugin-evidence-export/package.json)"
```

If any version differs, bump it:

```bash
// turbo
VERSION="0.3.1"
jq --arg v "$VERSION" '.version = $v' plugin-sdk/package.json > plugin-sdk/package.json.tmp && mv plugin-sdk/package.json.tmp plugin-sdk/package.json
jq --arg v "$VERSION" '.version = $v' cli/package.json > cli/package.json.tmp && mv cli/package.json.tmp cli/package.json
jq --arg v "$VERSION" '.version = $v' sdlc/package.json > sdlc/package.json.tmp && mv sdlc/package.json.tmp sdlc/package.json
jq --arg v "$VERSION" '.version = $v' plugins/devaudit-plugin-prisma/package.json > plugins/devaudit-plugin-prisma/package.json.tmp && mv plugins/devaudit-plugin-prisma/package.json.tmp plugins/devaudit-plugin-prisma/package.json
jq --arg v "$VERSION" '.version = $v' plugins/devaudit-plugin-evidence-export/package.json > plugins/devaudit-plugin-evidence-export/package.json.tmp && mv plugins/devaudit-plugin-evidence-export/package.json.tmp plugins/devaudit-plugin-evidence-export/package.json
```

If you bumped versions and the bump is not already on `main`, do not push directly to `main`. Use the allowed PR flow:

```bash
// turbo
git add plugin-sdk/package.json cli/package.json sdlc/package.json plugins/devaudit-plugin-prisma/package.json plugins/devaudit-plugin-evidence-export/package.json
git commit -m "chore: bump all packages to $(jq -r .version cli/package.json) for release"
git push origin <your-branch>
```

Then:

- if the release is still being prepared on `develop`, merge the bump through `develop -> main`
- if `main` already needs a post-merge release-only bump, open a reviewed `hotfix/* -> main` PR and let the repo automation open the `backmerge/* -> develop` PR afterwards

### 1b. Check if current version is already published on npm

If all packages are aligned but the version is already on npm, you need to bump before tagging. This detects that situation automatically.

```bash
// turbo
CURRENT_VERSION=$(jq -r .version cli/package.json)
REGISTRY_VERSION=$(npm view @metasession.co/devaudit-cli version 2>/dev/null || echo "NOT_PUBLISHED")
if [ "$CURRENT_VERSION" = "$REGISTRY_VERSION" ]; then
  echo "Version $CURRENT_VERSION is already published on npm — bump is required."
  echo ""
  echo "Suggested next version (patch):"
  MAJOR=$(echo "$CURRENT_VERSION" | cut -d. -f1)
  MINOR=$(echo "$CURRENT_VERSION" | cut -d. -f2)
  PATCH=$(echo "$CURRENT_VERSION" | cut -d. -f3)
  echo "  $MAJOR.$MINOR.$((PATCH + 1))"
  echo ""
  echo "Set VERSION below and run the bump block from Step 1."
else
  echo "Version $CURRENT_VERSION is not yet published — ready to release."
fi
```

If a bump is required, ask the user for the target version, then run the bump block from Step 1 with the new version before continuing.

### 2. Verify registry state — what's currently published

```bash
// turbo
for pkg in \
  "@metasession.co/devaudit-plugin-sdk" \
  "@metasession.co/devaudit-cli" \
  "@metasession.co/devaudit-sdlc" \
  "@metasession.co/devaudit-plugin-prisma" \
  "@metasession.co/devaudit-plugin-evidence-export"; do
  local_ver=""
  case "$pkg" in
    @metasession.co/devaudit-plugin-sdk) local_ver=$(jq -r .version plugin-sdk/package.json);;
    @metasession.co/devaudit-cli)         local_ver=$(jq -r .version cli/package.json);;
    @metasession.co/devaudit-sdlc)        local_ver=$(jq -r .version sdlc/package.json);;
    @metasession.co/devaudit-plugin-prisma) local_ver=$(jq -r .version plugins/devaudit-plugin-prisma/package.json);;
    @metasession.co/devaudit-plugin-evidence-export) local_ver=$(jq -r .version plugins/devaudit-plugin-evidence-export/package.json);;
  esac
  registry_ver=$(npm view "$pkg" version 2>/dev/null || echo "NOT_PUBLISHED")
  if [ "$local_ver" = "$registry_ver" ]; then
    echo "OK        $pkg @ $local_ver"
  else
    echo "PUBLISH   $pkg — local: $local_ver, registry: $registry_ver"
  fi
done
```

Any line showing `PUBLISH` means that package needs the new version. After the release workflow runs, all 5 should show `OK`.

### 3. Build all packages locally to catch breakages early

```bash
// turbo
cd plugin-sdk && npm install --legacy-peer-deps && npm run build && cd ..
cd cli && npm install --legacy-peer-deps && npm run build && cd ..
cd plugins/devaudit-plugin-prisma && npm install --legacy-peer-deps && npm run build && cd ../..
cd plugins/devaudit-plugin-evidence-export && npm install --legacy-peer-deps && npm run build && cd ../..
```

If any build fails, fix before proceeding. The release workflow will fail at the same step.

### 4. Verify CLI bundle integrity

The CLI's `prepack` runs `tsup` + `bundle-templates.mjs`. Verify the bundled snapshot contains the SDLC engine binary + blueprints:

```bash
// turbo
cd cli && npm run bundle:templates && echo "---" && \
  echo "sdlc/bin exists:    $(test -f sdlc/src/bin/devaudit-sdlc.js && echo YES || echo NO)" && \
  echo "blueprints exist:   $(test -d sdlc/src/blueprints && echo YES || echo NO)" && \
  echo "blueprint count:    $(ls sdlc/src/blueprints/*.raw.md 2>/dev/null | wc -l)" && \
  echo "upload-evidence:    $(test -f scripts/upload-evidence.sh && echo YES || echo NO)" && \
  echo "files dir:          $(test -d sdlc/files && echo YES || echo NO)" && \
  echo "common skills:      $(ls sdlc/files/_common/skills/ 2>/dev/null | wc -l) skill(s)" && cd ..
```

Expected: `sdlc/bin: YES`, `blueprints: YES`, `blueprint count: 6`, `upload-evidence: YES`, `files dir: YES`, `common skills: 2+`.

### 5. Run tests

```bash
// turbo
cd cli && npm test && cd ..
```

If tests fail, fix before proceeding.

### 6. Verify the release workflow includes devaudit-sdlc

Check that `.github/workflows/release.yml` has a publish step for `devaudit-sdlc`. It should publish all 5 packages: plugin-sdk, cli, prisma plugin, evidence-export plugin, and devaudit-sdlc. If the step is missing, add it before proceeding.

### 7. Cut the release tag

This triggers `release.yml` which builds and publishes all packages to npm and creates a GitHub release.

```bash
// turbo
VERSION=$(jq -r .version cli/package.json)
git fetch origin --tags
git rev-parse "v$VERSION" >/dev/null 2>&1 && { echo "Tag v$VERSION already exists locally"; exit 1; } || true
git ls-remote --tags origin "refs/tags/v$VERSION" | grep -q . && { echo "Tag v$VERSION already exists on origin"; exit 1; } || true
git tag "v$VERSION"
git push origin "v$VERSION"
```

### 8. Monitor the release workflow

```bash
// turbo
RUN_ID=$(gh run list --workflow Release --branch "v$VERSION" --event push --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN_ID" --exit-status
```

This watches the specific tag-triggered release run. If it fails, check the logs:

```bash
gh run view "$RUN_ID" --log-failed
```

Common failures:
- `npm publish` 403 — `NPM_TOKEN` expired or lacks publish permission
- `npm publish` 409 — version already exists on npm (bump the version)
- `tsup` build failure — TypeScript error in the package
- `bundle-templates` failure — `sdlc/` directory missing from repo root

### 9. Post-release verification — confirm GitHub release and all 5 packages on npm

```bash
// turbo
VERSION=$(jq -r .version cli/package.json)
gh release view "v$VERSION"
```

Then verify the npm registry:

```bash
// turbo
VERSION=$(jq -r .version cli/package.json)
echo "Expecting all packages at $VERSION"
for pkg in \
  "@metasession.co/devaudit-plugin-sdk" \
  "@metasession.co/devaudit-cli" \
  "@metasession.co/devaudit-sdlc" \
  "@metasession.co/devaudit-plugin-prisma" \
  "@metasession.co/devaudit-plugin-evidence-export"; do
  registry_ver=$(npm view "$pkg" version 2>/dev/null || echo "NOT_FOUND")
  if [ "$registry_ver" = "$VERSION" ]; then
    echo "OK        $pkg @ $registry_ver"
  else
    echo "MISMATCH  $pkg — expected: $VERSION, registry: $registry_ver"
  fi
done
```

If any package shows `MISMATCH`, the release is incomplete even when GitHub Actions and the GitHub release show success. Do not update consumers. Check the exact `name@version` and tarball URL on the public npm registry, then fix forward with a new patch version because npm versions are immutable. The release workflow must verify each published package before it creates the GitHub release.

### 10. Verify consumer install works

Simulate what a consumer experiences after the release:

```bash
// turbo
tmpdir=$(mktemp -d)
cd "$tmpdir"
npm install @metasession.co/devaudit-cli@$VERSION
npx devaudit --version
npx devaudit --help
cd /
rm -rf "$tmpdir"
```

If `npx devaudit --version` prints the expected version, the release is complete and consumers can install.

### 11. Notify consumers (if applicable)

Consumers update by running:

```bash
npx @metasession.co/devaudit-cli update
```

This syncs the new templates, binary, blueprints, hooks, scripts, and skills into their repo. No npm install of `devaudit-sdlc` required — the binary is copied locally to `SDLC/bin/`.

## Summary

After completing this workflow:
- All 5 packages are published on npm at the same version
- The CLI tarball is self-contained (includes `sdlc/` templates + binary + blueprints)
- `@metasession.co/devaudit-sdlc` is on npm as a fallback for `npx devaudit-sdlc`
- Consumers run `devaudit update` to pull everything into their repo
- The GitHub release is created with auto-generated notes
- `main` remains GitFlow-clean and `develop` is not left behind after any hotfix-style release bump

## Common failure modes

- **`@metasession.co/devaudit-sdlc` stale on npm** — check that `release.yml` step 5 ran successfully. If the step is missing from `release.yml`, add it.
- **CLI tarball missing `sdlc/`** — `bundle-templates.mjs` didn't run. Check `prepack` hook: `npm run build && npm run bundle:templates`.
- **Consumer gets `npx` prompt** — local `SDLC/bin/devaudit-sdlc.js` doesn't exist. Consumer needs `devaudit update` to sync section 2h.
- **Version mismatch** — one `package.json` wasn't bumped. The release workflow publishes whatever version is in each `package.json` independently.
- **`file:../plugin-sdk` in published tarball** — `release.yml` step 2 rewrites this to `^X.Y.Z` at publish time. If the rewrite fails, the published CLI can't resolve the plugin-sdk dependency.
