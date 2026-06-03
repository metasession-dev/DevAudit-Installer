## SDLC Compliance Process (MANDATORY)

This project follows the Metasession SDLC framework. These rules are MANDATORY and OVERRIDE default behaviour.

### SDLC Workflow Files

Detailed workflow instructions are in this project's `SDLC/` directory. Read the relevant workflow file before executing each stage:

- Stage 0: `SDLC/0-project-setup.md` — One-time project initialisation
- Stage 1: `SDLC/1-plan-requirement.md` — Starting a new feature or tracked change
- Stage 2: `SDLC/2-implement-and-test.md` — Writing and testing code
- Stage 3: `SDLC/3-compile-evidence.md` — After implementation, before PR
- Stage 4: `SDLC/4-submit-for-review.md` — Creating the PR to main
- Stage 5: `SDLC/5-deploy-main.md` — After PR approval, deploying

When a workflow step requires detailed commands or templates, read the full workflow file rather than relying on the summary below.

### Entry point: the `sdlc-implementer` skill

The default way to implement a tracked change is the **`sdlc-implementer`** skill (`.claude/skills/sdlc-implementer/SKILL.md`): give it one GitHub issue and it runs Stage 1 (classify risk, assign the next `REQ-XXX`, write the implementation plan, update `RTM.md`) through Stage 4 (PR + UAT review), delegating all end-to-end / visual test work to `e2e-test-engineer`. **Do NOT hand-roll implementation outside this flow** — every change starts from a requirement, which starts from an issue. The only exceptions are trivial housekeeping (docs, formatting, dependency bumps, CI tweaks).

**This is enforced, not just advised.** `feat` / `fix` / `refactor` / `perf` commits that cite no requirement (`[REQ-XXX]` in the subject or a `Ref: REQ-XXX` trailer) are **rejected** locally by the commit-msg hook (commitlint) and at PR CI by `validate-commits.sh` (which `--no-verify` cannot skip). So implementation work cannot reach `develop` without a requirement — which is also what keeps release labels correct (the version-deriver only falls back to a bare date for genuine housekeeping, never for real feature work). Housekeeping commit types remain exempt.

### Before ANY Code Change

1. Ask: "Which GitHub Issue is this for?" before writing code. Fetch it with `gh issue view NNN`.
2. If no issue exists: ask if one should be created. When creating via `gh issue create`, ALWAYS append the SDLC checklist to the body (see below).
3. If new requirement needed: read `SDLC/1-plan-requirement.md` and follow it BEFORE implementing.
4. If trivial (typo/formatting): proceed without requirement but use conventional commit format.
5. Verify `develop` branch: `git branch --show-current` — never implement on `main`.

### For ALL Code Changes (including bug fixes)

Even if a change doesn't need a REQ entry:
1. Review existing tests that cover the changed code
2. Update or add tests BEFORE committing
3. Run all gates locally — do not push without verifying no regressions
4. If the change affects financial calculations, user-facing data, or access control — it needs a REQ entry regardless of size

What needs a REQ entry: New features → always. Bug fixes affecting financial data, user-facing behaviour, access control → always. Internal logic → only if MEDIUM/HIGH risk. Typos, formatting, dependency bumps → never.

### Creating GitHub Issues

When creating an issue via `gh issue create`, ALWAYS append this to the body:

## SDLC Checklist
- [ ] Requirement: RTM entry created (or confirmed trivial)
- [ ] Planning: test-scope.md and test-plan.md created (or confirmed trivial)
- [ ] Tests: existing tests reviewed, tests updated/added
- [ ] Gates: all pass locally (tsc, semgrep, audit, playwright)
- [ ] Evidence: compiled and uploaded (if tracked requirement)

### Requirement Planning (do this BEFORE coding)

Read `SDLC/1-plan-requirement.md` for full details. Summary:

1. Confirm GitHub Issue `#NNN` exists (create if needed via `gh issue create`).
2. Get next REQ ID: `grep -oP 'REQ-\d+' compliance/RTM.md | sort -t- -k2 -n | tail -1`
3. Classify risk (use issue labels as input): LOW (internal, no auth) / MEDIUM (PII, user-facing, APIs) / HIGH (security, payments, RBAC). AI involvement raises risk by one level.
4. Add to `compliance/RTM.md` Part B: `| REQ-XXX | #NNN | [RISK] | compliance/evidence/REQ-XXX/ | DRAFT | -- | -- |`
5. **MEDIUM/HIGH risk:** Create `compliance/evidence/REQ-XXX/implementation-plan.md` from `SDLC/Implementation_Plan_TEMPLATE.md` (synced from the framework in v0.1.37+). The template's shape is load-bearing — it carries the `## Framework attribution` section that closes **ISO 29119 §3.4** (test plan), **ISO 27001 A.8.25** (secure SDLC), **GDPR Art. 25** (data protection by design), and **EU AI Act Art. 11** (technical documentation). Don't delete sections — mark with `N/A — <reason>` if a clause genuinely doesn't apply. **WAIT CHECKPOINT:** Present the plan to the developer. Do NOT proceed until approved.
6. Create `compliance/evidence/REQ-XXX/test-scope.md` with acceptance criteria (derived from the implementation plan for MEDIUM/HIGH).
7. **WAIT CHECKPOINT:** Present the test scope to the developer. Do NOT proceed until confirmed.
8. Create `compliance/evidence/REQ-XXX/test-plan.md` — map acceptance criteria to specific tests, list tests to add/update/remove. Distinguish unit tests (TDD, before implementation) from E2E tests (after implementation).
9. **WAIT CHECKPOINT:** Present the test plan to the developer. Do NOT proceed until confirmed.
10. Create `compliance/evidence/REQ-XXX/ai-use-note.md` if AI is involved.
11. Commit plan: `compliance: [REQ-XXX] define requirement, test scope, and test plan`

### During Implementation

Read `SDLC/2-implement-and-test.md` for full details. Summary:

- **Before coding:** Verify ALL exist: `ls compliance/evidence/REQ-XXX/test-scope.md` AND `ls compliance/evidence/REQ-XXX/test-plan.md`. If either is missing, STOP and run planning workflow first. For MEDIUM/HIGH also verify `implementation-plan.md` exists.
- **Phase 1 — Unit tests (TDD):** Write unit tests before implementation. Tests should initially fail. **CHECKPOINT:** Unit test coverage matches test plan.
- **Phase 2 — Implementation:** Write the code. Unit tests should now pass. **CHECKPOINT:** All unit tests green.
- **Phase 3 — E2E tests:** Write E2E tests against the working implementation. **CHECKPOINT:** All E2E tests green.
- **Phase 4 — All gates:** Run full gate suite (TypeScript, SAST, dep audit, all tests, build). **CHECKPOINT:** All gates green, push to develop.
- Every commit: conventional format with `Ref: REQ-XXX` and `Co-Authored-By` for AI.
- Add `@requirement REQ-XXX` JSDoc headers to modified files.
- Log AI prompts in `compliance/evidence/REQ-XXX/ai-prompts.md` for MEDIUM/HIGH risk.

### Before Pushing

Run ALL gates — every one must pass:
```
npx tsc --noEmit                    # 0 errors
semgrep scan --config auto src/     # 0 high/critical
npm audit --audit-level=high        # 0 vulnerabilities
npx playwright test                 # all pass
```

**Verify test plan tests are written:** For tracked requirements, check that every test file referenced in `compliance/evidence/REQ-XXX/test-plan.md` exists and passes. If `test-plan.md` lists tests that haven't been written yet, STOP — write and run the tests before pushing.

### After Pushing: WAIT — Confirm CI Green

```
gh run list --branch develop --limit 1
```

Do NOT proceed to evidence compilation or PR creation until CI is green. If CI fails, fix locally and re-push.

### Evidence Storage Rule

Markdown stays in git. Binary/JSON evidence goes to DevAudit portal.

Upload to DevAudit (NEVER commit to git):
- E2E results (JSON), screenshots (PNG/JPG), SAST results (JSON), dependency audit (JSON), unit test output (TXT), test reports (HTML)

Keep in git (small markdown, needs PR review):
- compliance/RTM.md, test-scope.md, security-summary.md, ai-use-note.md, ai-prompts.md, release tickets

### After Implementation

Read `SDLC/3-compile-evidence.md` for full details, including release ticket template. Summary:

1. Confirm CI is green before compiling evidence: `gh run list --branch develop --limit 1`
2. Generate `compliance/evidence/REQ-XXX/test-execution-summary.md` — gate results, test changes, coverage against test plan
3. Upload binary/JSON evidence to DevAudit portal
4. Create `compliance/evidence/REQ-XXX/security-summary.md` (in git)
5. Update RTM status to `TESTED - PENDING SIGN-OFF`
6. Create `compliance/pending-releases/RELEASE-TICKET-REQ-XXX.md` (use template from workflow file). If the change requires post-deploy actions (data migrations, backfill scripts), document them in the release ticket's Post-Deploy Actions section with exact commands
7. Commit compliance markdown locally (do NOT push yet — batch with UAT results)
8. **WAIT CHECKPOINT:** Confirm CI + UAT deployment complete before UAT verification.
9. **Verify on UAT** (if configured) — health check, smoke test, feature verification. Record in `security-summary.md`. Commit locally. Do NOT create a PR until UAT is green.
10. **Push all compliance commits** in a single push: `git push origin develop`
11. **Verify release in DevAudit** — CI auto-creates releases and links evidence. Check that a release exists with the current version (date-based: `v{YYYY}.{MM}.{DD}` or `v{YYYY}.{MM}.{DD}.{N}` for multiple releases on the same day) and evidence is linked.

### Pre-Flight Checklist (Before Creating PR)

**Do NOT create the PR until ready to merge.** Every push to `develop` while a PR is open triggers duplicate CI runs. The PR is the merge request, not the development workspace.

Before creating a PR, verify ALL of the following:
- [ ] All development and iteration is complete
- [ ] CI green on develop (not stale): `gh run list --branch develop --limit 1`
- [ ] Working tree clean: `git status`
- [ ] UAT verification passed (if configured)
- [ ] DevAudit UAT approval granted
- [ ] For tracked requirements: test-scope.md complete, implementation-plan.md exists (MEDIUM/HIGH), RTM is `TESTED - PENDING SIGN-OFF`, release ticket created, evidence uploaded

If any item fails, resolve it before proceeding.

### Status Reporting (MANDATORY before handing off)

Before describing a PR as "awaiting review", "waiting on reviewers", "ready to merge", "Stage 4/5 requires human action", or any other happy-path language, you MUST:

1. Run `gh pr checks <PR>` and capture the full output, and `gh pr view <PR> --json mergeable,mergeStateStatus` for GitHub's own mergeability signal.
2. If ANY required check is `fail` or `pending`, do NOT use happy-path language. Instead report:
   - Each failing check by name, with its error (from `gh run view <RUN> --log-failed` if needed)
   - Each pending check by name
   - The concrete fix you are about to apply, or a specific question for the developer
3. If `mergeStateStatus` is anything other than `CLEAN` or `BLOCKED` (blocked only by required-reviewer approval), treat it as an open issue and investigate before claiming "ready".
4. If `gh` itself fails (auth, rate limit, network): report "status unknown — gh call failed", never assume green.
5. Only when every required check is `pass` AND the PR is mergeable may you say "awaiting review" or "awaiting approval".

A summary like "awaiting UAT + 2 reviewers" reads to the developer as "nothing to do but approve." If a required check is red, that summary is a lie by omission — the PR cannot merge regardless of what the reviewer does.

This rule applies any time you summarise PR state in chat, not only at the final handoff.

### Review Policy (Risk-Tiered)

- **LOW risk:** CI provides independent verification. Self-merge is permitted after all CI checks pass.
- **MEDIUM/HIGH risk:** A second human reviewer MUST approve before merge. Self-merge is NOT permitted.

### Rules (NEVER break these)

- NEVER code without a GitHub Issue and requirement entry for tracked changes
- NEVER push without all four gates passing
- NEVER self-merge a MEDIUM or HIGH risk PR — a second human reviewer MUST approve
- NEVER use `--no-verify` to skip hooks
- NEVER commit secrets (.env, credentials, API keys)
- NEVER commit binary/JSON evidence to git — upload to DevAudit instead
- NEVER create a PR to main without UAT verification passing first (if UAT configured)
- NEVER push directly to main — always develop → PR → main
- NEVER skip Co-Authored-By when AI generates code
- NEVER proceed past a WAIT CHECKPOINT without developer confirmation
- NEVER describe a PR as "awaiting review" or "ready to merge" without first running `gh pr checks <PR>` and confirming every required check is `pass`
- ALWAYS commit compliance markdown to git (RTM, test-scope, implementation-plan, security-summary, release tickets)
- ALWAYS use merge commits (not squash) for develop → main
