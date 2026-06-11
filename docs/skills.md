# Skills catalog — the six AI agents that drive the SDLC

> **Audience.** Anyone evaluating or adopting the DevAudit SDLC: founders, engineering leads, compliance owners. Read this once to know what each skill does, when it fires, and what artefact it leaves behind on the portal.

DevAudit ships six AI skills that automate most of the per-issue ceremony. They are installed into your project at `.claude/skills/<name>/` by `npx @metasession.co/devaudit-cli@latest install`, and they auto-fire in **Claude Code** from natural-language prompts. The same SDLC instruction set is also synced to drop-in rule files for **Cursor** (`.cursorrules`), **Windsurf** (`.windsurfrules`), and **Gemini CLI** (`GEMINI.md`); any other LLM-driven agent (GitHub Copilot, Aider, Continue, etc.) reads the canonical `INSTRUCTIONS.md` directly. Claude Code's auto-firing skills give the deepest integration; the other agents do the same work via on-demand instruction-reading.

> **Why skills, not generic prompts?** Each skill is opinionated about what it WILL NOT do — skip a checkpoint, approve its own work, hide AI involvement, author evidence without the operator's source data. Those constraints are SKILL.md-level invariants, not policy you have to remember. They make the AI partner _bounded_, which is the precondition for compliance-grade automation.

## The six skills at a glance

| Skill                                                            | Owns                                                                                                  | Triggers                                                                              | Artefact on the portal                                                          |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **[`sdlc-implementer`](#sdlc-implementer-the-orchestrator)**     | End-to-end orchestration of one issue through Stages 0–5                                              | _"Implement issue #N"_ / _"Run the SDLC for #N"_ / _"Resume REQ-XXX"_                | All Stage 3 evidence (compiled into the per-REQ release)                        |
| **[`e2e-test-engineer`](#e2e-test-engineer)**                    | The E2E + visual-regression test pack                                                                 | _"Add e2e tests for #N"_ / _"What tests does this change need?"_                     | `e2e_result`, `test_report`, per-AC `screenshot` evidence                       |
| **[`governance-doc-author`](#governance-doc-author)**            | Tier-1/2 governance docs (RoPA, DPIA, AI disclosure, periodic-review schedule) + onboarding starters  | _"Author the ROPA"_ / _"Refresh the DPIA"_ / _"Open a control-gap entry"_            | Tier 1/2 governance evidence (operator-uploaded via portal form)                |
| **[`requirements-aligner`](#requirements-aligner)**              | The Software Requirements Specification (`docs/SRS.md`) — single SoT for what the system promises    | Auto-invoked by `sdlc-implementer` at Stage 1 + Stage 3                              | Per-REQ `srs-alignment.md` traceability artefact                                |
| **[`adr-author`](#adr-author)**                                  | Architecture Decision Records (`docs/ADR/`) — single SoT for the architectural choices behind code   | Auto-invoked by `sdlc-implementer` at Stage 1 + Stage 3                              | Per-REQ `architecture-decision.md` traceability artefact (+ new ADRs if needed) |
| **[`risk-register-keeper`](#risk-register-keeper)**              | The risk register (`compliance/risk-register.md`) — single SoT for residual risk per the standards    | Auto-invoked by `sdlc-implementer` at Stage 1 + post-incident + Stage 3              | Per-REQ `risk-assessment.md` traceability artefact (+ new RISK-NNN entries)     |

The three skills in the lower half — `requirements-aligner`, `adr-author`, `risk-register-keeper` — are the **SoT-alignment family**. Each maintains one persistent source-of-truth document and drops a per-REQ Tier 3 traceability artefact each cycle, so the portal can prove _"this requirement traces back to the SRS / an ADR / a register entry"_ without the operator hand-curating that link.

---

## `sdlc-implementer` — the orchestrator

**Trigger:** _"Implement issue #N"_, _"Run the SDLC for issue #N"_, _"Automate REQ-XXX from issue to release"_, _"Resume REQ-XXX"_ (Phase 5 after UAT approval).

**Reads:** the GitHub issue (title + body + labels + comments), the project's `sdlc-config.json`, the SDLC stage docs synced under `SDLC/`, the `Test_Policy.md` risk-classification heuristics.

**Writes:** `compliance/plans/REQ-XXX/implementation-plan.md`, `compliance/RTM.md` entry, feature branch (`feat/REQ-XXX-<slug>`), per-REQ evidence pack at `compliance/evidence/REQ-XXX/`, release ticket at `compliance/pending-releases/RELEASE-TICKET-REQ-XXX.md`, the develop→main release PR.

**How it works.** The orchestrator triages first (Phase 0: classify → announce → confirm → route), then drives the matching path to completion. A tracked change runs the full Stages 1–5 with three hard pause points:

1. **Phase 1 step 11** — pause for human approval *iff* risk class is HIGH or CRITICAL.
2. **Phase 4 step 5** — hard stop after opening the release PR; the operator does the four-eyes UAT review on the portal.
3. **Phase 5 entry** — invoked separately via _"resume REQ-XXX"_ after UAT approval.

A trivial / housekeeping / compliance-doc-only change runs the **Lightweight path** instead — branch off, run gates, open a `chore:` PR, drive it through review to merge. Same orchestrator, no tracked ceremony.

**Sub-skill delegation.** The orchestrator MUST invoke `e2e-test-engineer` for any end-to-end / visual-regression test work in Phase 2 (structurally enforced — two gates inside Phase 2 catch direct authoring). It MUST invoke each of the three SoT-alignment skills (`requirements-aligner`, `adr-author`, `risk-register-keeper`) at the right Phase 1 + Phase 3 steps. See [`change-workflows.md`](./change-workflows.md) for the change-type → workflow routing table and [`sdlc/files/_common/skills/sdlc-implementer/SKILL.md`](../sdlc/files/_common/skills/sdlc-implementer/SKILL.md) (installed into every consumer at `.claude/skills/sdlc-implementer/SKILL.md`) for the full phase-by-phase contract.

---

## `e2e-test-engineer`

**Trigger:** _"Add e2e tests for #N"_, _"Update the test pack for REQ-XXX"_, _"What tests does this change need?"_, _"Bootstrap an e2e suite for this project"_, _"Run the regression and file the failures"_. Framework-agnostic — supports Playwright, Cypress, WebdriverIO, etc.

**Reads:** the issue + acceptance criteria, the existing test pack (`e2e/`, `tests/e2e/`, `cypress/e2e/`, …), the project's `playwright.config.ts` / `cypress.config.ts`, the `Test_Architecture.md` per-AC test-design heuristics.

**Writes:** new spec files under the project's e2e layout (`e2e/critical/<spec>.spec.ts`, `e2e/<area>/<spec>.spec.ts`, …) using the `evidenceShot(page, reqId, ac, slug)` helper at every assertion that proves an AC; updates to the spec when ACs change; sometimes filed defect issues for failing existing specs. The skill is opinionated about delegation — `sdlc-implementer` calls it in Phase 2 and MUST NOT author e2e specs directly.

**3-tier gating model (v0.1.53+).** Specs land under one of three projects: `e2e/smoke/` (every push, ~3–5 min), `e2e/critical/` (PR-to-main gate, ~10–15 min), `e2e/<area>/` (full regression — nightly + post-merge + dispatch). The skill picks the tier per spec based on the AC's MoSCoW priority + the per-tier cost philosophy in [`Test_Strategy.md`](../sdlc/files/_common/Test_Strategy.md). See [`e2e-test-tiers.md`](./e2e-test-tiers.md) for how to opt in.

**Bootstrap mode.** When no e2e suite exists, the skill drops a starter Playwright config + smoke test + per-stack hook before adding the change's tests. Project gets a working suite in one invocation.

Detail: [`sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`](../sdlc/files/_common/skills/e2e-test-engineer/SKILL.md).

---

## `governance-doc-author`

**Trigger:** _"Author the ROPA"_, _"Refresh the DPIA — we added Stripe Connect"_, _"Draft the AI disclosure for the recommendation model"_, _"Schedule the next periodic review"_, _"Open a control-gap entry"_ (which routes to `risk-register-keeper`).

**Reads:** the starter template from `compliance/governance/<doc>.md` (dropped by `bootstrap-governance`), the project's actual processing flows / risks / response plan as supplied by the operator (the skill asks for source data — it doesn't make it up).

**Writes:** the Tier 1/2 governance docs. Currently five doc kinds: ROPA (GDPR Art. 30), DPIA (GDPR Art. 35), AI disclosure (EU AI Act Art. 13), incident report (per event), periodic-review schedule (SOC 2 CC4.1 / ISO 27001 A.12.1). Each ships with a STARTER TEMPLATE banner that the skill removes only after content is in place.

**Framework attribution.** Each completed doc carries a callout block naming the framework clauses it closes — the portal's framework-coverage matrix reads those callouts to flip the right clauses from MISSING to COVERED. See [`governance-templates.md`](./governance-templates.md) for the per-framework mapping + external references (ICO ROPA template, EDPB DPIA guidelines, NIST AI RMF) the skill points the operator at.

Detail: [`sdlc/files/_common/skills/governance-doc-author/SKILL.md`](../sdlc/files/_common/skills/governance-doc-author/SKILL.md).

---

## `requirements-aligner`

**Trigger:** auto-invoked by `sdlc-implementer` at Phase 1 step 6 (populate SRS-ID column on the implementation plan's AC table) and Phase 3 step 1 (drop the per-REQ `srs-alignment.md` artefact). Direct trigger: _"Is the SRS aligned with the current change?"_ / _"Audit SRS coverage across this branch"_.

**Reads:** `docs/SRS.md` (the project's Software Requirements Specification — single SoT for what the system promises), the implementation plan's AC table, the file diff.

**Writes:** updates `docs/SRS.md` with new `REQ-AREA-NNN` stubs (or flags stale items, or annotates `@srs-deferred`); populates the SRS-ID column on the AC table; drops `compliance/evidence/REQ-XXX/srs-alignment.md` summarising the per-REQ alignment.

**Why a separate SoT?** Implementation plans are per-REQ and short-lived. The SRS is the project's promise to its users — long-lived, cross-cutting. Drift between them is the silent compliance failure most projects ship with. `requirements-aligner` is the catch.

Detail: [`sdlc/files/_common/skills/requirements-aligner/SKILL.md`](../sdlc/files/_common/skills/requirements-aligner/SKILL.md).

---

## `adr-author`

**Trigger:** auto-invoked by `sdlc-implementer` at Phase 1 step 7 (ADR-worthiness verdict + draft) and Phase 3 step 2 (drop the per-REQ `architecture-decision.md` artefact). Direct trigger: _"Does REQ-XXX need an ADR?"_ / _"Audit ADR-worthiness across this branch"_.

**Reads:** the implementation plan, the file diff, the existing `docs/ADR/` catalog, `sdlc-config.json:adr_author.file_paths_signal_architecture` (consumer-tunable signal list).

**Writes:** when the change crosses the ADR-worthiness threshold (new third-party dep / new database or queue / new external service / pattern change spanning >3 files / HIGH-CRITICAL risk class / configured path signal) — allocates the next `ADR-NNN`, drafts a Context/Decision/Consequences/Alternatives/Status stub at `docs/ADR/ADR-NNN-<slug>.md`, and injects "Produced ADR-NNN" into the implementation plan's Architecture decisions section. Otherwise injects "No ADR needed — <rationale>". Always drops `compliance/evidence/REQ-XXX/architecture-decision.md` summarising the verdict for the auditor.

**Why a separate SoT?** Architectural choices outlive the REQ that produced them. ADRs are the project's institutional memory; `adr-author` keeps them current. Closes ISO 27001 A.8.25 (Secure development life cycle) via the dedicated `architecture_decision` evidence type predicate.

Detail: [`sdlc/files/_common/skills/adr-author/SKILL.md`](../sdlc/files/_common/skills/adr-author/SKILL.md).

---

## `risk-register-keeper`

**Trigger:** auto-invoked by `sdlc-implementer` at Phase 1 step 8 (open RISK-NNN entries for MEDIUM/HIGH REQs — LOW skipped by default), at incident close (open a residual-risk entry), and at Phase 3 step 3 (drop the per-REQ `risk-assessment.md` artefact summarising entries touched). Direct trigger: _"Open a control-gap entry"_ / _"Audit risk-register freshness"_ / _"Is solo-with-gap signed off?"_.

**Reads:** `compliance/risk-register.md` (the persistent risk SoT), the implementation plan + diff for risk-introducing changes, `sdlc-config.json:approval.mode` for the `solo_with_gap` enforcement check.

**Writes:** canonical RISK-NNN rows in the register (status: OPEN / MITIGATED / ACCEPTED / CLOSED + likelihood × impact 3×3 score + framework cross-references); the per-REQ `compliance/evidence/REQ-XXX/risk-assessment.md` summary; the `solo_with_gap` control-gap entry on projects in that approval mode (refuses approval until the entry is signed off — the four-eyes claim must be deliberately acknowledged, not silently inherited).

**Why a separate SoT?** Risk is forward-looking (potential failure) and per-control (compensating measures, residual rating); it's a different shape from per-REQ plans. Closes SOC 2 CC3.2 (Risk identification and assessment) via the dedicated `risk_assessment` evidence type predicate.

Detail: [`sdlc/files/_common/skills/risk-register-keeper/SKILL.md`](../sdlc/files/_common/skills/risk-register-keeper/SKILL.md).

---

## How the skills compose during a typical issue

A tracked REQ for a MEDIUM-risk feature:

```
sdlc-implementer (Phase 0 — triage)
  ↓ tracked → Phase 1 (Plan)
  ↓ writes implementation-plan.md
  ↓ ⇨ requirements-aligner       (populates SRS-ID column; updates docs/SRS.md)
  ↓ ⇨ adr-author                 (verdict: ADR / no-ADR; drafts if needed)
  ↓ ⇨ risk-register-keeper       (opens RISK-NNN entries for the risks introduced)
  ↓ updates RTM.md, posts plan summary on the issue, checkpoint (HIGH/CRIT only)
  ↓
  Phase 2 (Implement + Test)
  ↓ implementation work
  ↓ ⇨ e2e-test-engineer          (writes the per-AC critical-tier spec(s))
  ↓ commits + push develop, gates green
  ↓
  Phase 3 (Compile evidence)
  ↓ ⇨ requirements-aligner       (drops srs-alignment.md)
  ↓ ⇨ adr-author                 (drops architecture-decision.md)
  ↓ ⇨ risk-register-keeper       (drops risk-assessment.md)
  ↓ + test-execution-summary.md, security-summary.md, release ticket
  ↓ all uploaded to the portal under the REQ-XXX release
  ↓
  Phase 4 (Submit for review) — opens release PR, HARD STOP for UAT
  ↓
  ⏸ Operator approves UAT on the portal
  ↓
  Phase 5 (Deploy) — merge, post-deploy verification, mark Released
```

Each sub-skill returns synchronously to the parent orchestrator — the operator does not need to nudge the agent between sub-skill returns (see DevAudit-Installer#144 + the *Sub-skill return semantics* rule in `sdlc-implementer/SKILL.md`).

---

## See also

- [`change-workflows.md`](./change-workflows.md) — change-type → workflow routing; what each path runs and skips
- [`compliance-gates.md`](./compliance-gates.md) — the five CI workflows that enforce the SDLC at the gate-evidence layer
- [`evidence-tiers.md`](./evidence-tiers.md) — Tier 1 / 2 / 3 evidence taxonomy + upload paths
- [`e2e-test-tiers.md`](./e2e-test-tiers.md) — the 3-tier E2E gating model (smoke / critical / regression)
- [`sdlc-framework.md`](./sdlc-framework.md) — the framework's structure, adapter layering, and enforcement layers
- [`onboarding.md`](./onboarding.md) — `install` walkthrough; how the skills land in your repo
- [`adding-a-skill.md`](./adding-a-skill.md) — extending the catalog with a project-specific skill
