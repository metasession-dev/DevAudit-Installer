---
description: Implement changes on develop, run all local gates (tests + security scans), commit with compliance-aware conventions
---

# Implement & Test

**Pipeline Stage:** 2 of 5
**Previous:** `1-plan-requirement.md` (if tracked) or start here for untracked changes
**Next:** `3-compile-evidence.md`
**References:** Test Strategy (`sdlc/files/Test_Strategy.md` in DevAudit) (security gates, AI methodology), Test Architecture (tooling), Test Plan (exit criteria)

---

## Prerequisites

- On the `develop` branch
- Dev server starts
- Database running locally
- Playwright browsers installed
- Test data seeded
- Semgrep installed

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

> **Skill available:** invoke the **`e2e-test-engineer`** skill for this step (at `.claude/skills/e2e-test-engineer/SKILL.md`). It derives scenarios from the requirement's acceptance criteria, reconciles with the existing test pack (flags obsoletes — but never deletes without confirmation), runs the suite, and files defects for failures or missed ACs. Framework-agnostic (Playwright, Cypress, pytest-playwright, etc.) and tracker-agnostic (GitHub, Linear, Jira, etc.). For projects with no e2e suite yet, the skill also covers bootstrapping one. See [`sdlc/SKILLS.md`](../sdlc/SKILLS.md) for the full list of available skills.

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

### WAIT CHECKPOINT: E2E Tests Green

All E2E tests must pass:
```bash
npx playwright test
```

**Do NOT proceed** until all E2E tests are green.

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

### Step 7: Run All Local Gates (Mandatory)

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
```bash
npx playwright test
```

#### Exit Criteria

| Gate | Threshold |
|---|---|
| TypeScript | 0 errors |
| SAST (high/critical) | 0 findings |
| Dependencies (high/critical) | 0 vulnerabilities |
| E2E tests | All pass |
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
# Re-run ALL local gates after rebase
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

**Do NOT proceed** until CI is green. If CI fails, diagnose the failure, fix locally, re-run all local gates, and push again. Do not push repeatedly hoping CI will pass — fix the root cause.

### Step 9: Update Evidence

```bash
git status compliance/evidence/
git add compliance/evidence/
git commit -m "compliance: update test evidence"
git push origin develop
```

## Iteration

Repeat Steps 3-9. Every commit must leave all local gates green. Step 2 (implementation plan) is done once per requirement. Each push triggers full CI and auto-deploys to UAT.

## Output

- Code committed and pushed on `develop`
- All CI gates passing (TypeScript, SAST, dep audit, E2E, build)
- Evidence auto-uploaded to DevAudit (environment=uat)
- AI use documented (if applicable)
- UAT auto-deployed with latest changes

## Next Step

- **Tracked requirement:** `3-compile-evidence.md`
- **Untracked change:** `4-submit-for-review.md`
