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
5. **Route — and stay on to completion.** A route is a choice of *which workflow to drive*, never a hand-off that abandons the operator. Whatever the path, the skill keeps guiding step by step until no further action is required (typically: merged).
   - **tracked** (feature / bug fix / refactor / perf) → continue into Phase 1 below (full Stages 1–5).
   - **housekeeping / trivial** → drive the **Lightweight path** below to completion. No `REQ-XXX`, no RTM row, no evidence pack, no portal release approvals — but the skill still branches, runs the gates, opens the PR, and walks the operator through review → merge.
   - **compliance-doc-only** → drive the same Lightweight path as a docs push (or PR, per the project's flow) referencing the **existing** `REQ-XXX`: no new requirement and no quality-gate ceremony, but driven through to merge.
6. **Write labels back.** Apply the inferred `type:*` / `risk:*` labels so the issue ends up labelled — `gh label create <label> --force` to ensure the label exists (idempotent; no failure if a label-seeding step never ran), then `gh issue edit <N> --add-label <label>`. Future triage is then a glance.

**"Workflow Decision" announcement template**

> **Workflow decision — #N**
> - **Change type:** \<Feature | Bug fix | Refactor/Perf | Housekeeping | Trivial | Compliance-doc-only\>
> - **Commit type:** \<feat | fix | refactor | chore | docs | …\>
> - **Requirement:** \<REQ-XXX assigned | none\>
> - **Risk:** \<LOW | MEDIUM | HIGH | CRITICAL\>
> - **Path:** \<Full SDLC Stages 1–5 | Lightweight (gates → chore PR) | Doc-only push\>
> - **Gates/evidence:** \<…\>
> - **Your approvals:** \<UAT four-eyes + Production approval | PR review only\>
> - **Skipped:** \<…\>
> Proceed? *(or reclassify)*

Only the **tracked** route continues into Phase 1; the others run the Lightweight path below. The off-ramps are deliberate — dragging housekeeping through tracked-change machinery it doesn't need is exactly the failure mode this step exists to prevent — but they are still **driven to completion**, never dumped as a checklist for the operator to run alone.

### Lightweight path (housekeeping / trivial / compliance-doc-only)

Reached from Phase 0 for non-tracked change-types. The skill drives this end-to-end; the only difference from the tracked cycle is the absence of *ceremony*, not the absence of *guidance*. It pauses only where a human is genuinely required (PR review, merge).

1. **Branch off `develop`** with a housekeeping prefix — `chore/…`, `docs/…`, `ci/…`, `build/…`, `test/…`, or `compliance/…` for a doc-only change against an existing REQ.
2. **Make the change**, single-purpose. If it turns out to touch runtime behaviour in `app/` / `lib/`, stop and reclassify as tracked — the commit-type rule is the backstop.
3. **Run all gates locally** (`npm run lint`, `npx tsc --noEmit`, the test suite, `semgrep`, `npm audit` — or the stack-adapter equivalents). Trivial ≠ unverified; never `--no-verify`.
4. **Commit** with a housekeeping type and **no** `REQ-XXX` — `docs:` / `chore:` / `ci:` / `build:` / `test:` / `revert:` are exempt from the `[REQ-XXX]` rule; a `compliance:` doc-only change references the existing REQ. `Co-Authored-By: Claude` if AI-assisted.
5. **Push and open the PR.** CI runs the same quality gates; `compliance-validation.yml` finds no `REQ-XXX` and skips artifact validation.
6. **Report honest status** — wait for CI, name any failing check, fix and re-push. Never announce "ready" while a required check is red.
7. **Guide review → merge.** A human still reviews the PR (separation of duties). There is **no** portal release approval, no UAT four-eyes, no Production gate, and no close-out. Merge once CI is green and the reviewer approves.
8. **Done.** A housekeeping push produces at most a bare-date release (`vYYYY.MM.DD`) with no approval gate; a doc-only push attaches its docs to the existing `REQ-XXX` release. No further action required — report completion and stop.

### Phase 1 — Plan (SDLC stage 1)

Reached only on the **tracked** route from Phase 0 (the issue is already fetched and classified).

1. **Confirm the issue scope.** Re-read the `gh issue view <N>` output from Phase 0 — title, body, all comments — with implementation in mind.
2. **Classify risk** per `Test_Policy.md` §Risk-Based Testing. Emit a one-paragraph rationale citing the signals you used (auth surface, financial calc, data egress, RBAC, AI decisioning, etc.).
3. **Assign REQ-XXX.** Inspect `compliance/RTM.md` for existing entries; take the next free number. If the issue references an existing REQ, use that instead.
4. **Detect over-scoping.** If the issue spans clearly distinct deliverables (e.g. "build SAML SSO + reorganise the admin dashboard + migrate from Postgres 14 to 16"), halt with a clear message asking the user to split the issue into separate ones. Do not proceed past Phase 1.
5. **Write the implementation plan.** Create `compliance/plans/REQ-XXX/implementation-plan.md` per the stage-1 template (sections: context, acceptance criteria, technical approach, security considerations, dependencies, test scope). For HIGH/CRITICAL also include: threat model (against STRIDE categories applicable to the touched surfaces), four-eyes attestation slot, rollback plan.
6. **Update `compliance/RTM.md`** with the new entry: REQ-XXX, title, risk class, linked issue, linked test cases (placeholder).
7. **Post plan summary as an issue comment.** Format: TL;DR; Risk class + signals; Acceptance criteria; Technical approach (one paragraph); Dependencies; Test scope.
8. **Checkpoint** — pause for human approval **iff** risk class is HIGH or CRITICAL. LOW and MEDIUM pass through to Phase 2 automatically. The checkpoint can be forced on for all classes via the `--require-plan-approval` flag (or `DEVAUDIT_REQUIRE_PLAN_APPROVAL=1` env var) for orgs that want it always-on.

### Phase 2 — Implement and test (SDLC stage 2)

1. **Branch off `develop`.** `git checkout -b feat/REQ-XXX-<slug>`. The slug is a kebab-case fragment of the issue title (max 6 words).
2. **Write failing tests first** per [`Test_Architecture.md`](../../Test_Architecture.md). Depth scales with risk class:
   - LOW — unit tests on the changed function(s); no e2e required unless the change touches a user-facing flow.
   - MEDIUM — unit + integration; e2e for any UI-facing change.
   - HIGH — unit + integration + e2e for every user-visible path + at least one negative/abuse test.
   - CRITICAL — HIGH plus targeted security tests (authz bypass attempts, input fuzzing where applicable).
3. **For any e2e or visual-regression test work in this step, invoke `e2e-test-engineer`** — do not author e2e tests directly. The orchestrator passes the implementation plan + the diff so far to the e2e-test-engineer skill, which derives scenarios, reconciles with the existing pack, and runs the suite.
4. **Implement against the plan.** Reference `compliance/plans/REQ-XXX/implementation-plan.md` as you go. Any deviation from the plan must be noted in the plan itself under a `## Plan deviation` section — never silently diverge.
5. **Run all gates locally** before pushing:
   - `npm run lint` (or stack-adapter equivalent)
   - `npx tsc --noEmit` (or stack-adapter equivalent)
   - `npx vitest run` (unit/integration)
   - `npx playwright test` (e2e — delegated to `e2e-test-engineer`)
   - `semgrep scan --config auto`
   - `npm audit --audit-level=high` (or stack-adapter equivalent)
6. **On gate failure**, iterate up to N=3 attempts. Each iteration: read the failure output, propose a fix, apply, re-run. On exhausted attempts, halt with the full failure output and surface to the human — never use `--no-verify`, `eslint-disable`, `@ts-expect-error`, `xfail`, or any other bypass.
7. **Commit** using Conventional Commits with `Ref: REQ-XXX` trailer and `Co-Authored-By: Claude` trailer. One commit per logical step; never amend a commit that's already been pushed.
8. **Push** to the feature branch. No PR yet — that happens in Phase 4.

### Phase 3 — Compile evidence (SDLC stage 3)

1. **Re-run the full test pack** with artefact capture:
   - `npm run test:e2e -- --reporter=html` (produces `playwright-report/`)
   - `npx vitest run --coverage` (produces `coverage/`)
2. **Organise artefacts** under `compliance/evidence/REQ-XXX/` with date-prefixed naming:
   ```
   compliance/evidence/REQ-XXX/
   ├── YYYY-MM-DD_e2e-results.json
   ├── YYYY-MM-DD_playwright-report/
   ├── YYYY-MM-DD_unit-coverage/
   └── YYYY-MM-DD_screenshots/*.png
   ```
3. **Upload each artefact to the portal**:
   ```bash
   devaudit push <project-slug> REQ-XXX <evidence-type> <file> \
     --release "v$(date +%Y.%m.%d)" --create-release-if-missing \
     --environment uat --category testing \
     --git-sha "$(git rev-parse HEAD)" \
     --branch "$(git rev-parse --abbrev-ref HEAD)"
   ```
   Evidence types: `screenshot`, `e2e_result`, `test_report`, `audit_log`, `compliance_document`, `manual_upload`.
4. **Verify uploads landed.** `gh api` or `curl` against `https://devaudit.metasession.co/projects/<slug>/requirements/REQ-XXX/evidence` should show every artefact.
5. **Update `compliance/RTM.md`** with portal links for each evidence row.

### Phase 4 — Submit for UAT review (SDLC stage 4)

1. **Open the PR.** `gh pr create --base main --head <branch>`. PR body per the SDLC PR template (see [`.github/pull_request_template.md`](../../../../../.github/pull_request_template.md)):
   - Closes #N
   - REQ-XXX
   - Risk: <class>
   - Evidence: `https://devaudit.metasession.co/projects/<slug>/requirements/REQ-XXX`
   - For HIGH/CRITICAL: Four-eyes attestation: `@<reviewer-username>`
   - For HIGH/CRITICAL: Rollback plan: reference to `compliance/plans/REQ-XXX/implementation-plan.md` §Rollback
   - Test plan
   - SDLC checklist
2. **Verify the UAT reviewer ≠ skill-trigger user** for HIGH/CRITICAL. If they match, halt with a configuration error: "HIGH/CRITICAL risk requires an independent UAT reviewer; the configured reviewer matches the trigger user — fix the four-eyes attestation slot in the implementation plan and re-run."
3. **Apply labels** — `awaiting-uat-review`, `risk:<class>`.
4. **Comment on the issue**: "Implementation complete. PR #M opened. Evidence on portal: <link>. UAT review requested. Resume with `resume REQ-XXX` once UAT approval is granted on the portal."
5. **Hard stop.** Phase 4 ends here. Do not proceed to merge; the human's next action is reviewing on the portal.

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
