---
description: Install or update DevAudit SDLC in a consuming project — auto-detects which is needed and runs the correct command.
---

# DevAudit Install or Update — Consumer Workflow

This workflow detects whether your project needs a fresh DevAudit install or just a template update, then runs the correct command. Run this from the **consuming project's** root directory (not DevAudit-Installer).

> **This workflow is synced into consuming projects by `devaudit install`/`update` (section 2i).** It lands at `.devin/workflows/devaudit-update-install.md` and is available as `/devaudit-update-install` in Windsurf.

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

### 5. Hand off to the sdlc-implementer skill

The changes are staged in the working tree. The remaining steps — invoking the SDLC engine for the sentinel, running local gates, creating a feature branch, committing, pushing, opening a PR, monitoring CI, and handling post-merge housekeeping release stubs — are all owned by the **sdlc-implementer** skill that was synced into `.claude/skills/` by the install/update.

Invoke the sdlc-implementer skill and tell it:

> **Housekeeping change.** The working tree has uncommitted changes from `devaudit install` (or `devaudit update`). Commit type is `chore:`, no `REQ-XXX`. Use the SDLC lightweight path: invoke the SDLC engine for the sentinel, run local gates, create a `chore/sync-devaudit-sdlc-{version}` branch, commit, push, open a PR targeting `develop`, monitor CI, and guide merge. After merge, CI will auto-generate housekeeping release stubs (release ticket + security summary) — remind the operator to review and sign off on those.

The skill will:
1. Invoke `node SDLC/bin/devaudit-sdlc.js --phase=issue --view` to write the `.sdlc-implementer-invoked` sentinel
2. Run local gates (lint, tsc, test)
3. Create a `chore/` branch, commit, and push
4. Open a PR targeting `develop`
5. Monitor CI checks
6. Guide review → merge
7. Remind the operator about the housekeeping release stub PR that CI auto-opens after merge

**Do not** manually run these steps yourself — the skill owns the SDLC ceremony and stays in sync with the framework's evolution. If the skill is not available (e.g. the AI agent doesn't support skills), fall back to the manual steps documented in `SDLC/0-project-setup.md` and the sdlc-implementer skill definition at `.claude/skills/sdlc-implementer/SKILL.md`.

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
10. Syncs Windsurf workflow files to `.devin/workflows/` — including this workflow itself

## What update does (existing project)

1. Syncs all SDLC templates (stage docs, skills, blueprints, binary) — overwrites with latest
2. Syncs git hooks — overwrites with latest
3. Regenerates CI workflow from template — overwrites with latest
4. Syncs scripts — overwrites with latest
5. Updates AI agent pointer files (`.cursorrules`, `.windsurfrules`, `CLAUDE.md`, etc.)
6. Adds sentinel entries to `.gitignore` if missing
7. Adds `postinstall` script (`playwright install chromium`) to `package.json` if `@playwright/test` is a required dep and no postinstall exists — ensures browsers auto-install after `npm ci`
8. Syncs Windsurf workflow files to `.devin/workflows/` — overwrites with latest
9. Does NOT touch: `sdlc-config.json`, portal registration, API keys, secrets, branch protection

## Common issues

- **`npx` prompts to install the package** — this is normal on first run. Answer `y` to proceed. The package is `@metasession.co/devaudit-cli`.
- **Install fails with 401/403** — `DEVAUDIT_USER_TOKEN` is missing, expired, or wrong. Get a new token from the DevAudit portal `/settings/api-keys`.
- **Update overwrites custom CI config** — `devaudit update` regenerates `ci.yml` from the template. If you have project-specific customizations, keep them in a separate workflow file (e.g. `.github/workflows/project-specific.yml`) rather than editing `ci.yml` directly.
- **`SDLC/bin/devaudit-sdlc.js` missing after update** — the sync section 2h failed. Check that the CLI version you're using is >= 0.3.2 (the version that added the engine sync).
- **Postinstall script not added** — ensure you're using CLI >= 0.3.3. If a `postinstall` script already exists (and doesn't mention `playwright install`), it won't be overwritten — a warning is logged instead. Add `playwright install chromium` manually if needed.
- **Pre-push hook blocks pushes** — the hook checks for `.sdlc-implementer-invoked`. Run `node SDLC/bin/devaudit-sdlc.js --phase=issue` before committing to write the sentinel.
