---
name: adr-author
description: Catch the moment a tracked change makes an architecturally significant decision and either draft the canonical `docs/ADR/ADR-NNN-<slug>.md` artefact or document why no ADR was needed. Runs at Stage 1 (plan APPROVAL) and Stage 3 (evidence pack) of the SDLC. Decides "is this REQ architecturally significant?" via a calibrated heuristic (new third-party dependency, new database/cache/queue, new external service, pattern change spanning >3 files, HIGH/CRITICAL risk class), drafts a Context/Decision/Consequences/Alternatives/Status stub when warranted, allocates the next `ADR-NNN` ID, injects an ADR-NNN reference into the implementation plan, and produces a per-REQ `compliance/evidence/REQ-XXX/architecture-decision.md` artefact. Use when invoking on a single REQ ("draft an ADR for REQ-066", "does this REQ need an ADR?", "is the architectural decision documented?"); when `sdlc-implementer` delegates at Stage 1 plan-approval or Stage 3 evidence-compilation; when an operator asks for ADR-worthiness judgement on an in-flight branch. Do NOT use for authoring full ADR prose end-to-end (the operator edits the stub to canonical wording); for supersession-lifecycle handling (deferred to Phase B); for cross-link maintenance between ADRs and risk-register entries (that's `risk-register-keeper`); for framework-clause mapping of the `architecture_decision` evidence type (that's META-COMPLY's `framework-registry-auditor`).
---

# ADR Author

Catches the moment a tracked REQ makes an architecturally significant decision that should produce a persistent record — and either drafts the ADR or documents why no ADR was needed. Sibling of [`requirements-aligner`](../requirements-aligner/SKILL.md) and `risk-register-keeper` in the SoT-alignment skill family.

The skill is **Phase A scope** (per [DevAudit-Installer#120](https://github.com/metasession-dev/DevAudit-Installer/issues/120)): Stage 1 + Stage 3 hooks only. Supersession-lifecycle, stale-decision detection, and cross-link maintenance between ADRs and other SoT artefacts all defer to Phase B — the v1 surface is the safest enforcement points.

## What this skill owns

| Artefact | Lives at | Tier |
|---|---|---|
| `docs/ADR/ADR-NNN-<slug>.md` (the SoT, project-spanning) | Top-level project docs | 2 (project strategy) |
| `compliance/evidence/REQ-XXX/architecture-decision.md` (per-REQ Tier 3 evidence) | Per-REQ evidence directory | 3 (per-REQ) |

The skill does **not** own the canonical ADR prose. It drafts a stub the operator edits to publication-grade wording. Inventing decision rationale without operator review is exactly the kind of silent-drift this skill exists to prevent.

## Scope

**In scope**

- Phase 1 (Stage-1 hook) — judge "is this REQ architecturally significant?" → if yes, allocate `ADR-NNN` + draft Context/Decision/Consequences/Alternatives/Status stub → inject ADR-NNN reference into implementation plan's *Architecture Decisions* section.
- Phase 2 (Stage-3 hook) — drop `compliance/evidence/REQ-XXX/architecture-decision.md` pointing at the ADR file (or recording the no-ADR rationale).
- Per-REQ ADR-worthiness audit (operator invocation).

**Out of scope**

- Drafting canonical ADR prose end-to-end — the skill drafts a stub; the operator authors final wording.
- Supersession lifecycle — when ADR-007 supersedes ADR-003, both stay on disk; ADR-003's status flips to `Superseded by ADR-007`. Deferred to Phase B.
- Stale-decision detection — when the file referenced by ADR-007's *Decision* section is heavily modified in a new REQ without producing a new ADR. Deferred to Phase B.
- Cross-link maintenance to SRS items (`requirements-aligner`'s domain) or risk-register entries (`risk-register-keeper`'s domain) — the skills cross-reference each other in their stubs but Phase B owns the bidirectional consistency.
- Framework-clause mapping of the `architecture_decision` evidence type — that's META-COMPLY's `framework-registry-auditor`.

## The workflow

Five phases. Phase 0 routes; Phases 1–2 are the SDLC stage hooks; Phase 3 is the utility audit; Phase 4 reports.

### Phase 0 — Route

Determine what's being decided:

- **Stage-1 plan APPROVAL** — `sdlc-implementer` (or operator) says *"check ADR-worthiness for REQ-XXX before approving the plan"* / *"does this need an ADR?"* → Phase 1.
- **Stage-3 evidence pack** — `sdlc-implementer` (or operator) says *"drop the architecture-decision.md for REQ-XXX"* → Phase 2.
- **Per-REQ ad-hoc audit** — operator says *"is REQ-XXX's architectural decision documented?"* / *"audit ADR-worthiness across this branch"* → Phase 3.

The skill does not fire spontaneously. The parent skill (`sdlc-implementer`) invokes it at Stages 1 + 3 per the parent's SKILL.md delegation contract.

### Phase 1 — Stage-1 plan APPROVAL hook

Input: the REQ's `compliance/plans/REQ-XXX/implementation-plan.md` plus the working-tree diff.

**Step 1 — Read the file list + diff.** Identify which files the REQ touches.

**Step 2 — Apply the ADR-worthiness decision tree.** The skill judges *architectural significance* via these signals — any one matching ⇒ ADR warranted:

| Signal | Examples | Verdict |
|---|---|---|
| New third-party runtime dependency | adding `redis`, `bull`, a new ORM, a new auth provider package | ADR |
| New external service | introducing Stripe, Twilio, a new SaaS integration | ADR |
| New database / cache / queue tier | adding Redis alongside Postgres, swapping MongoDB for Postgres | ADR |
| Pattern change spanning > 3 files | moving from REST handlers to RPC, swapping auth flow across the API surface | ADR |
| Schema-level data model change | new tables that other tables FK to, fundamental relationship changes | ADR |
| Risk classification HIGH or CRITICAL | per `Test_Policy.md` §Risk-Based Testing | ADR (operator confirms) |
| File-path signal | `sdlc-config.json:adr_author.file_paths_signal_architecture` matches a touched file | ADR (operator confirms) |
| Bug fix touching ≤ 3 files in `app/` or `lib/` | a typo, a copy edit, a null-guard, a one-place validation | no ADR |
| Single-file refactor | extracting one function, renaming one variable | no ADR |
| Styling tweak | CSS-only, Tailwind class shuffle | no ADR |
| Dependency bump | `npm update foo` with no API change | no ADR |
| Documentation | `docs/`, `README.md`, doc-comments | no ADR |

**Step 3 — Branch on verdict:**

- **ADR warranted** → Phase 1 Step 4 (draft the stub).
- **No ADR** → Phase 1 Step 7 (inject the no-ADR rationale).
- **Ambiguous** → surface a candidate verdict + reasoning to the operator and ask. The operator can confirm or override. Do NOT silently default.

**Step 4 — Allocate the next `ADR-NNN`.** Scan `docs/ADR/` for the max-existing `ADR-NNN` (zero-padded to three digits where the project's convention has it) and propose `+1`. If `docs/ADR/` doesn't exist yet, create it + allocate `ADR-001`. The skill does NOT support cross-branch ID coordination — if two parallel branches both consume the same next-free ID, the git merge on the directory is the canonical conflict signal. Re-run the skill post-merge to re-allocate.

**Step 5 — Draft the stub `docs/ADR/ADR-NNN-<slug>.md`.** The slug is a kebab-case fragment of the decision (max 6 words). Format:

```markdown
---
adr_id: "ADR-NNN"
status: "Proposed"
date: "YYYY-MM-DD"
authored_by: "REPLACE — operator / agent"
related_reqs: ["REQ-XXX"]
supersedes: []
superseded_by: null
---

# ADR-NNN: <decision title>

## Status

**Proposed** (DRAFT — operator to flip to *Accepted* on plan APPROVAL)

## Context

REPLACE — what forces (constraints, requirements, tradeoffs) motivate this decision? Two or three sentences. Reference REQ-XXX and any SRS items it traces to.

## Decision

REPLACE — the choice made. One paragraph. Specific (not "we will use a queue" — "we will use Redis Streams as the queue substrate; consumers are FastAPI workers using `redis-py` ≥ 5.x").

## Consequences

REPLACE — what follows. List both **good** and **bad** consequences honestly.

- **Good:** REPLACE
- **Bad:** REPLACE
- **Neutral / tradeoffs:** REPLACE

## Alternatives considered

REPLACE — what other paths were on the table and why they were ruled out. At least one alternative; "we considered nothing else" is almost never honest.

- **Alternative 1:** REPLACE — ruled out because REPLACE
- **Alternative 2:** REPLACE — ruled out because REPLACE

## Cross-references

- Implementation plan: `compliance/plans/REQ-XXX/implementation-plan.md`
- SRS items: REPLACE — list `REQ-AREA-NNN` items this decision affects, from `requirements-aligner` output
- Risk register: REPLACE — list `RISK-NNN` entries this decision touches, from `risk-register-keeper` output (when that skill exists)
- Supersedes / superseded-by: REPLACE — fill if this ADR replaces a prior one
```

The stub is **draft-quality**; the operator edits each REPLACE marker before flipping the status from *Proposed* to *Accepted*.

**Step 6 — Inject ADR-NNN reference into the implementation plan.** The plan's *Architecture Decisions* section (converted from inline bullets to ADR-NNN references in this PR — see `Implementation_Plan_TEMPLATE.md`) gets a row added:

```markdown
## Architecture decisions

- **ADR-NNN — <decision title>** — Proposed by `adr-author` skill. Draft at `docs/ADR/ADR-NNN-<slug>.md`. Operator edits + flips status to *Accepted* before plan APPROVAL.
```

**Step 7 — No-ADR rationale.** When the verdict is *no ADR*, the plan's *Architecture decisions* section gets:

```markdown
## Architecture decisions

- **No ADR needed** — REPLACE one-line rationale. Examples: "Bug fix touching only `lib/services/order-service.ts:applyDiscount` — no structural change." / "CSS-only adjustment to dashboard layout — no behavioural or dependency change." / "Dependency bump from `foo@1.2.3` to `foo@1.2.5` (patch-level, no API change)."
```

The annotation is visible audit evidence that the *question was asked and answered* — auditors examine the negative case as well as the positive.

**Step 8 — Block plan APPROVAL** until each REQ has either:
- (a) an ADR file in this PR (status: Proposed → Accepted by operator), OR
- (b) an explicit "No ADR needed — <rationale>" annotation.

The block is configurable via `sdlc-config.json` — see *Configuration* below. Per the [#119 review](https://github.com/metasession-dev/DevAudit-Installer/issues/119#issuecomment-4631840651) defaults, advisory-with-strong-recommend in v1 (`block_on_stage_1: false`).

### Phase 2 — Stage-3 evidence pack hook

Input: the REQ's implementation plan (post-approval) and the working-tree diff.

**Step 1 — Generate `compliance/evidence/REQ-XXX/architecture-decision.md`.** Format:

```markdown
---
req: REQ-XXX
generated_by: adr-author
generated_at: <ISO timestamp>
---

# Architecture decision — REQ-XXX

## Outcome

REPLACE — one of:

- "**Produced ADR-NNN:** <title> (`docs/ADR/ADR-NNN-<slug>.md`)" — when an ADR was authored in this cycle
- "**No ADR needed** — <rationale>" — when the no-ADR branch was taken

## Detail

When **Produced ADR-NNN**:

- **ADR file:** `docs/ADR/ADR-NNN-<slug>.md`
- **Status:** Accepted (operator-confirmed during plan APPROVAL)
- **Summary:** REPLACE — one sentence from the ADR's *Decision* section
- **Affected files:** REPLACE — the file-path signals that triggered the verdict
- **Cross-references:** REPLACE — SRS items, risk-register entries

When **No ADR needed**:

- **Rationale:** REPLACE — one-line description copied from the plan's *Architecture decisions* section
- **Signals examined:** REPLACE — which signals from the decision tree were checked + how each scored

## Operator sign-off

I have reviewed the ADR-worthiness verdict above and confirm:

- [ ] The verdict (ADR or no-ADR) matches the actual scope of this REQ.
- [ ] If ADR: the file at `docs/ADR/ADR-NNN-<slug>.md` is edited from stub to canonical prose and status is Accepted.
- [ ] If no-ADR: the rationale is specific enough that an auditor reading this in 12 months would agree.

**Reviewer:** <operator-name>
**Date:** <YYYY-MM-DD>
```

**Step 2 — Tag for upload.** The CI's `compliance-evidence.yml` uploads this file as `evidence_type=architecture_decision` (added to META-COMPLY's `EVIDENCE_TYPE_REGISTRY` in the paired sub-PR). The framework-coverage matrix maps this to clauses per `framework-registry-auditor`'s review — see the META-COMPLY-side PR for the final clause attributions (v1 may ship orphan-by-design if the auditor rejects proposed mappings; see [`requirements-aligner`](../requirements-aligner/SKILL.md) for the precedent).

**Step 3 — Return to the running `sdlc-implementer` context.** The skill's job ends at the artefact + the operator sign-off. The orchestrator immediately continues with the rest of Stage 3 inline — no pause, no operator nudge needed. (Skills run in the same invocation context; control returns synchronously when this skill exits. See `sdlc-implementer/SKILL.md` § *Sub-skill return semantics*.)

### Phase 3 — Per-REQ ad-hoc audit

Same logic as Phase 1's Step 2 + Step 3, but produces a markdown report rather than blocking. Useful when an operator asks *"does REQ-XXX need an ADR?"* outside the SDLC orchestration flow, or runs *"audit ADR-worthiness across this branch"* to surface gaps.

### Phase 4 — Report

- For Phase 1 — the plan's injected section + the block/allow decision.
- For Phase 2 — the artefact path + summary line.
- For Phase 3 — markdown report (per-REQ verdict + reasoning).

## Configuration (sdlc-config.json)

```json
{
  "adr_author": {
    "enabled": true,
    "block_on_stage_1": false,
    "block_on_stage_3": true,
    "file_paths_signal_architecture": [
      "lib/services/",
      "lib/repositories/",
      "prisma/schema.prisma",
      "infra/"
    ]
  }
}
```

Per the [#119 review](https://github.com/metasession-dev/DevAudit-Installer/issues/119#issuecomment-4631840651) defaults:

- `block_on_stage_1: false` — advisory at Stage 1 by default. Operators flip to `true` once the heuristic is calibrated on the project (i.e. the skill's ADR/no-ADR verdicts have agreed with operator judgement on the last N runs).
- `block_on_stage_3: true` — the per-REQ evidence pack is the hard gate (the Stage 3 artefact is what actually lands as evidence; missing it leaks).
- `file_paths_signal_architecture` — list of file paths/prefixes that should signal an architectural change when touched. Defaults cover the common load-bearing surfaces; operators add project-specific paths (e.g. `infra/terraform/`, `app/auth/`).

## Principles

**Don't author the ADR prose.** The skill drafts a stub the operator edits to publication-grade wording. Inventing decision rationale without operator review is exactly the kind of silent-drift this skill exists to prevent.

**Calibrate, don't presume.** The decision tree above is a starting heuristic, not a hard rule. When a verdict surfaces on the edge — say a single-file change that introduces a new dependency — surface the candidate verdict + reasoning and ask. The operator can confirm or override. False-positive ADRs (drafting noise the team has to edit-and-delete) are worse than false-negative no-ADRs (the operator catches the gap in review and asks for one).

**Block at Stage 3, advise at Stage 1.** The implementation plan can carry "No ADR needed — <rationale>" and ship. The evidence pack cannot — the per-REQ `architecture-decision.md` artefact must exist before Stage 3 completes. Symmetric with `requirements-aligner` per the [#119 review](https://github.com/metasession-dev/DevAudit-Installer/issues/119#issuecomment-4631840651).

**Sibling-skill awareness.** When this skill drafts an ADR, cross-link the SRS items the decision affects (from `requirements-aligner`'s output) and the risk-register entries the decision touches (from `risk-register-keeper` when that skill ships). The three SoT-alignment skills work together; each produces its own per-REQ Tier 3 artefact but they share the per-REQ context. v1 carries the cross-references as inline references the operator fills in; Phase B will own bidirectional consistency.

**The negative case is audit evidence too.** A "No ADR needed — <rationale>" annotation is what an auditor examines to confirm the question was asked. An empty *Architecture decisions* section is the silent-drift failure mode. Always inject one or the other; never leave the section unannotated.

## References

- [DevAudit-Installer#120](https://github.com/metasession-dev/DevAudit-Installer/issues/120) — the issue this skill closes, with the case study + the locked Phase A scope.
- `sdlc-implementer/SKILL.md` Phase 1 + Phase 3 — the parent-skill invocation contract.
- `sdlc/files/_common/Implementation_Plan_TEMPLATE.md` — *Architecture decisions* section converted from inline bullets to ADR-NNN reference list in this PR (companion change).
- `sdlc/files/_common/1-plan-requirement.md` — stage-1 doc updated to point at the skill (companion change).
- `sdlc/files/_common/skills/requirements-aligner/SKILL.md` — sibling skill (same SoT-alignment family); see for the symmetric shape (Stage 1 + Stage 3 hooks; advisory-then-blocking enforcement).
- Sibling skill (forthcoming): `risk-register-keeper` (DevAudit-Installer#121).
- Meta-reviewer (META-COMPLY): `framework-registry-auditor` reviews the `architecture_decision` evidence type's clause mappings before the META-COMPLY sub-PR opens. Per the [#119 sequencing](https://github.com/metasession-dev/DevAudit-Installer/issues/119#issuecomment-4631840651).
- Existing ADRs in the framework itself: [`DevAudit-Installer/docs/ADR/ADR-001-polyglot-sdlc-architecture.md`](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/ADR/ADR-001-polyglot-sdlc-architecture.md) — the pattern this skill maintains.
