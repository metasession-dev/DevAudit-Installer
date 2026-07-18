# DevAudit Test Process — Detailed Reference

> **Purpose:** Complete specification of the test process enforced by DevAudit across the full SDLC. Covers stages, risk-based depth, E2E tiering, CI gates, evidence requirements, enforcement mechanisms, and traceability.
>
> **Source documents:** Test Policy (`sdlc/files/_common/Test_Policy.md`), Test Strategy (`sdlc/files/_common/Test_Strategy.md`), SDLC blueprints (`sdlc/src/blueprints/`), `sdlc-implementer` skill, `e2e-test-engineer` skill, CI templates (`sdlc/files/ci/`).

---

## Table of Contents

1. [Document Hierarchy](#document-hierarchy)
2. [The 5-Stage Pipeline](#the-5-stage-pipeline)
   - [Stage 1 — Plan Requirement](#stage-1--plan-requirement)
   - [Stage 2 — Implement and Test](#stage-2--implement-and-test)
   - [Stage 3 — Compile Evidence](#stage-3--compile-evidence)
   - [Stage 4 — Submit for Review](#stage-4--submit-for-review)
   - [Stage 5 — Deploy to Main](#stage-5--deploy-to-main)
3. [Risk-Based Testing](#risk-based-testing)
4. [3-Tier E2E Gating Model](#3-tier-e2e-gating-model)
5. [Per-Commit CI Gates](#per-commit-ci-gates)
6. [Evidence-Completeness Gate](#evidence-completeness-gate)
7. [Evidence Wiring Requirements](#evidence-wiring-requirements)
8. [AI-Assisted Development Testing](#ai-assisted-development-testing)
9. [Security Testing](#security-testing)
10. [Defect Management](#defect-management)
11. [Requirements Traceability](#requirements-traceability)
12. [Enforcement Mechanisms](#enforcement-mechanisms)
13. [Compliance Framework Mapping](#compliance-framework-mapping)

---

## Document Hierarchy

```
Test Policy (sdlc/files/_common/Test_Policy.md)
  → WHY we test, WHAT we commit to, WHO is responsible

Test Strategy (sdlc/files/_common/Test_Strategy.md)
  → HOW we approach testing methodically

Test Architecture (sdlc/files/_common/Test_Architecture.md)
  → WHAT tools we use, HOW we structure test code

Project Test Plans (per consumer repo)
  → WHERE and WHEN for specific products
```

DevAudit installs all three top-tier documents into every consumer repo via `devaudit install`. They are Tier 1 artefacts — never project-specific. Project-specific details live in the consumer's Test Plan, RTM, and evidence directory.

---

## The 5-Stage Pipeline

DevAudit enforces a 5-stage SDLC. Each stage has defined prerequisites, steps, wait checkpoints, and outputs. The `sdlc-implementer` skill orchestrates stages 1–3; stage 4 requires operator action (PR creation); stage 5 is triggered by merge.

### Stage 1 — Plan Requirement

**Blueprint:** `sdlc/src/blueprints/1-plan-requirement.raw.md`

**Prerequisites:**
- A GitHub issue exists (or is created) as the origin of the change
- Operator is on the integration branch (`develop` by default)

**Steps:**

1. **Identify or create the GitHub Issue** — every tracked change starts from an issue. The issue number becomes the traceability anchor.

2. **Assign a REQ-XXX identifier** — the next sequential ID from `compliance/RTM.md`. The RTM (Requirements Traceability Matrix) is the canonical mapping of requirements to test cases, evidence, and releases.

3. **Classify risk** — one of LOW, MEDIUM, HIGH, or CRITICAL. Classification is based on the nature of the change, not the complexity:
   - **HIGH** — Sensitive data (PII, payments), authentication/authorization, encryption, regulatory compliance, audit logging, core revenue, production infrastructure, AI-generated code in any of these
   - **MEDIUM** — New features, architectural changes, third-party integrations, performance optimizations, AI-generated code for non-security features
   - **LOW** — UI updates without functional changes, configuration, documentation, internal tools with limited impact
   - **CRITICAL** — HIGH plus targeted security tests (authz bypass, input fuzzing)
   - AI involvement raises risk by one level

4. **Add RTM entry** — REQ-XXX, title, risk class, linked issue, linked test cases (placeholder), provenance marker (`sdlc-implementer@<version>`). The provenance column is CI-validated: `feat`/`fix`/`refactor`/`perf` commits citing a REQ-XXX without the provenance stamp fail CI.

5. **Implementation plan** (MEDIUM/HIGH only) — created at `compliance/plans/REQ-XXX/implementation-plan.md`. Contains:
   - Files to create/modify
   - Architecture decisions (via `adr-author` skill — decides ADR-worthiness, allocates ADR-NNN, drafts Context/Decision/Consequences/Alternatives/Status)
   - Risk register entries (via `risk-register-keeper` skill — identifies discrete risks, allocates RISK-NNN, drafts rows in `compliance/risk-register.md`)
   - SRS alignment (via `requirements-aligner` skill — fuzzy-matches ACs against `docs/SRS.md`, proposes new REQ-AREA-NNN stubs, flags stale items)

6. **Test scope** — derived from the implementation plan at `compliance/evidence/REQ-XXX/test-scope.md`. Contains:
   - Risk classification and rationale
   - Test approach (which testing levels apply)
   - Acceptance criteria as Given/When/Then against named UI surfaces
   - Security testing items (if applicable)
   - Validation items

7. **Test plan** — maps acceptance criteria to specific test files at `compliance/evidence/REQ-XXX/test-plan.md`. Contains:
   - Tests to Add (new spec/test files with descriptions)
   - Tests to Update (existing files needing modification)
   - Tests to Remove (obsolete files with justification)
   - Functional Test Mapping table (AC → test file → test name)
   - Non-functional tests (security, performance, accessibility — MEDIUM/HIGH)
   - Test data requirements

8. **Update SRS** (if applicable) — if the requirement adds, changes, or removes observable behaviour, update `docs/SRS.md` with canonical Given/When/Then prose.

9. **Document AI use intent** (if applicable) — for MEDIUM/HIGH risk with AI involvement, create `compliance/evidence/REQ-XXX/ai-use-note.md` with tool name, version, session ID, planned use.

**Wait checkpoints:**
- Implementation plan review (MEDIUM/HIGH) — operator must approve before test scope extraction
- Test scope review — operator must confirm scope is complete and correct
- Test plan review — operator must confirm tests are correct and complete

**Output:**
- GitHub Issue `#NNN` identified as origin
- REQ-XXX in RTM with risk classification and provenance
- Implementation plan (MEDIUM/HIGH)
- Evidence directory with test scope and test plan
- AI use note (if applicable)

---

### Stage 2 — Implement and Test

**Blueprint:** `sdlc/src/blueprints/2-implement-and-test.raw.md`
**Skill:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`

**Prerequisites:**
- Stage 1 complete: test scope and test plan committed
- On the integration branch (`develop`)
- For full local E2E: database/services running, secrets available, Playwright browsers installed, test data seeded, auth/session configured

**Steps:**

#### Step 1: Branch off integration branch

```bash
git checkout develop && git pull
git checkout -b feat/REQ-XXX-<slug>
```

Advisory concurrent-REQ check: scan open PRs to the integration branch for overlapping files. Warn if overlap detected.

#### Step 2: Write failing tests first (TDD)

Depth scales with risk class:
- **LOW** — unit tests on changed functions; no E2E required unless UI-facing
- **MEDIUM** — unit + integration; E2E for any UI-facing change
- **HIGH** — unit + integration + E2E for every user-visible path + at least one negative/abuse test
- **CRITICAL** — HIGH plus targeted security tests

Tests should initially **fail** — the implementation doesn't exist yet. That's correct TDD.

#### Step 3: E2E delegation gate

Before creating or editing **any** `e2e/**/*.spec.ts` file:

1. Output the literal line: `Delegating e2e test work to e2e-test-engineer.`
2. Invoke `Skill(name: "e2e-test-engineer", args: "<change summary + plan pointer>")`
3. Do not author or edit any `e2e/**/*.spec.ts` file directly

This is a structural defence against the inertia trap where the orchestrator skill writes specs inline instead of delegating. The `e2e-test-engineer` skill owns spec authoring end-to-end, including the "this AC needs no E2E" decision.

#### Step 4: Implement against the plan

Write code referencing `compliance/plans/REQ-XXX/implementation-plan.md`. Deviations are classified:

- **Implementation deviation** (approach changed, ACs still correct) — note in `## Plan deviation` section of plan. Continue.
- **Requirements deviation** (an AC is wrong, incomplete, or missing) — trigger the requirements gap flow. Do NOT just note it as a plan deviation. The AC table must be updated, `requirements-aligner` re-invoked, RTM updated.

Add `@requirement REQ-XXX` JSDoc headers to implemented files.

If AI generates code (MEDIUM/HIGH):
```bash
echo "Prompt summary: [what you asked]" >> compliance/evidence/REQ-XXX/ai-prompts.md
echo "Files generated: [list]" >> compliance/evidence/REQ-XXX/ai-prompts.md
echo "Date: $(date -I)" >> compliance/evidence/REQ-XXX/ai-prompts.md
```

If AI regenerates a component from scratch:
```bash
echo "REGENERATION: [component] regenerated on $(date -I). Full retest required." >> compliance/evidence/REQ-XXX/ai-prompts.md
```

#### Step 5: Run gates locally, cheap-first

Gates are not equivalent-cost. Iterate on fast gates; spend E2E cost once.

**Fast gates** (every change, pre-commit):
- `npm run lint` (or stack-adapter equivalent)
- `npx tsc --noEmit` (or stack-adapter equivalent)
- `npx vitest run` (unit/integration)
- `semgrep scan --config auto`
- `npm audit --audit-level=high`

**E2E gate** (once, after fast gates clean):
- `npx playwright test` (delegated to `e2e-test-engineer`, which has its own focused-iteration discipline)

On gate failure: iterate up to N=3 attempts (read failure → propose fix → apply → re-run). On exhausted attempts: halt with full failure output + resume instructions. Never use `--no-verify`, `eslint-disable`, `@ts-expect-error`, `xfail`, or any other bypass.

#### Step 5b: E2E gate verification — mandatory before commit

Check whether the change touches UI-facing files:
```bash
git diff --name-only "$INTEGRATION_BRANCH"...HEAD -- 'app/**/*.tsx' 'src/**/*.tsx' 'pages/**/*.tsx'
```

- **UI-facing files present:** check for `.e2e-gate-passed` sentinel (written by `e2e-test-engineer` after successful run) or recent `playwright-report/`. If neither → **HALT**.
- **No UI-facing files:** skip check. Note exemption in commit body.
- **`e2e-test-engineer` determined E2E not needed:** skill writes `.e2e-gate-passed` with `NOT_NEEDED` reason. Sentinel check passes.

Also verify plan ↔ test-scope AC consistency: AC IDs in `implementation-plan.md` must match `test-scope.md`. Divergence → halt.

#### Step 6: Commit

Conventional Commits format:
```
type(scope): description

- Key change 1
- Key change 2

Ref: REQ-XXX

Co-Authored-By: [AI Tool] <noreply@provider.com>
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `compliance`, `security`, `perf`, `ci`, `build`, `revert`

One commit per logical step. Never amend a commit that's already been pushed.

#### Step 7: Land on integration branch

Push feature branch → open PR `feat/REQ-XXX → develop` → merge once CI green. This is the **integration hop** — no UAT four-eyes gate here (that's the release PR in Stage 4). For MEDIUM+ risk, get peer review on this PR.

#### Step 8: E2E delegation self-audit

Before proceeding to Stage 3, walk every `e2e/**/*.spec.ts` file in the diff. For each, state one of:
- "Authored via `e2e-test-engineer` skill invocation on turn N."
- "Pre-existing file; only mechanical edits (path renames, import fixes, lint-only)."

If neither applies → stop. Revert direct edits and re-do via `e2e-test-engineer`.

#### Step 9: Auto-continue to Stage 3

After integration PR merges and develop CI is green, do NOT return control to the operator. State: `Phase 2 complete — auto-continuing to Phase 3 (compile evidence).` Then proceed to Stage 3 in the same turn.

**CI failure post-merge:** attempt fix-forward (commit fix to develop, push, wait for CI) up to N=3 attempts. If exhausted → halt with resume instructions.

---

### Stage 3 — Compile Evidence

**Blueprint:** `sdlc/src/blueprints/3-compile-evidence.raw.md`

**Prerequisites:**
- Stage 2 complete: code on integration branch, all gates green

**Steps:**

#### Step 1: SRS alignment artefact

Invoke `requirements-aligner` to produce `compliance/evidence/REQ-XXX/srs-alignment.md` — per-REQ trace from each AC to its SRS item, with operator sign-off block. Returns `CLEAN` or `GAPS_FOUND`. If gaps found and `block_on_stage_3` is true → halt with requirements gap flow.

#### Step 2: Architecture decision artefact

Invoke `adr-author` to produce `compliance/evidence/REQ-XXX/architecture-decision.md` — either "Produced ADR-NNN: <title>" with file pointer, or "No ADR needed — <rationale>". Operator sign-off block.

#### Step 3: Risk assessment artefact

Invoke `risk-register-keeper` to produce `compliance/evidence/REQ-XXX/risk-assessment.md` — summary table of RISK-NNN entries this REQ opened/mitigated/accepted, framework cross-references, operator sign-off block.

#### Step 4: Re-run full test pack with artefact capture

```bash
npm run test:e2e -- --reporter=html    # produces playwright-report/
npx vitest run --coverage               # produces coverage/
```

Classify test failures:
- **Implementation bug** — test correct, implementation wrong → fix implementation
- **Test bug** — test wrong, implementation correct → fix test
- **Requirements gap** — both correct but disagree → AC is wrong → trigger requirements gap flow

On test failure: delegate incident filing to `e2e-test-engineer` (files issues with `incident` label + `### Framework attribution` section so `incident-export.yml` fires on close → `incident_report` evidence lands on portal).

#### Step 5: Nil incident report (if no incidents closed)

If no `incident`-labelled issues were closed during this REQ's lifecycle and the test pack passes:
- Create `compliance/governance/nil-incident-report-<version>.md` from template
- Fill scope section (test cases executed/passed/failed, defects filed)
- Leave sign-off section with REPLACE markers for operator

#### Step 6: Organise artefacts

```
compliance/evidence/REQ-XXX/
├── test-scope.md
├── test-plan.md
├── implementation-plan.md
├── srs-alignment.md
├── architecture-decision.md
├── risk-assessment.md
├── YYYY-MM-DD_e2e-results.json
├── YYYY-MM-DD_playwright-report/
├── YYYY-MM-DD_traces/               ← per-test trace.zip + error-context.md
├── YYYY-MM-DD_unit-coverage/
└── YYYY-MM-DD_screenshots/*.png
```

Copy Playwright's `test-results/` folder into `YYYY-MM-DD_traces/` so trace-by-test-name is available without walking the HTML report's hash-name index. For HIGH/CRITICAL releases, traces are part of the audit trail.

#### Step 7: Upload evidence to portal

```bash
# E2E results
./scripts/upload-evidence.sh [PROJECT_SLUG] REQ-XXX e2e_result [E2E_RESULTS_PATH] \
  --git-sha "$(git rev-parse HEAD)" --branch "$(git branch --show-current)"

# Unit test results
npm test -- --verbose 2>&1 | tee /tmp/unit-test-results.txt
./scripts/upload-evidence.sh [PROJECT_SLUG] REQ-XXX test_report /tmp/unit-test-results.txt \
  --git-sha "$(git rev-parse HEAD)"
```

CI also auto-uploads: gate results (TypeScript, SAST, dependency audit, E2E, build) tagged with release version and `environment=uat`. Per-AC screenshots uploaded via `evidenceShot()` calls in E2E specs.

#### Step 8: UAT verification

If Stage 3 Step 10 applies (UAT environment configured):
- Health check: UAT URL responds
- Smoke test: critical paths work on UAT
- Feature verification: exercise the new functionality on UAT
- Record results in evidence

#### Step 9: Release approval on portal

The release must reach `uat_approved` status on the DevAudit portal. This is the gate that unblocks the release PR in Stage 4.

**Output:**
- Full evidence directory organised and uploaded
- UAT verification recorded
- Release approved on portal

---

### Stage 4 — Submit for Review

**Blueprint:** `sdlc/src/blueprints/4-submit-for-review.raw.md`

**Prerequisites:**
- All changes on `develop`, all local gates passing
- CI green and not stale (CI commit SHA matches `git rev-parse develop`)
- UAT verification passed
- Release approved in DevAudit (`uat_approved`)
- RTM status: `TESTED - PENDING SIGN-OFF`
- Release ticket exists: `compliance/pending-releases/RELEASE-TICKET-REQ-XXX.md`

**Steps:**

1. **Verify develop is ready** — clean working tree, up to date
2. **Review PR contents** — `git log origin/main..develop --oneline`, check for unexpected dependency changes
3. **Create the PR** (`develop → main`) with mandatory body:
   - Summary (1-3 bullets)
   - REQ-XXX reference + risk level
   - Local test results table (E2E, TypeScript, SAST, dependency audit)
   - E2E spec files executed
   - Evidence location
   - UAT verification results
   - CI gates checklist
   - AI involvement disclosure
   - Test changes (added/updated/removed, what's covered, what's NOT covered and why)
   - Dependency changes
   - Compliance artefacts checklist
   - Reviewer checklist (code quality, test scope, security, AI review, UAT, compliance)

4. **CI re-runs all gates independently** on the PR — this is the tamper-resistant verification that complements the developer's local results.

**Risk-tier merge rules:**
- **LOW** → self-merge permitted after CI passes
- **MEDIUM/HIGH** → second human reviewer required, self-merge NOT permitted

**Reviewer checklist includes:**
- Test scope document exists and risk classification is appropriate
- Testing depth matches risk level
- All test scope items addressed
- New routes/pages have route protection tests
- New API endpoints have auth enforcement tests
- SAST: 0 unresolved high/critical (verify CI result)
- Access control changes tested (if applicable)
- AI code reviewed for correctness, security, no hardcoded values
- Regenerated components fully retested
- UAT verification results recorded
- RTM status: TESTED - PENDING SIGN-OFF
- Release ticket accurate

---

### Stage 5 — Deploy to Main

**Blueprint:** `sdlc/src/blueprints/5-deploy-main.raw.md`

**Steps:**

1. **Merge** — merge commit (preserves audit trail; squash/rebase blocked by branch protection)
2. **Watch deploy** — `post-deploy-prod.yml` workflow triggers production deployment
3. **Production smoke evidence** — auto-uploaded with `--environment production`
4. **Mark release as Released** on portal once production smoke is green
5. **On production smoke failure** — do NOT mark as Released; file defect issue immediately; follow incident playbook (rollback or roll-forward)
6. **Close-out** — `close-out-release.yml` moves the release ticket from `pending-releases/` to `approved-releases/`, reconciles the RTM status to `RELEASED`

**Post-merge regression safety net:**
- Every push to the release branch re-runs the full E2E regression suite
- On failure, auto-files a `bug, priority:high` issue tagging the merge commit + failing specs
- Operator triages within working hours: hotfix forward, revert, or accept-with-rationale
- No automated revert (false positives + flakes + UAT-data drift are real classes)

---

## Risk-Based Testing

Risk level is determined at planning time (Stage 1) and drives testing depth through the entire pipeline.

### Classification

| Risk | Criteria |
|---|---|
| **HIGH** | Sensitive data (PII, payments), auth/authz, encryption, regulatory compliance, audit logging, core revenue, production infrastructure, AI code in any of these |
| **MEDIUM** | New features, architectural changes, third-party integrations, performance optimizations, AI code for non-security features |
| **LOW** | UI updates without functional changes, configuration, documentation, internal tools with limited impact |
| **CRITICAL** | HIGH plus targeted security tests (authz bypass attempts, input fuzzing) |

AI involvement raises risk by one level. AI regeneration (full re-generation, not incremental edit) triggers full retest of the component and all dependents.

### Testing Depth Matrix

| Activity | LOW | MEDIUM | HIGH |
|---|---|---|---|
| Unit tests | Required | Required | Required |
| Integration tests | As applicable | Required | Required |
| E2E tests | Critical paths | Full coverage | Full coverage + negative/abuse |
| SAST scan | Required | Required | Required |
| Dependency audit | Required | Required | Required |
| Access control testing | If applicable | Required | Required |
| Audit log testing | If applicable | Required | Required |
| Performance testing | Not required | If applicable | Required |
| Penetration testing | Not required | Not required | Consider |
| Independent review | Not required | Not required | Required |

---

## 3-Tier E2E Gating Model

Full E2E regression on every PR is expensive. DevAudit maps MoSCoW prioritisation onto three tiers, each gated at a different point in the workflow.

| Tier | Location | When it runs | Wall-clock target | Audit role | Blocking? |
|---|---|---|---|---|---|
| **smoke** | `e2e/smoke/*.spec.ts` | Every push to integration branch (via `ci.yml`) | ~3–5 min | Fast feedback on every change | Yes — stops integration hop |
| **critical** | `e2e/smoke/` + `e2e/critical/*.spec.ts` | Consumer-enabled PR to release branch | ~10–15 min | Release-readiness Must gate | Yes — stops release |
| **regression** | all `e2e/**/*.spec.ts` | `workflow_dispatch` and any consumer-configured post-merge or schedule | ~35 min | Full audit trail + drift catch | No — consumer-selected safety net |

**MoSCoW mapping:** Must-priority SRS items live in `e2e/smoke/` (fast feedback) and `e2e/critical/` (release gate). Should/Could items live in `e2e/` and are covered by the regression tier.

**Cost philosophy:** Smoke protects every push from breaking the headline flow. Critical protects enabled release gates from a Must-tier regression. Full regression protects the audit trail and catches drift when the consumer elects to run it. The framework does not impose a nightly run; the consumer chooses post-merge, scheduled, or manual-dispatch coverage for Should/Could-tier regression.

**Post-merge safety net:** When a consumer enables it, a post-merge full regression can auto-file a `bug, priority:high` issue. The operator triages: hotfix forward, revert, or accept-with-rationale. No automated revert: flakes and UAT-data drift require human judgment.

**Tier classification decision tree** (applied per scenario by the developer, guided by `e2e-test-engineer` skill Phase 3):

1. Does the spec prove a Must-priority SRS AC (or baseline "app is up" sanity)? → smoke or critical
2. Within Must: would a regression here break a headline business flow visible to a paying customer or stop a release? → critical. Otherwise → smoke
3. Should/Could priority, edge case, advanced flow? → regression (file under `e2e/<area>/`)
4. When undecided between critical and regression → default to regression (promoting later is cheap)

---

## Per-Commit CI Gates

Every push to the integration branch triggers the full CI pipeline. All gates run on both integration pushes and PRs to the release branch. Gate results are auto-uploaded to DevAudit (`environment=uat`).

| Gate | What it checks | Exit criteria |
|---|---|---|
| **TypeScript** | `npx tsc --noEmit` | 0 errors |
| **SAST (Semgrep)** | Source code vulnerability scan | 0 high/critical findings |
| **Dependency audit (SCA)** | `npm audit --audit-level=high` | 0 high/critical vulnerabilities |
| **E2E smoke** | Playwright `--project=smoke` | All pass |
| **Build** | `npm run build` | Succeeds |

**Additional CI workflows:**
- `compliance-validation.yml` — validates commit messages, RTM entries, release tickets, compliance artefact structure
- `check-release-approval.yml` — verifies DevAudit portal release approval status before PR merge
- `compliance-evidence.yml` — uploads evidence to portal, runs evidence-completeness gate
- `post-deploy-prod.yml` — production smoke after merge to release branch
- `close-out-release.yml` — moves release ticket to approved, reconciles RTM
- `e2e-regression.yml` — critical + regression tiers on PR-to-release and post-merge

**Gate outcome summarisation:** Runs unconditionally (even if an earlier gate failed) so the portal can render each gate's status correctly. Step outcomes mapped to `passed`/`failed`/`skipped` and sent as `gateStatus=` on each per-gate upload.

---

## Evidence-Completeness Gate

**Location:** `sdlc/files/ci/ci.yml.template`, `upload-evidence` job (lines 754–811)

**Purpose:** Prevent releases from reaching UAT with no traceable per-REQ evidence. Complements the skill-side prevention (Phase 5½) as the CI-side safety net.

**How it works:**

1. **Find in-scope REQs** — scan `compliance/pending-releases/RELEASE-TICKET-REQ-*.md` for pending release tickets. Skip REQs already in terminal release directories (`approved-releases/` or `superseded-releases/`).

2. **For each in-scope REQ with zero screenshots** — check if the Playwright JSON report (`e2e-results.json`) contains any tests tagged with the REQ:

   ```python
   # Counts tests where REQ-XXX appears in title, annotations, or tags
   TAGGED_COUNT = count_tests_tagged_with(REQ, e2e-results.json)
   ```

3. **If zero tagged tests** — fallback: scan spec files on disk:
   ```bash
   grep -rl --include='*.spec.ts' -e "@requirement REQ-XXX" -e "tagTest.*REQ-XXX" -e "'REQ-XXX'" e2e/
   ```

4. **Decision:**
   - Tagged tests > 0 → pass (screenshot gap is non-blocking)
   - Zero tagged tests + specs found on disk → **non-blocking warning** (specs exist but weren't run in this CI tier)
   - Zero tagged tests + zero screenshots + zero on-disk spec references → **hard error, exit 1** — release blocked

5. **After all REQs checked** — if `EVIDENCE_GAPS > 0`, step exits 1 with `::error::` message.

**Known limitation (DevAudit-Installer#237):** The gate only counts E2E evidence (Playwright tagged tests + screenshots). Unit test evidence is invisible. A REQ with thorough unit test coverage but no smoke-tier E2E specs gets falsely blocked. Proposed fix: also scan vitest files for `@requirement` refs, or count `test-execution-summary.md` as traceable evidence, or downgrade to warning when pending release ticket + non-smoke tier specs exist.

---

## Evidence Wiring Requirements

Before running the E2E suite, the `e2e-test-engineer` skill's Phase 5½ verifies three wiring requirements for each in-scope REQ:

### 1. `@requirement REQ-XXX` annotation

Every spec file covering an in-scope REQ must carry at least one `@requirement REQ-XXX` JSDoc annotation. This is what the CI gate's `detect-req` step and the portal's evidence-by-requirement view search for.

```typescript
/**
 * @requirement REQ-087 — per-item deduction tracking
 */
```

### 2. `evidenceShot()` calls

For each UI spec covering an in-scope REQ, at least one `evidenceShot(page, 'REQ-XXX', <ac>, 'slug')` call per AC. Must be placed **at the assertion that proves the AC**, before any further interaction or navigation.

```typescript
await expect(page.getByText('Success')).toBeVisible();
await evidenceShot(page, 'REQ-087', 1, 'deduction-success');
```

API-only/transport-layer specs that don't have a visual surface are exempt — note the exemption in `test-execution-summary.md`.

### 3. `tagTest()` calls

Every test covering an in-scope REQ must call `tagTest()` at the top of the test body:

```typescript
import { tagTest } from './helpers/test-tags';

test('over-sell scenario', async ({ page }) => {
  tagTest('REQ-087', 1);  // REQ-087, acceptance criterion 1
  // ... test body
});
```

This writes `test.info().annotations` — `{ type: 'req', description: 'REQ-087 AC1' }` — which the portal's `ReqApprovalCard` uses to join test results with screenshots by acceptance criteria. Without `tagTest()`, the portal shows "no tests in report tagged with this REQ" even though the test ran and passed.

For tests covering multiple ACs: `tagTest('REQ-087', [1, 2])`.

The helper is synced to `e2e/helpers/test-tags.ts` by `devaudit update`. Do not inline annotation logic.

**If any check fails:** halt and report the gap. Do not proceed to suite execution until all gaps are resolved. The user may skip an AC (e.g. API-only) — that's valid, but must be an explicit decision recorded in `test-execution-summary.md`, not an omission.

---

## AI-Assisted Development Testing

### Risk Profile

AI-generated code presents risks distinct from human-authored code:
- **Confident incorrectness** — plausible code with subtle logic errors
- **Hallucinated dependencies** — fabricated, outdated, or vulnerable packages
- **Non-determinism** — same prompt may produce different code
- **Training data contamination** — reproduction of insecure patterns
- **No inherent audit trail** — no default record of what was asked or generated

### Mandatory Controls

1. **Human review as formal compliance gate** — every AI-generated code piece reviewed by qualified human before entering test pipeline. Review logged with reviewer identity, date, scope.
2. **Automated security scanning on every commit** — same SAST + dependency gates as human code. Mandatory, not optional.
3. **Dependency verification** — all dependencies in AI-assisted changes verified as real, current, vulnerability-free.
4. **Regeneration triggers full retest** — full re-generation (not incremental) triggers full retest of component + dependents. Functional equivalence cannot be assumed.
5. **Documentation proportional to risk** — AI tool, prompts, outputs retained per risk level.

### AI Documentation Requirements

| Risk Level | Commit Tag | Evidence | Prompts |
|---|---|---|---|
| LOW | `Co-Authored-By` | Not required | Not required |
| MEDIUM | `Co-Authored-By` | Summary of generation | Summary of prompts |
| HIGH | `Co-Authored-By` | Detailed AI record | Detailed prompts and outputs |

### What AI May and May Not Generate

- **Permitted (with human review):** Application logic, UI components, test code, DB queries, migrations, documentation, configuration, utilities
- **Elevated review (senior + security):** Auth/authz logic, crypto, payment processing, data validation, API security middleware, schema changes affecting PII
- **Prohibited (must be human-authored):** Security credentials, production config values, compliance policy documents

### Accountability

The human who commits AI-generated code is accountable for its correctness, security, and compliance. The PR reviewer who approves it shares accountability. "The AI wrote it" is not an acceptable explanation.

---

## Security Testing

### Per-Commit Gates (Mandatory)

| Gate | What | Exit Criteria |
|---|---|---|
| SAST (Semgrep) | Source code vulnerability patterns | 0 high/critical |
| Dependency audit (SCA) | Known CVEs in direct + transitive deps | 0 high/critical |
| Type checking + linting | Type errors, unsafe patterns, code quality | 0 errors |

### Per-Release Security Activities

- **Access control testing** — RBAC across protected endpoints; unauthenticated requests rejected; role boundaries enforced. Required for releases touching auth/authz/API.
- **Audit log verification** — auditable actions produce log entries with timestamp, user identity, action, affected resource. Logs cannot be modified by application users.
- **Post-deploy security verification** — access control spot-check in production, security header verification, no debug info exposed.

### Periodic Security Activities

| Activity | Frequency |
|---|---|
| Full codebase SAST review | Quarterly |
| Dependency deep audit | Quarterly |
| Access control review | Quarterly |
| Audit log integrity review | Quarterly |
| Penetration testing (third party) | Annually |
| Disaster recovery test | Annually |
| Third-party security assessment | Annually |

### Remediation SLAs

| Severity | Per-Commit Gate | Periodic Finding |
|---|---|---|
| Critical | Block merge, fix immediately | 7 days |
| High | Block merge, fix immediately | 30 days |
| Medium | Document and plan remediation | 90 days |
| Low | Track for next review | Next quarterly review |

---

## Defect Management

### Severity Classification

- **Critical** — System unusable, data loss, security breach. Fix immediately.
- **Major** — Major feature broken, no workaround. Fix within sprint.
- **Minor** — Minor issue, workaround exists. Prioritize in backlog.

### Lifecycle

1. **Detection** — test failure or manual report
2. **Triage** — severity and priority assigned
3. **Fix** — developer creates branch linked to issue
4. **Verification** — QA validates fix
5. **Closure** — evidence recorded, audit trail complete
6. **Traceability** — commit references issue ID

### Incident Filing Convention

Defects filed with `incident` label + `### Framework attribution` section. On close, `incident-export.yml` fires → `incident_report` evidence lands on portal → `ISO29119.3.5.4` flips to COVERED.

If no incidents were closed during a REQ's lifecycle and the test pack passes: generate a nil incident report from template, fill scope, leave sign-off for operator.

---

## Requirements Traceability

### Approach

Every requirement must be traceable through the complete chain:

```
Requirement (REQ-XXX in RTM)
  → Test Cases (test-scope.md, test-plan.md)
    → Test Results (CI logs, Playwright reports, coverage)
      → Code Commits (Ref: REQ-XXX trailers)
        → PR Review (four-eyes, recorded identity + timestamp)
          → Deployment (merge commit, post-deploy smoke)
```

### Implementation

- Requirements tracked with unique REQ-XXX IDs in `compliance/RTM.md`
- Test specifications tagged with `@requirement REQ-XXX` + `tagTest('REQ-XXX', ac)`
- Commit messages reference requirement IDs: `Ref: REQ-XXX`
- Pull requests link commits to requirements in PR body
- Test results linked to requirement IDs via portal uploads
- RTM maintained per project with status progression: `DRAFT → IMPLEMENTED → TESTED - PENDING SIGN-OFF → RELEASED`

### Audit Readiness

- Vertical slice capability: trace any code change to its requirement and risk assessment
- Complete linkage chain preserved permanently in Git history
- Historical evidence accessible for all past releases via tags and archives
- All artefacts retained minimum 3 years
- Audit-ready retrieval within 24 hours

### Agile Artifact Mapping

| ISO Artefact | DevAudit Implementation |
|---|---|
| Test Policy | Policy + Strategy + Architecture document hierarchy |
| Requirements Specification | Product backlog with acceptance criteria + SRS |
| Test Plan | Project-specific Test Plan + sprint planning |
| Test Case Specification | BDD feature files (Gherkin Given/When/Then) |
| Test Execution Log | CI/CD pipeline logs, test management tool records |
| Defect Reports | Issue tracker with severity labels and workflows |
| Traceability Matrix | RTM (`compliance/RTM.md`) |
| Security Evidence | SAST/SCA results, dependency audits, security summaries |
| AI Audit Trail | `Co-Authored-By` tags, evidence directory records, PR history |

---

## Enforcement Mechanisms

### Pre-commit / Pre-push Hooks

- **Commit message validation** — Conventional Commits format enforced; `Ref: REQ-XXX` required for tracked requirements
- **E2E gate sentinel** — `.e2e-gate-passed` file required if UI-facing files touched; pre-push hook checks for sentinel
- **SDLC phase sentinel** — `node SDLC/bin/devaudit-sdlc.js --phase=2` generates a commit sentinel file before any file modifications; without it, local git commits are blocked

### CI Enforcement

- **Branch protection** — release branch (`main`) requires PR approvals, all status checks pass, no direct pushes
- **Compliance validation** — `validate-compliance-artifacts.sh` checks RTM entries, release tickets, evidence directory structure
- **Commit validation** — `validate-commits.sh` checks commit message format, REQ-XXX references, provenance stamps
- **Release approval gate** — `check-release-approval.yml` verifies portal UAT approval before PR merge
- **Evidence-completeness gate** — hard error if in-scope REQ has zero traceable evidence

### Skill-Level Enforcement

- **E2E delegation gate** — `sdlc-implementer` structurally prohibited from authoring `e2e/**/*.spec.ts`; must delegate to `e2e-test-engineer`
- **E2E self-audit** — before Stage 3, walk every E2E spec in diff and state authoring provenance
- **Gate failure iteration limit** — N=3 attempts max; then halt with resume instructions
- **No bypasses** — `--no-verify`, `eslint-disable`, `@ts-expect-error`, `xfail` all prohibited
- **Plan ↔ test-scope consistency** — AC IDs must match between implementation plan and test scope
- **Auto-continue** — after integration PR merges, auto-continue to Stage 3 (not a checkpoint); the next operator handoff is Stage 4 (release PR)

### Four-Eyes Principle

- LOW risk → self-merge permitted after CI passes
- MEDIUM/HIGH → second human reviewer required, self-merge blocked
- PR approval constitutes formal sign-off for compliance purposes
- Reviewer identity and timestamp recorded immutably

---

## Compliance Framework Mapping

DevAudit's test process satisfies multiple compliance frameworks simultaneously — one gate, multiple frameworks.

| Framework | How DevAudit Satisfies It |
|---|---|
| **ISO/IEC 29119-3** | Test Policy + Strategy + Architecture document hierarchy; per-REQ test plans; test execution logs; defect reports; traceability matrix |
| **ISO 27001** | Per-commit SAST + SCA gates; access control testing; audit log verification; periodic security reviews; remediation SLAs |
| **SOC 2** | Four-eyes PR review; branch protection; immutable audit trail; evidence retention; change control process |
| **GDPR** | PII handling in HIGH risk classification; DPIA templates; ROPA templates; incident report templates (Art. 33-34) |
| **EU AI Act** | AI use documentation; AI disclosure templates; risk classification elevation for AI involvement; prohibited AI generation categories |

The framework produces evidence as a byproduct of the development workflow — compliance is not a separate project but an emergent property of following the process.
