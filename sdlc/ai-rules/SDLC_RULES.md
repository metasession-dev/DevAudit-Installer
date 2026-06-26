# SDLC Compliance Rules for AI Assistants

These rules enforce the Metasession SDLC process. They MUST be followed for every code change. These rules OVERRIDE default behaviour.

## SDLC Workflow Files

This project contains detailed SDLC workflow files in its `SDLC/` directory (copied from DevAudit during project setup). **You MUST read the relevant workflow file before executing each stage.** The summaries in this document are not a substitute for the full workflow — they are guardrails. The workflow files contain exact commands, templates, checklists, and edge cases.

| Stage | File to read | When |
|-------|-------------|------|
| 0 | `SDLC/0-project-setup.md` | One-time project initialisation |
| 1 | `SDLC/1-plan-requirement.md` | Before implementing any tracked change |
| 2 | `SDLC/2-implement-and-test.md` | During coding and testing |
| 3 | `SDLC/3-compile-evidence.md` | After implementation, before PR |
| 4 | `SDLC/4-submit-for-review.md` | Creating the PR to main |
| 5 | `SDLC/5-deploy-main.md` | After PR approval, deploying |

Tier 1 reference docs (Test_Policy.md, Test_Strategy.md, Test_Architecture.md, Periodic_Security_Review_Schedule.md) may also be in `SDLC/` or in the DevAudit repository.

## CRITICAL: `sdlc-implementer` prompt before implementation (devaudit-installer#199)

When the user requests implementation of an issue (e.g. "implement issue #N", "fix issue #N", "do issue #N", "implement #N"), you MUST prompt before writing any code:

> Implementing #N using sdlc-implementer, can I proceed?

Wait for the user's yes/no response. Do NOT begin implementation until they answer.

- **YES** → route to your platform's orchestration path:
  - **Claude Code:** invoke the `sdlc-implementer` skill immediately via `Skill(name: "sdlc-implementer", …)`. The skill drives Phase 0 (triage) through Phase 4 (PR + UAT review).
  - **Other agents (Cursor, Windsurf, Gemini, etc.):** proceed with the SDLC workflow manually, following the stage docs in `SDLC/`. **You MUST first create the commit sentinel:** `touch .sdlc-implementer-invoked` — without this file, the `commit-msg` and `pre-push` hooks will reject `feat`/`fix`/`refactor`/`perf` commits.
- **NO** → proceed with manual implementation outside the SDLC workflow. The user has explicitly opted out; respect their choice and do not ask again for the same issue.

This prompt is **mandatory and structural** — it is not advisory. Skipping the prompt and jumping straight into code is the same class of inertia-trap bug as #132 (e2e delegation bypass).

The only exception: if the user's request is clearly housekeeping ("bump a dep", "fix a typo", "update docs") and does not involve `feat`/`fix`/`refactor`/`perf` commit types, skip the prompt and proceed directly.

### Anti-pattern: manually walking through SDLC stages instead of invoking the skill

The most common failure mode is **prompting (or being told to use the skill) and then manually reading the SDLC workflow files and walking through the steps yourself** instead of invoking the `sdlc-implementer` skill. The skill exists to orchestrate this. Manually reading `SDLC/1-plan-requirement.md`, `SDLC/2-implement-and-test.md`, etc. and executing their steps by hand is the exact failure mode this rule exists to prevent.

**Self-check — if you find yourself doing any of these, STOP:**
- Reading `SDLC/1-plan-requirement.md` directly instead of invoking the skill
- Manually classifying risk, writing an implementation plan, or updating the RTM by hand instead of letting the skill drive it
- Walking through Stage 1 → Stage 2 → Stage 3 sequentially by reading each workflow file
- Saying "let me read the SDLC workflow files" or "let me follow the SDLC process" without invoking the skill

**When you catch yourself:** Stop immediately and route to your platform's orchestration path:
- **Claude Code:** Invoke the skill with `Skill(name: "sdlc-implementer", …)`. The skill will re-read state and resume correctly.
- **Other agents (Cursor, Windsurf, Gemini, etc.):** Ensure you have operator authorization and have created the commit sentinel (`touch .sdlc-implementer-invoked`). Then follow the stage docs step by step, pausing at each gate for operator confirmation.

## Driver clarity — always state who is driving (devaudit-installer#199)

The operator must be able to tell at a glance whether they need to act or whether the agent is handling it. **Every substantive response during SDLC work MUST open with a driver tag** on the first line, before any other content:

- **`[Agent driving]`** — the agent is auto-continuing; no human action needed right now. The operator can look away.
- **`[Operator driving]`** — the agent has halted; the human must do something (review, approve, merge, answer a question). State the specific action needed.
- **`[Blocked]`** — something failed and the agent cannot proceed. State the blocker and the operator action needed to unblock.

Rules:
- The tag is the **first thing** in the response — no preamble, no acknowledgement, no "Great question" before it.
- If the driver changes mid-response (e.g. the agent was driving, hits a gate failure, and halts), the tag at the top of the response reflects the **final** state. If the agent stops mid-work, the tag is `[Operator driving]` or `[Blocked]`.
- The tag is mandatory for any response that does work, reports status, or hands off. Skip it only for pure chitchat or one-word confirmations.
- The tag works alongside the LAST/NEXT sticky convention — the tag says *who* is driving right now; the sticky says *what* just happened and *what* is next.

**Why this exists:** Without an explicit driver tag, the operator cannot distinguish "the agent is working and I can wait" from "the agent stopped and I need to act" without reading the entire response. That ambiguity is the root cause of both false-waits (operator thinks the agent is working when it has halted) and false-stops (operator thinks they need to act when the agent is auto-continuing).

---

## CRITICAL: Before Writing Any Code

Before implementing ANY change (feature, fix, refactor, or enhancement), you MUST complete these checks:

### 1. Identify the GitHub Issue

Ask the user: **"Which GitHub Issue is this for?"**

- If the user provides an issue number (e.g., `#123`): fetch it with `gh issue view 123` to get context, labels, and description.
- If the user describes work without an issue: ask **"Is there a GitHub Issue for this, or should we create one?"** Create one with `gh issue create` if needed.
- If the user says it's trivial (typo, formatting, dependency bump): proceed without an issue or requirement, but still use conventional commit format.

### Creating GitHub Issues

When creating an issue via `gh issue create`, ALWAYS append the SDLC checklist to the body:

```
## SDLC Checklist
- [ ] Requirement: RTM entry created (or confirmed trivial)
- [ ] Planning: test-scope.md and test-plan.md created (or confirmed trivial)
- [ ] Tests: existing tests reviewed, tests updated/added
- [ ] Gates: all pass locally (tsc, semgrep, audit, playwright)
- [ ] Evidence: compiled and uploaded (if tracked requirement)
```

### 2. Determine if this change needs a requirement

**What needs a REQ entry:**
- New features → always
- Bug fixes affecting financial data, user-facing behaviour, access control → always
- Bug fixes to internal logic → only if MEDIUM/HIGH risk
- Typos, formatting, dependency bumps → never

- If the issue is non-trivial: it needs a requirement.
- If a REQ-XXX already exists for this issue: verify it exists in `compliance/RTM.md` before proceeding.
- If no requirement exists yet: **STOP coding and run the planning workflow first** (see "Planning a Requirement" below).
- If the user is unsure: assume it needs a requirement if it touches security, auth, payments, user-facing features, API changes, or data handling. Use issue labels to help classify.

### For ALL Code Changes (including bug fixes)

Even if a change doesn't need a REQ entry:
1. **Review existing tests** that cover the changed code
2. **Update or add tests BEFORE committing** the fix
3. **Run all gates locally** — do not push without verifying no regressions
4. If the change affects financial calculations, user-facing data, or access control — it needs a REQ entry regardless of size

### 3. Verify the requirement is planned

Before writing code for a tracked requirement, run these checks:

```bash
ls compliance/evidence/REQ-XXX/test-scope.md
ls compliance/evidence/REQ-XXX/test-plan.md
grep 'REQ-XXX' compliance/RTM.md
```

ALL must exist. If any are missing, **STOP** and tell the user: **"REQ-XXX hasn't been fully planned yet. test-scope.md and test-plan.md must both exist before implementation. Let's complete the planning step first."** Then follow "Planning a Requirement" below.

For MEDIUM/HIGH risk, also verify:
```bash
ls compliance/evidence/REQ-XXX/implementation-plan.md
```

### 4. Verify you're on the correct branch

```bash
git branch --show-current
```

All implementation work MUST happen on `develop`. If on a different branch, ask the user before switching.

---

## Planning a Requirement

When a new requirement is needed, guide the user through these steps. Do NOT skip any.

### Step 1: Confirm the GitHub Issue

If not already identified in the pre-coding checks:

```bash
gh issue view NNN
```

If no issue exists, create one:

```bash
gh issue create --title "[title]" --body "[description]" --label "[labels]"
```

Use the issue title, description, and labels to inform the requirement description and risk classification below.

### Step 2: Get the next requirement ID

```bash
grep -oP 'REQ-\d+' compliance/RTM.md | sort -t- -k2 -n | tail -1
```

The next ID is one higher.

### Step 3: Classify risk

Ask the user to classify risk, using issue labels as a starting point:

| Risk | Criteria |
|------|----------|
| LOW | Internal tools, no regulated data, no auth changes |
| MEDIUM | Touches PII, user-facing features, API changes, new dependencies |
| HIGH | Security, payments, RBAC, data handling, authentication |

Tell the user: **"If AI is generating code for MEDIUM or HIGH risk areas, the risk level is raised by one level."**

### Step 4: Add RTM entry

Add to `compliance/RTM.md` Part B. The issue provides full context; the RTM is a traceability index.

```markdown
| REQ-XXX | #NNN | [LOW/MEDIUM/HIGH] | compliance/evidence/REQ-XXX/ | DRAFT | -- | -- |
```

### Step 5: Create evidence directory

```bash
mkdir -p compliance/evidence/REQ-XXX
```

### Step 6: Implementation Plan (MEDIUM/HIGH Risk)

For MEDIUM and HIGH risk requirements, create an implementation plan **before** test scope. The implementation plan defines what code changes are needed — the test scope is then derived from it.

**Skip this for LOW risk** — proceed directly to Step 7.

1. Explore the codebase to understand existing patterns relevant to the change
2. Create `compliance/evidence/REQ-XXX/implementation-plan.md` with:
   - Approach (1-3 sentences)
   - Files to create and modify (with purpose)
   - Architecture decisions and rationale
   - Dependencies (new packages or "None")
   - Risks / considerations
3. **WAIT CHECKPOINT:** Present the implementation plan to the developer. Do NOT proceed until the developer explicitly approves. If changes are requested, update the plan and re-present.
4. Commit the plan

Tell the user: **"This is MEDIUM/HIGH risk. Let me create an implementation plan before we define the test scope."**

### Step 7: Create Test Scope

Create `compliance/evidence/REQ-XXX/test-scope.md` with acceptance criteria based on risk level. For MEDIUM/HIGH risk, derive the test scope from the implementation plan — you now know what code is changing and can define what tests are needed.

Ask the user what the acceptance criteria are.

### WAIT CHECKPOINT — Test Scope Review

**Present the test scope to the developer.** Summarize the risk classification, test approach, and acceptance criteria.

**Do NOT proceed** until the developer confirms the test scope is complete and correct. If changes are requested, update `test-scope.md` and re-present.

### Step 8: Create Test Plan

Create `compliance/evidence/REQ-XXX/test-plan.md` — maps acceptance criteria to specific tests, lists tests to add/update/remove, covers functional and non-functional testing. Proportional to risk level.

**Distinguish test types by phase:**
- **Unit tests** (TDD — written before implementation): list under "Tests to Add" with note "(unit, TDD)"
- **E2E tests** (written after implementation): list under "Tests to Add" with note "(E2E, post-implementation)"

Tell the user: **"Let me create a test plan that maps the acceptance criteria to specific tests."**

### WAIT CHECKPOINT — Test Plan Review

**Present the test plan to the developer.** Summarize tests to add, update, remove, and how criteria map to tests.

**Do NOT proceed** until the developer confirms the test plan. If changes are requested, update `test-plan.md` and re-present.

### Step 9: Document AI involvement (if applicable)

Create `compliance/evidence/REQ-XXX/ai-use-note.md` with YAML frontmatter (devaudit-installer#197):

```markdown
---
ai_contributors:
  - tool: "[tool name]"
    version: "[tool version]"
    session_id: "[session id]"
    date_range: "[YYYY-MM-DD to YYYY-MM-DD]"
    commits: []
---

# AI Use Record — REQ-XXX

Risk Classification Impact: [original risk] → [adjusted risk if AI involved]
Areas of AI involvement: [list]
```

### Step 10: Commit the plan

```bash
git add compliance/RTM.md compliance/evidence/REQ-XXX/
git commit -m "compliance: [REQ-XXX] define requirement and test scope - [description]

Ref: REQ-XXX

Co-Authored-By: [AI tool tag]"
```

**Only after this commit should implementation begin.**

```bash
git add compliance/evidence/REQ-XXX/implementation-plan.md
git commit -m "chore(compliance): [REQ-XXX] implementation plan

Ref: REQ-XXX

Co-Authored-By: [AI tool tag]"
```

---

## During Implementation

### Commit format

Every commit MUST follow this format:

```
type(scope): description

- Key change 1
- Key change 2

Ref: REQ-XXX

Co-Authored-By: [AI tool] <noreply@provider.com>
```

- `type`: feat, fix, refactor, test, docs, compliance
- `Ref: REQ-XXX` is REQUIRED for tracked changes
- `Co-Authored-By` is REQUIRED when AI generates code

### JSDoc headers

Every new or significantly modified file must include:

```typescript
/**
 * @requirement REQ-XXX - Brief description
 */
```

### AI-generated code logging

When generating code for MEDIUM or HIGH risk requirements, append to `compliance/evidence/REQ-XXX/ai-prompts.md`:

```markdown
## [Date]
Prompt: [summary of what was asked]
Files: [list of files generated/modified]
Regenerated: [yes/no — if yes, full retest required]
```

**MEDIUM/HIGH risk checkpoint:** Before committing AI-generated code, verify `ai-prompts.md` has been updated. This is a required artifact — if missing, create it before staging.

### Test review and update

Before staging changes, review the test suite to ensure it covers the implementation:

1. **Follow the test plan:** Check `compliance/evidence/REQ-XXX/test-plan.md` — add, update, and remove tests as documented.
2. **Write new tests:** New pages need route protection tests. New API endpoints need auth enforcement tests. New user flows need E2E tests. New business logic needs unit tests.
3. **Verify test plan coverage:** Are all items in the test plan implemented? Do all acceptance criteria have a corresponding test?

Tell the user: **"Before staging, let me review the test suite to make sure it covers the changes we just made."**

Gates must run against a test suite that actually covers the new code. A green gate on an unchanged test suite is a false signal.

---

## Before Pushing Code

Before pushing to `develop`, ALL of these gates must pass:

```bash
# TypeScript — 0 errors required
npx tsc --noEmit

# SAST — 0 high/critical findings required
semgrep scan --config auto src/ --severity ERROR --severity WARNING

# Dependency audit — 0 high/critical vulnerabilities required
npm audit --audit-level=high

# E2E tests — all must pass
npx playwright test
```

If any gate fails, fix the issue before pushing. Do NOT use `--no-verify` to skip hooks.

Tell the user: **"All four compliance gates must pass before pushing. Let me run them."**

### Verify test plan tests are written and passing

For tracked requirements, before pushing verify that every test listed in `test-plan.md` has been implemented:

```bash
# Check that test files referenced in the test plan exist
grep -oP '(?:__tests__/|tests?/|e2e/|spec/|\.test\.|\.spec\.)\S+' compliance/evidence/REQ-XXX/test-plan.md
```

For each test file referenced in `test-plan.md`:
1. Verify the file exists in the working tree
2. Verify the tests pass (covered by the gate commands above)

If `test-plan.md` lists tests that haven't been written yet, **STOP** — write and run the tests before pushing. A green gate on an unchanged test suite is a false signal.

Tell the user: **"Before pushing, let me verify that all tests from the test plan have been written and are passing."**

### After Pushing: WAIT CHECKPOINT — Confirm CI Green

After pushing to `develop`, wait for CI to complete:

```bash
gh run list --branch develop --limit 1
```

**Do NOT proceed** to evidence compilation or PR creation until CI is green. If CI fails, diagnose, fix locally, re-run gates, and push again.

---

## After Implementation is Complete

When the user says implementation is done, or when all acceptance criteria from test-scope.md are met, guide them through evidence compilation:

### Step 1: Verify all gates pass (run them again)

### Step 1a: Generate test execution summary

After gates pass, create `compliance/evidence/REQ-XXX/test-execution-summary.md` documenting gate results, test changes, and coverage against the test plan. Include links to evidence locations in DevAudit.

Tell the user: **"All gates passed. Let me generate the test execution summary."**

### Step 2: Upload binary/JSON evidence to DevAudit

**Markdown stays in git. Binary and JSON evidence goes to DevAudit.**

Upload these to DevAudit (NEVER commit to git):
- E2E results (JSON)
- Screenshots (PNG/JPG)
- SAST results (JSON)
- Dependency audit results (JSON)
- Unit test output (TXT)
- Test reports (HTML)

```bash
# Upload E2E results
./scripts/upload-evidence.sh [PROJECT_SLUG] REQ-XXX e2e_result /tmp/e2e-results.json

# Upload SAST results
semgrep scan --config auto src/ --json > /tmp/sast-results.json
./scripts/upload-evidence.sh [PROJECT_SLUG] REQ-XXX audit_log /tmp/sast-results.json

# Upload dependency audit
npm audit --json > /tmp/dependency-audit.json
./scripts/upload-evidence.sh [PROJECT_SLUG] REQ-XXX audit_log /tmp/dependency-audit.json

# Upload unit test output
npm test -- --verbose 2>&1 | tee /tmp/unit-test-results.txt
./scripts/upload-evidence.sh [PROJECT_SLUG] REQ-XXX test_report /tmp/unit-test-results.txt
```

The upload script is from the DevAudit repository at `scripts/upload-evidence.sh`.

### Step 3: Create markdown evidence in git

These stay in git (small, reviewable, need version history):

Create `compliance/evidence/REQ-XXX/security-summary.md`:

```markdown
SAST scan: 0 findings
Dependency audit: 0 vulnerabilities
Evidence uploaded to DevAudit project: [PROJECT_SLUG]
```

Verify these also exist in git:
- `compliance/evidence/REQ-XXX/test-scope.md` (from planning)
- `compliance/evidence/REQ-XXX/implementation-plan.md` (MEDIUM/HIGH risk — from implementation plan step)
- `compliance/evidence/REQ-XXX/ai-use-note.md` (if AI was used — YAML frontmatter, devaudit-installer#197)
- `compliance/evidence/REQ-XXX/ai-agent-handoff.md` (if AI agent changed mid-implementation — devaudit-installer#197)
- `compliance/evidence/REQ-XXX/ai-prompts.md` (if AI was used, MEDIUM/HIGH risk)

### Step 4: Update RTM status

Change the requirement status from `DRAFT` or `IN PROGRESS` to `TESTED - PENDING SIGN-OFF` in `compliance/RTM.md`.

### Step 5: Create release ticket

Create `compliance/pending-releases/RELEASE-TICKET-REQ-XXX.md` with:
- Summary of changes
- AI Contributors table (tool, version, session, commits, date range) — devaudit-installer#197
- AI handoffs (if any — reference `ai-agent-handoff.md`)
- Test changes (which test files were added/modified, what they cover, any gaps)
- Test evidence table (reference DevAudit portal for binary evidence)
- Security evidence (reference `security-summary.md` in git)
- Post-deploy actions (data migrations, backfill scripts, or "None required")
- Audit trail

When creating the PR, include:
- A **"Test Changes"** section listing test files added/modified, what they cover, and what's NOT covered
- A **"Where to Find Test Results"** section pointing reviewers to: CI status icons on commits, automated E2E comment, DevAudit portal link, and compliance evidence files in the PR

### Step 6: Commit compliance markdown only (do NOT push yet)

Commit locally but **do not push**. UAT verification runs against the prior deployment. We batch all compliance + UAT commits into a single push after Step 7 to avoid duplicate CI runs.

```bash
# ONLY commit markdown — binary/JSON evidence is in DevAudit
git add compliance/RTM.md \
  compliance/pending-releases/RELEASE-TICKET-REQ-XXX.md \
  compliance/evidence/REQ-XXX/test-scope.md \
  compliance/evidence/REQ-XXX/test-plan.md \
  compliance/evidence/REQ-XXX/implementation-plan.md \
  compliance/evidence/REQ-XXX/test-execution-summary.md \
  compliance/evidence/REQ-XXX/security-summary.md \
  compliance/evidence/REQ-XXX/ai-use-note.md \
  compliance/evidence/REQ-XXX/ai-prompts.md
git commit -m "compliance: [REQ-XXX] evidence compiled - awaiting review

Ref: REQ-XXX

Co-Authored-By: [AI tool tag]"
```

**NEVER `git add` JSON, TXT, HTML, PNG, or JPG evidence files. They belong in DevAudit.**

### Step 7: WAIT CHECKPOINT — UAT Verification (if UAT configured)

If the project has a UAT environment that auto-deploys from `develop`, verify the change works on UAT before creating a PR.

**First, confirm both CI and deployment are complete:**

```bash
gh run list --branch develop --limit 1    # CI must be green
curl -s [UAT_URL]/[HEALTH_ENDPOINT]       # Deployment must be live
```

**Do NOT test against a stale deployment.** Then:

1. Wait for UAT deployment to complete
2. Run health check against UAT URL
3. Run smoke test (homepage, key endpoint)
4. Manually verify the specific feature/fix works on UAT
5. Record results in `compliance/evidence/REQ-XXX/security-summary.md`

```bash
cat >> compliance/evidence/REQ-XXX/security-summary.md << EOF

## UAT Verification — $(date -I)
- UAT Health check: PASS
- UAT Smoke test: PASS
- Feature verification: PASS — [what was verified]
- UAT URL: [UAT_URL]
EOF

git add compliance/evidence/REQ-XXX/security-summary.md
git commit -m "compliance: [REQ-XXX] UAT verification passed

Ref: REQ-XXX

Co-Authored-By: [AI tool tag]"
```

**If UAT fails:** Fix on `develop`, re-run local gates, push, and repeat. Do NOT create a PR until UAT is green.

### Step 8: Push all compliance commits

Push all batched commits (evidence + UAT results) in a single push. This triggers one CI run instead of multiple.

```bash
git push origin develop
```

Tell the user: **"UAT verification passed. Compliance commits pushed. Next step: create a PR from develop to main."**

### Step 9: Verify release exists in DevAudit

CI auto-creates releases when uploading evidence (using `--create-release-if-missing`). After pushing, verify the release appears in DevAudit:

1. Navigate to the project's Releases page in DevAudit
2. Confirm a release exists with the current version (date-based: `v{YYYY}.{MM}.{DD}` or `v{YYYY}.{MM}.{DD}.{N}` for multiple releases on the same day)
3. Confirm evidence is linked to the release (not orphaned)

If no release exists, CI may not have the `upload-evidence` job configured. See `SDLC/3-compile-evidence.md` CI Integration section.

### Step 10: Tell the user what's next

**"Evidence is compiled. Markdown artifacts are in git, binary evidence is in DevAudit. Release created and evidence linked. UAT verified. Next step: create a PR from develop to main using the submit-for-review workflow."**

---

## After Deployment: Close the GitHub Issue

After the PR is merged, production is verified, and compliance artifacts are finalized, close the GitHub Issue:

```bash
gh issue close [ISSUE-NUMBER] --comment "Implemented in PR #[PR-NUMBER] (REQ-XXX). [Brief summary]."
```

This completes the traceability chain: **Issue → Requirement → PR → Deployment → Issue closed.**

Tell the user: **"REQ-XXX is complete. Let me close the GitHub Issue."**

---

## Review Policy (Risk-Tiered)

Review requirements are determined by the risk classification in the RTM:

- **LOW risk:** CI provides independent verification. Self-merge is permitted after all CI checks pass.
- **MEDIUM/HIGH risk:** A second human reviewer MUST approve before merge. Self-merge is NOT permitted.

When creating a PR, check the risk level of the requirement(s) included. If any requirement is MEDIUM or HIGH, the entire PR requires a second reviewer. This satisfies separation of duties requirements (ISO 27001 A.5.3, SOC 2 CC6.1/CC8.1) where they apply, while avoiding unnecessary bottlenecks on low-risk changes.

Tell the user: **"This PR includes [RISK LEVEL] requirements. [A second reviewer is required / Self-merge is permitted after CI passes]."**

## Pre-Flight Checklist (Before Creating PR)

**Do NOT create the PR until ready to merge.** Every push to `develop` while a PR is open triggers duplicate CI runs (quality gates + UAT approval check). The PR is the merge request, not the development workspace. Develop on `develop`, iterate until ready, then create the PR as the final step before merge.

Before creating a PR from `develop` to `main`, verify ALL of the following:

**Pipeline state:**
- [ ] All development and iteration is complete
- [ ] Latest CI run on `develop` is green (not stale, not cancelled)
- [ ] Working tree is clean
- [ ] UAT verification passed (if configured)
- [ ] DevAudit UAT approval granted

**For tracked requirements (REQ-XXX):**
- [ ] `compliance/evidence/REQ-XXX/test-scope.md` exists and all items addressed
- [ ] `compliance/evidence/REQ-XXX/implementation-plan.md` exists (MEDIUM/HIGH risk)
- [ ] `compliance/evidence/REQ-XXX/ai-prompts.md` exists (MEDIUM/HIGH risk with AI)
- [ ] RTM status is `TESTED - PENDING SIGN-OFF`
- [ ] Release ticket exists in `compliance/pending-releases/`
- [ ] Evidence uploaded to DevAudit

If any item fails, resolve it before proceeding.

---

## Enforcement Layers

The SDLC is enforced at three levels:

| Layer | Mechanism | What It Catches |
|-------|-----------|-----------------|
| **Local hooks** | Husky + commitlint (commit-msg, pre-commit, pre-push) | Commit format, lint errors, TypeScript errors before push |
| **AI enforcement** | These rules + WAIT checkpoints in workflow files | Process sequencing, artifact existence, planning before coding |
| **CI hard gates** | GitHub Actions required status checks | TypeScript, SAST, dependencies, E2E, compliance artifact validation, commit conventions |

Local hooks and AI enforcement are the first line of defense. CI is the backstop — if something slips through locally, CI catches it on the PR.

---

## Rules You Must NEVER Break

1. **NEVER implement a tracked change without a GitHub Issue and requirement entry in RTM.md** — issue first, plan second, code third.
2. **NEVER commit without running all four gates** (TypeScript, SAST, dependency audit, E2E).
3. **NEVER self-merge a MEDIUM or HIGH risk PR** — a second human reviewer MUST approve before merge.
4. **NEVER use `--no-verify`** to skip git hooks.
5. **NEVER commit secrets** (.env, credentials, API keys) — warn the user if you detect them staged.
6. **NEVER create a PR to `main` without UAT verification passing first** (if UAT environment is configured).
7. **NEVER push directly to `main`** — all changes go through `develop` → PR → `main`.
8. **NEVER skip the `Co-Authored-By` tag** when AI generates code.
9. **NEVER amend published commits** — create new commits to preserve audit trail.
10. **NEVER commit binary or JSON evidence to git** (JSON, TXT, HTML, PNG, JPG) — upload to DevAudit portal instead.
11. **ALWAYS ask which GitHub Issue a change is for** before writing code.
12. **ALWAYS create evidence artifacts** before marking work as complete.
13. **ALWAYS use merge commits** (not squash) for `develop` → `main` to preserve audit history.
14. **ALWAYS commit compliance markdown to git** (RTM, test-scope, implementation-plan, security-summary, ai-use-note, release tickets).
