---
description: One-time project setup — configure repository, CI pipeline, compliance structure, and tooling before workflows can run
---

# Project Setup Guide

> **For the operator only.** This guide is for the first developer setting up the project. If you're joining an **already-onboarded** project, you don't need to run any of this — the synced framework files are already in the repo. See [`SDLC/joining-an-existing-project.md`](./joining-an-existing-project.md) for the second-developer path.

**Document Type:** Setup Guide | **Run Once:** At project start, before any workflow is executed

**Parent Documents:** Test Policy, Test Strategy, Test Architecture (all Tier 1, in devaudit/sdlc/files/)

---

## Purpose

This guide configures a new project so that the five pipeline workflows can run correctly. It sets up the repository structure, branch protection, CI pipeline (the independent verification gate), compliance directories, and local tooling.

**Run this guide once when starting a new project.** The pipeline workflows (1-5) assume this setup is complete.

---

## Fast path (recommended): `devaudit install`

The DevAudit CLI (`@metasession.co/devaudit-cli`) automates almost all of this guide. It writes `sdlc-config.json`, creates the DevAudit project, issues an API key, sets the GitHub secrets and variables, installs the hook framework, configures branch protection, and syncs the framework templates (CI workflows, hooks, scripts) — in roughly 30 seconds.

```bash
npm install -g @metasession.co/devaudit-cli   # requires Node >= 22
devaudit auth login                            # paste your PAT (issued at https://devaudit.metasession.co/settings/tokens)
devaudit install ../path/to/this-project
```

The CLI ships the framework templates inside the package, so no DevAudit-Installer checkout is needed. If `sdlc-config.json` already exists in the target, `install` runs non-interactively from it and preserves your customisations (`app_env`, `build_env`, `e2e_*`, etc.). See [`docs/onboarding.md` in DevAudit-Installer](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/onboarding.md) for the full walkthrough.

> **Version checks use npm, not GitHub releases.** The CLI is published to npm as `@metasession.co/devaudit-cli`. Check your installed version with `devaudit --version` and the latest published version with `npm view @metasession.co/devaudit-cli version`. Upgrade with `npm install -g @metasession.co/devaudit-cli@latest`. The `npx @metasession.co/devaudit-cli@latest` invocation always pulls the latest from npm — no global install needed for one-off or CI use.

If you take the fast path, skip to Step 6 (Tier 1 docs reference) — Steps 1–5 are handled automatically. The remaining manual steps in this guide are still relevant: project-specific customisation of `INSTRUCTIONS.md` and `CLAUDE.md`, optional UAT-environment configuration, and verifying the first end-to-end release walks through Stages 1–5 cleanly.

The steps below are the **manual reference** — useful for understanding what the CLI does, or for environments where it can't run. Where a step produces a framework file (CI workflows, hooks, scripts), **copy the canonical template from the DevAudit-Installer repo (`sdlc/files/…`) and fill its placeholders** rather than authoring it by hand — a hand-written `ci.yml` routinely omits the DevAudit `register-release` / `upload-evidence` jobs and leaves releases unable to pass the compliance gates.

---

## Prerequisites

- GitHub repository created
- Hosting platform configured (Railway, Vercel, Fly, etc.) with auto-deploy from `main` (production)
- UAT environment configured (optional, opt-in by risk class — see Stage 3 Step 10)
- Local development environment working (app builds and runs)
- Stack toolchain: Node.js + npm (Node stack) OR Python 3.11+ + pip (Python stack)
- GitHub CLI (`gh`) installed and authenticated

---

## Step 1: Branch Structure

Create the permanent working branch:

```bash
# Ensure main exists and is up to date
git checkout main
git pull origin main

# Create develop branch
git checkout -b develop
git push origin develop
```

**Branch roles:**
- `main` — Production. Auto-deploys. Never commit directly.
- `develop` — All work happens here. Permanent, never deleted.

---

## Step 2: Branch Protection Rules

Configure in GitHub → Settings → Branches → Branch protection rules:

**`main` branch:**
- [x] Require a pull request before merging
- [x] Require approvals: 1 (adjust if team size requires more)
- [x] Require status checks to pass before merging
  - Add these required checks after CI is configured (Step 4):
    - `Quality Gates` (the consolidated CI job from `ci.yml` — TypeScript, SAST, dependency audit, E2E, build)
    - `DevAudit Release Approval` (from `check-release-approval.yml` — blocks merge until the release is approved in DevAudit. Re-run the workflow after approving in DevAudit to turn the check green)
- [x] Require branches to be up to date before merging
- [x] Do not allow bypassing the above settings

**`develop` branch (optional but recommended):**
- [x] Require status checks to pass (push-to-develop checks)

---

## Step 3: Compliance Directory Structure

```bash
# Create compliance directories
mkdir -p compliance/evidence/periodic/{sast-quarterly,dependency-audit,access-control,audit-log,pentest,dr-test,third-party}
mkdir -p compliance/pending-releases
mkdir -p compliance/approved-releases

# Create initial RTM
cat > compliance/RTM.md << 'EOF'
# Requirements Traceability Matrix

**Project:** [PROJECT NAME]
**Standard:** ISO/IEC/IEEE 29119-3:2021

## Part A: Baseline Requirements

| ID | Requirement | Source | Status |
|---|---|---|---|

## Part B: Change Request Traceability

| REQ-ID | Issue | Risk | Evidence | Status | Approver | Date |
|---|---|---|---|---|---|---|
EOF

# Commit
git add compliance/
git commit -m "compliance: initialize compliance directory structure"
git push origin develop
```

---

## Step 4: CI Pipeline Configuration

This is the **independent verification gate**. Tests run locally during development (comprehensive, all tests). Tests run in CI during PR review (independent, tamper-resistant evidence produced by GitHub, not the developer).

### What CI Must Run

| Pipeline | Trigger | Jobs | Purpose |
|---|---|---|---|
| CI | Push to `develop` | TypeScript + SAST + dependency audit + E2E + build | Quality gates + independent verification |
| Deploy | Merge to `main` | Auto-deploy to hosting platform | Production release |

PRs to the integration branch run `Quality Gates` before merge. PRs to `main` do not trigger a duplicate quality-gates run; branch protection required status checks ensure the commit already passed Quality Gates on the integration branch.

### GitHub Actions Workflow File

> **Don't hand-author `ci.yml`.** `devaudit install` (and `devaudit update`)
> generate it from the canonical template; it is the load-bearing path for the
> compliance gates and drifts the moment it's retyped.

The generated `ci.yml` is a single `quality-gates` job (TypeScript + SAST +
dependency audit + E2E + build, all on every push to `develop`) **plus two
DevAudit jobs that are mandatory and easy to miss:**

- **`register-release`** — registers the release in DevAudit and syncs known
  requirements from `RTM.md`, so the UAT gate can find the release.
- **`upload-evidence`** — uploads the gate results to DevAudit with the evidence
  **categories the approval gate keys on**: `security_scan` (SAST + Dependency
  Audit), `ci_pipeline` (E2E Tests), `test_report` (Playwright report / coverage).

⚠️ **Without `upload-evidence`, releases can never pass the SAST Scan / Dependency
Audit / E2E Tests gates** — DevAudit derives gate pass/fail from uploaded evidence
categories, not from the GitHub check status. A `ci.yml` that only saves results
as `upload-artifact` artifacts produces a release that is permanently stuck in UAT
review with "Missing compliance gates". This is the single most common onboarding
failure; let the CLI generate the workflow.

**Manual install (fallback only):** copy the canonical template from the
DevAudit-Installer repo and fill its placeholders from `sdlc-config.json`:

```bash
# `devaudit` here = a clone of the DevAudit-Installer repo, not the portal app.
cp path/to/DevAudit-Installer/sdlc/files/ci/ci.yml.template .github/workflows/ci.yml
# Then substitute {{PLACEHOLDERS}} ({{RUNNER}}, {{NODE_VERSION}}, {{SOURCE_DIRS}},
# {{DATABASE_*}}, {{APP_ENV}}, {{BUILD_ENV}}, {{E2E_*}}, {{PROJECT_SLUG}}, …) — the
# `devaudit update` command does this for you from sdlc-config.json.
```

### Customization Checklist

Customisation lives in **`sdlc-config.json`**, not in `ci.yml` (which is generated).
Confirm before the first install/sync:

- [ ] `node_version` matches your project
- [ ] `source_dirs` matches your source directory(ies) (e.g. `app/ lib/`)
- [ ] `database_service` / `database_image` / `database_env` match your DB (or empty for none)
- [ ] `app_env` + `build_env` carry every secret your app needs to start, as `${{ secrets.NAME }}`
- [ ] `e2e_start_command` + `e2e_project` are set
- [ ] `accepted_dep_risks` lists any documented, risk-registered audit acceptances

### Verify CI Works

```bash
# Commit the workflow file
git add .github/workflows/ci.yml
git commit -m "ci: configure CI pipeline with independent verification gates"
git push origin develop

# Create a test PR to verify all jobs pass
gh pr create --base main --head develop --title "ci: verify pipeline configuration" --body "Testing CI pipeline setup"

# Watch the checks run
gh pr checks
```

Once all checks pass, go back to GitHub → Settings → Branches → `main` protection rules and add the required status check. The canonical workflow runs a single consolidated job, so add **`Quality Gates`** (and **`DevAudit Release Approval`** once that workflow is in place — see Additional Workflows below).

Now the PR **cannot be merged** unless the Quality Gates job passes. This is enforced by GitHub, not by the developer.

### After CI Is Configured

The relationship between local testing and CI testing:

```
Developer Machine (comprehensive)          GitHub Actions (independent)
─────────────────────────────────          ──────────────────────────────
TypeScript check ──────────────────────→   TypeScript check
SAST scan (Semgrep) ───────────────────→   SAST scan (Semgrep)
Dependency audit ──────────────────────→   Dependency audit
E2E tests (ALL — e.g., 183) ──────────→   E2E tests (unauthenticated subset)
E2E tests (authenticated — local only)     ✗ (credentials not in CI)
Post-deploy verification (local only)      ✗ (runs after merge)
                                           
Evidence → compliance/evidence/REQ-XXX/    Evidence → uploaded to DevAudit
(comprehensive, developer-produced)        (independent, tamper-resistant)
```

Both are required. Local evidence proves comprehensive testing. CI evidence proves it independently. The `upload-evidence` job pushes the CI gate results **into DevAudit** (categorised `security_scan` / `ci_pipeline` / `test_report`) — GitHub artifacts alone are not evidence as far as the release gates are concerned.

### Additional Workflows

These are generated for you by `devaudit install` / `devaudit update`. They come from the canonical templates in the DevAudit-Installer repo (`sdlc/files/ci/`):

**`check-release-approval.yml`** (workflow "Release Approval Gate") — release approval gate:
- Runs on PRs to `main` and `workflow_dispatch`
- Queries DevAudit for release approval status
- Blocks merge unless the release is approved
- Add `DevAudit Release Approval` (the job name) as a required status check on `main`

**`post-deploy-prod.yml`** — Production evidence capture:
- Runs on push to `main` (after merge)
- Waits for deployment, runs production smoke tests
- Uploads production evidence to DevAudit (`environment: production`)
- Marks the release as `released` in DevAudit

**Versioning convention:** Releases use date-based versions by default (`v2026.03.27`, or `v2026.03.27.2` for the second release on the same day). CI auto-creates releases in DevAudit when uploading evidence and auto-increments the sequence number if a release already exists for today. Update `PROJECT_SLUG` and `PRODUCTION_URL` in each template.

---

## Step 5: Local Tooling Setup (Required)

### 5a. Security scanning tools

```bash
# SAST
pip install semgrep
# or: npm install --save-dev semgrep

# Verify
semgrep --version
npm audit --help
```

### 5b. Playwright

```bash
npx playwright install chromium
```

### 5c. Git hooks (required — enforces commit conventions and pre-push gates)

Install husky, commitlint, and lint-staged:

```bash
npm install --save-dev husky @commitlint/cli @commitlint/config-conventional lint-staged
npx husky init
```

Copy hook templates from DevAudit SDLC:

```bash
# From your project root (adjust path to DevAudit)
# `devaudit install` bootstraps these for you. Manual fallback (path = a clone
# of the DevAudit-Installer repo). Hooks are stack-specific — swap `node` for `python`.
cp path/to/DevAudit-Installer/sdlc/files/stacks/node/hooks/commit-msg .husky/commit-msg
cp path/to/DevAudit-Installer/sdlc/files/stacks/node/hooks/pre-commit .husky/pre-commit
cp path/to/DevAudit-Installer/sdlc/files/stacks/node/hooks/pre-push .husky/pre-push
chmod +x .husky/commit-msg .husky/pre-commit .husky/pre-push

# Copy commitlint config
cp path/to/DevAudit-Installer/sdlc/files/stacks/node/hooks/commitlint.config.mjs commitlint.config.mjs
```

Add lint-staged configuration to `package.json`:

```json
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix"],
    "*.{ts,tsx,js,jsx,json,md}": ["prettier --write"]
  }
}
```

Add the prepare script so hooks install automatically for new clones:

```bash
npm pkg set scripts.prepare="husky"
```

### 5d. JSDoc requirement check script (optional — for CI enforcement)

```bash
cp path/to/DevAudit-Installer/sdlc/files/stacks/node/scripts/check-requirement-jsdoc.sh scripts/check-requirement-jsdoc.sh
chmod +x scripts/check-requirement-jsdoc.sh
```

### 5e. Verify hooks work

```bash
# Test commitlint (should fail — missing type prefix)
echo "bad commit message" | npx commitlint
# Expected: error

# Test commitlint (should pass)
echo "feat: test commit message" | npx commitlint
# Expected: no errors (warnings about missing Ref/Co-Authored-By are OK)

# Test pre-push hook
npx tsc --noEmit
# Expected: passes (or shows real errors to fix)
```

---

## Step 6: Create Project Test Plan

Copy `Test_Plan_TEMPLATE.md` from the DevAudit-Installer repo (`sdlc/files/_common/Test_Plan_TEMPLATE.md`) to `compliance/test-plan.md` and fill in:

- [ ] Project name and repository
- [ ] Stack and hosting details
- [ ] Production URL and health endpoint
- [ ] Database configuration
- [ ] Test suite counts and framework
- [ ] Entry/exit criteria with actual thresholds
- [ ] AI tool permissions for this project
- [ ] Disaster recovery targets (RTO/RPO)
- [ ] Penetration test scope

```bash
git add compliance/test-plan.md
git commit -m "compliance: project test plan"
git push origin develop
```

---

## Step 7: Verify Everything Works

Run through the complete pipeline once with a small test change:

```bash
# 1. Plan (workflow 1)
# Create a test requirement in RTM

# 2. Implement (workflow 2)
# Make a small change, run all local gates

# 3. Compile evidence (workflow 3)
# Generate compliance artifacts

# 4. Submit for review (workflow 4)
# Create PR — verify all CI checks run and pass

# 5. Deploy (workflow 5)
# Merge, verify deployment, finalize compliance
```

If any step fails, fix the configuration before starting real work.

---

## Setup Checklist

| Step | Status |
|---|---|
| Repository created | [ ] |
| `develop` branch created | [ ] |
| Production environment configured (auto-deploy from `main`) | [ ] |
| UAT environment configured (auto-deploy from `develop`) | [ ] |
| Branch protection configured | [ ] |
| Compliance directories created (including `periodic/` subdirs) | [ ] |
| RTM initialized | [ ] |
| CI workflow file created (`.github/workflows/ci.yml`) | [ ] |
| CI verified — all jobs pass on test PR | [ ] |
| Required status checks added to branch protection | [ ] |
| Local tooling installed (Semgrep, Playwright) | [ ] |
| Git hooks configured (Husky, Commitlint, lint-staged) | [ ] |
| Hook verification passed (commitlint, pre-push tsc) | [ ] |
| AI assistant SDLC rules configured (AGENTS.md / CLAUDE.md / GEMINI.md / .windsurfrules / .cursorrules) | [ ] |
| DevAudit evidence upload configured in CI | [ ] |
| Project Test Plan created | [ ] |
| End-to-end pipeline verified with test change | [ ] |

---

## What Happens Next

With setup complete, all development follows the five pipeline workflows:

```
1-plan-requirement.md       → Define requirement, classify risk, generate test scope
2-implement-and-test.md     → Code, commit, run all local gates, auto-deploy to UAT
3-compile-evidence.md       → Gather evidence, verify on UAT, create release ticket
4-submit-for-review.md      → Create PR (CI runs independent verification)
5-deploy-main.md            → Merge, verify production deployment, finalize
```

The CI pipeline runs automatically on every PR. The developer doesn't need to trigger it — GitHub handles it. The branch protection rules prevent merging if CI fails. The human reviewer sees both local evidence (in the compliance directory) and CI evidence (in the PR checks) before approving.
