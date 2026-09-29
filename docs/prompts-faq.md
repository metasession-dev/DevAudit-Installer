# Prompts FAQ — what to say, what to type

A quick-reference for the range of prompts (natural-language, for an AI agent) and CLI commands across DevAudit's features. Every trigger phrase below is quoted verbatim from the corresponding skill's own `description:` frontmatter — this doc doesn't invent new phrasing, it collects what already exists. If a skill's actual trigger phrases ever drift from what's listed here, the skill's own `SKILL.md` is authoritative; update this page to match.

## Onboarding and setup (CLI, not a skill)

| I want to... | Run |
| --- | --- |
| Onboard a brand-new consumer project | `devaudit install ../path/to/new-consumer` |
| Onboard it with a safe, read-only key an agent can hold locally | `devaudit install ../path/to/new-consumer --with-viewer-key` |
| Join an already-onboarded project as a second developer | `devaudit join` |
| Retrofit the viewer key onto an already-onboarded project | `devaudit install --force-team-config --with-viewer-key` |
| Disconnect a repo from DevAudit entirely | `devaudit uninstall` |

See [`onboarding.md`](onboarding.md) for the full walkthrough.

## Keeping a consumer current

| I want to... | Run |
| --- | --- |
| Sync the latest framework templates into this project | `devaudit update .` |
| Opt into the 3-tier E2E regression gate | `devaudit update --enable-e2e-regression .` |
| Opt back out | `devaudit update --disable-e2e-regression .` |
| Check this project's own health before starting new work | `devaudit doctor` (or `devaudit doctor --json` for a script/agent) |
| Sweep every project my account can see for drift | `devaudit doctor --fleet` |
| Run the full pre-flight housekeeping pass (sync + doctor + fix) | See [`housekeeping-release-runbook.md`](housekeeping-release-runbook.md) |

## Implementing a tracked change — `sdlc-implementer`

Takes a GitHub issue end-to-end through the SDLC: triage → plan → implement → PR → (resume) → merge → release.

- **Start:** "implement issue #N", "fix issue #N", "do issue #N", "implement #N", "implement issue #N under the SDLC", "run the SDLC for issue #N", "automate REQ-XXX from issue to release", "do the SDLC stages for [issue]"
- **Resume after UAT/portal action:** "resume REQ-XXX"
- **Bundle multiple issues into one branch/PR/release:** "Bundles: #A, #B" — see [`change-workflows.md`](change-workflows.md) for the behavioral contract (lineage, atomic approval); this is just the syntax that turns it on.

Don't use it for stage-1 planning only (run the manual walkthrough instead), or for test authorship alone (invoke `e2e-test-engineer` directly — `sdlc-implementer` delegates to it automatically in Phase 2 anyway).

## End-to-end and visual regression tests — `e2e-test-engineer`

- "add e2e tests for [ticket]"
- "update the test pack"
- "what tests do we need for this issue"
- "are any tests obsolete"
- "run the e2e tests and file issues"
- "add visual regression coverage"
- "set up e2e tests for this project"
- "bootstrap an e2e suite"

Framework- and tracker-agnostic. Not for unit/component/API-only or performance tests.

An incident found outside a tracked run doesn't have to go through the issue-filing path first — `e2e-test-engineer` can file the incident report directly ("this regression isn't tied to an open issue, file it as an incident") and skip straight to the incident-export flow described in [`incident-export.md`](incident-export.md).

## E2E suite flakiness and CI reliability — `e2e-ci-reliability`

- "why is our regression tier flaky"
- "should we shard this suite"
- "different test fails every run"
- "e2e suite is flaky"
- "warm up the dev server"
- "CI reliability review"

Not for authoring test content (that's `e2e-test-engineer`) and not for a single test that fails the same way every time (that's an ordinary application defect — triage it normally, or via `sdlc-implementer`'s Phase 5 post-deploy triage gate if it's a released regression).

## Governance documents — `governance-doc-author`

- "create / refresh the RoPA"
- "write a DPIA"
- "update the AI disclosure"
- "set up the periodic review schedule"
- "I need to make our [governance doc] audit-ready"
- Also fires when the portal's framework-coverage matrix shows `GDPR.Art-30` / `GDPR.Art-35` / `EUAIA.Art-13` / `SOC2.CC4.1` / `ISO27001.A.12.1` as MISSING and you ask how to close them.

For periodic review specifically, the skill only authors the review *schedule and template* — it deliberately doesn't touch the auto-generated execution half (the actual scheduled review run and its findings), which is a separate, already-automated mechanism.

## Source-of-truth alignment family

These three run automatically as part of `sdlc-implementer`'s Stage 1 (plan approval) and Stage 3 (evidence pack), but can also be invoked standalone:

| Skill | Standalone prompts |
| --- | --- |
| `requirements-aligner` | "align SRS for REQ-066", "what SRS items did this REQ need?", "is the SRS in sync with this branch?", "audit SRS drift across this PR's commits" |
| `adr-author` | "draft an ADR for REQ-066", "does this REQ need an ADR?", "is the architectural decision documented?" |
| `risk-register-keeper` | "draft a risk-register entry for REQ-XXX", "is the risk register up to date for this branch?" |

## Fleet-wide operator audit — `fleet-doctor` (DevAudit-Installer only, never synced to consumers)

- "run fleet doctor"
- "audit all consumers"
- "check onboarded projects for drift"

Operator-only — runs from a `DevAudit-Installer` checkout with every consumer checked out as a sibling directory. See [`fleet-doctor.md`](fleet-doctor.md).

## See also

- [`skills.md`](skills.md) — what each skill produces and when the orchestrator delegates to it
- [`sdlc/SKILLS.md`](../sdlc/SKILLS.md) — the canonical skill contract and current trigger catalog (authoritative if this page ever drifts)
- [`change-workflows.md`](change-workflows.md) — how a change gets classified as tracked vs. housekeeping vs. doc-only
- [`doctor.md`](doctor.md) / [`fleet-doctor.md`](fleet-doctor.md) — full check lists for both doctor variants
