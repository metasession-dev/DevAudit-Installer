---
description: Implement changes on develop, run scoped local gates, and let CI/UAT provide authoritative full E2E verification when local prerequisites are unavailable
---

### 🛑 SYSTEM OVERRIDE: AUTOMATED SDLC ENFORCEMENT

If you are an AI agent reading this file, you are strictly prohibited from manually executing this workflow step-by-step unless explicitly authorized by the operator. Route immediately to your platform's valid orchestration path:

- **CLAUDE CODE:** Halt manual tracking immediately. Invoke the orchestrator skill via: `Skill(name: "sdlc-implementer", …)` 
- **OTHER AGENTS (Cursor, Windsurf, Gemini, etc.):** Halt manual execution and output this exact message to the user: 
  "I am pausing to request authorization for the SDLC workflow on this issue. Please confirm if I should proceed."
  
  CRITICAL WORKFLOW REQUIRED AFTER AUTHORIZATION: Once the operator grants permission to proceed, you MUST immediately execute 'node SDLC/bin/devaudit-sdlc.js --phase=2' to generate the required commit sentinel file in the root directory BEFORE making any file modifications or code changes. Failure to create this file will result in your local git commits being automatically blocked by our pre-commit hooks.

---

# Implement & Test

**Pipeline Stage:** 2 of 5
**Previous:** `1-plan-requirement.md` (if tracked) or start here for untracked changes
**Next:** `3-compile-evidence.md`
**References:** Test Strategy (`sdlc/files/Test_Strategy.md` in DevAudit) (security gates, AI methodology), Test Architecture (tooling), Test Plan (exit criteria)

---

## Prerequisites

- On the `develop` branch
- Dev server starts when the local test scope requires it
- Semgrep installed
- For a full local E2E suite only: database/services running locally, required secrets available, Playwright browsers installed, test data seeded, and auth/session setup configured

## Steps

### Step 0: Validate Planning Artifacts (Tracked Requirements)

Before writing any code, verify that the planning stage is complete:

```bash
# For tracked requirements — ALL planning artifacts MUST exist
ls compliance/evidence/REQ-XXX/test-scope.md
ls compliance/evidence/REQ-XXX/test-plan.md
grep 'REQ-XXX' compliance/RTM.md
```

**If any file does not exist:** STOP. Run `1-plan-requirement.md` first. Do NOT proceed to implementation without a committed test scope and test plan.

For MEDIUM/HIGH risk, also verify:
```bash
# Implementation plan must exist (created during planning stage)
ls compliance/evidence/REQ-XXX/implementation-plan.md
```

---

### Step 1: Verify Branch

```bash
git branch --show-current
# Must output: develop
```

If not: `git checkout develop && git pull origin develop`

### Step 2: Unit Tests (TDD)

Write or update unit tests **before** implementing the code. You know the expected interfaces and behaviour from the implementation plan and test plan.

**2a. Review the test plan:**
```bash
cat compliance/evidence/REQ-XXX/test-plan.md
```

**2b. Write unit tests** listed in the "Tests to Add" section:
- New business logic → unit tests for services, utilities, validators
- New API endpoints → auth enforcement tests, response format tests
- Tests should initially **fail** (the implementation doesn't exist yet)

**2c. Update existing unit tests** listed in the "Tests to Update" section:
- API response shape changed? → Update assertions
- Business logic changed? → Update unit test expectations

**2d. Remove obsolete tests** listed in the "Tests to Remove" section (if any). Each removal must have a justification in the test plan.

### WAIT CHECKPOINT: Unit Test Coverage

Verify the unit tests cover the test plan:
```bash
cat compliance/evidence/REQ-XXX/test-plan.md
# Check: have all unit test items in "Tests to Add" been implemented?
# Check: have all unit test items in "Tests to Update" been addressed?
```

**Do NOT proceed** until unit test coverage matches the test plan. Tests are expected to fail at this point — that's correct (TDD).

### Step 3: Implement the Change

Write your code. For tracked requirements, add JSDoc headers:

```typescript
/**
 * @requirement REQ-XXX - Brief description
 */
```

**If AI is generating code (Medium/High risk):**

```bash
echo "Prompt summary: [what you asked AI to generate]" >> compliance/evidence/REQ-XXX/ai-prompts.md
echo "Files generated: [list]" >> compliance/evidence/REQ-XXX/ai-prompts.md
echo "Date: $(date -I)" >> compliance/evidence/REQ-XXX/ai-prompts.md
```

**If AI regenerates a component** (from scratch, not incremental edit):

```bash
echo "REGENERATION: [component] regenerated on $(date -I). Full retest required." >> compliance/evidence/REQ-XXX/ai-prompts.md
```

Per Test Strategy: regeneration triggers full retest.

**MEDIUM/HIGH risk — AI prompt logging checkpoint:** Before committing AI-generated code, verify that `ai-prompts.md` has been updated with the prompt summary and files generated. If missing, create it now — this is a required artifact for MEDIUM/HIGH risk requirements with AI involvement.

### WAIT CHECKPOINT: Unit Tests Green

All unit tests must pass before proceeding:
```bash
npm test
```

**Do NOT proceed** until all unit tests are green.

### Step 4: E2E Tests

Write or update E2E tests **after** implementation. E2E tests need working UI/API to test against — writing Playwright tests against routes and selectors that don't exist is impractical.

> **Skill available:** invoke the **`e2e-test-engineer`** skill for this step (at `.claude/skills/e2e-test-engineer/SKILL.md`). It derives scenarios from the requirement's acceptance criteria, reconciles with the existing test pack (flags obsoletes — but never deletes without confirmation), checks local full-suite prerequisites before running broad E2E locally, and files defects for failures or missed ACs. Framework-agnostic (Playwright, Cypress, pytest-playwright, etc.) and tracker-agnostic (GitHub, Linear, Jira, etc.). For projects with no e2e suite yet, the skill also covers bootstrapping one. See [`sdlc/SKILLS.md`](../sdlc/SKILLS.md) for the full list of available skills.

> **Run authenticated flows in CI.** Tests that need a logged-in session (admin forms, role-gated flows) belong in their own Playwright project that depends on `auth-setup`. Register that project name in `sdlc-config.json` `e2e_projects` and set `e2e_seed_command` / `e2e_env` so CI seeds fixtures and runs it as a **report-only** gate (continue-on-error — it surfaces failures as evidence without blocking the merge until proven stable). Prove each UI-driven AC with an `evidenceShot(page, 'REQ-XXX', acN, 'slug')` so the PNG lands in `compliance/evidence/REQ-XXX/screenshots/`. This is what lets Stage 3 Step 10 reduce manual UAT to a light smoke instead of a full re-click.

> **Transport-layer specs have no page** (devaudit#127). Specs that exercise the system at the transport boundary — Node `fetch` against webhooks, `MongoClient` queries, `socket.io-client` assertions — cannot call `evidenceShot`. Their evidence form is the per-spec row in `test-execution-summary.md` describing the asserted behaviour in operator terms. The portal's release-detail "screenshots" panel will show zero entries for purely-transport REQs; that's correct. Reviewers cross-reference `test-execution-summary.md` instead. See `e2e-test-engineer/SKILL.md` § *Specs with no page object*.

**4a. Review the test plan for E2E items:**
```bash
cat compliance/evidence/REQ-XXX/test-plan.md
```

**4b. Add new E2E tests** listed in the "Tests to Add" section:
- New pages → route protection tests (unauthenticated redirect)
- New user flows → Playwright tests for critical paths
- UI components changed? → Update selectors and expected content

**4c. Update existing E2E tests** listed in the "Tests to Update" section:
- New routes added? → Add them to route protection test arrays
- UI flow changed? → Update selectors and assertions

**4d. Remove obsolete E2E tests** listed in the "Tests to Remove" section (if any).

### WAIT CHECKPOINT: E2E Scope Complete

Run the E2E checks required by the approved test plan. Before running the full local suite, confirm the local prerequisites are present:

- Required services/databases are running locally
- Required secrets/env vars point to disposable local or test resources
- Test data and authenticated fixtures are seeded
- Playwright browsers and project dependencies are installed

If those prerequisites are confirmed, run:
```bash
npx playwright test
```

If prerequisites are missing, do **not** start the full local suite. Run the targeted local checks listed in the test plan and record that full E2E verification is delegated to CI/UAT. For LOW-risk docs/tooling/script-only changes, targeted local verification is expected unless the operator explicitly requests a full local E2E run.

**Do NOT proceed** until the scoped E2E/test-plan checks are complete and any local limitations are called out.

### Step 4b: Reconcile Test Plan (devaudit-installer#241)

After writing/updating tests (both unit and E2E), verify that `test-plan.md` file paths still match reality. The test plan was authored during Stage 1 with predicted file paths — during implementation, tests are often added to existing files instead of creating new ones. This natural drift must be reconciled before committing so `validate-compliance-artifacts.sh` doesn't fail at PR time.

For each file path referenced in `test-plan.md`:

- If the file exists on disk → OK, no action needed.
- If the file does not exist → check whether a test covering the same AC was added to a different file. If so, update `test-plan.md` to reference the actual file path.
- If the file does not exist and no equivalent test was found → **STOP**: "test-plan.md references `<file>` but no test file exists and no equivalent test covering the same AC was found. Either create the test file, update test-plan.md to point to the actual test file, or remove the entry if the AC is no longer relevant."

Commit the updated `test-plan.md` alongside the test code. This is a file-path reconciliation — it does not change the AC table (the plan ↔ test-scope AC consistency check in the skill handles AC drift separately).

### Step 5: Stage Selectively

```bash
git diff --name-only
git add src/path/to/file.ts

# Safety check — no secrets staged
git diff --cached --name-only | grep -iE '\.env|secret|credential|\.auth|\.pem'
# Must return nothing
```

### Step 6: Commit

```bash
git commit -m "$(cat <<'EOF'
type(scope): description

- Key change 1
- Key change 2

Ref: REQ-XXX

Co-Authored-By: [AI Tool Name] <noreply@provider.com>
EOF
)"
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `compliance`, `security`

### Step 7: Run Applicable Local Gates (Mandatory)

#### Gate 1: TypeScript
```bash
npx tsc --noEmit
```

#### Gate 2: Security (SAST + Dependencies)
```bash
semgrep scan --config auto [SOURCE_DIR]/ --severity ERROR --severity WARNING
npm audit --audit-level=high
```

If new dependencies added:
```bash
git diff origin/main -- package.json package-lock.json | grep '^\+'
npm audit
# Verify: real packages? Current versions? No CVEs? AI hallucinations?
```

#### Gate 3: E2E Tests
Run the E2E scope from the approved test plan. Use full local Playwright only after confirming local services, secrets, seeded data, auth fixtures, and browser dependencies are ready:
```bash
npx playwright test
```

For LOW-risk docs/tooling/script-only changes or environments without the required local prerequisites, do not run the full local suite by default. Run the targeted commands in the test plan and rely on CI/UAT for the authoritative full E2E gate.

#### Exit Criteria

| Gate | Threshold |
|---|---|
| TypeScript | 0 errors |
| SAST (high/critical) | 0 findings |
| Dependencies (high/critical) | 0 vulnerabilities |
| E2E tests | Scoped local E2E checks pass; full CI/UAT E2E passes before PR/release |
| Severity-1 defects | 0 open |

For Medium/High risk, also verify access control and audit log tests pass (see Test Plan and test-scope.md).

**If SAST finds issues:**
```bash
echo "SAST finding: [rule-id] in [file] — [fixed/false-positive: reason]" >> compliance/evidence/REQ-XXX/sast-review.md
```

### Step 8: Push

```bash
git push origin develop
```

If rejected:
```bash
git pull --rebase origin develop
# Re-run applicable local gates after rebase
git push origin develop
```

Pushing to `develop` triggers the full CI pipeline (TypeScript, SAST, dependency audit, E2E, build). All gate results are automatically uploaded to DevAudit tagged with the release version and `environment=uat`. The develop branch auto-deploys to the UAT environment (Railway staging). UAT will be formally reviewed and approved in DevAudit before a PR to main can be created.

### WAIT CHECKPOINT: Confirm CI Green

After pushing, wait for CI to complete before proceeding:

```bash
gh run list --branch develop --limit 1
# Or watch in real time:
gh run watch
```

**Do NOT proceed** until CI is green. If CI fails, diagnose the failure, fix locally, re-run the applicable local gates, and push again. Do not push repeatedly hoping CI will pass — fix the root cause. CI/UAT is the authoritative full E2E environment when local services/secrets/seeded auth state are not available.

### Step 9: Update Evidence

```bash
git status compliance/evidence/
git add compliance/evidence/
git commit -m "compliance: update test evidence"
git push origin develop
```

## Iteration

Repeat Steps 3-9. Every commit must leave the applicable local gates green. Step 2 (implementation plan) is done once per requirement. Each push triggers full CI and auto-deploys to UAT.

## Output

- Code committed and pushed on `develop`
- All CI gates passing (TypeScript, SAST, dep audit, E2E, build)
- Evidence auto-uploaded to DevAudit (environment=uat)
- AI use documented (if applicable)
- UAT auto-deployed with latest changes

## Next Step

- **Tracked requirement:** `3-compile-evidence.md`
- **Untracked change:** `4-submit-for-review.md`
