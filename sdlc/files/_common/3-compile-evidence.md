---
description: Compile test, security, and AI evidence, update RTM, create release ticket for review
---

# Compile Evidence

**Pipeline Stage:** 3 of 5
**Previous:** `2-implement-and-test.md`
**Next:** `4-submit-for-review.md`
**References:** Test Strategy (`sdlc/files/Test_Strategy.md` in DevAudit) (evidence requirements), Test Architecture (tooling), Test Plan (artifact structure)

---

## When to Use

- After implementing a tracked requirement (REQ-XXX)
- After significant changes needing audit trail
- Before creating a PR to `main`

**Skip** for trivial changes — go straight to `4-submit-for-review.md`.

## Evidence Storage Rule

**Markdown stays in git. Binary and JSON evidence goes to DevAudit.**

| Artifact | Store in | Why |
|----------|----------|-----|
| `compliance/RTM.md` | Git | Source of truth, version history, PR-reviewable |
| `compliance/evidence/REQ-XXX/test-scope.md` | Git | Planning artifact, reviewed in PRs |
| `compliance/evidence/REQ-XXX/implementation-plan.md` | Git | Design decisions artifact (MEDIUM/HIGH risk), reviewed in PRs |
| `compliance/evidence/REQ-XXX/test-plan.md` | Git | Test strategy — tests to add/update/remove, mapped to criteria |
| `compliance/evidence/REQ-XXX/test-execution-summary.md` | Git | Gate results, test changes, coverage against test plan |
| `compliance/evidence/REQ-XXX/ai-use-note.md` | Git | Small markdown, needs PR review |
| `compliance/evidence/REQ-XXX/ai-prompts.md` | Git | Small markdown, needs PR review |
| `compliance/evidence/REQ-XXX/security-summary.md` | Git | Small markdown, needs PR review |
| `compliance/pending-releases/RELEASE-TICKET-*.md` | Git | Reviewed and moved to approved-releases |
| E2E results (JSON) | DevAudit | Large, bloats git history |
| Screenshots (PNG/JPG) | DevAudit | Binary, bloats git history |
| SAST results (JSON) | DevAudit | Large JSON, bloats git history |
| Dependency audit (JSON) | DevAudit | Large JSON, bloats git history |
| Unit test output (TXT) | DevAudit | Verbose output, bloats git history |
| Test reports (HTML) | DevAudit | Binary, bloats git history |

## Release Identity

CI uploads are scoped to a **release record** in DevAudit, keyed by `(project, version)`. Every gate result, test artifact, and compliance document for one logical feature must land in the same release record — that is how the portal evaluates the release-completeness checklist and the four-gate panel.

The templated workflows derive the release version from the **latest commit on the branch** via `scripts/derive-release-version.sh`:

| Commit shape | Release version |
|---|---|
| Subject `[REQ-037] feat(...)` | `REQ-037` |
| Subject `feat(...)` + body `Ref: REQ-037` | `REQ-037` |
| Subject contains multiple tags (e.g. `[REQ-037][REQ-038]`) | First match wins → `REQ-037` |
| No REQ tag (housekeeping, dep bumps) | Bare date → `v2026.05.17` |

Both `ci.yml` and `compliance-evidence.yml` call the same helper, so a feature spanning many commits and a mix of code/docs pushes converges on **one** release record. Subject takes priority over body when both are present.

If you need a separate release container for a sub-piece of work — e.g. carving REQ-038 out of an in-flight feature — give it its own REQ-ID and tag the commits accordingly.

## Steps

### Step 0: Confirm CI Is Green

Before compiling evidence, verify the latest CI run on `develop` passed:

```bash
gh run list --branch develop --limit 1
```

**Do NOT proceed** if CI is failing or was cancelled. Evidence must reflect a green pipeline. If CI failed, return to `2-implement-and-test.md` and fix the issue first.

For MEDIUM/HIGH risk with AI involvement, also verify:
```bash
# AI prompt log must exist and be non-empty
test -s compliance/evidence/REQ-XXX/ai-prompts.md && echo "OK" || echo "MISSING — create ai-prompts.md before proceeding"
```

---

### Step 1: Verify All Local Gates Pass

```bash
npx tsc --noEmit
semgrep scan --config auto [SOURCE_DIR]/ --severity ERROR --severity WARNING
npm audit --audit-level=high
npx playwright test
```

All must pass. Evidence must reflect a green suite.

> **Skill available:** for the E2E gate specifically, invoke the **`e2e-test-engineer`** skill (at `.claude/skills/e2e-test-engineer/SKILL.md`). It runs the suite, triages failures into flake / test-bug / app-defect / intended-visual-diff / unintended-visual-diff before taking any action, checks each acceptance criterion has a passing test, and files defects via whatever tracker the project uses (GitHub, GitLab, Jira, Linear, Azure DevOps; markdown report as fallback). See [`sdlc/SKILLS.md`](../sdlc/SKILLS.md) for the full list of available skills.

### Step 1a: Generate Test Execution Summary

After confirming all gates pass, generate the test execution summary. This documents what ran, the results, and maps back to the test plan.

```bash
cat > compliance/evidence/REQ-XXX/test-execution-summary.md << 'EOF'
# Test Execution Summary — REQ-XXX

**Date:** [YYYY-MM-DD]
**Git SHA:** [short SHA]
**CI Run:** [run ID or "local"]

## Gate Results

| Gate | Result | Details |
|------|--------|---------|
| TypeScript | PASS | 0 errors |
| SAST | PASS | [N] findings ([N] baseline) |
| Dependency Audit | PASS | [N] unaccepted high/critical |
| E2E Tests | PASS | [N]/[N] passed |
| Build | PASS | Production build succeeded |

## Test Changes in This Release

**Added:**
- `e2e/[spec-file].spec.ts` — [N] tests ([description])

**Updated:**
- `e2e/[spec-file].spec.ts` — [what changed]

**Removed:**
- [none, or file + justification]

## Test Plan Coverage

| Acceptance Criterion | Status | Test |
|---------------------|--------|------|
| [From test-plan.md] | PASS | `[spec-file]::[test-name]` |

## Evidence Locations

| Evidence | Location |
|----------|----------|
| E2E results | DevAudit: [project]/REQ-XXX/e2e-results.json |
| SAST results | DevAudit: [project]/REQ-XXX/sast-results.json |
| Dependency audit | DevAudit: [project]/REQ-XXX/dependency-audit.json |
| Playwright report | CI artifact: playwright-report/ |
EOF
```

This summary is committed to git (small markdown) and uploaded to DevAudit where reviewers can see it inline on the release dashboard.

---

### Step 2: Verify JSDoc Headers

```bash
git diff --name-only origin/main...HEAD -- '*.ts' '*.tsx' | head -20
```

Each modified file should have `@requirement REQ-XXX` header.

### Step 3: Upload Test Evidence to DevAudit

Upload evidence to DevAudit so reviewers can access full test results (Playwright reports, SAST scans, dependency audits) without needing GitHub Checks tab access. This is the primary way reviewers verify test evidence.

The upload script is available in the DevAudit repository at `scripts/upload-evidence.sh`.

```bash
# Ensure DevAudit environment variables are set
# SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY

# Upload E2E results
./scripts/upload-evidence.sh [PROJECT_SLUG] REQ-XXX e2e_result [E2E_RESULTS_PATH] \
  --git-sha "$(git rev-parse HEAD)" \
  --branch "$(git branch --show-current)"

# Upload unit test results
npm test -- --verbose 2>&1 | tee /tmp/unit-test-results.txt
./scripts/upload-evidence.sh [PROJECT_SLUG] REQ-XXX test_report /tmp/unit-test-results.txt \
  --git-sha "$(git rev-parse HEAD)"
```

**Alternative (git-based):** If not using DevAudit, save evidence locally:
```bash
cp [E2E_RESULTS_PATH] compliance/evidence/REQ-XXX/
npm test -- --verbose 2>&1 | tee compliance/evidence/REQ-XXX/unit-test-results.txt
```

### Step 4: Upload Security Evidence

```bash
# Generate evidence files
semgrep scan --config auto [SOURCE_DIR]/ --json > /tmp/sast-results.json 2>&1
npm audit --json > /tmp/dependency-audit.json 2>&1

# Upload to DevAudit
./scripts/upload-evidence.sh [PROJECT_SLUG] REQ-XXX audit_log /tmp/sast-results.json \
  --git-sha "$(git rev-parse HEAD)"
./scripts/upload-evidence.sh [PROJECT_SLUG] REQ-XXX audit_log /tmp/dependency-audit.json \
  --git-sha "$(git rev-parse HEAD)"
```

Create a security summary (keep in git — this is a compliance document, not binary evidence):
```bash
cat > compliance/evidence/REQ-XXX/security-summary.md << EOF
## Security Evidence Summary — REQ-XXX
**Date:** $(date -I)
**SAST Tool:** Semgrep (auto config)
**SAST High/Critical Findings:** 0
**Dependency Audit High/Critical:** 0
Evidence uploaded to DevAudit project: [PROJECT_SLUG]
EOF
```

For Medium/High risk, add access control and audit log verification to the security summary.

### Step 5: Save AI Evidence (If Applicable)

Verify `ai-use-note.md` and `ai-prompts.md` exist (if AI was used). If missing:

```bash
cat > compliance/evidence/REQ-XXX/ai-use-note.md << 'EOF'
# AI Use Record — REQ-XXX
**AI Tool:** [tool name]
**Code Generated By AI:** [list files]
**Human Reviewer:** [name]
**Review Date:** [date]
**Regenerations:** [none / list]
EOF
```

### Step 6: Verify Test Scope and Implementation Plan

Review `compliance/evidence/REQ-XXX/test-scope.md` (created during PLAN stage). Confirm all testing items have been addressed:

```bash
cat compliance/evidence/REQ-XXX/test-scope.md
# Check: are all [ ] items now [x]?
# If not, complete the outstanding items before proceeding
```

For MEDIUM/HIGH risk, verify the implementation plan exists and matches what was built:

```bash
cat compliance/evidence/REQ-XXX/implementation-plan.md
# Check: does the plan match the actual implementation?
# If the approach changed during development, update the plan to reflect what was actually built.
```

### Step 7: Update RTM

Open `compliance/RTM.md`, Part B. Update status:

```markdown
| REQ-XXX | Description | [RISK] | implementation-files | evidence | TESTED - PENDING SIGN-OFF | Pending | -- |
```

### Step 8: Generate Release Ticket

Create `compliance/pending-releases/RELEASE-TICKET-REQ-XXX.md`:

```markdown
# Release Ticket: REQ-XXX — [Title]

**Status:** TESTED - PENDING SIGN-OFF
**Date:** [YYYY-MM-DD]
**Requirement ID:** REQ-XXX
**Risk Level:** [LOW / MEDIUM / HIGH]
**PR:** [Will be linked when PR is created]

---

## Summary
[1-3 sentences]

## AI Involvement
- **AI Tool Used:** [tool / none]
- **AI-Generated Files:** [list, or "none"]
- **Human Reviewer of AI Code:** [name]
- **Components Regenerated:** [none / list]

## Implementation Details
**Files Modified:**
- `path/to/file1.ts` — [what changed]

**Dependencies Added/Changed:**
- [package@version — purpose — vulnerability status]
- [or "No dependency changes"]

## Test Evidence
| Test Type | Count | Passed | Failed | Evidence Location |
|-----------|-------|--------|--------|-------------------|
| E2E (Playwright) | [N] | [N] | 0 | DevAudit portal: [PROJECT_SLUG]/REQ-XXX |
| Unit | [N] | [N] | 0 | DevAudit portal: [PROJECT_SLUG]/REQ-XXX |

## Security Evidence
| Check | Result | Evidence Location |
|-------|--------|-------------------|
| SAST | 0 high/critical | DevAudit portal: [PROJECT_SLUG]/REQ-XXX |
| Dependency Audit | 0 high/critical | DevAudit portal: [PROJECT_SLUG]/REQ-XXX |
| Access Control | [PASS/N/A] | Git: `compliance/evidence/REQ-XXX/security-summary.md` |
| Audit Log | [PASS/N/A] | Git: `compliance/evidence/REQ-XXX/security-summary.md` |

## Acceptance Criteria
- [x] [From test-scope.md]
- [x] All E2E tests passing
- [x] TypeScript clean
- [x] SAST clean
- [x] Dependencies clean
- [x] AI use documented (if applicable)

## Risk Assessment
- [Any risks introduced]
- [New dependencies and trust assessment]

## Post-Deploy Actions

| Type | Script / Command | Target | Required | Notes |
|------|-----------------|--------|----------|-------|
| — | None | — | — | No post-deploy actions required |

<!-- Replace the "None" row above with actual actions if this release requires them:
| Data migration | `npx tsx scripts/backfill-x.ts "[CONN_STRING]"` | Prod DB | Yes | [description] |
| Schema migration | `npx prisma migrate deploy` | Prod DB | Yes | [description] |
-->

**Run these after deployment, before production verification.**

---

## Reviewer Checklist
- [ ] Code matches requirement
- [ ] Test evidence present and all-pass
- [ ] Security evidence present and clean
- [ ] Test scope fully addressed
- [ ] RTM correct status and risk
- [ ] No sensitive data committed
- [ ] No regressions
- [ ] AI code reviewed (if applicable)
- [ ] No hallucinated dependencies
- [ ] Post-deploy actions documented (or confirmed none required)

---

## Audit Trail
| Date | Action | Actor | Notes |
|------|--------|-------|-------|
| [date] | Requirement created | [who] | Risk: [level] |
| [date] | Implementation completed | [who] | [details] |
| [date] | AI code reviewed | [reviewer] | [files] |
| [date] | Tests passed | [who] | E2E + SAST: clean |
| [date] | UAT verification passed | [who] | Health + smoke + feature verified |
| [date] | Post-deploy actions | [who] | [Completed / None required] |
| [date] | Submitted for review | [who] | PR #[number] |
```

### Step 9: Commit Compliance Docs and Push

Commit compliance documents and push immediately. Heavy CI gates (E2E, TypeScript, build) skip markdown-only pushes via `paths-ignore`, so this push is cheap — but the Compliance Evidence Upload workflow fires and pushes the new artefacts to DevAudit. Pushing immediately means destination breakage (dead alias URL, revoked API key, schema drift) surfaces in seconds, not at the end of the stage.

> **What changed in sdlc-v1.22.0:** Earlier versions of this stage held the commit locally and batched the push at the end. We learned the hard way that this hides destination integration bugs — a stale `devaudit.base_url` was invisible until the batched push, by which point the dev had already done UAT verification against the assumption that evidence had been uploaded. Push-early surfaces those problems within seconds.

If using DevAudit, commit only compliance documents (RTM, release ticket, test scope, AI notes, security summary). Binary evidence (JSON results, screenshots) is stored in DevAudit, not git.

**Before committing, verify all required artifacts exist:**
- [ ] `compliance/evidence/REQ-XXX/test-scope.md`
- [ ] `compliance/evidence/REQ-XXX/test-plan.md`
- [ ] `compliance/evidence/REQ-XXX/test-execution-summary.md`
- [ ] `compliance/evidence/REQ-XXX/implementation-plan.md` (MEDIUM/HIGH risk only)
- [ ] `compliance/evidence/REQ-XXX/ai-prompts.md` (if AI used on MEDIUM/HIGH risk)
- [ ] `compliance/evidence/REQ-XXX/security-summary.md`
- [ ] `compliance/pending-releases/RELEASE-TICKET-REQ-XXX.md`

```bash
# DevAudit projects — commit + push compliance docs
git add compliance/RTM.md compliance/pending-releases/RELEASE-TICKET-REQ-XXX.md \
  compliance/evidence/REQ-XXX/test-scope.md \
  compliance/evidence/REQ-XXX/test-plan.md \
  compliance/evidence/REQ-XXX/implementation-plan.md \
  compliance/evidence/REQ-XXX/test-execution-summary.md \
  compliance/evidence/REQ-XXX/ai-use-note.md \
  compliance/evidence/REQ-XXX/ai-prompts.md \
  compliance/evidence/REQ-XXX/security-summary.md
git commit -m "compliance: [REQ-XXX] evidence compiled - awaiting review"
git push origin develop
```

If NOT using DevAudit (git-based evidence):
```bash
git add compliance/RTM.md compliance/pending-releases/RELEASE-TICKET-REQ-XXX.md compliance/evidence/REQ-XXX/
git commit -m "compliance: [REQ-XXX] evidence compiled - awaiting review"
git push origin develop
```

#### Wait for the Compliance Evidence Upload workflow

```bash
gh run watch --workflow "Compliance Evidence Upload"
```

If it fails — typically a stale `devaudit.base_url`, a revoked `DEVAUDIT_API_KEY`, or schema drift — fix the configuration and re-push. Resolving this here is fast and recoverable; the same failure caught at the end of the stage would mean a long detour through UAT verification before discovering the upload never happened.

### Step 10: UAT-Environment Verification (CONDITIONAL)

**Skip this step entirely if any of these are true:**

- Project's `sdlc-config.json` has `uat.enabled: false` — meaning the project has no deployed UAT environment configured (internal services, retroactive-compliance pickups, etc.).
- Requirement's risk class is **not** listed in project's `uat.required_risk_classes` (defaults: `payment`, `destructive_migration`, `realtime`, `physical_ux`). Text-only fixes, internal refactors, low-risk UI tweaks carry none of these and skip UAT-env verification. **Wildcard:** if `required_risk_classes` contains `"*"`, every requirement requires UAT-env verification regardless of risk class — use this for projects that deploy `develop` to a UAT environment and exercise every release there before promotion.

When skipped, proceed directly to Step 11.

> **Why opt-in by risk class?** UAT-env verification has two functions: (a) catching environment-specific issues (env vars, DB differences, build behaviour) and (b) recording that a human exercised the deployed system before approval. (a) is only valuable when there are environment-specific failure modes — a text-label change can't carry one. (b) is the four-eyes record, which Step 11 captures independently. Running UAT-env verification on every requirement adds ceremony without value; running it on risky requirements adds confidence where it matters. See sdlc-v1.22.0 release notes for the full rationale.

When this step DOES apply, the develop branch's auto-deploy to UAT must complete first. **Wait for the deployment to complete**, then verify the change works in the UAT environment.

> **Automated e2e shrinks this step — it does not delete it.** When a requirement's acceptance criteria are covered by **passing CI e2e tests** authored with the `e2e-test-engineer` skill (each AC proven by an `evidenceShot`, run via the report-only authenticated-e2e gate — see `sdlc-config.json` `e2e_projects` / `e2e_seed_command`), those ACs are already exercised against the running app on every push. For those ACs, this step is **not** a full manual re-click of every criterion: it reduces to a **light manual smoke** on the deployed UAT environment — confirm the build is live, the changed area loads, and spot-check anything the e2e couldn't reach (real third-party integrations, environment-specific config, payment sandboxes). Record which ACs were discharged by automated e2e vs. exercised manually. ACs **not** covered by a passing e2e test still need full manual verification here.

#### WAIT CHECKPOINT: Confirm CI + Deployment Complete

Before UAT verification, confirm BOTH CI and deployment are complete:

```bash
# Confirm CI passed
gh run list --branch develop --limit 1

# Confirm UAT deployment is live (check hosting platform dashboard)
curl -s [UAT_URL]/[HEALTH_ENDPOINT]
# Expected: success response
```

**Do NOT proceed** with UAT verification until both CI is green and the deployment is live. Testing against a stale deployment produces invalid evidence.

#### 10a. Wait for UAT deployment

Monitor in the hosting platform dashboard or wait for the build to complete.

#### 10b. Health check

```bash
curl -s [UAT_URL]/[HEALTH_ENDPOINT]
# Expected: success response
```

#### 10c. Smoke test

```bash
# Homepage loads
curl -s -o /dev/null -w "%{http_code}" [UAT_URL]/
# Expected: 200

# A key endpoint responds correctly
curl -s -o /dev/null -w "%{http_code}" [UAT_URL]/[PUBLIC_ENDPOINT]
```

#### 10d. Feature-specific verification

Manually verify the specific feature or fix you implemented works on UAT. This catches environment-specific issues (env vars, database differences, build behavior) that local testing cannot.

#### 10e. Record UAT results

```bash
cat >> compliance/evidence/REQ-XXX/security-summary.md << EOF

## UAT Verification — $(date -I)
- UAT Health check: PASS
- UAT Smoke test: PASS
- Feature verification: PASS — [brief description of what was verified]
- UAT URL: [UAT_URL]
EOF

git add compliance/evidence/REQ-XXX/security-summary.md
git commit -m "compliance: [REQ-XXX] UAT-environment verification passed"
git push origin develop
```

**If UAT-env verification fails:** Fix the issue on `develop`, re-run local gates, push, and repeat UAT-env verification. Do NOT proceed to Step 11 until UAT-env is green.

### Step 11: Submit for Review + Approve Release in DevAudit (MANDATORY)

This is the **four-eyes release approval gate**. It has two transitions:

- **Step 11a. Submit for UAT review** (`draft → uat_review`) — the dev (or AI agent) signals the release is ready for review.
- **Step 11b. Approve** (`uat_review → uat_approved`) — an authorised reviewer (a different person under `approval.mode: dual_actor`) reviews the evidence and clicks Approve.

#### Step 11a — Submit for UAT review

Two paths; do whichever fits the project's workflow:

**Manual.** Open the release in DevAudit and click **Submit for UAT Review**. URL shape: `https://[DEVAUDIT_BASE_URL]/projects/[PROJECT_SLUG]/releases/[releaseId]` — posted as a comment on the develop branch by CI (look at the latest run of `Release Approval Gate` or `Compliance Evidence Upload`).

**Scripted.** Run the bundled script (synced from META-COMPLY into every consuming project under `scripts/`):

```bash
./scripts/submit-for-uat-review.sh [PROJECT_SLUG] v2026.MM.DD
```

The script:

1. Checks the working tree is clean and develop is up-to-date with origin.
2. Checks a `RELEASE-TICKET-*.md` exists in `compliance/pending-releases/`.
3. Checks CI gates are green on the current develop HEAD (via `gh run list`).
4. Resolves the release id from DevAudit using `DEVAUDIT_API_KEY` (existing).
5. Submits with `DEVAUDIT_USER_TOKEN` (Personal Access Token issued from `/settings/tokens` in DevAudit). The submission carries the issuing user's identity, so `isOwnRelease` keeps holding for Step 11b under `dual_actor`.
6. Idempotent — if the release is already in `uat_review` (or later), exits 0 with a note rather than failing.

Required environment variables for the scripted path:

| Var | What it is | Where to set |
|---|---|---|
| `DEVAUDIT_USER_TOKEN` | Personal Access Token (`mctok_…`) attributed to the running user | Issue at `/settings/tokens`; store as a repo secret for CI or `.env` for local |
| `DEVAUDIT_API_KEY` | Project-scoped API key (existing) | Already set for evidence uploads |
| `DEVAUDIT_BASE_URL` | DevAudit URL | Resolved by CI templates; locally read from `sdlc-config.json devaudit.base_url` |

#### Step 11b — Approve

After Step 11a completes (status: `uat_review`), an authorised reviewer:

1. Opens the release in DevAudit (same URL as above).
2. Reviews:
   - **Quality gate results** (TypeScript, SAST, dependency audit, E2E, coverage) — uploaded by CI on the Stage 2 implementation push.
   - **Compliance Markdowns** (RTM, release ticket, test-scope, test-execution-summary, security-summary, ai-prompts) — uploaded by Compliance Evidence Upload on the Step 9 push.
   - **UAT-environment verification record** (if Step 10 ran) — in `security-summary.md`.
3. Clicks **Approve**. The release status transitions to `release_approved` (backend enum still `uat_approved` in v1.22.x for backwards-compat; renamed in v1.23.0).

If something looks wrong, click **Reject** and add a comment. Return to Stage 2 to fix, then re-walk Stage 3 from Step 1.

#### Approver mode

Project's `sdlc-config.json` `approval.mode` setting:

- `dual_actor` (recommended) — DevAudit enforces `approver_user_id ≠ release_creator_user_id`. If you're the release creator, you cannot approve your own release; delegate to another authorised reviewer.
- `solo_with_gap` — DevAudit allows self-approval. This is a documented control gap; the gap must be recorded in `compliance/risk-register.md` with explicit acknowledgement of which compliance clauses it diverges from (SOC2 CC8.1, ISO 29119 §5.4).
- `auto_low_risk` — LOW-risk requirements auto-approve once Compliance Evidence Upload completes (audited as a system event). MEDIUM/HIGH requirements always require a human click.

The `Release Approval Gate` workflow on Stage 4's PR enforces this — it polls DevAudit's API for `release.status` and fails the PR if approval isn't recorded. Wait for the next CI run on develop to confirm the gate sees the approval before proceeding to Stage 4.

## DevAudit CI Integration

Projects using DevAudit can automate evidence upload via the reusable GitHub Actions workflow. After CI tests pass, evidence is uploaded to the centralized portal where auditors can browse it.

### Versioning Convention

Releases use **date-based versioning** by default:

```
v{YYYY}.{MM}.{DD}         — e.g. v2026.03.27
v{YYYY}.{MM}.{DD}.{N}     — e.g. v2026.03.27.2 (second release same day)
```

The version is auto-generated by CI from the current date. Projects may override with semantic versioning (v1.2.0) if preferred by setting a `RELEASE_VERSION` variable.

### How Releases Are Created

CI **auto-creates releases** in DevAudit when uploading evidence. The workflow passes `--create-release-if-missing` to the upload script, which creates a `draft` release if one doesn't exist for the given version. This means:

- You don't need to manually create releases in DevAudit
- Evidence is always linked to a release (never orphaned)
- The release dashboard shows evidence immediately after CI runs
- Requirements are auto-synced from `compliance/RTM.md` to enable completeness tracking

### CI Workflow Setup

Add this job to your CI pipeline (after E2E tests pass):

```yaml
upload-evidence:
  needs: [e2e-tests]
  uses: metasession-dev/devaudit/.github/workflows/upload-evidence.yml@main
  with:
    project-slug: your-project-slug
    release-version: v2026.03.27       # or use date-based auto-generation
    environment: uat
  secrets:
    SUPABASE_URL: ${{ secrets.META_COMPLY_SUPABASE_URL }}
    SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.META_COMPLY_SERVICE_ROLE_KEY }}
```

This automatically:
- Creates the release in DevAudit if it doesn't exist (status: `draft`)
- Uploads compliance source documents (RTM, test plan, test cases, test summary report)
- Syncs `known_requirements` from RTM.md for completeness tracking
- Tags each upload with git SHA and CI run ID for traceability

### Additional Template Workflows

Copy these from `sdlc/files/ci/` into your project's `.github/workflows/`:

**`check-release-approval.yml`** (renamed from `check-uat-approval.yml` in sdlc-v1.22.0) — Release Approval Gate on PRs to main:
- Blocks merge until the release is approved in DevAudit (`uat_approved` / `release_approved` / downstream statuses)
- Add as a required status check on the `main` branch protection rule

**`post-deploy-prod.yml`** — Production evidence capture after merge to main:
- Runs production smoke tests
- Uploads production evidence to DevAudit (environment: production)
- Marks the release as `released`

The source of truth for compliance documents remains in git. DevAudit holds read-only snapshots so auditors see the full compliance picture in one place.

## Output

- RTM: `TESTED - PENDING SIGN-OFF`
- Release ticket in `compliance/pending-releases/`
- Test + security + AI evidence uploaded to DevAudit (or in `compliance/evidence/REQ-XXX/` if git-based)
- Compliance documents (test scope, AI notes, security summary) committed to git and pushed
- Test scope fully addressed
- UAT-environment verification passed and recorded (only if Step 10 applied — opt-in by risk class)
- **Release approved in DevAudit** (status: `uat_approved` / `release_approved`) — always required before PR to main

## Next Step

Proceed to `4-submit-for-review.md`.
