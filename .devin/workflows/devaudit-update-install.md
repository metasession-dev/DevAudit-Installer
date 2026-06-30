---
description: Install or update DevAudit SDLC in a consuming project — auto-detects which is needed and runs the correct command.
---

# DevAudit Install or Update — Consumer Workflow

This workflow detects whether your project needs a fresh DevAudit install or just a template update, then runs the correct command. Run this from the **consuming project's** root directory (not DevAudit-Installer).

## Prerequisites

- Node.js >= 22
- You are in the consuming project's root directory
- For a fresh install: you need a DevAudit portal token (`DEVAUDIT_USER_TOKEN`) and know your project slug, stack, and host
- For an update: the project was previously onboarded (has `sdlc-config.json`)

## Steps

### 1. Detect whether this is a fresh install or an update

The presence of `sdlc-config.json` in the project root is the marker:

```bash
// turbo
if [ -f sdlc-config.json ]; then
  echo "MODE: update"
  echo "Existing sdlc-config.json found — project is already onboarded"
  cat sdlc-config.json
else
  echo "MODE: install"
  echo "No sdlc-config.json found — project needs a fresh DevAudit install"
fi
```

Also check for other DevAudit markers that confirm onboarding:

```bash
// turbo
echo "SDLC/ dir:         $(test -d SDLC && echo YES || echo NO)"
echo ".husky/ hooks:     $(test -f .husky/pre-push && echo YES || echo NO)"
echo "scripts/ dir:      $(test -d scripts && echo YES || echo NO)"
echo "CI workflow:       $(test -f .github/workflows/ci.yml && echo YES || echo NO)"
echo "INSTRUCTIONS.md:   $(test -f INSTRUCTIONS.md && echo YES || echo NO)"
echo "SDLC/bin/ binary:  $(test -f SDLC/bin/devaudit-sdlc.js && echo YES || echo NO)"
echo "SDLC/blueprints:   $(test -d SDLC/blueprints && echo YES || echo NO)"
```

If `MODE: install` — proceed to step 2.
If `MODE: update` — skip to step 3.

### 2. Fresh install — run `devaudit install`

This onboards the project into the DevAudit SDLC framework. It creates `sdlc-config.json`, syncs all templates, sets up git hooks, CI workflows, and registers the project with the DevAudit portal.

You will need:
- Your DevAudit portal token (set as `DEVAUDIT_USER_TOKEN` env var or pass via `--token`)
- Your project slug (the name registered on the DevAudit portal)
- Your stack (e.g. `node`, `python`) and host (e.g. `railway`, `vercel`)

```bash
DEVAUDIT_USER_TOKEN=your_token_here npx @metasession.co/devaudit-cli install --yes
```

For interactive mode (prompts for stack, host, etc.):

```bash
DEVAUDIT_USER_TOKEN=your_token_here npx @metasession.co/devaudit-cli install
```

For a dry run first (no mutations):

```bash
DEVAUDIT_USER_TOKEN=your_token_here npx @metasession.co/devaudit-cli install --dry-run
```

After install completes, verify the markers:

```bash
// turbo
echo "sdlc-config.json:  $(test -f sdlc-config.json && echo YES || echo NO)"
echo "SDLC/ dir:         $(test -d SDLC && echo YES || echo NO)"
echo ".husky/ hooks:     $(test -f .husky/pre-push && echo YES || echo NO)"
echo "CI workflow:       $(test -f .github/workflows/ci.yml && echo YES || echo NO)"
echo "INSTRUCTIONS.md:   $(test -f INSTRUCTIONS.md && echo YES || echo NO)"
echo "SDLC/bin/ binary:  $(test -f SDLC/bin/devaudit-sdlc.js && echo YES || echo NO)"
echo "SDLC/blueprints:   $(test -d SDLC/blueprints && echo YES || echo NO)"
```

All should show `YES`. If any show `NO`, check the install output for errors.

Skip to step 4.

### 3. Update — run `devaudit update`

This syncs the latest SDLC templates, binary, blueprints, hooks, scripts, and skills from the published CLI package into your repo. It does NOT touch `sdlc-config.json`, portal registration, or secrets.

```bash
npx @metasession.co/devaudit-cli update .
```

For a dry run first (no mutations):

```bash
npx @metasession.co/devaudit-cli update --dry-run .
```

After update completes, verify the new binary + blueprints landed:

```bash
// turbo
echo "SDLC/bin/ binary:  $(test -f SDLC/bin/devaudit-sdlc.js && echo YES || echo NO)"
echo "SDLC/blueprints:   $(ls SDLC/blueprints/*.raw.md 2>/dev/null | wc -l) file(s)"
echo "Binary works:      $(node SDLC/bin/devaudit-sdlc.js --phase=issue --view >/dev/null 2>&1 && echo YES || echo NO)"
```

Expected: `binary: YES`, `blueprints: 6 file(s)`, `Binary works: YES`.

### 4. Review the diff

Whether install or update, review what changed before committing:

```bash
// turbo
git status --short
git diff --stat
```

Key files to expect:
- `SDLC/` — stage docs, blueprints, binary, config templates
- `.husky/` — pre-commit, pre-push, commit-msg hooks
- `.github/workflows/ci.yml` — CI pipeline with quality gates
- `scripts/` — evidence upload, compliance validation scripts
- `INSTRUCTIONS.md`, `CLAUDE.md`, `.cursorrules`, `.windsurfrules` — AI agent pointers
- `.claude/skills/` — sdlc-implementer and e2e-test-engineer skills
- `.gitignore` — sentinel file entries

### 5. Commit and push

```bash
// turbo
git add -A
git commit -m "chore: sync DevAudit SDLC templates from @metasession.co/devaudit-cli@$(npm view @metasession.co/devaudit-cli version 2>/dev/null || echo latest)

Ref: $(jq -r '.project_slug // "onboarding"' sdlc-config.json 2>/dev/null || echo onboarding)"
git push origin HEAD
```

If your project uses a `develop` branch:

```bash
git push origin develop
```

### 6. Verify the SDLC engine works

Test that the local binary can write the sentinel and output blueprints:

```bash
// turbo
node SDLC/bin/devaudit-sdlc.js --phase=issue --view | head -5
```

You should see the phase execution manifest header. If you see an error, the binary or blueprints didn't sync correctly — re-run step 2 or 3.

### 7. Verify CI pipeline

Push should trigger the CI workflow. Monitor it:

```bash
// turbo
gh run list --limit=1
```

If the CI workflow is missing or fails, the update may have overwritten a customized `ci.yml`. Review the diff and re-apply any project-specific customizations.

## What install does (fresh project)

1. Creates `sdlc-config.json` with stack, host, and project slug
2. Syncs all SDLC templates (stage docs, skills, blueprints, binary)
3. Sets up git hooks (husky: pre-commit, pre-push, commit-msg, prepare-commit-msg)
4. Generates CI workflow (`.github/workflows/ci.yml`) with quality gates
5. Registers the project on the DevAudit portal
6. Issues an API key and stores it as a GitHub secret
7. Applies branch protection rules
8. Syncs scripts (evidence upload, compliance validation)
9. Adds `postinstall` script (`playwright install chromium`) to `package.json` if `@playwright/test` is a required dep and no postinstall exists — ensures browsers auto-install after `npm ci`

## What update does (existing project)

1. Syncs all SDLC templates (stage docs, skills, blueprints, binary) — overwrites with latest
2. Syncs git hooks — overwrites with latest
3. Regenerates CI workflow from template — overwrites with latest
4. Syncs scripts — overwrites with latest
5. Updates AI agent pointer files (`.cursorrules`, `.windsurfrules`, `CLAUDE.md`, etc.)
6. Adds sentinel entries to `.gitignore` if missing
7. Adds `postinstall` script (`playwright install chromium`) to `package.json` if `@playwright/test` is a required dep and no postinstall exists — ensures browsers auto-install after `npm ci`
8. Does NOT touch: `sdlc-config.json`, portal registration, API keys, secrets, branch protection

## Common issues

- **`npx` prompts to install the package** — this is normal on first run. Answer `y` to proceed. The package is `@metasession.co/devaudit-cli`.
- **Install fails with 401/403** — `DEVAUDIT_USER_TOKEN` is missing, expired, or wrong. Get a new token from the DevAudit portal `/settings/api-keys`.
- **Update overwrites custom CI config** — `devaudit update` regenerates `ci.yml` from the template. If you have project-specific customizations, keep them in a separate workflow file (e.g. `.github/workflows/project-specific.yml`) rather than editing `ci.yml` directly.
- **`SDLC/bin/devaudit-sdlc.js` missing after update** — the sync section 2h failed. Check that the CLI version you're using is >= 0.3.2 (the version that added the engine sync).
- **Postinstall script not added** — ensure you're using CLI >= 0.3.3. If a `postinstall` script already exists (and doesn't mention `playwright install`), it won't be overwritten — a warning is logged instead. Add `playwright install chromium` manually if needed.
- **Pre-push hook blocks pushes** — the hook checks for `.sdlc-implementer-invoked`. Run `node SDLC/bin/devaudit-sdlc.js --phase=issue` before committing to write the sentinel.
