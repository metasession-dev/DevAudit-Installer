---
description: Create a PR from develop to main — triggers CI independent verification and human review
---

# Submit for Review

**Pipeline Stage:** 4 of 5
**Previous:** `3-compile-evidence.md` (tracked) or `2-implement-and-test.md` (untracked)
**Next:** `5-deploy-main.md` (after PR approved)
**References:** Test Policy (`sdlc/files/Test_Policy.md` in DevAudit) (approval gate, AI governance), Test Strategy (reviewer requirements)

---

## IMPORTANT: Do NOT Create the PR Until Ready to Merge

**Do NOT create the PR prematurely.** Every push to `develop` while a PR is open triggers additional CI runs on the PR (quality gates + Release Approval Gate), creating unnecessary duplicate runs. Only create the PR when:
- All development and iteration is complete
- CI on `develop` is green
- UAT-environment verification has passed (only if Stage 3 Step 10 applied — opt-in by risk class)
- Evidence is compiled, committed, and uploaded
- **Release is approved in DevAudit** (status: `uat_approved` — backend enum kept as-is in v1.22.x for backwards-compat; renamed to `release_approved` in v1.23.0)

The PR is the **merge request**, not the development workspace. Develop on `develop`, iterate until ready, then create the PR as the final step before merge.

## What Happens at This Stage

When you create the PR, CI runs automatically — GitHub Actions re-executes the verification gates (TypeScript, SAST, dependency audit, E2E) independently. The `Release Approval Gate` workflow (renamed from `UAT Approval Gate` in sdlc-v1.22.0) also runs, verifying the release has been approved in DevAudit. This produces tamper-resistant evidence verified by GitHub's infrastructure.

> **Note:** The Release Approval Gate check will fail initially if the release hasn't been approved in DevAudit yet. This is expected. After approving the release in DevAudit (Stage 3 Step 11), re-run the `Release Approval Gate` workflow from GitHub Actions (or use `workflow_dispatch`) to update the check status. The PR cannot be merged until this check passes — it is a required status check.

What happens next depends on the risk level of the requirements in the PR:

- **LOW risk:** CI provides independent verification. After CI passes, the developer may self-merge.
- **MEDIUM/HIGH risk:** A second human reviewer is notified. They review the code, CI results, and compliance evidence. They cannot approve until CI passes. The developer may NOT self-merge.

If a PR contains requirements at multiple risk levels, the highest risk level determines the review requirement.

---

## Prerequisites

- All changes committed and pushed on `develop`
- All local gates passing
- **UAT-environment verification passed** (only if Stage 3 Step 10 applied to this requirement) — health check, smoke test, feature verification recorded in evidence
- **Release approved in DevAudit** — release status is `uat_approved` in DevAudit (required for the Release Approval Gate check to pass on the PR)
- For tracked requirements: RTM updated, release ticket created, evidence saved
- **Know the risk level** of the requirement(s) — this determines whether a second reviewer is required

## Steps

### Step 0: Pre-Flight Verification

Before creating a PR, verify all prerequisites are met. **Do NOT skip this checklist.**

**Pipeline state:**
- [ ] Latest CI run on `develop` is green: `gh run list --branch develop --limit 1`
- [ ] CI is not stale (ran against the latest commit): compare CI commit SHA with `git rev-parse develop`
- [ ] Working tree is clean: `git status`
- [ ] UAT-environment verification passed (only if Stage 3 Step 10 applied to this requirement)
- [ ] Release approved in DevAudit (Stage 3 Step 11)

**For tracked requirements (REQ-XXX):**
- [ ] `compliance/evidence/REQ-XXX/test-scope.md` exists and all items addressed
- [ ] `compliance/evidence/REQ-XXX/implementation-plan.md` exists (MEDIUM/HIGH risk)
- [ ] `compliance/evidence/REQ-XXX/ai-prompts.md` exists (if AI was used on MEDIUM/HIGH risk)
- [ ] RTM status is `TESTED - PENDING SIGN-OFF`: `grep 'REQ-XXX' compliance/RTM.md`
- [ ] Release ticket exists: `ls compliance/pending-releases/RELEASE-TICKET-REQ-XXX.md`
- [ ] Evidence uploaded to DevAudit (or saved locally if git-based)

**Risk-tier reminder:**
- LOW risk → self-merge permitted after CI passes
- MEDIUM/HIGH risk → second human reviewer required, self-merge NOT permitted

If any item fails, resolve it before proceeding. Do NOT create a PR with incomplete prerequisites.

---

### Step 1: Verify Develop Is Ready

```bash
git status                    # Clean working tree
git branch --show-current     # develop
git pull origin develop       # Up to date
```

### Step 2: Review PR Contents

```bash
git log origin/main..develop --oneline
git diff origin/main..develop --stat
git diff origin/main..develop -- package.json | grep '^\+'
```

### Step 3: Create the PR

**For tracked requirements:**

```bash
gh pr create --base main --head develop --title "type: description" --body "$(cat <<'EOF'
## Summary
[1-3 bullet points]

## Requirement Reference
- **REQ-XXX:** [description]
- **Risk Level:** [LOW / MEDIUM / HIGH]

## Test Results (Local — Comprehensive)

| Gate | Result | Details |
|------|--------|---------|
| E2E Tests | [N]/[N] passed | Spec files: [list spec files that ran] |
| TypeScript | 0 errors | `npx tsc --noEmit` |
| SAST | 0 high/critical | [N] rules scanned, [N] files |
| Dependency Audit | 0 unaccepted | [note any accepted risks] |

**E2E spec files executed:**
- `e2e/[spec-file].spec.ts` — [N] tests ([brief description])
- [list all spec files that ran]

**Evidence location:** `compliance/evidence/REQ-XXX/`

## UAT Verification
- UAT Health check: PASS
- UAT Smoke test: PASS
- UAT Feature verification: PASS — [what was verified]
- UAT URL: [UAT_URL]

## CI Results (Independent Verification)
CI runs automatically on this PR. The following gates must pass before merge:
- [ ] TypeScript check (CI)
- [ ] SAST scan (CI)
- [ ] Dependency audit (CI)
- [ ] E2E tests — unauthenticated subset (CI)

### Where to Find Test Results
| Source | Location | What It Shows |
|--------|----------|---------------|
| **CI status** | Green/red icons on PR commits | Pass/fail for each gate (independent, tamper-resistant) |
| **CI E2E comment** | PR comments (automated) | E2E pass/fail with commit SHA |
| **DevAudit evidence** | [View evidence on DevAudit](https://[DevAudit-URL]/projects/[PROJECT_SLUG]/requirements/REQ-XXX) | Playwright report, SAST results, dependency audit |
| **Security summary** | `compliance/evidence/REQ-XXX/security-summary.md` (in PR files) | Developer's local gate results + UAT verification |
| **Test scope** | `compliance/evidence/REQ-XXX/test-scope.md` (in PR files) | What was planned to be tested (cross-reference with results) |
| **Test changes** | PR description ("Test Changes" section) + PR files | Which test files were added/modified and what they cover |

## AI Involvement
- **AI Tool:** [tool / none]
- **AI-Generated Code:** [list files, or "none"]
- **Components Regenerated:** [none / list]
- **AI Prompts Retained:** [yes / N/A]

## Test Changes
- **Tests added:** [list new test files or "none"]
- **Tests updated:** [list modified test files or "none"]
- **Test locations:** [e.g. `e2e/requirements-verification.spec.ts`, `__tests__/...`]
- **What's covered:** [brief description of what the new/updated tests verify]
- **What's NOT covered and why:** [any gaps and justification, or "Full coverage"]

## Dependency Changes
- [package@version — purpose, or "No new dependencies"]

## Compliance Artifacts
- [ ] RTM updated with risk level
- [ ] Test scope addressed (all items in test-scope.md completed)
- [ ] Implementation plan present and matches implementation (MEDIUM/HIGH risk)
- [ ] Release ticket created
- [ ] Test evidence saved
- [ ] Security evidence saved
- [ ] AI use documented

## Reviewer Checklist

**Code Quality**
- [ ] Changes correct and complete
- [ ] No sensitive data committed
- [ ] No regressions

**Test Scope Verification**
- [ ] Test scope document exists (`compliance/evidence/REQ-XXX/test-scope.md`)
- [ ] Risk classification is appropriate (not under-classified)
- [ ] Testing depth matches risk level
- [ ] All items in test scope addressed
- [ ] New/updated test files listed in PR description ("Test Changes" section)
- [ ] Review the test files — verify tests actually exercise the new functionality (not just passing on unchanged code)
- [ ] New routes/pages have route protection tests
- [ ] New API endpoints have auth enforcement tests

**Security**
- [ ] SAST: 0 unresolved high/critical (verify CI result)
- [ ] Dependencies verified (real, current, no CVEs)
- [ ] Access control changes tested (if applicable)

**AI Review** (if AI code present)
- [ ] AI code reviewed for correctness
- [ ] No insecure defaults or injection vulnerabilities
- [ ] No hardcoded credentials or test data
- [ ] Regenerated components fully retested

**UAT** (if UAT configured)
- [ ] UAT verification results recorded in evidence
- [ ] Feature works correctly on UAT environment

**Compliance**
- [ ] RTM status: TESTED - PENDING SIGN-OFF
- [ ] Release ticket accurate
- [ ] Security evidence present and clean

> **Audit Note:** AI-assisted PR. Verified locally (comprehensive) and by CI (independent). See Test Plan for evidence model.
EOF
)"
```

**For untracked changes:**

```bash
gh pr create --base main --head develop --title "type: description" --body "$(cat <<'EOF'
## Summary
[1-3 bullet points]

## Test Results (Local)
- E2E: [N]/[N] passed, TypeScript: 0 errors, SAST: clean, Dependencies: clean
- Spec files: [list spec files that ran]

## Test Changes
- **Tests added/updated:** [list or "none"]
- **What's covered:** [brief description]

## UAT Verification
- UAT Health check: PASS
- UAT Smoke test: PASS
- UAT Feature verification: PASS — [what was verified]

## CI Verification
- [ ] TypeScript (CI)
- [ ] SAST (CI)
- [ ] Dependency audit (CI)
- [ ] E2E tests (CI)

CI pass/fail visible on PR commit status icons. Full test evidence available on [DevAudit](https://[DevAudit-URL]/projects/[PROJECT_SLUG]).

## Reviewer Checklist
- [ ] Code correct, no sensitive data, no regressions
- [ ] SAST clean, no hallucinated dependencies
- [ ] AI code reviewed (if applicable)
- [ ] Tests reviewed — verify they cover the changes (not just passing on unchanged code)
- [ ] Testing depth appropriate for the change
EOF
)"
```

### Step 4: Wait for CI and Report Honest Status (MANDATORY)

After creating the PR, **do not hand off to the reviewer yet**. Required checks include `Compliance Validation` and `Release Approval Gate` (the latter is named `DevAudit Release Approval` in the job-level UI) — both take time to run and can fail for reasons the local gates did not catch (e.g. a missing `RELEASE-TICKET-REQ-XXX.md` that only the PR-side validator sees).

1. Wait ≥60 seconds for required checks to register.
2. Verify status:

```bash
gh pr checks <PR-NUMBER>
gh pr view <PR-NUMBER> --json mergeable,mergeStateStatus
```

3. If ANY required check is `fail` or `pending`, DO NOT describe the PR as "awaiting review" or "awaiting approvers." Instead:
   - Name each failing check and surface its error (e.g. `gh run view <RUN-ID> --log-failed`)
   - Fix the underlying issue
   - Re-push and re-check

4. Only when every required check is `pass` **and** `mergeStateStatus` is `CLEAN` (or `BLOCKED` purely by required-reviewer approval) may you describe the PR as ready for review.

**Why this matters:** A status like "awaiting UAT + 2 reviewers" is read by the developer as "nothing for me to do but approve." If a required check is red, that summary is a lie by omission — the PR cannot merge regardless of what the reviewer does. Honest status reporting at this step is the single cheapest defence against wasted review time.

**If CI fails:**

```bash
# Check which job failed
gh pr checks <PR-NUMBER>

# Fix the issue locally
git add <fixed-files>
git commit -m "fix: resolve CI failure - [description]"

# Re-run local gates to confirm
npx tsc --noEmit && semgrep scan --config auto [SOURCE_DIR]/ --severity ERROR --severity WARNING && npm audit --audit-level=high && npx playwright test

# Push — CI re-runs automatically
git push origin develop
```

### Step 5: Link PR to Release Ticket (Tracked Only)

```bash
gh pr list --head develop --json number --jq '.[0].number'
```

Add to release ticket and push:
```bash
# Edit RELEASE-TICKET-REQ-XXX.md to add PR link
git add compliance/pending-releases/RELEASE-TICKET-REQ-XXX.md
git commit -m "compliance: [REQ-XXX] link PR #[number]"
git push origin develop
```

### Step 6: Wait for CI and Review

**For LOW risk (self-merge permitted):**

```bash
# Watch CI status
gh pr checks
# Once all checks pass, merge
gh pr merge [PR-NUMBER] --merge --delete-branch=false
```

**For MEDIUM/HIGH risk (second reviewer required):**

The reviewer sees:
1. **CI results** — independent pass/fail from GitHub (green checks)
2. **Code changes** — in the Files changed tab
3. **Test changes** — in the PR description ("Test Changes" section) and in the Files changed tab (look for `e2e/`, `__tests__/`, `*.spec.ts`, `*.test.ts` files)
4. **Compliance evidence** — in the compliance/ directory
5. **Test scope** — in compliance/evidence/REQ-XXX/test-scope.md
6. **Implementation plan** — in compliance/evidence/REQ-XXX/implementation-plan.md (MEDIUM/HIGH risk)

They cannot approve until CI is green. They then verify the comprehensive local evidence and compliance artifacts. The developer may NOT merge until the reviewer approves.

### Step 7: Handle Feedback (MEDIUM/HIGH risk only)

```bash
git add <changed-files>
git commit -m "fix: address review feedback - [description]"

# Re-run local gates
# Push — CI re-runs automatically
git push origin develop
```

## What Approval Means

The verification model is risk-tiered to satisfy separation of duties (ISO 27001 A.5.3, SOC 2 CC6.1/CC8.1) where it matters:

**LOW risk — CI-verified self-merge:**
1. **CI** — GitHub confirms gates passed (tamper-resistant, independent)
2. **Developer** — Confirms code quality and compliance (author verification)

CI provides the independent verification source. The developer's self-merge is acceptable because the risk classification is LOW and the automated gates provide objective verification.

**MEDIUM/HIGH risk — second human reviewer required:**
1. **CI** — GitHub confirms gates passed (tamper-resistant, independent)
2. **Human reviewer** — Confirms code quality, security, compliance, test scope (judgment-based, independent)

Both are recorded immutably in GitHub. The second reviewer satisfies separation of duties for changes that affect security, PII, payments, RBAC, or user-facing features.

## Output

- PR created: `develop` → `main`
- CI independent verification running (or passed)
- Compliance checklist in PR description
- For MEDIUM/HIGH: second reviewer approval recorded
- Immutable audit trail

## Next Step

After CI passes (and reviewer approves for MEDIUM/HIGH risk), proceed to `5-deploy-main.md`.
