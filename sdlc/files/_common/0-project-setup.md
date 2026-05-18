---
description: One-time project setup — configure repository, CI pipeline, compliance structure, and tooling before workflows can run
---

# Project Setup Guide

**Document Type:** Setup Guide | **Run Once:** At project start, before any workflow is executed

**Parent Documents:** Test Policy, Test Strategy, Test Architecture (all Tier 1, in devaudit/sdlc/files/)

---

## Purpose

This guide configures a new project so that the five pipeline workflows can run correctly. It sets up the repository structure, branch protection, CI pipeline (the independent verification gate), compliance directories, and local tooling.

**Run this guide once when starting a new project.** The pipeline workflows (1-5) assume this setup is complete.

---

## Fast path (recommended): `sdlc-onboard.sh`

If you're starting a new project from scratch, the DevAudit team maintains a one-shot onboarding script that automates almost all of this guide. It writes `sdlc-config.json`, creates the DevAudit project, issues an API key, sets the GitHub secrets and variables, installs the hook framework, configures branch protection, and runs the first template sync — in roughly 30 seconds.

```bash
# In DevAudit's working copy:
export DEVAUDIT_USER_TOKEN="mctok_..."   # Issued at https://devaudit.metasession.co/settings/tokens
./scripts/sdlc-onboard.sh ../path/to/this-project
```

See [`docs/onboarding.md` in DevAudit](https://github.com/metasession-dev/devaudit/blob/main/docs/onboarding.md) for the full walkthrough.

If you take the fast path, skip to Step 6 (Tier 1 docs reference) — Steps 1–5 are handled automatically. The remaining manual steps in this guide are still relevant: project-specific customisation of `INSTRUCTIONS.md` and `CLAUDE.md`, optional UAT-environment configuration, and verifying the first end-to-end release walks through Stages 1–5 cleanly.

The steps below remain as the **manual reference** for cases where the script can't be used (e.g. no network access to DevAudit at setup time, or an unsupported stack/host combination). They produce the same end state as the script.

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
    - `typecheck`
    - `sast`
    - `dependency-audit`
    - `e2e-tests`
    - `DevAudit UAT Approval` (from `check-uat-approval.yml` — blocks merge until release is approved in DevAudit. Re-run the workflow after approving in DevAudit to turn the check green)
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

PRs to `main` do not trigger a separate CI run. Branch protection required status checks ensure the commit already passed Quality Gates on the develop push. This avoids duplicate CI runs.

### GitHub Actions Workflow File

Create `.github/workflows/ci.yml`:

```yaml
name: CI Pipeline

on:
  push:
    branches: [develop]
    paths-ignore:      # Skip full CI for non-code changes
      - '.github/workflows/**'
      - 'SDLC/**'
      - 'compliance/**'
      - '*.md'
      - '.cursorrules'
      - '.windsurfrules'
# PRs to main inherit commit status via branch protection required status checks.
# No pull_request trigger needed — avoids duplicate CI runs.

jobs:
  # ──────────────────────────────────────────────
  # JOB 1: TypeScript Compilation
  # ──────────────────────────────────────────────
  typecheck:
    name: TypeScript Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'          # UPDATE: match your project's Node version
          cache: 'npm'
      - run: npm ci
      - run: npx tsc --noEmit

  # ──────────────────────────────────────────────
  # JOB 2: SAST Scan (Semgrep)
  # Runs on: PR to main only
  # Independent security evidence
  # ──────────────────────────────────────────────
  sast:
    name: SAST Scan
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install semgrep
      - run: semgrep scan --config auto src/ --severity ERROR --severity WARNING --error
        # --error flag makes semgrep exit with non-zero if findings exist
      # Optional: upload results as artifact for audit evidence
      - name: Save SAST results
        if: always()
        run: semgrep scan --config auto src/ --json > sast-results.json || true
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: sast-results
          path: sast-results.json
          retention-days: 90

  # ──────────────────────────────────────────────
  # JOB 3: Dependency Audit
  # Runs on: PR to main only
  # Independent supply chain evidence
  # ──────────────────────────────────────────────
  dependency-audit:
    name: Dependency Audit
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'          # UPDATE: match your project's Node version
          cache: 'npm'
      - run: npm ci
      - run: npm audit --audit-level=high
      # Optional: save results for audit evidence
      - name: Save audit results
        if: always()
        run: npm audit --json > dependency-audit.json || true
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: dependency-audit
          path: dependency-audit.json
          retention-days: 90

  # ──────────────────────────────────────────────
  # JOB 4: E2E Tests (Playwright)
  # Runs on: PR to main only
  # Independent functional test evidence
  # ──────────────────────────────────────────────
  e2e-tests:
    name: E2E Tests
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'

    # UPDATE: Configure your database service
    # Option A: MongoDB service container
    services:
      mongodb:
        image: mongo:7
        ports:
          - 27017:27017
        options: >-
          --health-cmd "mongosh --eval 'db.runCommand({ping:1})'"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    # Option B: If using Docker Compose, remove the services block above
    # and add a step: run: docker compose -f docker-compose.test.yml up -d

    env:
      # UPDATE: Set your project's required environment variables
      MONGODB_URI: mongodb://localhost:27017
      MONGODB_DB_NAME: testdb           # UPDATE: your test database name
      NODE_ENV: test
      # Add other env vars your app needs to start

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'            # UPDATE: match your project's Node version
          cache: 'npm'
      - run: npm ci
      - run: npx playwright install chromium --with-deps

      # Seed test data — required before running tests
      - name: Seed test data
        run: npx tsx scripts/seed-e2e-admins.ts    # UPDATE: your seed script path

      # Run unauthenticated E2E tests only
      # UPDATE: adjust the command to match your test configuration
      # Options:
      #   npx playwright test                        # all tests
      #   npx playwright test --project=unauthenticated  # if using named projects
      #   npx playwright test --grep-invert="@auth"  # exclude by tag
      - name: Run E2E tests
        run: npx playwright test

      # Save test results for audit evidence
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 90

  # ──────────────────────────────────────────────
  # JOB 5: Compliance Validation
  # Runs on: PR to main only
  # Validates compliance artifacts and commit conventions
  # ──────────────────────────────────────────────
  compliance-validation:
    name: Compliance Validation
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0    # Full history needed for commit and diff analysis
      - name: Validate compliance artifacts
        run: bash scripts/validate-compliance-artifacts.sh origin/main
      - name: Validate commit conventions
        run: bash scripts/validate-commits.sh origin/main

  # ──────────────────────────────────────────────
  # Build verification (push to develop only)
  # ──────────────────────────────────────────────
  build:
    name: Build Check
    runs-on: ubuntu-latest
    if: github.event_name == 'push'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'            # UPDATE: match your project's Node version
          cache: 'npm'
      - run: npm ci
      - run: npm run build              # UPDATE: your build command
```

### Customization Checklist

After creating the workflow file, update every line marked `# UPDATE`:

- [ ] Node.js version matches your project
- [ ] `src/` path in SAST scan matches your source directory
- [ ] Database service matches your database (MongoDB, PostgreSQL, etc.)
- [ ] Environment variables set for your app to start
- [ ] Seed script path is correct
- [ ] E2E test command runs the correct subset (unauthenticated for CI)
- [ ] Build command is correct

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

Once all checks pass, go back to GitHub → Settings → Branches → `main` protection rules and add the job names as required status checks: `typecheck`, `sast`, `dependency-audit`, `e2e-tests`, `compliance-validation`.

Now the PR **cannot be merged** unless all four independent verification gates pass. This is enforced by GitHub, not by the developer.

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
                                           
Evidence → compliance/evidence/REQ-XXX/    Evidence → GitHub Actions logs + artifacts
(comprehensive, developer-produced)        (independent, tamper-resistant)
```

Both are required. Local evidence proves comprehensive testing. CI evidence proves it independently.

### Additional Workflows

Copy these template workflows from `sdlc/files/ci/` into your project's `.github/workflows/`:

**`check-uat-approval.yml`** — UAT approval gate:
- Runs on PRs to `main` and `workflow_dispatch`
- Queries DevAudit for release approval status
- Blocks merge unless release is `uat_approved`
- Add `Check UAT Approval` as a required status check on `main`

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
cp path/to/devaudit/sdlc/files/hooks/commit-msg .husky/commit-msg
cp path/to/devaudit/sdlc/files/hooks/pre-commit .husky/pre-commit
cp path/to/devaudit/sdlc/files/hooks/pre-push .husky/pre-push
chmod +x .husky/commit-msg .husky/pre-commit .husky/pre-push

# Copy commitlint config
cp path/to/devaudit/sdlc/files/hooks/commitlint.config.mjs commitlint.config.mjs
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
cp path/to/devaudit/sdlc/files/scripts/check-requirement-jsdoc.sh scripts/check-requirement-jsdoc.sh
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

Copy `Test_Plan_TEMPLATE.md` from DevAudit (`sdlc/files/Test_Plan_TEMPLATE.md`) to `compliance/test-plan.md` and fill in:

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
| AI assistant SDLC rules configured (CLAUDE.md / .windsurfrules / .cursorrules) | [ ] |
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
