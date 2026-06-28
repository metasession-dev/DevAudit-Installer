---
name: sdlc-implementer
description: Take a GitHub issue end-to-end through the Metasession SDLC. Opens with a Workflow Triage step (Phase 0) that classifies the change and routes it — tracked work continues into the full cycle; housekeeping/trivial/doc-only is driven to merge down a lightweight path (same step-by-step guidance, no tracked ceremony). Use when the user wants to implement a single GitHub issue as a complete SDLC cycle — Phase 1 (classify risk, write implementation plan, update RTM) through Phase 4 (open PR, request UAT review on the portal), then halt; and Phase 5 (merge, post-deploy smoke evidence, mark Released, or change-request loop) on resume. Trigger phrases — "implement issue #N", "fix issue #N", "do issue #N", "implement #N", "implement issue #N under the SDLC", "run the SDLC for issue #N", "automate REQ-XXX from issue to release", "do the SDLC stages for [issue]". Resume phrase — "resume REQ-XXX". MUST delegate end-to-end and visual-regression test work to the e2e-test-engineer skill in Phase 2; never authors e2e tests directly. Do NOT use for partial work — for stage-1 planning only, run the manual walkthrough; for test work alone, invoke e2e-test-engineer directly.
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

**Structural enforcement (devaudit#132):** the contract is backed by two gates inside Phase 2 — a literal pre-test-work declaration before any `e2e/**/*.spec.ts` edit (step 3) and a mandatory self-audit before Phase 3 (step 9). Both are scripts the orchestrator follows, not prose it can rationalise around. If you find yourself about to skip either, that's the inertia trap the gates exist to interrupt — STOP, run the gate, and you'll usually find the delegation path is obvious from there.

Unit-test and integration-test work stays with this skill until a counterpart unit-test skill ships. The full sub-skill call graph lives at [`references/call-graph.md`](./references/call-graph.md).

## Sub-skill return semantics (devaudit-installer#144)

**Sub-skills return findings synchronously; do not wait for operator confirmation between sub-skill returns.** Invoking a Skill loads its instructions into this same invocation context — there is no separate agent, no separate process. When a sub-skill emits its final summary and stops, this orchestrator's next step runs immediately, in the same turn if possible.

The literal phrasing _"Returns to the running `sdlc-implementer` context"_ at the tail of each sub-skill (`requirements-aligner`, `adr-author`, `risk-register-keeper`, and any future siblings) does **not** mean "pause and wait for the operator to nudge you" — it means "you have control again; keep going with the parent workflow." A chain of three sub-skill calls in Phase 1 (steps 6 → 7 → 8) or Phase 3 (steps 1 → 2 → 3) is a single flowing sequence; do not stop between them.

The only pauses in the whole workflow are the explicitly-named checkpoints:

- **Phase 1 step 11** — pause for human approval **iff** risk class is HIGH or CRITICAL (or `--require-plan-approval` is set).
- **Phase 4 step 5** — hard stop, release PR opened, awaiting UAT review on the portal.
- **Phase 5** — invoked separately by the user (`resume REQ-XXX`).

Everything else is silent continuation. The rule is **opt-in-to-pause, not opt-out-of-pause**. If you find yourself stopping after a sub-skill's "Return to the running `sdlc-implementer` context" line and waiting for the operator to ask _"is anything happening?"_ — that is the bug this section exists to prevent. Keep going.

### False stopping points (devaudit-installer#194)

The following milestones **feel** like completion boundaries but are mid-flow — do NOT halt at any of them:

- **Sub-skill return** — covered above (#144).
- **Phase 2 integration PR merged to `develop`** — the merge is the trigger for CI to upload binary gate evidence, not a handoff to the operator. Once CI is green on `develop`, immediately begin Phase 3 (compile evidence). The next required operator handoff is Phase 4 step 5 (release PR opened, awaiting portal UAT approval), not the develop merge.
- **CI going green on `develop`** — this is the signal to proceed, not to stop and report.
- **Evidence upload completing** — the `devaudit push` calls in Phase 3 are intermediate steps; proceed to the next artefact or the next phase.

If you find yourself halting at any of these, state the literal line `Continuing — this is not a checkpoint.` and proceed to the next step in the same turn. The only thing that may interrupt the auto-continue is the scope-expansion halt gate (#171) firing on a new user request.

## Scope-expansion halt gate (devaudit-installer#171)

The change-request loop's scope-expansion halt rule (see [`references/change-request-loop.md`](./references/change-request-loop.md) §"If the change-request is fundamentally a different REQ") only fires during Phase 5 — after a UAT reviewer clicks "Request Changes" and the portal state is `uat_changes_requested`. In practice, scope-expanding requests also arrive from the user at any point after Phase 1:

- During Phase 2 (implementation) — user spots a related improvement and asks the agent to add it
- During Phase 3 (evidence compile) — user asks for an additional evidence artefact not in the plan
- During Phase 4 (UAT submission) — user exercises the deployed app and asks for a behaviour change
- Between UAT submission and approval — same scenario
- After approval but before merge — user makes a last-minute request

In all these cases, the portal state is NOT `uat_changes_requested`, so the change-request loop's halt rule never fires. The agent implements the out-of-scope change without flagging it.

**This gate fires on every user work request while a REQ is active, in any phase.**

When the user asks for a change that goes beyond the current REQ's acceptance criteria:

1. **Read the current REQ's `test-scope.md`** (or `implementation-plan.md` § Acceptance Criteria if no test-scope exists yet) to identify the defined ACs.

2. **Check whether the user's request maps to an existing AC.** If yes — proceed (or enter the change-request loop if in Phase 5).

3. **If no — halt with the scope-expansion message:**

   > This request adds behaviour outside REQ-XXX's acceptance criteria (AC1–ACn defined in test-scope.md). Recommend filing a separate issue for \<subject\> and shipping REQ-XXX as originally scoped.

4. **Wait for the user to confirm one of:**
   - **(a) File a separate issue** (new REQ) — ship the current REQ as-is. The agent continues with the original scope.
   - **(b) Amend REQ-XXX's scope** — explicitly expand `test-scope.md` / `test-plan.md` / `implementation-plan.md`, update the plan, invalidate existing evidence, and re-walk Stage 3. Re-extract both `test-scope.md` and `test-plan.md` from the updated plan (Phase 1 step 5b drift management). This option carries a warning: *"Amending scope after evidence is compiled (Stage 3+) invalidates the existing test-execution-summary, screenshots, and UAT verification. All Stage 3 evidence must be re-compiled."*
   - **(c) Abandon the request** — do nothing, continue with the original scope.

**Do not implement the out-of-scope change before the user picks (a), (b), or (c).** The inertia trap is real: the agent is mid-flow, the codebase is open, and the request sounds reasonable. The gate exists to interrupt that inertia — STOP, surface the scope gap, and let the user decide.

This gate is distinct from Phase 2 step 4's "any deviation from the plan must be noted" rule: that covers implementation *approach* deviations (how to build something the plan says to build), not *scope* expansions (building something the plan doesn't say to build at all).

## Requirements gap flow (devaudit-installer#212)

A **requirements gap** is "the ACs themselves were wrong, incomplete, or missing" — discovered by the skill or sub-skills mid-cycle, not by a user request. This is distinct from:

- **Scope expansion** (user asks for something beyond the ACs → scope-expansion halt gate above)
- **Defect** (implementation doesn't match the ACs → incident filing)

### When it fires

The requirements gap flow is triggered by:

- **Phase 2 step 4** — plan deviation classified as "requirements deviation" (an AC is wrong/incomplete/missing, not just the implementation approach)
- **Phase 3 step 1** — `requirements-aligner` returns `GAPS_FOUND` (ACs that don't trace to SRS items, or unresolved drift)
- **Phase 2** — `e2e-test-engineer` classifies an AC as "impossible to test" or "missing AC" (returns a requirements gap report instead of filing a defect)
- **Phase 3 step 4** — test failure classified as "requirements gap" (test is correct, implementation is correct, but the AC they both derive from is wrong)
- **Phase 5** — change-request loop classifies feedback as "requirements gap" (reviewer identified behaviour that should have been an AC but wasn't)

### The flow

When any skill or sub-skill discovers a requirements gap, it surfaces a **requirements gap report**:

- Which AC is affected (or which missing AC should exist)
- What's wrong (impossible to satisfy / incomplete / incorrect / missing)
- What the corrected or new AC should be
- Impact on existing evidence (what needs re-compilation)

The `sdlc-implementer` presents the operator with three options:

**(a) Accept the gap** — proceed as-is. Mark the AC with `@requirements-gap-accepted: <reason>` in the plan. Document in a `## Requirements gap accepted` section: the gap, the reason for acceptance, and the operator's name + date. Appropriate for LOW-risk or when the gap is cosmetic. Continue from the current phase.

**(b) Amend the ACs** — update the plan's AC table, re-invoke `requirements-aligner` to propose new/updated SRS stubs, operator edits SRS stubs into canonical prose, update the RTM, invalidate affected evidence, re-walk affected phases. This carries the same evidence-invalidation warning as the scope-expansion halt gate option (b): *"Amending ACs after evidence is compiled (Phase 3+) invalidates the existing test-execution-summary, screenshots, and UAT verification. All affected Stage 3 evidence must be re-compiled."*

Amendment steps:
1. Update `compliance/plans/REQ-XXX/implementation-plan.md` AC table
2. Re-invoke `requirements-aligner` → propose new/updated SRS stubs
3. Operator edits SRS stubs into canonical Given/When/Then prose in `docs/SRS.md`
4. Update `compliance/RTM.md`
5. Re-extract `compliance/evidence/REQ-XXX/test-scope.md` and `compliance/evidence/REQ-XXX/test-plan.md` from the updated plan (Phase 1 step 5b drift management, devaudit-installer#226)
6. Commit: `compliance: [REQ-XXX] amend ACs — requirements gap <description>`
7. If Phase 2+: re-run affected tests (delegating to `e2e-test-engineer` if e2e)
8. If Phase 3+: re-compile affected evidence
9. Continue from current phase

**(c) File a follow-up REQ** — ship the current REQ as-is, file a separate issue for the requirements gap. Appropriate when the gap is a genuine new behaviour that deserves its own cycle. Continue with the current REQ unchanged.

### Distinction from scope-expansion halt gate

- Triggered by **skill/sub-skill discovery**, not by a user request
- Includes "accept the gap" option (scope-expansion gate doesn't — scope expansion is always halt-or-amend)
- Classification is "the requirements were wrong" not "the user wants more"

## SDLC navigability — LAST/NEXT status sticky (devaudit#131)

Long-running SDLC issues accumulate dozens of comments across multiple Claude Code sessions. The operator returning to the thread should be able to answer two questions in under five seconds:

1. **What just happened?** — the most recent stage completion
2. **What is the immediate next step?** — the single action the operator (or this skill on resume) should take next

Two surfaces, one convention. Both are mandatory:

### 1. Sticky comment on the REQ issue

At **every stage transition** AND **every operator-action handoff** (waiting for review, waiting for merge, waiting for prod apply), invoke the helper:

```bash
bash scripts/update-sdlc-status.sh "$ISSUE_NUM" \
  "<one sentence describing the step just completed>" \
  "<one sentence describing the immediate next step + actor>"
```

The helper is idempotent — finds the marker-tagged comment and edits it, or creates one if none exists. So calling it on every transition keeps the same comment current; it never spawns duplicates.

LAST sentence rules:

- One sentence. Name the phase / artefact / outcome.
- Include load-bearing identifiers — PR numbers, file paths, gate names — so the operator can act without re-scrolling.
- Past tense.

NEXT sentence rules:

- One sentence. **Always name the actor** (operator action / `sdlc-implementer` auto-continues / waiting for CI / waiting for review).
- Include the artefact to act on — issue number, PR number, migration path, command to run.
- If the next step is operator-only and we're paused: say so explicitly. "Operator action — apply Prisma migration 13 to prod, then merge develop→main PR #458."

Examples:

```
LAST: Phase 1 complete — implementation plan written to compliance/plans/REQ-074/implementation-plan.md (risk class MEDIUM)
NEXT: Phase 2 — sdlc-implementer auto-continuing
```

```
LAST: Phase 4 — release PR #455 opened against develop, CI running
NEXT: Operator action — review PR #455 + merge when CI green; sdlc-implementer halts here until you ping resume REQ-074
```

```
LAST: Phase 5 complete — release v1.2.0 marked Released; post-deploy smoke evidence uploaded
NEXT: Done — close issue + retire feature branch (sdlc-implementer halts)
```

### 2. In-chat LAST/NEXT line (Claude Code surface)

Lead every substantive turn with a driver tag on the **first line**, then the two-line LAST/NEXT shape so the operator can `Ctrl-F NEXT:` in the chat transcript to find the current pointer without re-reading:

```
[Agent driving]   — or —   [Operator driving]   — or —   [Blocked]

**LAST:** <one sentence>
**NEXT:** <one sentence with actor>
```

The driver tag is mandatory and comes **before** the LAST/NEXT lines:

- **`[Agent driving]`** — the skill is auto-continuing; no human action needed right now. The operator can look away.
- **`[Operator driving]`** — the skill has halted; the human must do something (review, approve, merge, answer a question). The NEXT line states the specific action needed.
- **`[Blocked]`** — something failed and the skill cannot proceed. State the blocker and the operator action needed to unblock.

The tag reflects the **final** state of the response — if the skill was driving but hits a halt mid-turn, the tag is `[Operator driving]` or `[Blocked]`.

Skip the tag and LAST/NEXT for trivial turns (acknowledging a "merged" / one-line confirmations / chitchat). It's for SDLC work, not every message. The two surfaces (sticky comment + chat line) should always agree — if they diverge, the comment is canonical (it's what the operator scrolling the issue sees).

### When to update

- After every Phase transition (Phase 0 → 1, 1 → 2, …, 5 → done)
- On every operator-action handoff (paused for review, paused for merge, paused for prod apply, paused for migration)
- On the change-request loop (Phase 5 rejection → re-enter Phase 2)
- On error halt (gate failure exhausted retries, operator-only decision needed)

Do **not** update on every internal step within a phase — that just spams the sticky. The transition + handoff cadence is the right frequency.

**Sticky update failure (devaudit-installer#211 Gap 14).** Check the exit code of `update-sdlc-status.sh`. If it fails (gh auth expired, GitHub API rate-limited, network error), log a warning in the chat: "⚠️ SDLC status sticky update failed (gh CLI error). The LAST/NEXT pointer on issue #N may be stale. Operator — update manually if needed." Continue the workflow — the sticky is a navigation aid, not a control gate.

## The workflow

A triage step (Phase 0) routes the issue, then up to five phases for tracked work. Phase 0 plus Phases 1–4 run in one Claude Code session; Phase 5 is invoked separately by the user after UAT. The off-ramps from Phase 0 (housekeeping / trivial / doc-only) don't enter Phase 1 — they run the **Lightweight path** (below), which the skill drives to merge.

**Branch targets are project-configured — never hardcode `main` / `develop`.** Read them once from `sdlc-config.json` and use them throughout:

```bash
INTEGRATION_BRANCH=$(jq -r '.integration_branch // "develop"' sdlc-config.json)  # where work lands + ci.yml uploads gate evidence
RELEASE_BRANCH=$(jq -r '.release_branch // "main"' sdlc-config.json)             # the protected production branch
```

The framework uses a **develop-first** branching model: implementation lands on `$INTEGRATION_BRANCH` (default `develop`), and the UAT-approved release PR is `$INTEGRATION_BRANCH → $RELEASE_BRANCH` (default `main`). The release PR's head is always `$INTEGRATION_BRANCH`.

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
   - **tracked** (feature / bug fix / refactor / perf) → continue into Phase 1 below (full Stages 1–5). **Write the skill-invocation sentinel** (devaudit-installer#226): `node SDLC/bin/devaudit-sdlc.js --phase=issue` (or `node SDLC/bin/devaudit-sdlc.js --phase=issue` if the npm package is installed). This invokes the CLI engine, which appends a JSON phase record to `.sdlc-implementer-invoked` (a gitignored, local-only file). The pre-push hook checks for this file's existence before allowing `feat`/`fix`/`refactor`/`perf` commits to be pushed. Without this sentinel, the pre-push hook will refuse the push and `validate-commits.sh` in CI will flag missing RTM provenance. Each subsequent phase transition (Phase 1, 2, 3, 4, 5) must also invoke `node SDLC/bin/devaudit-sdlc.js --phase=<N>` to append its phase record to the sentinel.
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

**CI trigger shape — read once before step 7.** DevAudit-Installer-generated `ci.yml.template` runs `Quality Gates` on PRs to the integration branch and on pushes to the integration branch. Older consumers may still have post-merge-only CI (`push: branches: [<integration>]`, no `pull_request:` trigger) until they re-run `devaudit update`. The skill must adapt step 7's wording to whichever shape the project uses; never poll a PR for checks that won't arrive on that consumer yet.

1. **Branch off `$INTEGRATION_BRANCH`** with a housekeeping prefix — `chore/…`, `docs/…`, `ci/…`, `build/…`, `test/…`, or `compliance/…` for a doc-only change against an existing REQ.
2. **Make the change**, single-purpose. If it turns out to touch runtime behaviour in `app/` / `lib/`, stop and reclassify as tracked — the commit-type rule is the backstop. **Transition:**
   - **PR not yet merged:** Close the PR (`gh pr close <N>`), delete the branch, restart from Phase 0 with the tracked classification. The housekeeping commit is abandoned (branch deleted).
   - **PR already merged:** Halt — "This change was classified as housekeeping and merged, but implementation touched runtime behaviour (`app/` / `lib/`). The commit <SHA> is on `$INTEGRATION_BRANCH` without REQ tracking, evidence, or portal release. Operator action — decide: (a) revert the merge and re-run as tracked (`git revert <SHA>` + new `sdlc-implementer` invocation), or (b) accept the gap and file a retroactive REQ-XXX to backfill evidence. Option (b) leaves a compliance gap — the change shipped without plan, test scope, or UAT review."
3. **Run all gates locally** (`npm run lint`, `npx tsc --noEmit`, the test suite, `semgrep`, `npm audit` — or the stack-adapter equivalents). Trivial ≠ unverified; never `--no-verify`.
4. **Commit** with a housekeeping type and **no** `REQ-XXX` — `docs:` / `chore:` / `ci:` / `build:` / `test:` / `revert:` are exempt from the `[REQ-XXX]` rule; a `compliance:` doc-only change references the existing REQ. `Co-Authored-By: Claude` if AI-assisted.
5. **Push and open the PR** into `$INTEGRATION_BRANCH` (`gh pr create --base "$INTEGRATION_BRANCH" --head <branch>`). CI runs the same quality gates; `compliance-validation.yml` finds no `REQ-XXX` and skips artifact validation.
6. **For `ci:` changes, verify-via-dispatch before merging.** `gh workflow run <workflow.yml> --ref <branch>` fires the modified workflow against the PR branch. If the change broke a step, the dispatch run fails loudly and you fix-forward _before_ the merge ships the broken gate to `$INTEGRATION_BRANCH`. This is the cheapest insurance against silent CI regressions — a `ci:` change that breaks a gate is most damaging _after_ it lands.
7. **Report honest status — adapt to the project's CI trigger shape (devaudit-installer#145).** Check whether `.github/workflows/ci.yml` has a `pull_request:` trigger.
   - **PR-time CI present (current DevAudit default)** — wait for `gh pr checks <PR>` to report `Quality Gates`, name any failing check, fix and re-push. Never announce "ready" while a required check is red. Release registration and evidence upload still happen on the post-merge push to `$INTEGRATION_BRANCH`.
   - **Post-merge-only CI (older generated workflows — `push: branches: [<integration>]` with no `pull_request:` trigger)** — say so explicitly in the LAST/NEXT sticky: _"no PR-time checks will fire; review + merge is the gate; CI runs post-merge on `$INTEGRATION_BRANCH`."_ Don't poll the PR for checks that won't arrive. The post-merge run (CI Pipeline + Compliance Evidence Upload on the integration branch) is the actual gate; address it via fix-forward if it fails.

   Either way, never bypass a gate (no `--no-verify`, no `--admin` merge of a red required check); the only difference is **where** you wait for the gate to fire — before merge vs. after merge.
8. **Guide review → merge.** A human still reviews the PR (separation of duties). There is **no** portal release approval, no UAT four-eyes, no Production gate, and no close-out. Merge once CI is green and the reviewer approves.
9. **Done.** A housekeeping push produces at most a bare-date release (`vYYYY.MM.DD`) with no approval gate; a doc-only push attaches its docs to the existing `REQ-XXX` release. No further action required — report completion and stop.

### Phase 1 — Plan (SDLC stage 1)

Reached only on the **tracked** route from Phase 0 (the issue is already fetched and classified).

0. **Initialise SDLC status sticky** on the issue: `bash scripts/update-sdlc-status.sh "$ISSUE_NUM" "Phase 0 complete — classified as tracked SDLC work" "Phase 1 — sdlc-implementer authoring implementation plan"`. From now until the issue closes, the sticky is the always-current pointer to "what's next" — the operator scans it on every return to the issue.
1. **Confirm the issue scope.** Re-read the `gh issue view <N>` output from Phase 0 — title, body, all comments — with implementation in mind.
2. **Classify risk** per `Test_Policy.md` §Risk-Based Testing. Emit a one-paragraph rationale citing the signals you used (auth surface, financial calc, data egress, RBAC, AI decisioning, etc.).
3. **Assign REQ-XXX.** Inspect `compliance/RTM.md` for existing entries; take the next free number. If the issue references an existing REQ, use that instead. **Create the portal release immediately** (DevAudit-Installer#200 Fix 3) by running `bash scripts/upload-evidence.sh {{PROJECT_SLUG}} REQ-XXX compliance_document compliance/evidence/REQ-XXX/test-scope.md --category planning --release REQ-XXX --create-release-if-missing --environment uat --sdlc-stage 1` (or a placeholder file if test-scope.md isn't written yet). This ensures: (a) incident reports during Stage 2 implementation attach to the correct `REQ-XXX` release instead of a bare-date housekeeping release, (b) planning evidence can upload as Stage 1 evidence, (c) CI `register-release` on push to `develop` becomes a safety net (finds the existing release) rather than the primary creation mechanism.
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

5b. **Extract `test-scope.md` and `test-plan.md` from the implementation plan (devaudit-installer#226).** After step 5, extract two artefacts from the plan into `compliance/evidence/REQ-XXX/` so CI's `validate-compliance-artifacts.sh` finds them in the expected location:

   - **`compliance/evidence/REQ-XXX/test-scope.md`** — the AC table with SRS-IDs, risk class, and verification method per AC. Extracted from the plan's "Acceptance criteria" table.
   - **`compliance/evidence/REQ-XXX/test-plan.md`** — the test file listing with AC coverage mapping: which test file covers which AC, test type (unit/integration/e2e), and whether each AC has at least one test. Extracted from the plan's "Test scope" section.

   These files are the CI validator's expected artefacts. Without them, `validate-compliance-artifacts.sh` fails and the pre-push hook blocks the push. The plan directory (`compliance/plans/REQ-XXX/`) retains the full plan; these are extracted subsets for CI validation.

   **Drift management (devaudit-installer#226).** If the plan's AC table changes after step 5b (requirements gap flow option (b), scope-expansion halt gate option (b), or plan deviation), re-extract both `test-scope.md` and `test-plan.md` from the updated plan. The extracted files must always match the plan's current AC table. Phase 2 step 5b checks plan ↔ test-scope AC consistency before running E2E.

6. **Invoke `requirements-aligner` to populate the SRS-ID column on the AC table.** The plan's "Acceptance criteria" table carries an SRS-ID column per AC; `requirements-aligner` fuzzy-matches each AC against `docs/SRS.md` and proposes new `REQ-AREA-NNN` stubs, flags stale items, or annotates `@srs-deferred`. Don't author the SRS-ID column inline — call via the standard Claude Code Skill mechanism (`Skill(name: "requirements-aligner", …)`). Block plan APPROVAL until every AC has a resolved SRS-ID per the skill's Phase 1 contract (configurable via `sdlc-config.json:requirements_aligner.block_on_stage_1`; ramp-up mode default-on for legacy projects).

   **SRS stub editing (devaudit-installer#212 Gap 5).** After `requirements-aligner` returns, the plan's SRS items proposed/touched section may contain N new stubs and M stale items. The operator must edit `docs/SRS.md` to flesh out the stubs into canonical Given/When/Then prose and update stale items. Do not proceed to Phase 2 until the SRS is updated. The skill enforces this by checking that no stub placeholders remain in `docs/SRS.md` for the proposed SRS-IDs before auto-continuing. A stub placeholder is any SRS entry containing `<TODO>` or the `@srs-stub` marker.
7. **Invoke `adr-author` to decide ADR-worthiness + draft the ADR if needed.** The plan's "Architecture decisions" section is no longer authored inline as bullets — `adr-author` applies its decision tree (new third-party dependency / new database/cache/queue / new external service / pattern change spanning >3 files / HIGH-CRITICAL risk class / file-path signals from `sdlc-config.json:adr_author.file_paths_signal_architecture`), allocates the next `ADR-NNN`, drafts a Context/Decision/Consequences/Alternatives/Status stub at `docs/ADR/ADR-NNN-<slug>.md`, and injects either _"Produced ADR-NNN: <title>"_ or _"No ADR needed — <rationale>"_ into the plan's section. Call via the standard Claude Code Skill mechanism (`Skill(name: "adr-author", …)`). Configurable via `sdlc-config.json:adr_author.block_on_stage_1`; advisory by default in v1.
8. **Invoke `risk-register-keeper` for MEDIUM/HIGH risk classifications.** The plan's "Threat model" / Risks section is no longer authored as orphan bullets — when risk class is MEDIUM or HIGH (LOW skipped by default per `sdlc-config.json:risk_register_keeper.stage_1_min_risk_class`), `risk-register-keeper` reads the plan + diff, identifies discrete risks the change introduces, allocates `RISK-NNN` per project, drafts canonical rows in `compliance/risk-register.md`, and injects the RISK-NNN reference list into the plan's "Risk register entries" sub-section. The skill also enforces the `solo_with_gap` control-gap entry exists for projects in that approval mode. Call via the standard Claude Code Skill mechanism (`Skill(name: "risk-register-keeper", …)`). Configurable via `sdlc-config.json:risk_register_keeper.block_on_stage_1`; advisory by default in v1.

**Sub-skill failure behavior (devaudit-installer#211 Gap 15).** If a sub-skill fails during steps 6–8, behavior is defined per-skill:
- **`requirements-aligner` fails** (e.g. no `docs/SRS.md`): If `block_on_stage_1` is true, halt — "requirements-aligner could not find SRS.md. Operator action — create `docs/SRS.md` or disable `requirements_aligner.block_on_stage_1` in `sdlc-config.json`." If false, warn and continue with `@srs-deferred` on all ACs.
- **`adr-author` fails**: Warn and continue — ADR is advisory by default. Mark the plan's "Architecture decisions" section as "ADR assessment skipped — <error>".
- **`risk-register-keeper` fails**: If `block_on_stage_1` is true, halt. If false, warn and continue — mark the plan's "Risk register entries" section as "Risk assessment skipped — <error>".
9. **Update `compliance/RTM.md`** with the new entry: REQ-XXX, title, risk class, linked issue, linked test cases (placeholder), and a provenance marker `sdlc-implementer@<version>` (devaudit-installer#226). The provenance column is the last column in the RTM row — `validate-commits.sh` in CI checks for its presence when `feat`/`fix`/`refactor`/`perf` commits cite a REQ-XXX. Without the stamp, CI fails with "no sdlc-implementer provenance in RTM.md." If the RTM table doesn't have a provenance column, add one with header `Provenance`.
10. **Post plan summary as an issue comment.** Format: TL;DR; Risk class + signals; Acceptance criteria (with SRS-IDs); Architectural decisions (ADR-NNN reference or no-ADR rationale); Risk register entries (RISK-NNN list); Technical approach (one paragraph); Dependencies; Test scope.
11. **Checkpoint** — pause for human approval **iff** risk class is HIGH or CRITICAL. LOW and MEDIUM pass through to Phase 2 automatically. The checkpoint can be forced on for all classes via the `--require-plan-approval` flag (or `DEVAUDIT_REQUIRE_PLAN_APPROVAL=1` env var) for orgs that want it always-on.
12. **Update SDLC status sticky** before exiting Phase 1: `bash scripts/update-sdlc-status.sh "$ISSUE_NUM" "Phase 1 complete — plan written to compliance/plans/REQ-XXX/implementation-plan.md (risk class <CLASS>)" "Phase 2 — sdlc-implementer auto-continuing"` (or "Operator action — review plan + ping resume" if the HIGH/CRITICAL checkpoint paused).

### Phase 2 — Implement and test (SDLC stage 2)

1. **Branch off `$INTEGRATION_BRANCH`.** `git checkout "$INTEGRATION_BRANCH" && git pull && git checkout -b feat/REQ-XXX-<slug>`. The slug is a kebab-case fragment of the issue title (max 6 words). **Advisory — concurrent REQ check:** check for existing open PRs to `$INTEGRATION_BRANCH` that touch overlapping files (`gh pr list --base "$INTEGRATION_BRANCH" --state open --json files`). If overlap is detected: warn the operator — "PR #M (REQ-YYY) is open and touches <overlapping files>. Merging this REQ first may cause conflicts for REQ-YYY. Proceed with caution." This is advisory, not blocking.
2. **Write failing tests first** per [`Test_Architecture.md`](../../Test_Architecture.md). Depth scales with risk class:
   - LOW — unit tests on the changed function(s); no e2e required unless the change touches a user-facing flow.
   - MEDIUM — unit + integration; e2e for any UI-facing change.
   - HIGH — unit + integration + e2e for every user-visible path + at least one negative/abuse test.
   - CRITICAL — HIGH plus targeted security tests (authz bypass attempts, input fuzzing where applicable).
3. **E2E delegation gate — pre-test-work declaration (devaudit#132).** Before creating or editing **any** `e2e/**/*.spec.ts` file in this phase, follow these three steps in order. The literal script exists because the "MUST invoke" prose alone has been bypassed by inertia in past runs; the declaration is the structural defence.

   a. Output the single literal line, verbatim: `Delegating e2e test work to e2e-test-engineer.`
   b. Immediately invoke `Skill(name: "e2e-test-engineer", args: "<the change summary + plan pointer>")`. The change summary is one sentence; the plan pointer is `compliance/plans/REQ-XXX/implementation-plan.md`.
   c. **Do not author or edit any `e2e/**/*.spec.ts` file in this skill's own tool calls.** The e2e-test-engineer skill owns spec authoring end-to-end — including the "this AC needs no e2e" decision. If you feel the urge to write a spec inline, that's the inertia trap — STOP and re-invoke the skill.

   When in doubt about whether work qualifies: visual-regression tests, screenshot diffs, browser-driven flows, any file ending in `.spec.ts` under `e2e/`, and any `playwright.config.ts`/`evidence/`/`baselines/` directory all qualify. Unit/integration tests under `tests/unit/`, `tests/integration/`, or stack-equivalent paths stay with this orchestrator.
4. **Implement against the plan.** Reference `compliance/plans/REQ-XXX/implementation-plan.md` as you go. Any deviation from the plan must be classified:
   - **Implementation deviation** (approach changed, ACs still correct) — note in a `## Plan deviation` section of the plan. Continue.
   - **Requirements deviation** (an AC is wrong, incomplete, or missing) — trigger the [requirements gap flow](#requirements-gap-flow-devaudit-installer212). Do NOT just note it as a plan deviation. The AC table must be updated, `requirements-aligner` must be re-invoked to re-check SRS alignment, and the RTM must be updated.
   
   The classification question: "Did the implementation deviate from the plan's approach (how to build it), or did the plan's requirements deviate from reality (what to build)?" If the former, note and continue. If the latter, trigger the requirements gap flow.

4b. **Reconcile test-plan.md file paths with actual files (devaudit-installer#241).** After writing/updating tests (both unit and E2E), diff the actual test file paths against `compliance/evidence/REQ-XXX/test-plan.md`. The test plan was authored during Stage 1 with predicted file paths — during implementation, tests are often added to existing files instead of creating new ones. This is a natural drift, but it must be reconciled before committing so `validate-compliance-artifacts.sh` doesn't fail at PR time.

   For each file path referenced in `test-plan.md`:
   - If the file exists on disk → OK, no action needed.
   - If the file does not exist → check whether a test covering the same AC was added to a different file. If so, update `test-plan.md` to reference the actual file path.
   - If the file does not exist and no equivalent test was found → **HALT**: "test-plan.md references <file> but no test file exists and no equivalent test covering the same AC was found. Either create the test file, update test-plan.md to point to the actual test file, or remove the entry if the AC is no longer relevant."

   Commit the updated `test-plan.md` alongside the test code. This is a file-path reconciliation — it does not change the AC table (that's the step 5b plan ↔ test-scope AC consistency check, which is separate and checks AC drift, not file-path drift).
5. **Run gates locally, cheap-first.** The gates are not equivalent-cost — `npm run lint` is seconds, `npx playwright test` is 30–60 minutes. Iterate on the fast gates; spend the e2e cost once.

   **Fast gates** (run on every change, ideally pre-commit):
   - `npm run lint` (or stack-adapter equivalent)
   - `npx tsc --noEmit` (or stack-adapter equivalent)
   - `npx vitest run` (unit/integration)
   - `semgrep scan --config auto`
   - `npm audit --audit-level=high` (or stack-adapter equivalent)

   **E2E gate** — run _once_, after the fast gates are clean:
   - `npx playwright test` (delegated to `e2e-test-engineer`, which has its own focused-iteration discipline for within-e2e fix-and-verify loops)

5b. **E2E gate verification — mandatory before commit (devaudit-installer#226).** After running gates in step 5, verify the E2E gate actually ran before proceeding to step 7 (commit). This is the skill-level enforcement that backs the pre-push hook.

   Check whether the change touches UI-facing files:
   ```bash
   git diff --name-only "$INTEGRATION_BRANCH"...HEAD -- 'app/**/*.tsx' 'src/**/*.tsx' 'pages/**/*.tsx' 'app/**/*.jsx' 'src/**/*.jsx' 'pages/**/*.jsx'
   ```

   - **If UI-facing files are present:** check for `.e2e-gate-passed` sentinel file (written by `e2e-test-engineer` after a successful run) or `playwright-report/` directory with recent content. If neither exists, **HALT**: "E2E gate was not run. The change touches UI-facing files. Run `npx playwright test` (or invoke `e2e-test-engineer`) before committing. Do not defer to CI — install Playwright browsers with `npx playwright install` if needed. The pre-push hook will also block this push."

     **Also check for `.e2e-evidence-wired` sentinel (devaudit-installer#226).** If `e2e/**/*.spec.ts` files were authored or modified, verify the `.e2e-evidence-wired` sentinel exists (written by `e2e-test-engineer` Phase 5½ after validating `tagTest()` and `evidenceShot()` calls). If missing, **HALT**: "Evidence wiring validation (Phase 5½) was not run. The change includes E2E spec files but no evidence wiring sentinel. Invoke `e2e-test-engineer` to validate `tagTest()` and `evidenceShot()` calls before committing. The pre-push hook will also block this push."
   - **If no UI-facing files (API-only, config, docs):** skip the check. Note the exemption in the commit body: "E2E gate skipped — no UI-facing files in this change."
   - **If `e2e-test-engineer` was invoked and determined e2e is not needed** (e.g. schema-only change): the skill writes `.e2e-gate-passed` with a `NOT_NEEDED` reason. The sentinel check passes. Note the exemption in the commit body: "E2E gate not needed — e2e-test-engineer assessed no UI surface (turn N)."

   **Plan ↔ test-scope AC consistency check (devaudit-installer#226 drift management).** Before running E2E, verify the AC table in `compliance/plans/REQ-XXX/implementation-plan.md` matches `compliance/evidence/REQ-XXX/test-scope.md`. Compare the AC IDs in both files — if they diverge (new AC added to plan but not re-extracted, or AC removed from plan but still in test-scope), **HALT**: "test-scope.md is out of sync with implementation-plan.md. AC IDs differ: <diff>. Re-extract test-scope.md and test-plan.md from the updated plan (Phase 1 step 5b) before running E2E."

6. **On gate failure**, iterate up to N=3 attempts. Each iteration: read the failure output, propose a fix, apply, re-run. On exhausted attempts, halt with the full failure output and explicit resume instructions: "Gate <name> failed after N=3 attempts. Last failure: <output>. Operator action — fix the failure, commit to the feature branch, push, then ping `resume REQ-XXX`. The skill will re-run the gate from where it left off." Update the sticky with the same. Never use `--no-verify`, `eslint-disable`, `@ts-expect-error`, `xfail`, or any other bypass.
7. **Commit** using Conventional Commits with `Ref: REQ-XXX` trailer and `Co-Authored-By: Claude` trailer. One commit per logical step; never amend a commit that's already been pushed.
8. **Land the work on `$INTEGRATION_BRANCH`.** Push the feature branch, then open a PR `feat/REQ-XXX-<slug> → $INTEGRATION_BRANCH` and merge it once CI is green. This is the **integration hop** — there is no UAT four-eyes gate here (that's the release PR in Phase 4); for MEDIUM+ risk get a peer review on this PR per the project's norms. The push to `$INTEGRATION_BRANCH` is what triggers `ci.yml` to register the release and upload gate evidence. **Merge conflict resolution:** if the PR has merge conflicts (another feature branch merged first), pull the latest `$INTEGRATION_BRANCH` into the feature branch (`git merge "$INTEGRATION_BRANCH" --no-edit`), resolve conflicts (preferring the feature branch's changes for files this REQ touches), push, wait for CI. If conflicts are in files this REQ doesn't touch, halt — "Merge conflict in <files> from another feature. Operator action — review the conflict, these files are outside REQ-XXX's scope."

9. **E2E delegation self-audit — mandatory before Phase 3 (devaudit#132).** Run `git diff "$INTEGRATION_BRANCH"...HEAD --name-only` and walk the file list. For **every** entry matching `e2e/**/*.spec.ts`, state out loud one of:

   - _"Authored via `e2e-test-engineer` skill invocation on turn N."_ — with the turn pointer the operator can verify from the chat transcript.
   - _"Pre-existing file; only mechanical edits (path renames, import fixes, lint-only) applied directly. No scenario / assertion / selector changes."_ — applies only to non-substantive sweeps where the e2e-test-engineer skill would have nothing to contribute.

   If you cannot place a spec file in either category — STOP. Do not proceed to Phase 3. Revert the direct edits (`git checkout "$INTEGRATION_BRANCH" -- <file>`) and re-do the work via `Skill(name: "e2e-test-engineer", …)`. The audit must be honest: omitting a file or fabricating a turn pointer is worse than the original delegation gap because it pollutes the audit trail with a false attribution.

   This is the post-hoc check that catches anything step 3 missed. If both gates fire (declaration before the spec edit + audit before Phase 3) and you still see a direct authoring path, that's evidence the gates need to be stronger and worth a follow-up issue.

10. **Update SDLC status sticky** before exiting Phase 2: `bash scripts/update-sdlc-status.sh "$ISSUE_NUM" "Phase 2 complete — feat branch landed on $INTEGRATION_BRANCH; all gates green" "Phase 3 — sdlc-implementer auto-continuing (evidence compile)"`.

11. **Auto-continue to Phase 3 — mandatory, NOT a checkpoint (devaudit-installer#194).** After the integration PR merges and `develop` CI is green, do NOT return control to the operator. State the literal line:

    > `Phase 2 complete — auto-continuing to Phase 3 (compile evidence).`

    Then proceed to Phase 3 step 1 in the same turn. The integration-PR merge *feels* terminal — that is the inertia trap. The next required operator handoff is Phase 4 step 5 (release PR opened, awaiting portal UAT approval), not the develop merge. The only thing that interrupts this auto-continue is the scope-expansion halt gate (#171) firing on a new user request.

    **CI failure on `$INTEGRATION_BRANCH` post-merge.** If CI on `$INTEGRATION_BRANCH` fails after the integration PR merges:
    - Read the failure output, attempt fix-forward (commit fix to `$INTEGRATION_BRANCH` directly, push, wait for CI) up to N=3 attempts.
    - If fix-forward succeeds: auto-continue to Phase 3.
    - If fix-forward exhausts attempts: halt — "CI on `$INTEGRATION_BRANCH` failed after integration merge. N=3 fix-forward attempts exhausted. Last failure: <output>. Operator action — fix CI on `$INTEGRATION_BRANCH`, then ping `resume REQ-XXX`."
    - If the failure is unrelated to this REQ's changes (e.g. another feature broke `$INTEGRATION_BRANCH`): document on the PR, attempt cancel-and-admin-merge per the existing external-gate rule (adapted for post-merge context), or halt and surface.

### Phase 3 — Compile evidence (SDLC stage 3)

1. **Invoke `requirements-aligner` to drop the per-REQ SRS-alignment artefact.** The skill's Phase 2 produces `compliance/evidence/REQ-XXX/srs-alignment.md` — the per-REQ trace from each AC to its SRS item, with an operator sign-off block. The artefact uploads with `evidence_type=srs_alignment` (visible in Documents tab + audit-pack export; v1 orphan-by-design per META-COMPLY framework-registry-auditor). Call via the standard Skill mechanism; don't inline the alignment logic. **Gap status return (devaudit-installer#212 Gap 3):** `requirements-aligner` returns a gap status to `sdlc-implementer`:
   - `CLEAN` — all ACs trace to SRS items, no drift. Continue to step 2.
   - `GAPS_FOUND` — one or more ACs don't trace, or drift is unresolved. Return the gap details.
   
   When `sdlc-implementer` receives `GAPS_FOUND`:
   - If `block_on_stage_3: true` (configurable via `sdlc-config.json:requirements_aligner.block_on_stage_3`) — halt with the [requirements gap flow](#requirements-gap-flow-devaudit-installer212). The operator must resolve the gaps (edit SRS stubs, update ACs, or accept with `@requirements-gap-accepted`) before evidence upload proceeds. The block verifies artefact content (no unresolved gaps without `@srs-deferred`), not just artefact existence.
   - If `block_on_stage_3: false` — warn: "SRS alignment gaps found: <details>. Evidence will upload with gaps recorded. Consider resolving before UAT review." Continue to step 2.
2. **Invoke `adr-author` to drop the per-REQ architecture-decision artefact.** The skill's Phase 2 produces `compliance/evidence/REQ-XXX/architecture-decision.md` — either _"Produced ADR-NNN: <title>"_ with the file pointer, or _"No ADR needed — <rationale>"_. Operator sign-off block at the bottom. The artefact uploads with `evidence_type=architecture_decision`; clause attribution per the META-COMPLY framework-registry-auditor review. Call via the standard Skill mechanism.
3. **Invoke `risk-register-keeper` to drop the per-REQ risk-assessment artefact.** The skill's Phase 3 produces `compliance/evidence/REQ-XXX/risk-assessment.md` — a summary table of RISK-NNN entries this REQ opened / mitigated / accepted, framework cross-references, and an operator sign-off block. The artefact uploads with `evidence_type=risk_assessment`; clause attribution per the META-COMPLY framework-registry-auditor review. Call via the standard Skill mechanism.
4. **Re-run the full test pack** with artefact capture. **Classify test failures (devaudit-installer#212 Gap 7):**
   - **Implementation bug** — test is correct, implementation is wrong. Fix the implementation. (Current behaviour.)
   - **Test bug** — test is wrong, implementation is correct. Fix the test. (Already handled by `e2e-test-engineer` Phase 6 triage.)
   - **Requirements gap** — the test is correct, the implementation is correct, but the AC the test derives from is wrong or incomplete. The test reveals behaviour the AC didn't anticipate. Trigger the [requirements gap flow](#requirements-gap-flow-devaudit-installer212) instead of fixing code or test.
   
   The classification question: "Is the test testing the right thing? Is the implementation doing the right thing? If both are 'right' but they disagree, the AC they both derive from is wrong."

   **On test failure — delegate incident filing to `e2e-test-engineer` (devaudit-installer#210 §6a).** When the test pack re-run fails, do NOT file incidents inline. Instead, invoke `Skill(name: "e2e-test-engineer", args: "Phase 6 triage — test pack re-run failed for REQ-XXX. Triage failures and file application defects with the `incident` label + `### Framework attribution` section per the standard convention.")`. `e2e-test-engineer` returns with a summary of filed incidents. This ensures all incidents follow the correct filing convention (label + attribution) so `incident-export.yml` fires on close → `incident_report` evidence lands on the portal → `ISO29119.3.5.4` flips to COVERED.

   - `npm run test:e2e -- --reporter=html` (produces `playwright-report/`)
   - `npx vitest run --coverage` (produces `coverage/`)

5. **Generate nil incident report if no incidents were closed (devaudit-installer#210 §8a).** After the test pack re-run passes, check whether any `incident`-labelled issues were closed during this REQ's lifecycle (`gh issue list --label incident --state closed --search "REQ-XXX" --json number`). If none were closed and the test pack re-run passes:
   - Create `compliance/governance/nil-incident-report-<version>.md` from the `nil-incident-report.md.template` template.
   - Fill in the scope section (test cases executed/passed/failed, defects filed, incidents reported).
   - Leave the sign-off section with REPLACE markers — the operator fills it in.
   - The nil report uploads as `incident_report` evidence via `compliance-evidence.yml`'s `upload_incident_report` function, flipping `ISO29119.3.5.4` to COVERED for clean releases.
   - If incidents WERE closed, skip nil report generation — the populated incident report(s) from `incident-export.yml` serve as the evidence.

5b. **Validate test-execution-summary.md gate states (devaudit-installer#240).** Before uploading evidence, verify that `compliance/evidence/REQ-XXX/test-execution-summary.md` does not contain invalid gate states. Run:

   ```bash
   bash scripts/validate-test-summary.sh origin/main
   ```

   If the validator fails, fix the summary before proceeding. E2E gate results must be one of: `PASS`, `FAIL`, `NOT_NEEDED` (with reason), or `SKIPPED` (with operator-approved rationale). The word "deferred" must never appear in `test-execution-summary.md` — not as a gate state, not in prose, not in final assessment. "Deferred to CI" and "Playwright browsers not installed locally" are environment issues, not gate states. The CI validator (`validate-test-summary.sh`) will reject any summary containing "deferred" or "browsers not installed" on PRs to main.

6. **Organise artefacts** under `compliance/evidence/REQ-XXX/` with date-prefixed naming:

   ```
   compliance/evidence/REQ-XXX/
   ├── test-scope.md                     ← extracted in Phase 1 step 5b
   ├── test-plan.md                      ← extracted in Phase 1 step 5b
   ├── implementation-plan.md            ← copied from compliance/plans/ in step 6b
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

6b. **Copy `implementation-plan.md` from `compliance/plans/` to `compliance/evidence/` (devaudit-installer#226).** The CI validator (`validate-compliance-artifacts.sh`) expects `implementation-plan.md` in `compliance/evidence/REQ-XXX/`, not in `compliance/plans/REQ-XXX/`. Copy (not move) the file so the plan directory retains the original:

   ```bash
   cp compliance/plans/REQ-XXX/implementation-plan.md compliance/evidence/REQ-XXX/implementation-plan.md
   ```

   This ensures the pre-push hook's compliance validator check passes. The plan directory retains the original for in-flight reference; the evidence directory has the copy for CI validation and audit.

6. **Upload each artefact to the portal** — retry each upload up to 3 times with backoff (5s, 15s, 45s). If an upload still fails after 3 retries, mark it in the RTM as `UPLOAD_FAILED` and surface a warning. Do not mark the RTM as verified for failed uploads. On `resume REQ-XXX`, re-attempt failed uploads before proceeding to Phase 4.
   ```bash
   devaudit push <project-slug> REQ-XXX <evidence-type> <file> \
     --release "v$(date +%Y.%m.%d)" --create-release-if-missing \
     --environment uat --category testing \
     --git-sha "$(git rev-parse HEAD)" \
     --branch "$(git rev-parse --abbrev-ref HEAD)"
   ```
   Evidence types: `screenshot`, `e2e_result`, `test_report`, `audit_log`, `compliance_document`, `manual_upload`, `srs_alignment` (from step 1), `architecture_decision` (from step 2), `risk_assessment` (from step 3).
7. **Verify uploads landed.** `gh api` or `curl` against `https://devaudit.metasession.co/projects/<slug>/requirements/REQ-XXX/evidence` should show every artefact. Any artefact marked `UPLOAD_FAILED` in step 6 should be re-attempted here.
8. **Update `compliance/RTM.md`** with portal links for each evidence row. Rows with `UPLOAD_FAILED` status remain marked as failed — do not mark them verified.
9. **Update SDLC status sticky** before exiting Phase 3: `bash scripts/update-sdlc-status.sh "$ISSUE_NUM" "Phase 3 complete — evidence uploaded; SRS-alignment + ADR + risk-assessment artefacts attached" "Phase 4 — sdlc-implementer auto-continuing (open release PR)"`.

### Phase 4 — Submit for UAT review (SDLC stage 4)

1. **Open the release PR** — the PR that carries the UAT four-eyes approval gate (`check-release-approval.yml`), always into `$RELEASE_BRANCH`: `gh pr create --base "$RELEASE_BRANCH" --head "$INTEGRATION_BRANCH"` (e.g. `develop → main`). The implementation already landed on `$INTEGRATION_BRANCH` in Phase 2; this promotes it. (Note: if other work is also waiting on `$INTEGRATION_BRANCH`, this is a bundled release — every in-scope REQ keeps its own release record and Production approval.)

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
6. **Update SDLC status sticky** before halting: `bash scripts/update-sdlc-status.sh "$ISSUE_NUM" "Phase 4 — release PR #<N> opened against $RELEASE_BRANCH; CI running" "Operator action — review PR #<N> + approve UAT release on the portal; sdlc-implementer halts until you ping resume REQ-XXX"`. This is a critical handoff — the sticky must reflect that the agent has stopped + the operator is on the hook.

**When an external gate hangs or fails for unrelated reasons.** A required gate may fail for reasons outside the change's scope — flaky infra, an unrelated regression test that hangs at hour-plus runtime with no log activity, a known-failing suite. When this happens:

1. **Verify it's actually unrelated.** Read the failure (or the lack of one). If it's the change's fault, fix it; this section does not apply.
2. **Document the rationale on the PR.** A sticky comment naming: which gate, what the failure was, why it's unrelated to the change, what the safety net is (nightly run on `$INTEGRATION_BRANCH`, post-deploy verification, etc.).
3. **Cancel-and-admin-merge is allowed** when **all three** hold: (a) ≥3 other required gates are green, (b) the change has no scope-overlap with the failing gate (e.g. service-layer fix vs hung UI e2e, or an `E2E: N/A by scope` test-plan), and (c) a fallback verification exists (nightly e2e on `$INTEGRATION_BRANCH`, post-deploy smoke, etc.). If any of the three fail, hold the merge and surface the blocker to the operator.
4. **Record the decision in the release ticket.** The release ticket's `## Verification` section must mention the cancelled gate by run-ID and the fallback that justifies bypassing it. Auditors look here first.

**When the cancel-and-admin-merge conditions are NOT met.** If only one or two of the three conditions hold, the skill cannot bypass the gate. Escalation path:
- Update the sticky: "Phase 4 BLOCKED — gate <name> failing for unrelated reasons. Cancel-and-admin-merge conditions not met (<which condition failed>). Operator action — resolve the gate, re-classify it as unrelated with evidence, or accept the risk and admin-merge manually."
- If the operator chooses to admin-merge manually (outside the skill), on `resume REQ-XXX` the skill should detect the PR is merged and proceed to Phase 5.
- Timeout escalation: if the gate hasn't resolved in 24 hours (configurable via `sdlc-config.json:phase4.gate_timeout_hours`), escalate the sticky to "Phase 4 BLOCKED 24h — gate <name> still failing. Escalation required."

**Release Approval Gate retry (devaudit-installer#211 Gap 17).** If the Release Approval Gate check fails on the PR and the portal approval was already given (API sync delay, stale cache), retry logic: re-run the Release Approval Gate workflow up to 3 times with 30-second intervals (`gh workflow run check-release-approval.yml` or trigger via `workflow_dispatch`). If it still fails after 3 retries: halt — "Release Approval Gate still failing after 3 retries. Portal may show approval but the gate can't verify it. Operator action — check the portal release status manually, verify the API key is valid, and re-run the workflow from GitHub Actions if needed."

### Phase 5 — Finalise or change-request loop (SDLC stage 5)

Invoked separately by the user after UAT activity on the portal. Trigger: "resume REQ-XXX", "REQ-XXX UAT done", or just re-firing the skill on the same issue.

0. **Re-read state (devaudit-installer#226).** On resume, reconstruct state from the filesystem before acting:
   - Re-read `compliance/RTM.md` to check the REQ-XXX row's current status.
   - Check whether `compliance/pending-releases/RELEASE-TICKET-REQ-XXX.md` still exists (not yet moved to `approved-releases/`).
   - Check `git log` for the merge commit on `$RELEASE_BRANCH`.
   - If resuming after an environment detour (not a UAT approval), re-read `compliance/evidence/REQ-XXX/` to see which artefacts already exist and resume at the appropriate phase.

1. **Read portal state.** `curl` `https://devaudit.metasession.co/api/projects/<slug>/releases/<version>` and inspect the approval status. Retry up to 3 times with exponential backoff (5s, 15s, 45s) on 5xx responses. If all retries fail, halt — "Portal unreachable at <URL>. Cannot determine UAT approval state. Operator action — verify portal availability + API key, then ping `resume REQ-XXX`." If the API returns 401/403, halt — "Portal API key rejected (HTTP 401/403). The `DEVAUDIT_API_KEY` secret may be expired or revoked. Operator action — rotate the API key, then ping `resume REQ-XXX`." Never guess the portal state.

2. **Branch on state:**
   - **UAT approved** → run stage 5:
     - **Enumerate all in-scope REQs** from `compliance/pending-releases/RELEASE-TICKET-REQ-*.md` and check each one's portal state before merging. If ANY are `uat_changes_requested`: halt — "REQ-YYY has changes requested on the portal. Cannot merge bundled PR until all in-scope REQs are approved." If ANY are still `uat_review`: halt — "REQ-YYY is still pending UAT review." If ALL are `uat_approved` (or `prod_review`/`prod_approved`/`released`): proceed with merge.
     - `gh pr merge <M> --merge` (merge commit; `--squash` and `--rebase` are blocked by branch protection on SDLC repos and would break the audit trail).
     - **Before watching `post-deploy-prod.yml`**, verify the workflow exists and has triggered: `gh run list --workflow post-deploy-prod.yml --limit 1 --json status,conclusion`. If no run appears within 5 minutes of the merge, halt — "post-deploy-prod.yml did not trigger after merge. Check workflow configuration, secrets, and deployment platform. Operator action — run `gh workflow run post-deploy-prod.yml` manually, then ping `resume REQ-XXX`."
     - Watch `post-deploy-prod.yml` via `gh run watch` — block until the workflow reaches a terminal state. Wrap in a timeout (30 minutes default, configurable via `sdlc-config.json:post_deploy.timeout_minutes`). If the timeout fires: halt — "post-deploy-prod.yml has not reached a terminal state in N minutes. The deployment may be stuck. Operator action — check hosting platform logs, decide whether to wait or rollback, then ping `resume REQ-XXX`."
     - Verify production smoke evidence uploaded (`--environment production`) at `https://devaudit.metasession.co/projects/<slug>/releases/<version>`.
     - **Read `production_review.terminal_status` from `sdlc-config.json`** (default: `prod_review`). Branch:
       - If `released` (Option B): PATCH directly to `released` — `PATCH /releases/<version>` with `{"status": "released"}`.
       - If `prod_review` (Option A, default): after `post-deploy-prod.yml` completes, the release is at `prod_review`. Update the sticky to "Phase 5 — production deployed; awaiting prod approval on portal" and halt. The operator clicks "Approve Production" (`prod_review` → `prod_approved`) then "Mark as Released" (`prod_approved` → `released`) in the portal. On next `resume REQ-XXX`, the skill reads the portal state — if `released`, finalise (close issue, update sticky to terminal). If `prod_approved`, prompt the operator to click "Mark as Released". If still `prod_review`, report "awaiting production approval" and stop.
     - Comment on the issue: "Released. Production smoke evidence: <link>." (only after release status is `released`)
     - **Phase 5 close-out — mandatory post-merge compliance steps (devaudit-installer#226).** After the release is marked `released` on the portal, perform the close-out:
       1. **Update RTM status** — change the REQ-XXX row from `TESTED - PENDING SIGN-OFF` to `APPROVED - DEPLOYED` in `compliance/RTM.md`.
       2. **Move release ticket** — move `compliance/pending-releases/RELEASE-TICKET-REQ-XXX.md` to `compliance/approved-releases/`. This prevents CI's `upload-evidence` job from treating the REQ as in-scope for subsequent releases.
       3. **Verify portal approval** — confirm the DevAudit portal release record is in `released` status.
       4. **Commit the close-out** — `git add compliance/RTM.md compliance/pending-releases/ compliance/approved-releases/ && git commit -m "compliance: [REQ-XXX] close out release — RTM updated to APPROVED - DEPLOYED, ticket moved to approved-releases/"`.
       5. **Push the close-out commit** to `$INTEGRATION_BRANCH`.

       These steps are mandatory — the native agent must not treat "PR merged" or "release marked Released" as completion without performing the close-out. Without moving the release ticket to `approved-releases/`, CI continues uploading evidence for the REQ on every subsequent release, polluting the portal's audit trail.
     - **Update SDLC status sticky** to the terminal state: `bash scripts/update-sdlc-status.sh "$ISSUE_NUM" "Phase 5 complete — release marked Released; production smoke evidence uploaded; close-out committed (RTM → APPROVED - DEPLOYED, ticket → approved-releases/)" "Done — close issue + retire feature branch (sdlc-implementer halts)"`.
     - Close the issue.
     - If production smoke fails: do NOT mark as Released. **Delegate incident filing to `governance-doc-author` (devaudit-installer#210 §6c)** — invoke `Skill(name: "governance-doc-author", args: "Production smoke failure for REQ-XXX. File an incident issue with the `incident` label + `### Framework attribution` section (ISO29119.3.5.4 + SOC2.CC7.2), severity `blocker`. Include the production URL, git SHA, testCycleId (CI run ID), and smoke results in the issue body.")`. Page the on-call per the project's incident playbook, follow the rollback plan from the implementation plan. If the rollback also fails: update the sticky to "Phase 5 CRITICAL — production smoke failed AND rollback failed. Production is in a broken state. Operator action — page on-call immediately, engage hosting platform support, declare incident per the project's incident playbook. This is beyond the skill's scope." Do NOT attempt further automated remediation. **Update the sticky** to reflect the incident state: `… "Phase 5 BLOCKED — production smoke failed; INCIDENT issue #N filed" "Operator action — read INCIDENT #N + execute rollback per plan"`.

   - **Changes requested** → run change-request loop:
     - Fetch change-request comments from the PR (`gh pr view <M> --comments`) and from the portal release page.
     - **Classify the change request (devaudit-installer#210 §6b, devaudit-installer#212 Gap 6):** Assess whether the change request is a **defect** (the implementation doesn't match the AC — the reviewer found a bug), a **requirements gap** (the reviewer identified behaviour that should have been an AC but wasn't — the plan was incomplete, not the implementation), or a **scope change** (the reviewer wants new behaviour this REQ genuinely shouldn't deliver).
       - **If it's a defect:** Delegate to `e2e-test-engineer` to file the incident with the `incident` label + `### Framework attribution` section before fixing. Invoke `Skill(name: "e2e-test-engineer", args: "Phase 6 triage — UAT reviewer found defect in REQ-XXX. Change-request comment: <summary>. Triage and file application defects with the `incident` label + `### Framework attribution` section per the standard convention.")`. `e2e-test-engineer` returns with a summary of filed incidents. Then fix the defect in the same Phase 2 re-run. This ensures UAT-discovered defects produce `incident_report` evidence, closing `ISO29119.3.5.4` for the defect — not just silently fixing it.
       - **If it's a requirements gap:** Trigger the [requirements gap flow](#requirements-gap-flow-devaudit-installer212) with the reviewer's feedback as the gap report. The operator decides: accept the gap (ship without the edge case), amend the ACs (add the edge case as a new AC, update plan + SRS, re-walk Phase 2-3), or file a follow-up REQ. If "amend" is chosen, the change-request iteration includes the new AC in the delta-plan section, `requirements-aligner` is re-invoked for the new AC, and the SRS is updated. Do NOT file an incident — the plan was incomplete, not the implementation buggy. Do NOT use the scope-expansion halt gate — this is a plan quality issue, not a scope creep request.
       - **If it's a scope change:** Use the existing scope-expansion halt gate (REQ-SKILL-IMPLEMENTER-019) — file a separate issue or amend the REQ scope. Do NOT file an incident — the AC itself needs amendment, not a defect fix.
     - Add a new `## Change-request iteration N` section to `compliance/plans/REQ-XXX/implementation-plan.md` describing what changed and why.
     - **Update the release ticket status** (`compliance/pending-releases/RELEASE-TICKET-REQ-XXX.md`): set `**Status:**` to `CHANGES REQUESTED — ITERATION N` when entering the iteration. Commit the ticket update alongside the delta-plan section in the same iteration commit.
     - Re-run Phase 2 (implement + test) for the requested changes — same delegation to `e2e-test-engineer` for any e2e work.
     - Re-run Phase 3 (evidence) for the new/changed artefacts only; existing evidence stays. After evidence re-compile completes, update the release ticket status to `TESTED - PENDING SIGN-OFF (ITERATION N)`.
     - Push to the same branch (no force-push). The PR auto-updates.
     - Re-request UAT review on the portal: `POST /api/projects/<slug>/releases/<version>/approval-requests`.
     - Comment on the issue: "Change requests addressed in commits <SHAs>. UAT re-review requested."
     - **Update SDLC status sticky** for the re-review handoff: `bash scripts/update-sdlc-status.sh "$ISSUE_NUM" "Change-request iteration N applied; PR pushed; re-review requested" "Operator action — re-review on portal; sdlc-implementer halts until you ping resume REQ-XXX"`.
     - Hard stop again. The portal's release-approval state has reset; UAT must explicitly re-approve.
     - **After UAT re-approval (Phase 5 happy path):** update the release ticket status to `APPROVED — READY FOR MERGE`. After merge + deploy + prod verification: update to `RELEASED`. If rejected: update to `REJECTED — AWAITING OPERATOR DIRECTION`.
     - **Iteration cap (N=5).** If the change-request loop reaches 5 iterations without convergence, halt and ask the user to choose:
       - **Abandon:** Close the PR (`gh pr close <M>`), close the issue with "REQ-XXX abandoned after N=5 change-request iterations without convergence", update RTM status to `ABANDONED`, update release ticket status to `ABANDONED — ITERATION CAP REACHED (N=5)`, update sticky to terminal. Skill halts.
       - **Split:** Halt with "Recommend filing separate issues for: <inferred sub-scopes>. Close this PR after splitting. Each new issue gets its own `sdlc-implementer` invocation." The skill does not perform the split — it surfaces the recommendation and stops.
       - **Restart from fresh plan:** Keep the same REQ-XXX number (the portal release already exists). Archive the current implementation plan (`mv compliance/plans/REQ-XXX/implementation-plan.md compliance/plans/REQ-XXX/implementation-plan-v1-archived.md`), re-run Phase 1 from step 5 (write new plan). The PR stays open — the new plan's implementation replaces the code on the feature branch. Reset the iteration counter to 0.

   - **Still pending UAT (no approval, no change-request)** → report "UAT review still pending on the portal at <link>" and stop. Do not act.

   - **UAT rejected** → halt. Post on the issue: "UAT rejected this release. Options: (a) close PR and re-plan from scratch, (b) escalate to a different reviewer, (c) appeal the rejection with new context." See [`references/change-request-loop.md`](./references/change-request-loop.md) §"If the change-request is a rejection" for details. Do not attempt to address — the reviewer has marked the release fundamentally broken. Wait for the user to decide.

## Native agent responsibilities and re-invocation protocol (devaudit-installer#226)

The `skill` tool is a **stateless instruction injection** — not a persistent sub-agent. When invoked, the skill's markdown is loaded into the native agent's context. The native agent executes the steps. But the skill has no persistent state, no execution monitoring, and no re-invoke triggers. The following protocol bridges this gap.

### Native agent responsibilities

The native agent (the AI coding assistant executing this skill) is responsible for:

- **Command execution** — running `npx playwright test`, `npm run dev`, `mongod`, etc.
- **Environment debugging** — port conflicts, stale locks, missing binaries, Playwright browser installs
- **Browser inspection** — reading page snapshots, DOM state, error dialogs during E2E debugging
- **External service interaction** — Railway deploy status, UAT health checks, DevAudit portal (human-only)
- **Git operations** — merge conflicts, push retries, branch management

The skill is responsible for workflow decisions, compliance checklists, and phase transitions. The native agent executes; the skill decides what to do next.

### Re-invocation protocol

After any **environment detour** — service startup failure, test debugging iteration loop, CI failure fix — the native agent must re-invoke this skill to get back on track:

```
Skill(name: "sdlc-implementer", args: "resume REQ-XXX — <detour description>, re-enter at Phase N")
```

The skill re-reads state from the filesystem and continues from where it left off. It is idempotent on re-entry:

- Re-read `compliance/RTM.md` to confirm the REQ-XXX row exists and has a provenance stamp.
- Re-read `compliance/evidence/REQ-XXX/` to see which artefacts already exist.
- Check `git log` for commits already made on this branch.
- Resume at the appropriate phase: if Phase 2 implementation is complete but Phase 3 artefacts are missing, resume at Phase 3 step 1.

The native agent must NOT continue to the next phase (Phase 3 → Phase 4, Phase 2 → Phase 3) without re-invoking the skill. The only exception is the skill's own auto-continue steps (Phase 2 step 11) where the skill explicitly says it will continue to the next phase in the same turn.

**PR merged to main ≠ done.** After the release PR is merged to `main`, the native agent must re-invoke the skill for Phase 5 close-out (see Phase 5 step 0 below). The merge is not the end of the workflow — post-merge compliance steps are mandatory.

### Commit-scoping rule for SRS updates (devaudit-installer#226)

When a commit is authored as part of REQ-XXX's SDLC flow, the commit subject must cite `[REQ-XXX]` — the **active REQ** driving the current SDLC flow — regardless of which other REQs the content touches. Other REQs may appear in the body for traceability, but never in the subject.

**Correct:**
```
docs: [REQ-085] add SRS stubs for REQ-083/084/085 — order status revert, checkout separation, tab payment

Ref: REQ-083, REQ-084
```

**Incorrect:**
```
docs: [REQ-083/084] update SRS with order status revert fix and checkout separation
```

The portal's commit scanner parses `REQ-XXX` tags from commit subjects within a PR's diff. Citing the wrong REQ in the subject causes the portal to associate out-of-scope REQs with the current release.

## Compliance constraints

Hard rules — the skill's SKILL.md fails review if any of these are violated. Audited against ISO 29119, ISO 27001, SOC 2, GDPR, and the EU AI Act; details in [`references/compliance-constraints.md`](./references/compliance-constraints.md).

1. **Never skip the UAT review gate** for any risk class. The portal enforces this server-side via `check-release-approval.yml`; do not attempt to merge with that check still red.
2. **For HIGH/CRITICAL, the skill MUST NOT act as the UAT approver.** Check at Phase 4 that the configured UAT reviewer differs from the skill-trigger user; halt with a configuration error otherwise. (SOC 2 CC8 — segregation of duties.)
3. **Plan checkpoint mandatory for HIGH/CRITICAL.** LOW/MEDIUM pass through Phase 1 automatically; HIGH/CRITICAL pause for human plan approval before code is written.
4. **Change-request loop triggers full UAT re-review.** The portal's release-approval state resets when new commits land on the PR — respect it. Surface a "UAT re-review needed" comment; never rely on prior approval covering subsequent changes.
5. **AI involvement disclosed on every commit** via `Co-Authored-By: Claude`. (ISO 27001 disclosure norms + EU AI Act Art. 13 transparency.)
6. **All portal mutations through audit-logged APIs.** Use `devaudit push` and the standard portal-API endpoints — never a private back-channel.
7. **Never file incidents inline (devaudit-installer#210).** Incident filing (label application, framework attribution, severity classification) is delegated to `e2e-test-engineer` (for E2E-discovered defects) or `governance-doc-author` (for non-E2E incidents). The orchestrator's job is to detect the defect, delegate the filing, receive the return summary, and act on it (halt, rollback, re-review). This keeps the incident filing convention in one place — the sub-skills — and prevents silent evidence gaps where defects are found and fixed but never recorded on the portal.

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
