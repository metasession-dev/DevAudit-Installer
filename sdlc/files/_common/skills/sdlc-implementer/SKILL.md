---
name: sdlc-implementer
description: Take a GitHub issue end-to-end through the Metasession SDLC. Opens with a Workflow Triage step (Phase 0) that classifies the change and routes it — tracked work continues into the full cycle; housekeeping/trivial/doc-only is driven to merge down a lightweight path (same step-by-step guidance, no tracked ceremony). Use when the user wants to implement a single GitHub issue as a complete SDLC cycle — Phase 1 (classify risk, write implementation plan, update RTM) through Phase 4 (open PR, request UAT review on the portal), then halt; and Phase 5 (merge, post-deploy smoke evidence, mark Released, or change-request loop) on resume. Trigger phrases — "implement issue #N under the SDLC", "run the SDLC for issue #N", "automate REQ-XXX from issue to release", "do the SDLC stages for [issue]". Resume phrase — "resume REQ-XXX". MUST delegate end-to-end and visual-regression test work to the e2e-test-engineer skill in Phase 2; never authors e2e tests directly. Do NOT use for partial work — for stage-1 planning only, run the manual walkthrough; for test work alone, invoke e2e-test-engineer directly.
tags: [sdlc, orchestration, compliance, automation]
---

# SDLC implementer

Take a single GitHub issue end-to-end through the Metasession SDLC. The skill **triages first** (Phase 0): it classifies the change, announces the path it will take, and routes — only a **tracked** change continues into the full cycle, while housekeeping, trivial, and compliance-doc-only work is driven down its lighter path **to completion** (the skill still guides every step to merge; it just skips the tracked ceremony). For a tracked change, one command runs Phase 1 through Phase 4 unattended (with a plan-approval pause for HIGH/CRITICAL risk); the human enters the loop at the UAT review gate on the portal. On resume, the skill runs Phase 5 — merge, post-deploy smoke evidence, mark the release Released, or address change-requests and re-submit for UAT re-review.

This skill is a single entry point that **routes**, not one that always runs heavy. The change-type taxonomy it routes against is the canonical table in [`change-workflows.md`](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/change-workflows.md) (six change-types → commit-type → requirement? → path).

This is an **orchestration skill**. It drives Claude Code's native tools (`gh`, shell, the `devaudit` CLI, the portal API) through the framework's existing stage docs, and it **MUST invoke the [`e2e-test-engineer`](../e2e-test-engineer/SKILL.md) skill** for any end-to-end or visual-regression test work in Phase 2. It does not author e2e tests directly.

## Scope

**In scope**

- Pickup-time **workflow triage** (Phase 0): read the issue + labels, classify the change-type, announce the path, and route — tracked work into Stages 1–5; housekeeping / trivial / compliance-doc-only **driven to merge down the Lightweight path** (same guidance, no tracked ceremony).
- Taking one GitHub issue from triage to merged-and-deployed, under the project's existing SDLC framework.
- Risk classification per [`Test_Policy.md`](../../Test_Policy.md) §Risk-Based Testing.
- Authoring `compliance/plans/REQ-XXX/implementation-plan.md` per the stage-1 template.
- Updating `compliance/RTM.md`.
- Implementation, unit/integration tests, quality gates.
- Evidence capture and upload to the portal via `devaudit push`.
- PR opening, UAT review request, change-request loop, merge, post-deploy verification, release finalisation.

**Out of scope**

- Issues that decompose into multiple requirements — refuse at Phase 1 and ask the user to split.
- Stage-1 planning in isolation — run the manual walkthrough instead.
- E2E or visual-regression test work in isolation — invoke `e2e-test-engineer` directly.
- Cross-issue refactors that touch multiple REQ-XXX scopes — these are out of the one-issue contract.
- Onboarding a new consumer — that's `devaudit install`, a different command entirely.

## Sub-skill invocation contract

The orchestrator MUST invoke `e2e-test-engineer` for end-to-end and visual-regression test work in Phase 2. This is a hard contract:

- Never author e2e tests directly.
- Never transcribe `e2e-test-engineer`'s six-phase workflow into this skill's body.
- Call via the standard Claude Code Skill mechanism (`Skill(name: "e2e-test-engineer", …)`).

Unit-test and integration-test work stays with this skill until a counterpart unit-test skill ships. The full sub-skill call graph lives at [`references/call-graph.md`](./references/call-graph.md).

## The workflow

A triage step (Phase 0) routes the issue, then up to five phases for tracked work. Phase 0 plus Phases 1–4 run in one Claude Code session; Phase 5 is invoked separately by the user after UAT. The off-ramps from Phase 0 (housekeeping / trivial / doc-only) don't enter Phase 1 — they run the **Lightweight path** (below), which the skill drives to merge.

**Branch targets are project-configured — never hardcode `main` / `develop`.** Read them once from `sdlc-config.json` and use them throughout:

```bash
INTEGRATION_BRANCH=$(jq -r '.integration_branch // "develop"' sdlc-config.json)  # where work lands + ci.yml uploads gate evidence
RELEASE_BRANCH=$(jq -r '.release_branch // "main"' sdlc-config.json)             # the protected production branch
```

For a **develop-first** repo these are `develop` and `main`: implementation lands on `$INTEGRATION_BRANCH`, and the UAT-approved release PR is `$INTEGRATION_BRANCH → $RELEASE_BRANCH`. A **trunk-only** repo sets both to `main`, collapsing the two hops into a single `feature → main` PR. Where the two branches differ, the release PR's head is `$INTEGRATION_BRANCH`; where they're equal, it's the feature branch.

### Phase 0 — Workflow triage (classify → announce → confirm → route)

Runs **first**, before any `REQ-XXX` is assigned. It decides which of the six change-types in [`change-workflows.md`](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/change-workflows.md) applies and what will — and won't — run. This is what stops every issue defaulting to maximum ceremony.

1. **Fetch.** `gh issue view <N> --json labels,title,body` and read all comments. Read the **labels** as well as the title and body.
2. **Classify the change-workflow**, inference-first (labels are optional input). Precedence, highest first:
   1. An explicit `type:*` / `risk:*` label → **authoritative**.
   2. A conventional-commit prefix in the issue title — `feat` / `fix` / `refactor` / `perf` → **tracked**; `chore` / `ci` / `build` / `test` / `docs` / `compliance` → **housekeeping / doc-only**.
   3. The issue template — Requirement → tracked; Bug → fix (tracked); Task → housekeeping.
   4. Body heuristics — acceptance criteria, or risk signals (auth, payments, RBAC, data egress, AI decisioning) → tracked, and raise the risk class.

   Map the result to one of the six paths in `change-workflows.md`.

3. **Announce a "Workflow Decision" block** (template below): change-type, commit-type, whether a `REQ-XXX` is needed, risk class, which stages/gates run, which approvals the **operator** must perform (UAT four-eyes, Production approval), and what is **skipped**.
4. **Pause policy — pause-when-it-matters.** Pause for explicit confirmation on **tracked / heavier** paths, or when classification is **ambiguous**; **announce-and-auto-proceed** on trivial / housekeeping. The operator can always reclassify ("treat this as housekeeping" / "this is HIGH risk").
5. **Route — and stay on to completion.** A route is a choice of _which workflow to drive_, never a hand-off that abandons the operator. Whatever the path, the skill keeps guiding step by step until no further action is required (typically: merged).
   - **tracked** (feature / bug fix / refactor / perf) → continue into Phase 1 below (full Stages 1–5).
   - **housekeeping / trivial** → drive the **Lightweight path** below to completion. No `REQ-XXX`, no RTM row, no evidence pack, no portal release approvals — but the skill still branches, runs the gates, opens the PR, and walks the operator through review → merge.
   - **compliance-doc-only** → drive the same Lightweight path as a docs push (or PR, per the project's flow) referencing the **existing** `REQ-XXX`: no new requirement and no quality-gate ceremony, but driven through to merge.
6. **Write labels back.** Apply the inferred `type:*` / `risk:*` labels so the issue ends up labelled — `gh label create <label> --force` to ensure the label exists (idempotent; no failure if a label-seeding step never ran), then `gh issue edit <N> --add-label <label>`. Future triage is then a glance.

**"Workflow Decision" announcement template**

> **Workflow decision — #N**
>
> - **Change type:** \<Feature | Bug fix | Refactor/Perf | Housekeeping | Trivial | Compliance-doc-only\>
> - **Commit type:** \<feat | fix | refactor | chore | docs | …\>
> - **Requirement:** \<REQ-XXX assigned | none\>
> - **Risk:** \<LOW | MEDIUM | HIGH | CRITICAL\>
> - **Path:** \<Full SDLC Stages 1–5 | Lightweight (gates → chore PR) | Doc-only push\>
> - **Gates/evidence:** \<…\>
> - **Your approvals:** \<UAT four-eyes + Production approval | PR review only\>
> - **Skipped:** \<…\>
>   Proceed? _(or reclassify)_

Only the **tracked** route continues into Phase 1; the others run the Lightweight path below. The off-ramps are deliberate — dragging housekeeping through tracked-change machinery it doesn't need is exactly the failure mode this step exists to prevent — but they are still **driven to completion**, never dumped as a checklist for the operator to run alone.

**Worked examples** (one per change-type the skill keeps mis-routing without one):

_Tracked feature — REQ-XXX assigned_

> - **Change type:** Feature
> - **Commit type:** feat
> - **Requirement:** REQ-XXX (new)
> - **Risk:** MEDIUM
> - **Path:** Full SDLC Stages 1–5
> - **Gates/evidence:** plan + RTM row + unit/integration/e2e evidence + UAT four-eyes + Production approval
> - **Your approvals:** UAT four-eyes + Production approval
> - **Skipped:** none

_Test fix surfaced by suite drift_

> - **Change type:** Housekeeping (test maintenance)
> - **Commit type:** test
> - **Requirement:** none
> - **Risk:** LOW
> - **Path:** Lightweight (gates → PR review → merge)
> - **Gates/evidence:** quality-gates smoke (default CI Gate 4); no full regression on PR (run via `workflow_dispatch` while iterating, full regression on next nightly)
> - **Your approvals:** PR review only
> - **Skipped:** RTM, evidence pack, UAT four-eyes, Production approval

_Workflow tweak (CI artifact upload, gate timeout bump, etc.)_

> - **Change type:** Housekeeping (CI maintenance)
> - **Commit type:** ci
> - **Requirement:** none
> - **Risk:** LOW
> - **Path:** Lightweight (gates → verify-via-dispatch → PR review → merge)
> - **Gates/evidence:** quality-gates smoke + a `gh workflow run <file> --ref <branch>` on the modified workflow before merge (silent CI regressions are the failure mode this catches)
> - **Your approvals:** PR review only
> - **Skipped:** RTM, evidence pack, UAT four-eyes, Production approval

### Lightweight path (housekeeping / trivial / compliance-doc-only)

Reached from Phase 0 for non-tracked change-types. The skill drives this end-to-end; the only difference from the tracked cycle is the absence of _ceremony_, not the absence of _guidance_. It pauses only where a human is genuinely required (PR review, merge).

1. **Branch off `$INTEGRATION_BRANCH`** with a housekeeping prefix — `chore/…`, `docs/…`, `ci/…`, `build/…`, `test/…`, or `compliance/…` for a doc-only change against an existing REQ.
2. **Make the change**, single-purpose. If it turns out to touch runtime behaviour in `app/` / `lib/`, stop and reclassify as tracked — the commit-type rule is the backstop.
3. **Run all gates locally** (`npm run lint`, `npx tsc --noEmit`, the test suite, `semgrep`, `npm audit` — or the stack-adapter equivalents). Trivial ≠ unverified; never `--no-verify`.
4. **Commit** with a housekeeping type and **no** `REQ-XXX` — `docs:` / `chore:` / `ci:` / `build:` / `test:` / `revert:` are exempt from the `[REQ-XXX]` rule; a `compliance:` doc-only change references the existing REQ. `Co-Authored-By: Claude` if AI-assisted.
5. **Push and open the PR** into `$INTEGRATION_BRANCH` (`gh pr create --base "$INTEGRATION_BRANCH" --head <branch>`). CI runs the same quality gates; `compliance-validation.yml` finds no `REQ-XXX` and skips artifact validation.
6. **For `ci:` changes, verify-via-dispatch before merging.** `gh workflow run <workflow.yml> --ref <branch>` fires the modified workflow against the PR branch. If the change broke a step, the dispatch run fails loudly and you fix-forward _before_ the merge ships the broken gate to `$INTEGRATION_BRANCH`. This is the cheapest insurance against silent CI regressions — a `ci:` change that breaks a gate is most damaging _after_ it lands.
7. **Report honest status** — wait for CI, name any failing check, fix and re-push. Never announce "ready" while a required check is red.
8. **Guide review → merge.** A human still reviews the PR (separation of duties). There is **no** portal release approval, no UAT four-eyes, no Production gate, and no close-out. Merge once CI is green and the reviewer approves.
9. **Done.** A housekeeping push produces at most a bare-date release (`vYYYY.MM.DD`) with no approval gate; a doc-only push attaches its docs to the existing `REQ-XXX` release. No further action required — report completion and stop.

### Phase 1 — Plan (SDLC stage 1)

Reached only on the **tracked** route from Phase 0 (the issue is already fetched and classified).

1. **Confirm the issue scope.** Re-read the `gh issue view <N>` output from Phase 0 — title, body, all comments — with implementation in mind.
2. **Classify risk** per `Test_Policy.md` §Risk-Based Testing. Emit a one-paragraph rationale citing the signals you used (auth surface, financial calc, data egress, RBAC, AI decisioning, etc.).
3. **Assign REQ-XXX.** Inspect `compliance/RTM.md` for existing entries; take the next free number. If the issue references an existing REQ, use that instead.
4. **Detect over-scoping.** If the issue spans clearly distinct deliverables (e.g. "build SAML SSO + reorganise the admin dashboard + migrate from Postgres 14 to 16"), halt with a clear message asking the user to split the issue into separate ones. Do not proceed past Phase 1.
5. **Write the implementation plan.** Create `compliance/plans/REQ-XXX/implementation-plan.md` from `sdlc/files/_common/Implementation_Plan_TEMPLATE.md` (synced into the consumer's `SDLC/` directory at install). The template's shape is load-bearing — it carries the **Framework attribution** section that closes four framework clauses on upload:

   | Clause                                        | What the plan must contain                                                                                |
   | --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
   | **ISO 29119 §3.4** Test Plan                  | Acceptance criteria + verification strategy per AC.                                                       |
   | **ISO 27001 A.8.25** Secure SDLC              | Threat model + secrets / dependency considerations.                                                       |
   | **GDPR Art. 25** Data protection by design    | Per-purpose data flows + lawful basis + retention. Explicit "no personal data" callout if not applicable. |
   | **EU AI Act Art. 11** Technical documentation | Model provenance + oversight path when AI is in scope. Explicit "no AI in scope" callout if not.          |

   For HIGH/CRITICAL also include: threat model (against STRIDE categories applicable to the touched surfaces), four-eyes attestation slot, rollback plan — the template has slots for all of these.

   **Don't delete sections** — mark with `N/A — <reason>` if a clause genuinely doesn't apply (e.g. UI-only change with no personal-data scope). Empty stubs commit-then-upload as placeholder evidence and break the audit trail.

6. **Invoke `requirements-aligner` to populate the SRS-ID column on the AC table.** The plan's "Acceptance criteria" table carries an SRS-ID column per AC; `requirements-aligner` fuzzy-matches each AC against `docs/SRS.md` and proposes new `REQ-AREA-NNN` stubs, flags stale items, or annotates `@srs-deferred`. Don't author the SRS-ID column inline — call via the standard Claude Code Skill mechanism (`Skill(name: "requirements-aligner", …)`). Block plan APPROVAL until every AC has a resolved SRS-ID per the skill's Phase 1 contract (configurable via `sdlc-config.json:requirements_aligner.block_on_stage_1`; ramp-up mode default-on for legacy projects).
7. **Invoke `adr-author` to decide ADR-worthiness + draft the ADR if needed.** The plan's "Architecture decisions" section is no longer authored inline as bullets — `adr-author` applies its decision tree (new third-party dependency / new database/cache/queue / new external service / pattern change spanning >3 files / HIGH-CRITICAL risk class / file-path signals from `sdlc-config.json:adr_author.file_paths_signal_architecture`), allocates the next `ADR-NNN`, drafts a Context/Decision/Consequences/Alternatives/Status stub at `docs/ADR/ADR-NNN-<slug>.md`, and injects either _"Produced ADR-NNN: <title>"_ or _"No ADR needed — <rationale>"_ into the plan's section. Call via the standard Claude Code Skill mechanism (`Skill(name: "adr-author", …)`). Configurable via `sdlc-config.json:adr_author.block_on_stage_1`; advisory by default in v1.
8. **Invoke `risk-register-keeper` for MEDIUM/HIGH risk classifications.** The plan's "Threat model" / Risks section is no longer authored as orphan bullets — when risk class is MEDIUM or HIGH (LOW skipped by default per `sdlc-config.json:risk_register_keeper.stage_1_min_risk_class`), `risk-register-keeper` reads the plan + diff, identifies discrete risks the change introduces, allocates `RISK-NNN` per project, drafts canonical rows in `compliance/risk-register.md`, and injects the RISK-NNN reference list into the plan's "Risk register entries" sub-section. The skill also enforces the `solo_with_gap` control-gap entry exists for projects in that approval mode. Call via the standard Claude Code Skill mechanism (`Skill(name: "risk-register-keeper", …)`). Configurable via `sdlc-config.json:risk_register_keeper.block_on_stage_1`; advisory by default in v1.
9. **Update `compliance/RTM.md`** with the new entry: REQ-XXX, title, risk class, linked issue, linked test cases (placeholder).
10. **Post plan summary as an issue comment.** Format: TL;DR; Risk class + signals; Acceptance criteria (with SRS-IDs); Architectural decisions (ADR-NNN reference or no-ADR rationale); Risk register entries (RISK-NNN list); Technical approach (one paragraph); Dependencies; Test scope.
11. **Checkpoint** — pause for human approval **iff** risk class is HIGH or CRITICAL. LOW and MEDIUM pass through to Phase 2 automatically. The checkpoint can be forced on for all classes via the `--require-plan-approval` flag (or `DEVAUDIT_REQUIRE_PLAN_APPROVAL=1` env var) for orgs that want it always-on.

### Phase 2 — Implement and test (SDLC stage 2)

1. **Branch off `$INTEGRATION_BRANCH`.** `git checkout "$INTEGRATION_BRANCH" && git pull && git checkout -b feat/REQ-XXX-<slug>`. The slug is a kebab-case fragment of the issue title (max 6 words).
2. **Write failing tests first** per [`Test_Architecture.md`](../../Test_Architecture.md). Depth scales with risk class:
   - LOW — unit tests on the changed function(s); no e2e required unless the change touches a user-facing flow.
   - MEDIUM — unit + integration; e2e for any UI-facing change.
   - HIGH — unit + integration + e2e for every user-visible path + at least one negative/abuse test.
   - CRITICAL — HIGH plus targeted security tests (authz bypass attempts, input fuzzing where applicable).
3. **For any e2e or visual-regression test work in this step, invoke `e2e-test-engineer`** — do not author e2e tests directly. The orchestrator passes the implementation plan + the diff so far to the e2e-test-engineer skill, which derives scenarios, reconciles with the existing pack, and runs the suite.
4. **Implement against the plan.** Reference `compliance/plans/REQ-XXX/implementation-plan.md` as you go. Any deviation from the plan must be noted in the plan itself under a `## Plan deviation` section — never silently diverge.
5. **Run gates locally, cheap-first.** The gates are not equivalent-cost — `npm run lint` is seconds, `npx playwright test` is 30–60 minutes. Iterate on the fast gates; spend the e2e cost once.

   **Fast gates** (run on every change, ideally pre-commit):
   - `npm run lint` (or stack-adapter equivalent)
   - `npx tsc --noEmit` (or stack-adapter equivalent)
   - `npx vitest run` (unit/integration)
   - `semgrep scan --config auto`
   - `npm audit --audit-level=high` (or stack-adapter equivalent)

   **E2E gate** — run _once_, after the fast gates are clean:
   - `npx playwright test` (delegated to `e2e-test-engineer`, which has its own focused-iteration discipline for within-e2e fix-and-verify loops)

6. **On gate failure**, iterate up to N=3 attempts. Each iteration: read the failure output, propose a fix, apply, re-run. On exhausted attempts, halt with the full failure output and surface to the human — never use `--no-verify`, `eslint-disable`, `@ts-expect-error`, `xfail`, or any other bypass.
7. **Commit** using Conventional Commits with `Ref: REQ-XXX` trailer and `Co-Authored-By: Claude` trailer. One commit per logical step; never amend a commit that's already been pushed.
8. **Land the work on `$INTEGRATION_BRANCH`.** Push the feature branch, then:
   - **If `$INTEGRATION_BRANCH` ≠ `$RELEASE_BRANCH`** (develop-first): open a PR `feat/REQ-XXX-<slug> → $INTEGRATION_BRANCH` and merge it once CI is green. This is the **integration hop** — there is no UAT four-eyes gate here (that's the release PR in Phase 4); for MEDIUM+ risk get a peer review on this PR per the project's norms. The push to `$INTEGRATION_BRANCH` is what triggers `ci.yml` to register the release and upload gate evidence.
   - **If `$INTEGRATION_BRANCH` = `$RELEASE_BRANCH`** (trunk-only): do **not** merge to the protected branch here — leave the work on the feature branch; it becomes the release PR's head in Phase 4.

### Phase 3 — Compile evidence (SDLC stage 3)

1. **Invoke `requirements-aligner` to drop the per-REQ SRS-alignment artefact.** The skill's Phase 2 produces `compliance/evidence/REQ-XXX/srs-alignment.md` — the per-REQ trace from each AC to its SRS item, with an operator sign-off block. The artefact uploads with `evidence_type=srs_alignment` (visible in Documents tab + audit-pack export; v1 orphan-by-design per META-COMPLY framework-registry-auditor). Call via the standard Skill mechanism; don't inline the alignment logic.
2. **Invoke `adr-author` to drop the per-REQ architecture-decision artefact.** The skill's Phase 2 produces `compliance/evidence/REQ-XXX/architecture-decision.md` — either _"Produced ADR-NNN: <title>"_ with the file pointer, or _"No ADR needed — <rationale>"_. Operator sign-off block at the bottom. The artefact uploads with `evidence_type=architecture_decision`; clause attribution per the META-COMPLY framework-registry-auditor review. Call via the standard Skill mechanism.
3. **Invoke `risk-register-keeper` to drop the per-REQ risk-assessment artefact.** The skill's Phase 3 produces `compliance/evidence/REQ-XXX/risk-assessment.md` — a summary table of RISK-NNN entries this REQ opened / mitigated / accepted, framework cross-references, and an operator sign-off block. The artefact uploads with `evidence_type=risk_assessment`; clause attribution per the META-COMPLY framework-registry-auditor review. Call via the standard Skill mechanism.
4. **Re-run the full test pack** with artefact capture:
   - `npm run test:e2e -- --reporter=html` (produces `playwright-report/`)
   - `npx vitest run --coverage` (produces `coverage/`)
5. **Organise artefacts** under `compliance/evidence/REQ-XXX/` with date-prefixed naming:

   ```
   compliance/evidence/REQ-XXX/
   ├── srs-alignment.md                  ← produced in step 1 by requirements-aligner
   ├── architecture-decision.md          ← produced in step 2 by adr-author
   ├── risk-assessment.md                ← produced in step 3 by risk-register-keeper
   ├── YYYY-MM-DD_e2e-results.json
   ├── YYYY-MM-DD_playwright-report/
   ├── YYYY-MM-DD_traces/                ← per-test trace.zip + error-context.md
   ├── YYYY-MM-DD_unit-coverage/
   └── YYYY-MM-DD_screenshots/*.png
   ```

   Copy Playwright's `test-results/` folder verbatim into `YYYY-MM-DD_traces/` so trace-by-test-name is available for audit without walking the HTML report's hash-name index. For HIGH/CRITICAL releases the traces are part of the audit trail — _"what state was the page in when test X failed and was overridden?"_ answers in one `ls` instead of an HTML-report walk.

6. **Upload each artefact to the portal**:
   ```bash
   devaudit push <project-slug> REQ-XXX <evidence-type> <file> \
     --release "v$(date +%Y.%m.%d)" --create-release-if-missing \
     --environment uat --category testing \
     --git-sha "$(git rev-parse HEAD)" \
     --branch "$(git rev-parse --abbrev-ref HEAD)"
   ```
   Evidence types: `screenshot`, `e2e_result`, `test_report`, `audit_log`, `compliance_document`, `manual_upload`, `srs_alignment` (from step 1), `architecture_decision` (from step 2), `risk_assessment` (from step 3).
7. **Verify uploads landed.** `gh api` or `curl` against `https://devaudit.metasession.co/projects/<slug>/requirements/REQ-XXX/evidence` should show every artefact.
8. **Update `compliance/RTM.md`** with portal links for each evidence row.

### Phase 4 — Submit for UAT review (SDLC stage 4)

1. **Open the release PR** — the PR that carries the UAT four-eyes approval gate (`check-release-approval.yml`), always into `$RELEASE_BRANCH`:
   - develop-first (`$INTEGRATION_BRANCH` ≠ `$RELEASE_BRANCH`): `gh pr create --base "$RELEASE_BRANCH" --head "$INTEGRATION_BRANCH"` (e.g. `develop → main`). The implementation already landed on `$INTEGRATION_BRANCH` in Phase 2; this promotes it. (Note: if other work is also waiting on `$INTEGRATION_BRANCH`, this is a bundled release — every in-scope REQ keeps its own release record and Production approval.)
   - trunk-only (`$INTEGRATION_BRANCH` = `$RELEASE_BRANCH`): `gh pr create --base "$RELEASE_BRANCH" --head feat/REQ-XXX-<slug>` (the feature branch from Phase 2).

   PR body per the SDLC PR template (see [`.github/pull_request_template.md`](../../../../../.github/pull_request_template.md)):
   - Closes #N
   - REQ-XXX
   - Risk: <class>
   - Evidence: `https://devaudit.metasession.co/projects/<slug>/requirements/REQ-XXX`
   - For HIGH/CRITICAL: Four-eyes attestation: `@<reviewer-username>`
   - For HIGH/CRITICAL: Rollback plan: reference to `compliance/plans/REQ-XXX/implementation-plan.md` §Rollback
   - Test plan
   - SDLC checklist

2. **Verify the UAT reviewer ≠ skill-trigger user** for HIGH/CRITICAL. If they match, halt with a configuration error: "HIGH/CRITICAL risk requires an independent UAT reviewer; the configured reviewer matches the trigger user — fix the four-eyes attestation slot in the implementation plan and re-run."

   **Solo-operator teams.** On a one-person team, the literal "reviewer ≠ submitter" check is structurally unsatisfiable. The supported interpretation is _actor type, not human identity_ — AI tooling (the skill-trigger) and the human operator (the portal-approver) are distinct actors. Document this on the release ticket under `## Sign-off (dual-actor)` with the explicit interpretation, and ensure the human operator has independently reviewed the diff before clicking _Approve Production_ in the portal. Without this attestation the four-eyes claim is performative.

3. **Apply labels** — `awaiting-uat-review`, `risk:<class>`.
4. **Comment on the issue**: "Implementation complete. PR #M opened. Evidence on portal: <link>. UAT review requested. Resume with `resume REQ-XXX` once UAT approval is granted on the portal."
5. **Hard stop.** Phase 4 ends here. Do not proceed to merge; the human's next action is reviewing on the portal.

**When an external gate hangs or fails for unrelated reasons.** A required gate may fail for reasons outside the change's scope — flaky infra, an unrelated regression test that hangs at hour-plus runtime with no log activity, a known-failing suite. When this happens:

1. **Verify it's actually unrelated.** Read the failure (or the lack of one). If it's the change's fault, fix it; this section does not apply.
2. **Document the rationale on the PR.** A sticky comment naming: which gate, what the failure was, why it's unrelated to the change, what the safety net is (nightly run on `$INTEGRATION_BRANCH`, post-deploy verification, etc.).
3. **Cancel-and-admin-merge is allowed** when **all three** hold: (a) ≥3 other required gates are green, (b) the change has no scope-overlap with the failing gate (e.g. service-layer fix vs hung UI e2e, or an `E2E: N/A by scope` test-plan), and (c) a fallback verification exists (nightly e2e on `$INTEGRATION_BRANCH`, post-deploy smoke, etc.). If any of the three fail, hold the merge and surface the blocker to the operator.
4. **Record the decision in the release ticket.** The release ticket's `## Verification` section must mention the cancelled gate by run-ID and the fallback that justifies bypassing it. Auditors look here first.

### Phase 5 — Finalise or change-request loop (SDLC stage 5)

Invoked separately by the user after UAT activity on the portal. Trigger: "resume REQ-XXX", "REQ-XXX UAT done", or just re-firing the skill on the same issue.

1. **Read portal state.** `curl` `https://devaudit.metasession.co/api/projects/<slug>/releases/<version>` and inspect the approval status.

2. **Branch on state:**
   - **UAT approved** → run stage 5:
     - `gh pr merge <M> --merge` (merge commit; `--squash` and `--rebase` are blocked by branch protection on SDLC repos and would break the audit trail).
     - Watch `post-deploy-prod.yml` via `gh run watch` — block until the workflow reaches a terminal state.
     - Verify production smoke evidence uploaded (`--environment production`) at `https://devaudit.metasession.co/projects/<slug>/releases/<version>`.
     - Mark release as `Released` via portal API: `PATCH /releases/<version>` with `{"status": "released"}`.
     - Comment on the issue: "Released. Production smoke evidence: <link>."
     - Close the issue.
     - If production smoke fails: do NOT mark as Released. File an `[INCIDENT]` defect issue, page the on-call per the project's incident playbook, follow the rollback plan from the implementation plan.

   - **Changes requested** → run change-request loop:
     - Fetch change-request comments from the PR (`gh pr view <M> --comments`) and from the portal release page.
     - Add a new `## Change-request iteration N` section to `compliance/plans/REQ-XXX/implementation-plan.md` describing what changed and why.
     - Re-run Phase 2 (implement + test) for the requested changes — same delegation to `e2e-test-engineer` for any e2e work.
     - Re-run Phase 3 (evidence) for the new/changed artefacts only; existing evidence stays.
     - Push to the same branch (no force-push). The PR auto-updates.
     - Re-request UAT review on the portal: `POST /api/projects/<slug>/releases/<version>/approval-requests`.
     - Comment on the issue: "Change requests addressed in commits <SHAs>. UAT re-review requested."
     - Hard stop again. The portal's release-approval state has reset; UAT must explicitly re-approve.

   - **Still pending UAT (no approval, no change-request)** → report "UAT review still pending on the portal at <link>" and stop. Do not act.

## Compliance constraints

Hard rules — the skill's SKILL.md fails review if any of these are violated. Audited against ISO 29119, ISO 27001, SOC 2, GDPR, and the EU AI Act; details in [`references/compliance-constraints.md`](./references/compliance-constraints.md).

1. **Never skip the UAT review gate** for any risk class. The portal enforces this server-side via `check-release-approval.yml`; do not attempt to merge with that check still red.
2. **For HIGH/CRITICAL, the skill MUST NOT act as the UAT approver.** Check at Phase 4 that the configured UAT reviewer differs from the skill-trigger user; halt with a configuration error otherwise. (SOC 2 CC8 — segregation of duties.)
3. **Plan checkpoint mandatory for HIGH/CRITICAL.** LOW/MEDIUM pass through Phase 1 automatically; HIGH/CRITICAL pause for human plan approval before code is written.
4. **Change-request loop triggers full UAT re-review.** The portal's release-approval state resets when new commits land on the PR — respect it. Surface a "UAT re-review needed" comment; never rely on prior approval covering subsequent changes.
5. **AI involvement disclosed on every commit** via `Co-Authored-By: Claude`. (ISO 27001 disclosure norms + EU AI Act Art. 13 transparency.)
6. **All portal mutations through audit-logged APIs.** Use `devaudit push` and the standard portal-API endpoints — never a private back-channel.

Plus one process risk surfaced explicitly in the principles below (rubber-stamping at UAT). Not enforceable architecturally — the UAT reviewer is the load-bearing human.

## Principles

**The UAT reviewer is the load-bearing human.** This skill makes it easy to produce many releases per day. The control regime depends on the UAT reviewer actually reading what they're approving. If the human approves without reviewing, the controls are formally satisfied but substantively broken — auditors will notice. Where possible, the UAT reviewer should be a different human from the skill-trigger user (mandatory for HIGH/CRITICAL).

**Never bypass a gate to ship faster.** No `--no-verify`. No `eslint-disable`. No `@ts-expect-error`. No `xfail`. No "we'll fix it in the next PR." If a gate is structurally wrong for this change, halt and surface the blocker — fix the gate, not the bypass.

**The implementation plan is the source of truth, not a one-shot artefact.** When implementation deviates from the plan (and it will), update the plan in place under a `## Plan deviation` section. The plan documents intent + reality; the RTM, the evidence, and the PR all reference it.

**Never close the issue until Phase 5 completes.** An issue closed at Phase 4 (PR opened) loses its tie to the release outcome. Closure is the signal that the change is Released; don't generate that signal prematurely.

**Never mark a release as Released without verifying production smoke evidence on the portal.** "The post-deploy workflow ran" is not the same as "production smoke evidence is on the portal." Verify the artefact landed before flipping the status.

**Confirm before destructive operations.** Force-pushing, branch deletion, tag deletion, `git reset --hard`, modifying CI/CD pipelines — all need explicit user sign-off when they arise mid-skill. The cost of confirming is a sentence; the cost of getting it wrong is real.

**Issue too big? Refuse at Phase 1.** If the issue spans multiple distinct deliverables, the right answer is "split this issue" — not "sub-divide into multiple REQs silently". Halt at Phase 1 with the proposed split for the user to confirm.

**Ambiguity is a question, not a guess.** If the issue is unclear about scope, acceptance criteria, or which subsystem is affected, ask. Implementing on guesses is worse than no implementation — it encodes the misunderstanding into evidence and the audit trail.

## References

- [`change-workflows.md`](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/change-workflows.md) — the canonical change-type taxonomy and the pickup-time **Workflow triage** decision Phase 0 runs against.
- [`references/compliance-constraints.md`](./references/compliance-constraints.md) — the six architectural constraints + the process risk, audited per framework.
- [`references/call-graph.md`](./references/call-graph.md) — sub-skill invocation map; what `sdlc-implementer` calls and when.
- [`references/change-request-loop.md`](./references/change-request-loop.md) — Phase 5 change-request flow in detail, including portal-state semantics.
- [`../e2e-test-engineer/SKILL.md`](../e2e-test-engineer/SKILL.md) — the test-work sub-skill this orchestrator delegates to.
- [`SKILLS.md`](../../../../SKILLS.md) — skill contract and conventions for the framework.
- Portal: `docs/implementing-an-sdlc-issue.md` — the user-facing walkthrough this skill automates. (Lives in the portal repo, currently private; the synced framework copy at `sdlc/files/_common/implementing-an-sdlc-issue.md` is the consumer-visible equivalent.)
- Portal: `docs/standards-coverage.md` — which SDLC artefacts satisfy which compliance clauses. (Same: portal repo, currently private.)
- [`metasession-dev/DevAudit-Installer#29`](https://github.com/metasession-dev/DevAudit-Installer/issues/29) — the umbrella issue tracking this skill's delivery.
