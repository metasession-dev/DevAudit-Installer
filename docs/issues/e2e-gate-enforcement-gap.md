# E2E gate is advisory — no machine-enforced prevention against pushing without running Playwright

## Background

The DevAudit SDLC requires all four gates (TypeScript, SAST, dep-audit, E2E) to pass before pushing to `$INTEGRATION_BRANCH`. The `sdlc-implementer` skill's Phase 2 step 5 explicitly lists `npx playwright test` as a gate that must run "once, after the fast gates are clean."

Multiple issues have been implemented to strengthen E2E test discipline:

- **#132** — Pre-test-work declaration gate + post-hoc self-audit in Phase 2 (prose-level enforcement)
- **#170** — Phase 5½ evidence wiring validation (checks `evidenceShot()` / `tagTest()` / `@requirement` annotations)
- **#196** — `tagTest()` helper for REQ/AC tagging
- **#174** — Feature-branch in-scope E2E via `feature-e2e.yml` (CI-time only)
- **#169** — Evidence-completeness gate in `upload-evidence` job (CI-time only)
- **#211** — 18 control gaps across all phases
- **#212** — Requirements gap classification

Despite all these fixes, a real-world deployment in `wawagardenbar-app` demonstrated that the E2E gate can be silently skipped:

1. The `sdlc-implementer` skill (or operator) ran TypeScript, vitest, semgrep, and npm audit
2. The E2E suite (`npx playwright test`) was **never executed**
3. The skill noted "I did not run the Playwright E2E suite" but still committed and pushed
4. The E2E spec was unverified — selectors, routes, and DB seed structure were all guessed
5. The `e2e-test-engineer` skill was never invoked, so its scenario-derivation, convention-matching, and suite-execution discipline never fired

## Scenarios that break the skill-driven workflow

The wawagardenbar-app deployments (first failure and PR #413) are not isolated incidents. They are instances of a broader pattern: the skill-driven SDLC workflow breaks whenever the native agent must step outside the skill's file-read/write boundary. The following taxonomy maps all observed failure modes.

### 1. Environment setup & infrastructure

- **MongoDB/Redis/Postgres not running** — permission issues, stale locks, wrong ports, missing binaries
- **Missing system dependencies** — Playwright browsers not installed, `mongod` not on PATH, missing native libraries
- **Port conflicts** — another process occupying 3000, 27017, etc.
- **Filesystem permission errors** — can't write to `/var/lib/mongodb`, `/tmp` full, read-only mounts

### 2. Test debugging iteration loops

- **E2E tests fail against a live dev server** — need to inspect page snapshots, error contexts, DOM structure, then adjust locators/selectors and re-run. Each iteration requires: read error → edit test → restart server (sometimes) → re-run → read new error. This tight loop is impossible without direct environment access.
- **Test data doesn't match Mongoose schema** — e.g. `OrderItemsTable` crashed because test orders were missing `subtotal`, `dineInDetails`, `guestName`, `statusHistory`. Discovering this requires seeing the runtime error dialog in the browser, which only the native agent can do.
- **Flaky parallel tests** — tests pass in isolation but fail in parallel due to shared DB state. Requires re-running, adjusting test isolation, adding cleanup.

### 3. CI feedback loops

- **CI compliance validation failures** — CI expects artifacts in `compliance/evidence/` but skills put them in `compliance/plans/`. Requires reading CI logs, understanding the validator script, creating/copying files, pushing again.
- **CI semgrep findings above baseline** — requires reading the finding, deciding if it's a false positive, adjusting code or baseline, re-running.
- **CI TypeScript errors** — `tsc --noEmit` catches type errors that only appear in the CI environment (different Node version, different tsconfig resolution).
- **CI npm audit failures** — new vulnerability published between local run and CI run.

### 4. Git & GitHub operations

- **Commit message format rejections** — husky/commitlint rejects non-conventional formats. Requires understanding the configured enum and retrying.
- **Pre-push hook failures** — TypeScript check or lint-staged fails, blocking push. Requires fixing the issue and re-pushing.
- **Merge conflicts** — `develop` diverged while working on a feature branch. Requires conflict resolution.
- **PR creation** — `gh pr create` with the right title, body, labels, reviewers.

### 5. External service interactions

- **DevAudit portal approval** — can't be done from code; requires human login to the portal
- **Railway deployment status** — checking if deploy succeeded, reading build logs, diagnosing startup failures
- **UAT health checks** — curling the UAT URL, verifying the app is responsive
- **Monnify webhook mocking** — E2E tests for gateway payments would require either mocking the webhook or using a test API key

### 6. Skill workflow gaps

- **Directory convention mismatches** — skills say `compliance/plans/`, CI validates `compliance/evidence/`. The skill doesn't know about the CI validator's expectations.
- **Missing Phase 1 artifacts** — `sdlc-implementer` should create `test-scope.md` and `test-plan.md` during planning, but if the native agent skips Phase 1 or rushes through it, these get missed.
- **Skill can't verify its own output** — the skill can write an artifact file, but can't run `./scripts/validate-compliance-artifacts.sh` to check if it would pass CI.

### 7. Cross-skill handoff failures

- **e2e-test-engineer writes tests but can't run them** — it can design and author test files, but executing `npx playwright test` requires the native agent's environment access.
- **sdlc-implementer delegates but loses track** — after delegating to e2e-test-engineer, the native agent continues without re-invoking sdlc-implementer for subsequent phases (exactly what happened in PR #413).

### Root causes

All of these fall into two root causes:

1. **Skills lack environment access** — they can read/write files and provide instructions, but can't run commands, start services, inspect browser state, or interact with external APIs. The native agent bridges this gap but doesn't re-invoke the skill after the fix, losing the workflow structure.
2. **Skills lack feedback loops** — they can produce artifacts but can't verify them against CI validators, test runners, or deployment targets. The native agent bridges this gap but doesn't re-invoke the skill after the fix, losing the workflow structure.

The changes in this issue (1–9) address the *symptoms* — missing sentinels, missing artifacts, wrong directories. The root causes (environment access and feedback loops) are architectural limitations of the skill mechanism itself and are out of scope for this issue. They are tracked here as context for future architectural work.

## Problem statement

Every existing defence is either:

- **Prose-level** — the skill's instructions say "MUST invoke" and "MUST run gates", but nothing prevents the skill (or operator) from skipping a gate and pushing anyway. The #132 declaration gate and self-audit are structural prompts, not machine-enforced checks.
- **CI-time only** — `feature-e2e.yml` and the evidence-completeness gate (#169) catch missing E2E evidence *after* the push lands on `develop` or after a PR is opened. By then, the commit is on the integration branch and the release record may already exist.
- **Post-hoc** — #170's Phase 5½ validation checks evidence wiring *after* specs are written, not whether the suite was actually *run*.

The missing layer is **pre-push enforcement**: a mechanism that refuses to push to `$INTEGRATION_BRANCH` if the E2E gate was never run locally.

## Root cause analysis

### Why prose gates aren't enough

The #132 gates work by forcing the agent to output a literal declaration line (`Delegating e2e test work to e2e-test-engineer.`) and then blocking direct spec authoring. But:

1. The agent can output the declaration and still not run the suite — the declaration is about *authoring*, not *executing*
2. The self-audit (Phase 2 step 9) checks whether specs were authored via the skill, not whether `npx playwright test` was actually run
3. Neither gate has a machine-enforced failure mode — the skill can rationalise around them ("I'll run E2E later", "CI will catch it")

### Why CI-time gates aren't enough

CI gates fire *after* the push. The sequence is:

1. Skill skips E2E gate locally
2. Skill pushes to `develop`
3. CI registers the release on the portal (via `register-release` job with `--create-release-if-missing`)
4. CI runs E2E — which may fail
5. But the release record already exists, and for housekeeping versions, the housekeeping stub PR is already opening

The release record existing on the portal before E2E passes is an audit-trail problem — the portal shows a release that was created from a push where gates weren't verified locally.

### The enforcement gap

There is no mechanism today that:
- Verifies `npx playwright test` was run (e.g., checks for `playwright-report/` or a test results artifact) before allowing a push
- Verifies the `e2e-test-engineer` skill was actually invoked (e.g., checks chat transcript for the skill invocation)
- Blocks a push at the git-hook level if E2E evidence is missing

## Proposed solutions

### Option 1: Pre-push hook with E2E evidence check

Add a pre-push hook (husky `pre-push` for node stacks) that checks for recent E2E evidence before allowing pushes to `$INTEGRATION_BRANCH`:

- Checks for `playwright-report/` directory with files newer than the last commit
- If no E2E evidence found and the change touches `e2e/**/*.spec.ts` or any UI-facing source files, refuses the push
- Can be bypassed with `--no-verify` (documented as a last resort, not a habit)

**Pros:** Machine-enforced, fires before the push, catches the exact failure mode
**Cons:** `--no-verify` bypass exists; doesn't verify the *quality* of the E2E run (just that it ran); adds friction to legitimate non-E2E changes

### Option 2: CI-side pre-registration gate

Modify `ci.yml.template` so the `register-release` job does **not** create the release until E2E gates pass:

- Move `--create-release-if-missing` from `register-release` to `upload-evidence` (which runs after gates)
- The release record only appears on the portal after all gates (including E2E) are green
- This doesn't prevent the push, but prevents the portal from showing a release until E2E passes

**Pros:** No local hook needed; portal audit trail is clean; release record only exists for verified pushes
**Cons:** Doesn't address the local gate skip; CI still runs E2E on a push that should have been verified locally; changes the release registration timing (may affect other workflows)

### Option 3: Skill-level E2E gate verification

Add a verification step to `sdlc-implementer` Phase 2 that checks for E2E run evidence before allowing the push:

- After step 5 (run gates), check for `playwright-report/` or a sentinel file (e.g., `.e2e-gate-passed`)
- If the change touches UI-facing files and no E2E evidence exists, halt with: "E2E gate was not run. Operator action — run `npx playwright test` before pushing."
- The sentinel file approach: `e2e-test-engineer` writes `.e2e-gate-passed` after a successful run; `sdlc-implementer` checks for it before pushing; `.gitignore`'d so it doesn't pollute the repo

**Pros:** Fits the existing skill architecture; no CI changes; catches the gap at the skill level
**Cons:** Still advisory (skill can rationalise around it); doesn't help if the skill isn't invoked at all

### Option 4: Combined approach (recommended)

Combine Options 1 + 2:

- **Pre-push hook** (Option 1) catches the local skip — the most common failure mode
- **CI-side pre-registration gate** (Option 2) ensures the portal never shows a release from an unverified push — defence in depth
- **Skill-level verification** (Option 3) adds a clear halt point in the skill flow

## Recommended approach

**Option 4 (combined)** — the pre-push hook is the primary defence, the CI-side pre-registration gate is the safety net, and the skill-level verification provides a clear halt point. Each layer catches what the others miss:

| Layer | Catches | Misses |
|-------|---------|--------|
| Skill-level verification (Option 3) | Skill skipping E2E gate | Operator working without the skill |
| Pre-push hook (Option 1) | Any push without E2E evidence | `--no-verify` bypass |
| CI-side pre-registration (Option 2) | Portal showing unverified releases | Doesn't prevent the push itself |

## Skill-invocation enforcement (devaudit-installer#199 follow-up)

A related but distinct gap was identified during the wawagardenbar-app post-mortem: despite #199's mandatory prompt gate, the `sdlc-implementer` skill was never invoked — the operator manually read the SDLC workflow files and executed the steps themselves. This bypassed all skill-level delegation gates (#132) and the E2E gate.

#199 enforces the **output** (commits have REQ tags via commitlint + `validate-commits.sh`) but not the **process** (sdlc-implementer skill was actually invoked). The prompt gate is prose-level — it depends on the AI agent reading and complying with a system-prompt instruction. There is no machine-enforced verification that the skill was invoked.

Two additional changes address this:

### 5. Skill invocation sentinel + pre-push hook check

**File:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (write sentinel), `sdlc/files/stacks/node/hooks/pre-push` (check sentinel)

**Logic:**
- `sdlc-implementer` writes `.sdlc-implementer-invoked` (gitignored) at Phase 0 start
- The pre-push hook (from change #1) also checks for this sentinel when `feat`/`fix`/`refactor`/`perf` commits are present
- If no sentinel exists, refuses the push with: "sdlc-implementer skill was not invoked. This change uses feat/fix commit types which require the SDLC skill flow. Invoke sdlc-implementer or use --no-verify to bypass (not recommended)."
- Bypass with `--no-verify` is possible but logged

### 6. RTM provenance stamp + CI validation

**File:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (write provenance), `sdlc/files/_common/scripts/validate-commits.sh` (check provenance)

**Logic:**
- `sdlc-implementer` Phase 1 step 9 (update RTM.md) adds a provenance marker to the RTM row: `| REQ-XXX | <title> | <risk> | #<issue> | <tests> | sdlc-implementer@<version> |`
- `validate-commits.sh` (CI gate, `--no-verify` cannot skip) extracts the REQ-XXX from the commit message, looks up the RTM row, and checks for the provenance marker
- If the REQ-XXX has no provenance stamp, fails CI with: "REQ-XXX in commit message has no sdlc-implementer provenance in RTM.md. The skill was not invoked. Either invoke sdlc-implementer and re-run, or add the provenance marker manually with operator sign-off."
- This is the unskippable safety net — catches `--no-verify` bypass of the pre-push hook and non-husky stacks

## Required changes

### 1. Pre-push hook with E2E evidence check

**File:** `sdlc/files/stacks/node/hooks/pre-push` (synced to consumer's `.husky/pre-push`)

**Logic:**
- Detect if the push targets `$INTEGRATION_BRANCH` (develop)
- Check if any changed files match UI-facing patterns (e.g., `src/**/*.tsx`, `app/**/*.tsx`, `pages/**/*.tsx`)
- If UI-facing files changed, check for `playwright-report/` with files newer than the last commit
- If no E2E evidence found, refuse the push with a clear message
- Allow bypass via `--no-verify` (documented as last resort)

### 2. Move release registration after E2E gates

**File:** `sdlc/files/ci/ci.yml.template`

**Change:** Remove `--create-release-if-missing` from the `register-release` job's "Ensure release exists" step. Add a new "Register release" step in the `upload-evidence` job (which runs after gates) that creates the release with `--create-release-if-missing`.

### 3. Skill-level E2E gate verification

**File:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`

**Change:** Add a verification sub-step between Phase 2 step 5 (run gates) and step 7 (commit) that:
- Checks for `playwright-report/` directory existence
- If the change touches UI-facing files and the directory is missing, halts with: "E2E gate was not run. Run `npx playwright test` before committing."
- If the change is non-UI (e.g., API-only, config, docs), skip the check with a noted exemption

### 4. Update `e2e-test-engineer` to write a sentinel

**File:** `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`

**Change:** After a successful E2E run, write a `.e2e-gate-passed` sentinel file (gitignored) that the pre-push hook and skill-level verification can check for as an alternative to `playwright-report/` existence.

### 5. Skill invocation sentinel + pre-push hook check

(See skill-invocation enforcement section above)

### 6. RTM provenance stamp + CI validation

(See skill-invocation enforcement section above)

## Acceptance criteria

### E2E gate enforcement
- [ ] Pre-push hook refuses pushes to `develop` when UI-facing files changed and no E2E evidence exists
- [ ] Pre-push hook allows pushes when no UI-facing files changed (non-UI changes)
- [ ] Pre-push hook can be bypassed with `--no-verify` (documented, not encouraged)
- [ ] `register-release` CI job no longer creates portal release records before E2E gates pass
- [ ] `upload-evidence` CI job creates the portal release record after all gates pass
- [ ] `sdlc-implementer` Phase 2 halts if E2E gate was not run for UI-facing changes
- [ ] `e2e-test-engineer` writes `.e2e-gate-passed` sentinel after successful E2E run
- [ ] `.gitignore` includes `.e2e-gate-passed`
- [ ] Human-authored non-UI housekeeping commits (docs, config) are not blocked by the pre-push hook
- [ ] Test: a UI-facing change without E2E evidence is blocked at pre-push
- [ ] Test: a UI-facing change with E2E evidence passes the pre-push hook
- [ ] Test: a non-UI change passes the pre-push hook without E2E evidence

### Skill-invocation enforcement
- [ ] `sdlc-implementer` writes `.sdlc-implementer-invoked` sentinel at Phase 0 start
- [ ] `.gitignore` includes `.sdlc-implementer-invoked`
- [ ] Pre-push hook refuses `feat`/`fix`/`refactor`/`perf` commits when `.sdlc-implementer-invoked` sentinel is missing
- [ ] Pre-push hook allows housekeeping commit types (`docs`/`chore`/`ci`/`build`/`test`/`revert`) without the sentinel
- [ ] `sdlc-implementer` Phase 1 step 9 stamps RTM row with `sdlc-implementer@<version>` provenance marker
- [ ] `validate-commits.sh` checks RTM provenance for REQ-XXX in commit message and fails CI if missing
- [ ] `validate-commits.sh` provenance check cannot be bypassed with `--no-verify` (CI gate)
- [ ] Test: a `feat` commit without `.sdlc-implementer-invoked` sentinel is blocked at pre-push
- [ ] Test: a `feat` commit with sentinel passes the pre-push hook
- [ ] Test: a `chore` commit without sentinel passes the pre-push hook
- [ ] Test: CI fails when RTM row for the commit's REQ-XXX has no provenance stamp
- [ ] Test: CI passes when RTM row has `sdlc-implementer@<version>` provenance stamp

## Phase-artifact creation gaps (discovered in wawagardenbar-app PR #413)

A second real-world deployment in `wawagardenbar-app` (PR #413) revealed three additional gaps that the original six changes do not address. In this deployment, `sdlc-implementer` **was** invoked and drove Phase 1 (planning) and Phase 2 (implementation) correctly. The E2E suite was delegated to `e2e-test-engineer`. The failure occurred later, after an environment debugging detour (MongoDB port conflict, dev server startup, Playwright browser install) forced the native agent to take over hands-on debugging. The native agent then continued through Phase 3 (evidence) and Phase 4 (PR) without re-invoking `sdlc-implementer`. CI Compliance Validation failed with 3 missing files.

### Gap A: `test-scope.md` and `test-plan.md` are never created by any skill step

`validate-compliance-artifacts.sh` (CI) hard-fails if `compliance/evidence/REQ-XXX/test-scope.md` or `test-plan.md` are missing. The PR review checklist in `4-submit-for-review.md` also requires them. The scope-expansion halt in `sdlc-implementer` references `test-scope.md` as if it always exists.

But no step in `sdlc-implementer` (Phase 1 or Phase 3) or any sub-skill creates these files. The implementation plan template (`Implementation_Plan_TEMPLATE.md`) contains acceptance criteria and test strategy sections that are the natural source for these artifacts, but the skill never extracts them into separate files.

**This gap would cause CI failure even with perfect skill invocation end-to-end.** The skill can drive Phase 1 → Phase 2 → Phase 3 → Phase 4 correctly and still fail Compliance Validation because these files were never created.

### Gap B: `implementation-plan.md` location mismatch

`sdlc-implementer` Phase 1 step 5 writes `implementation-plan.md` to `compliance/plans/REQ-XXX/implementation-plan.md`. But `validate-compliance-artifacts.sh` checks `compliance/evidence/$REQ/implementation-plan.md`. Phase 3 step 6 organises artifacts under `compliance/evidence/REQ-XXX/` but the listed artifacts don't include `implementation-plan.md` — so it's never copied.

### Gap C: No re-invocation enforcement after environment detour

The `.sdlc-implementer-invoked` sentinel (Change 5) is written once at Phase 0. It proves the skill was invoked *at some point*, not that it drove *every* phase. After an environment debugging detour (MongoDB, dev server, Playwright install), the native agent continued through Phase 3 and Phase 4 without re-invoking the skill. The sentinel check passes. The RTM provenance check passes. But the skill's Phase 3 artifact checklist — which might have caught the missing files — was never run by the skill.

This is the same class of gap as the original E2E gate problem: prose-level enforcement says "auto-continue to Phase 3" (Phase 2 step 11), but nothing enforces that the *skill* does the continuing vs. the native agent doing it manually.

## Additional required changes (from PR #413 findings)

### 7. Create `test-scope.md` and `test-plan.md` in `sdlc-implementer` Phase 1

**File:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`

**Change:** Add a new step after Phase 1 step 5 (write implementation plan) that extracts the acceptance criteria and test strategy from the plan into two separate files under `compliance/evidence/REQ-XXX/`:
- `test-scope.md` — acceptance criteria (AC table from the plan), risk classification, verification methods per AC
- `test-plan.md` — test file listing, which ACs each file covers, test depth per risk class

These are derived from the implementation plan's existing sections (Acceptance Criteria, Test Strategy). The extraction is mechanical — the skill already authors this content in the plan; it just needs to write it to the CI-expected location as separate files.

### 8. Copy `implementation-plan.md` to `compliance/evidence/` in Phase 3

**File:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`

**Change:** In Phase 3 step 6 (organise artefacts), add `implementation-plan.md` to the list of files placed under `compliance/evidence/REQ-XXX/`. The skill should copy (not move) the file from `compliance/plans/REQ-XXX/` so the plan directory retains the original.

### 9. Phase-transition sentinel — re-invocation enforcement

**File:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`, `sdlc/files/stacks/node/hooks/pre-push`

**Change:** Instead of a single `.sdlc-implementer-invoked` sentinel written once at Phase 0, the skill writes a phase-tracking sentinel at each phase transition:

```
echo "phase=1 complete=true timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> .sdlc-implementer-invoked
echo "phase=2 complete=true timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> .sdlc-implementer-invoked
echo "phase=3 complete=true timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> .sdlc-implementer-invoked
```

The pre-push hook checks that the sentinel contains `phase=3 complete=true` (evidence compiled) before allowing `feat`/`fix`/`refactor`/`perf` commits to be pushed. This catches the case where the skill was invoked for Phase 0–2 but the native agent continued through Phase 3–4 without re-invoking.

**Note:** This is a lighter alternative to requiring skill re-invocation at every phase. The skill's Phase 2 step 11 already says "auto-continue to Phase 3" — the sentinel verifies the skill actually did the continuation, not just that it was invoked once.

## Acceptance criteria (additional, from PR #413 findings)

### Phase-artifact creation
- [ ] `sdlc-implementer` Phase 1 creates `compliance/evidence/REQ-XXX/test-scope.md` with AC table, risk class, and verification methods
- [ ] `sdlc-implementer` Phase 1 creates `compliance/evidence/REQ-XXX/test-plan.md` with test file listing and AC coverage mapping
- [ ] `sdlc-implementer` Phase 3 step 6 copies `implementation-plan.md` from `compliance/plans/` to `compliance/evidence/`
- [ ] Test: a REQ driven through Phase 1 by `sdlc-implementer` produces `test-scope.md` and `test-plan.md` in `compliance/evidence/`
- [ ] Test: `validate-compliance-artifacts.sh` passes when `sdlc-implementer` drives the full Phase 1 → Phase 3 flow

### Phase-transition enforcement
- [ ] `.sdlc-implementer-invoked` sentinel contains per-phase completion lines (not just a single INVOKED line)
- [ ] Pre-push hook checks for `phase=3 complete=true` in sentinel before allowing `feat`/`fix`/`refactor`/`perf` commits
- [ ] Test: a push with `phase=2 complete=true` but no `phase=3` is blocked at pre-push
- [ ] Test: a push with `phase=3 complete=true` passes the pre-push hook

## Out of scope

- Enforcing E2E for non-node stacks (python pre-commit hooks would need a separate implementation)
- Verifying E2E test *quality* (coverage, assertion depth) — this issue is about whether the suite *ran*, not whether it's comprehensive
- Portal-side changes to release record creation timing (portal API already supports late creation)
- Removing `--no-verify` bypass (this is a git-level feature that can't be disabled)
- Implementation plan watermark (Option 3 from skill-invocation analysis) — redundant with RTM provenance check; the RTM row is the single source of truth for REQ metadata

## Dependencies

- None blocking. The pre-push hook is additive (new hook content). The CI change is a relocation of `--create-release-if-missing` within the same workflow template. The skill changes are prose additions.

## References

- `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` Phase 0 (sentinel write point), Phase 1 step 5 (implementation plan — source for test-scope/test-plan extraction), Phase 1 step 9 (RTM update — provenance stamp point), Phase 2 steps 3, 5, 9, 11 — E2E delegation gate, gate execution, self-audit, auto-continue, Phase 3 step 6 (artifact organisation — plan copy point)
- `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` Phase 5 — E2E execution
- `sdlc/files/_common/scripts/validate-compliance-artifacts.sh:69-95` — CI checks for `test-scope.md`, `test-plan.md`, `implementation-plan.md` in `compliance/evidence/`
- `sdlc/files/ci/ci.yml.template:291-300` — `register-release` with `--create-release-if-missing`
- `sdlc/files/ci/ci.yml.template:366-374` — `upload-evidence` job (runs after gates)
- `sdlc/files/stacks/node/hooks/pre-push` — existing pre-push hook
- `sdlc/files/_common/scripts/validate-commits.sh` — CI commit validation (unskippable)
- `sdlc/ai-rules/INSTRUCTIONS-SDLC.md:24-37` — #199 mandatory prompt gate (prose-level)
- wawagardenbar-app first deployment failure — E2E suite never run, spec unverified, sdlc-implementer never invoked
- wawagardenbar-app PR #413 deployment failure — sdlc-implementer invoked for Phase 1–2, native agent took over after MongoDB debugging detour, continued Phase 3–4 without re-invoking skill, CI Compliance Validation failed with 3 missing files (`test-scope.md`, `test-plan.md`, `implementation-plan.md` in wrong location)
- Issues #132, #170, #196, #174, #169, #199, #211, #212 — prior E2E/skill gap fixes
