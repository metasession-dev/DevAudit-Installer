---
title: "Implementation plan — REQ-XXX"
requirement_id: "REQ-XXX"
risk_class: "REPLACE — HIGH | MEDIUM | LOW"
change_type: "REPLACE — feat | fix | refactor | perf | chore | docs | ci | build | test | compliance | revert"
authored_by: "REPLACE — operator / agent"
authored_at: "REPLACE — YYYY-MM-DD"
---

> ⚠️ **STARTER TEMPLATE — REPLACE EVERY `REPLACE` MARKER BEFORE COMMITTING.**
> The shape of this doc is load-bearing: the framework-coverage matrix
> closes four different clauses based on this plan being present + tagged
> with the correct evidence category. Empty stub commits flip the
> matrix to COVERED with placeholder content — auditors reject this.

# Implementation plan — REQ-XXX

## Framework attribution

**Evidence type:** `compliance_document` · **Category:** `planning` · **Scope:** per-REQ

**Closes clauses** (every implementation plan satisfies all four):

| Clause | What this plan must contain |
|---|---|
| **ISO 29119 §3.4** Test Plan | Acceptance criteria + the strategy for verifying each one. Reference the per-REQ `test-plan.md` if it lives separately. |
| **ISO 27001 A.8.25** Secure development life cycle | Threat model + secure-design considerations (auth, data handling, dependencies, secrets). |
| **GDPR Art. 25** Data protection by design and by default | Per-purpose data flows; minimisation; lawful basis; retention. **Required for any REQ that processes personal data; explicit "no personal data" callout if not.** |
| **EU AI Act Art. 11** Technical documentation (Annex IV) | When the REQ touches AI / model behaviour: model provenance, prompt sources, oversight path. **Explicit "no AI in scope" callout if not.** |

Each section below maps to one (or more) of these clauses. Don't delete sections — mark with "N/A — <reason>" if the clause genuinely doesn't apply.

## 1. Goal + acceptance criteria

> *Closes ISO 29119 §3.4 — test plan*

- **Goal:** REPLACE — one sentence describing what this REQ delivers, no jargon.
- **Acceptance criteria:**

| AC | Description | SRS item it traces to |
|---|---|---|
| AC1 | REPLACE — one-line behavioural description | REQ-AREA-NNN (existing) / REQ-AREA-NNN (new — propose stub) / `@srs-deferred: <reason>` |
| AC2 | REPLACE | REPLACE |
| … | | |

> **SRS-ID column populated by the `requirements-aligner` skill** at Stage 1 plan APPROVAL. The skill fuzzy-matches each AC against `docs/SRS.md`, proposes new `REQ-AREA-NNN` stubs for behaviour the SRS doesn't yet describe, and flags stale items. Plan APPROVAL blocks (configurable per `sdlc-config.json:requirements_aligner.block_on_stage_1`, ramp-up mode default-on for legacy projects) until every AC has either an existing SRS item, a new SRS-ID stub added in this cycle, or an explicit `@srs-deferred` annotation. See [`requirements-aligner` skill](../skills/requirements-aligner/SKILL.md).

## 2. Scope

- **In scope:** REPLACE — list every file / module / surface the change touches.
- **Out of scope:** REPLACE — adjacent areas the change deliberately leaves alone.

## 3. Architecture decisions

> *Populated by the [`adr-author` skill](../skills/adr-author/SKILL.md) at Stage 1 plan APPROVAL.*

Either an ADR-NNN reference list (when the skill judges the REQ architecturally significant) OR an explicit "no ADR" rationale. **Don't author this section inline as bullets** — the `adr-author` skill applies its decision tree and either drafts a `docs/ADR/ADR-NNN-<slug>.md` stub the operator edits, or annotates the no-ADR case.

When **ADR warranted**:

- **ADR-NNN — <decision title>** — Drafted by `adr-author`. File at `docs/ADR/ADR-NNN-<slug>.md`. Operator edits stub to canonical prose + flips status to *Accepted* before plan APPROVAL.

When **No ADR needed**:

- **No ADR needed** — REPLACE one-line rationale. Examples: "Bug fix touching only `lib/services/order-service.ts:applyDiscount` — no structural change." / "CSS-only adjustment — no behavioural or dependency change." / "Patch-level dependency bump with no API change."

The negative case is audit evidence too — auditors examine "no ADR — <rationale>" to confirm the question was asked. Never leave this section empty.

## 4. Threat model + security considerations

> *Closes ISO 27001 A.8.25 — secure development life cycle*

| Threat | Likelihood | Impact | Mitigation |
|---|---|---|---|
| REPLACE — e.g. SQL injection via X param | REPLACE | REPLACE | REPLACE |
| REPLACE — e.g. unauthenticated access to Y route | REPLACE | REPLACE | REPLACE |

**Secrets / credentials:** REPLACE — does this REQ handle any? If yes, how stored, rotated, scoped?

**Dependencies introduced:** REPLACE — list new npm/pip packages; flag any with known CVEs or transitive concerns.

## 5. Data protection (GDPR Art. 25)

> *Closes GDPR Art. 25 — data protection by design*

**Personal data processed by this REQ:** REPLACE — yes / no.

If **yes**, fill in:

- **Categories of data subjects:** REPLACE
- **Categories of personal data:** REPLACE (name, email, IP, etc.)
- **Special categories (Art. 9):** REPLACE — none / specify
- **Lawful basis:** REPLACE — Art. 6(1)(a-f) — pick one + justify
- **Purpose limitation:** REPLACE — how the design prevents repurposing
- **Data minimisation:** REPLACE — fields collected vs fields needed
- **Retention:** REPLACE — how long, then what happens
- **Cross-references:**
  - Is the ROPA (`compliance/governance/ropa.md`) updated? REPLACE — yes / no / N/A
  - Is a DPIA required? REPLACE — yes (file under `compliance/governance/dpia-<reqid>.md`) / no / N/A
- **Cross-border transfers:** REPLACE — none / specify mechanism

If **no**, write: *"N/A — this REQ does not process personal data. <Why — e.g. UI-only change, internal-routing refactor, dev-tooling.>"*

## 6. AI / model considerations (EU AI Act Art. 11)

> *Closes EUAIA Art. 11 — technical documentation*

**AI / ML in scope for this REQ:** REPLACE — yes / no.

If **yes**, fill in:

- **Model(s) used:** REPLACE — provider, model name, version
- **Inputs / outputs:** REPLACE
- **Prompt sources:** REPLACE — hardcoded / user-supplied / template-substituted
- **Human-oversight path:** REPLACE — what stops a bad output reaching a user? Review gate / circuit breaker / rate limit / etc.
- **Accuracy / robustness considerations:** REPLACE — known failure modes, planned guardrails
- **Cross-references:**
  - Is `compliance/governance/ai-disclosure.md` updated? REPLACE — yes / no / N/A

If **no**, write: *"N/A — this REQ does not introduce or change AI behaviour. <Why.>"*

## 7. Rollback plan

- **Reversible via:** REPLACE — git revert / migration down / config flip / etc.
- **Data implications of rollback:** REPLACE — any data written by the new code that an older version can't read?
- **Notification path if rollback during a release:** REPLACE — who hears, how quickly?

## 8. Verification

How the team will know the REQ is correct in production:

- **Unit + integration tests:** REPLACE — what's added / changed
- **E2E coverage:** REPLACE — which spec(s); reference per-AC `evidenceShot()` captures
- **Manual smoke after deploy:** REPLACE — bullet-list, or "none" with reason
- **Monitoring / alerting:** REPLACE — what dashboards / alerts the change adds or relies on

## 9. Sign-off

- **Plan reviewer (eng):** REPLACE — name + date
- **Plan reviewer (security / DPO):** REPLACE — when GDPR or threat-model sections are non-trivial; otherwise "N/A"
- **Plan approved by operator:** REPLACE — name + date

## Upload path

This file lives at `compliance/plans/REQ-XXX/implementation-plan.md` and is uploaded automatically on the next push to `develop` via `compliance-evidence.yml`. The portal's framework-coverage matrix flips ISO 29119 §3.4, ISO 27001 A.8.25, GDPR Art. 25, and EU AI Act Art. 11 to COVERED for this REQ once the upload lands.

Verify the upload at `https://devaudit.metasession.co/projects/<slug>/releases/REQ-XXX` — the "Evidence by requirement" list should show this plan tagged with `category=planning`.
