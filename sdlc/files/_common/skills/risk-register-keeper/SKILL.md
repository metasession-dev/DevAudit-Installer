---
name: risk-register-keeper
description: Maintain `compliance/risk-register.md` as the authoritative project-spanning record of risks across the SDLC lifecycle. Runs at Stage 1 (MEDIUM/HIGH risk classification — open RISK-NNN entries for risks the REQ introduces), at incident-close (residual risk after an incident), and at Stage 3 (per-REQ evidence pack). Owns the canonical risk row (description, inherent likelihood × impact, mitigations planned, residual likelihood × impact, owner, review-due, framework cross-references), allocates the next `RISK-NNN` per project, replaces the implementation plan's inline Risks/Considerations bullets with RISK-NNN reference list, and produces `compliance/evidence/REQ-XXX/risk-assessment.md` summarising which entries this REQ opened, mitigated, or accepted. Use when invoking on a single REQ ("draft a risk-register entry for REQ-XXX", "is the risk register up to date for this branch?"); when `sdlc-implementer` delegates at Stage 1 for MEDIUM/HIGH classifications or Stage 3 for the evidence artefact; when an incident closes and the residual-risk entry needs drafting; when a `solo_with_gap` approval mode requires the documented control-gap entry. Do NOT use for authoring canonical risk-treatment language (the operator owns the final wording); for periodic-review re-validation of accepted risks (deferred to Phase B); for full STRIDE/LINDDUN threat modelling (deferred to Phase B; consider folding into a separate `threat-modeller` skill if volume justifies); for framework-clause mapping of the `risk_assessment` evidence type (that's META-COMPLY's `framework-registry-auditor`).
---

# Risk Register Keeper

Maintains `compliance/risk-register.md` as the authoritative record of project risks across the SDLC lifecycle. Sibling of [`requirements-aligner`](../requirements-aligner/SKILL.md) (owns `docs/SRS.md`) and [`adr-author`](../adr-author/SKILL.md) (owns `docs/ADR/`) in the SoT-alignment skill family.

The skill is **Phase A scope** (per [DevAudit-Installer#121](https://github.com/metasession-dev/DevAudit-Installer/issues/121) and the [#119 review](https://github.com/metasession-dev/DevAudit-Installer/issues/119#issuecomment-4631840651)): Stage 1 + post-incident + Stage 3 hooks. Periodic-review re-validation, audit-pack inclusion, and STRIDE/LINDDUN threat modelling all defer to Phase B.

## What this skill owns

| Artefact                                                                   | Lives at                       | Tier                 |
| -------------------------------------------------------------------------- | ------------------------------ | -------------------- |
| `compliance/risk-register.md` (the SoT, project-spanning)                  | Top-level compliance directory | 2 (project strategy) |
| `compliance/evidence/REQ-XXX/risk-assessment.md` (per-REQ Tier 3 evidence) | Per-REQ evidence directory     | 3 (per-REQ)          |

The skill does **not** own the canonical risk-treatment language (operator decision — risk acceptance has legal + audit consequences). It allocates `RISK-NNN` IDs, drafts canonical row stubs the operator edits, and cross-references the register entries from per-REQ artefacts.

## Scope

**In scope**

- Phase 1 (Stage-1 hook, MEDIUM/HIGH only by default) — read implementation plan + diff → identify risks → allocate `RISK-NNN` → draft canonical rows → replace plan's Risks/Considerations bullets with RISK-NNN reference list.
- Phase 2 (post-incident hook) — read closed `incident`-labelled report → draft residual-risk entry → cross-link incident report ↔ register entry.
- Phase 3 (Stage-3 hook) — drop `compliance/evidence/REQ-XXX/risk-assessment.md` with this REQ's RISK-NNN summary.
- Phase 4 (`solo_with_gap` approval) — when project's `sdlc-config.json:approval.mode = 'solo_with_gap'`, refuse merge unless the documented control-gap RISK-NNN entry exists.
- Per-REQ ad-hoc audit (operator invocation).

**Out of scope**

- Authoring canonical risk-treatment prose — the skill drafts stubs; the operator owns final language. Risk acceptance has legal + audit consequences; the operator's sign-off is the audit value.
- Periodic-review re-validation — Phase B, paired with `governance-doc-author`'s periodic-review schedule.
- Audit-pack inclusion — Phase B, pairs with portal audit-pack export.
- STRIDE / LINDDUN threat modelling sub-domain — deferred; if volume justifies, graduates to a separate `threat-modeller` skill.
- Framework-clause mapping of the `risk_assessment` evidence type — that's META-COMPLY's `framework-registry-auditor`.
- CVSS-aware scoring — defaults to a `likelihood × impact` 3×3 matrix per `0-project-setup.md`. CVSS deferred.

## The workflow

Six phases. Phase 0 routes; Phases 1–4 are the SDLC stage hooks; Phase 5 is the utility audit; Phase 6 reports.

### Phase 0 — Route

Determine what's being assessed:

- **Stage-1 plan APPROVAL (MEDIUM/HIGH risk)** — `sdlc-implementer` (or operator) says _"draft risk-register entries for REQ-XXX"_ / _"this is HIGH risk, what goes in the register?"_ → Phase 1.
- **Incident close** — operator (or CI workflow) says _"incident-report-N.md just exported, draft the residual-risk entry"_ → Phase 2.
- **Stage-3 evidence pack** — `sdlc-implementer` (or operator) says _"drop the risk-assessment.md for REQ-XXX"_ → Phase 3.
- **`solo_with_gap` approval check** — operator says _"approval mode is solo_with_gap, is the control-gap entry on the register?"_ → Phase 4.
- **Per-REQ ad-hoc audit** — operator says _"is REQ-XXX's risk record complete?"_ / _"audit the register against this branch"_ → Phase 5.

The skill does not fire spontaneously. The parent skill (`sdlc-implementer`) invokes it at Stage 1 for MEDIUM/HIGH classifications + Stage 3 per the parent's SKILL.md delegation contract. `incident-export.yml` invokes it at incident close per its workflow definition.

### Phase 1 — Stage-1 plan APPROVAL hook (MEDIUM/HIGH only)

Input: the REQ's `compliance/plans/REQ-XXX/implementation-plan.md` plus the working-tree diff. Triggered only when the orchestrator's risk classification is **MEDIUM or HIGH** by default (LOW skipped); configurable via `sdlc-config.json:risk_register_keeper.block_on_stage_1`.

**Step 1 — Read the implementation plan's Threat model + Security considerations section** (`Implementation_Plan_TEMPLATE.md` §4) and the diff scope.

**Step 2 — Identify discrete risks.** Each risk is something an auditor could examine independently:

- A specific attack surface the change exposes (e.g. "SQL injection via the order-id query param").
- A specific control gap the change introduces (e.g. "no rate limit on /api/auth/forgot-password").
- A specific dependency-introduced concern (e.g. "Redis adopted as cache — no encryption at rest by default").
- A specific data-handling decision (e.g. "payment card last-4 stored in app DB").

**Step 3 — For each risk, allocate `RISK-NNN` and draft the canonical row.** Scan `compliance/risk-register.md` for max-existing ID + 1. If the register doesn't exist yet, bootstrap it from `sdlc/files/_common/governance/risk-register.md.template`.

Format per row (markdown table inside the register):

```markdown
### RISK-NNN — <one-line title>

- **Status:** OPEN
- **Opened:** YYYY-MM-DD (REQ-XXX)
- **Owner:** <operator>
- **Description:** REPLACE — what the risk is, in operator-readable terms (2-3 sentences).
- **Inherent likelihood × impact:** REPLACE (low × medium = 2 / medium × medium = 4 / etc — per 3×3 matrix in 0-project-setup.md)
- **Mitigations applied in this REQ:** REPLACE — list controls landing in this PR
- **Residual likelihood × impact:** REPLACE (post-mitigation)
- **Framework cross-references:** REPLACE — ISO27001.A.X.Y / SOC2.CC3.2 / GDPR.Art-32 (as applicable)
- **Review due:** YYYY-MM-DD (default 365d for ACCEPTED + MITIGATED; OPEN reviews monthly)
- **Cross-links:** REQ-XXX implementation plan; ADR-NNN (if produced by adr-author); incident-report-N (if post-incident)
```

**Step 4 — Replace the implementation plan's Risks/Considerations bullets with RISK-NNN references.** The plan's §4 (Threat model) gets a new sub-section:

```markdown
### Risk register entries

This REQ opens / touches the following entries in `compliance/risk-register.md`:

- **RISK-NNN — <title>** — Status: OPEN. Opened by `risk-register-keeper`. Operator edits the canonical row + signs off the residual rating before plan APPROVAL.
- **RISK-NNN — <title>** — Status: MITIGATED. Controls landing in this PR close the residual.
```

For **deferred** risks (the operator decides the surface doesn't merit a register entry — typically LOW-impact + LOW-likelihood combination), the row carries `@risk-deferred: <reason>` so the deferral is visible.

**Step 5 — Block plan APPROVAL** (configurable) until each MEDIUM/HIGH risk has either a RISK-NNN entry OR an explicit `@risk-deferred` annotation with rationale.

### Phase 2 — Post-incident hook

Triggered when `incident-export.yml` exports a closed `incident`-labelled GitHub issue to `compliance/governance/incident-report-N.md` (DevAudit-Installer v0.1.31 WS4+).

**Step 1 — Read the incident report.** Severity classification, root cause, controls applied, residual concern.

**Step 2 — Draft a residual-risk entry.** Status branches:

| Outcome of incident                                                           | Status    | What the entry records                                                  |
| ----------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------- |
| Controls landed alongside the fix; residual risk now LOW                      | MITIGATED | What was wrong, what landed, what's checked going forward               |
| Controls deferred (fix-forward shipped but follow-up work tracked)            | OPEN      | Same, plus follow-up issue reference + deadline                         |
| Risk judged tolerable post-incident (e.g. one-off external dependency outage) | ACCEPTED  | What was wrong, why acceptance is defensible, when re-validation is due |

**Step 3 — Cross-link both directions.** The register entry references `incident-report-N.md`; the incident report file's frontmatter gets a `risk_register_entry: RISK-NNN` line so the audit trail is bidirectional.

### Phase 3 — Stage-3 evidence pack hook

Input: the REQ's implementation plan (post-approval) and the working-tree diff.

**Step 1 — Generate `compliance/evidence/REQ-XXX/risk-assessment.md`.** Format:

```markdown
---
req: REQ-XXX
generated_by: risk-register-keeper
generated_at: <ISO timestamp>
---

# Risk assessment — REQ-XXX

## Summary

This REQ opened / mitigated / accepted the following entries in `compliance/risk-register.md`:

| RISK-NNN | Title   | Status this cycle                                      | Residual L × I |
| -------- | ------- | ------------------------------------------------------ | -------------- |
| RISK-NNN | <title> | OPEN (opened in this REQ)                              | medium × low   |
| RISK-NNN | <title> | MITIGATED (controls landed in this REQ)                | low × low      |
| RISK-NNN | <title> | ACCEPTED (re-validated, no change required this cycle) | low × medium   |

## Framework cross-references

Risks above map to the following framework clauses:

- ISO27001.A.X.Y — RISK-NNN
- SOC2.CC3.2 — RISK-NNN (Risk identification and assessment)
- GDPR.Art-32 — RISK-NNN (Security of processing) — if applicable

## Operator sign-off

I have reviewed the risk register entries above and confirm:

- [ ] Each entry's residual rating is defensible given the controls landing in this REQ.
- [ ] No risk was downgraded without evidence (control demonstrated effective via tests).
- [ ] OPEN entries have follow-up tracking (issue / deadline / next-review-due).

**Reviewer:** <operator-name>
**Date:** <YYYY-MM-DD>
```

**Step 2 — Tag for upload.** The CI's `compliance-evidence.yml` uploads this file as `evidence_type=risk_assessment` (added to META-COMPLY's `EVIDENCE_TYPE_REGISTRY` in the paired sub-PR). The framework-coverage matrix attribution depends on `framework-registry-auditor`'s review — see the META-COMPLY-side PR for final clause closures.

**Step 3 — Hand-off back to `sdlc-implementer`.** The skill's job ends at the artefact + operator sign-off.

### Phase 4 — `solo_with_gap` approval check

When `sdlc-config.json:approval.mode = 'solo_with_gap'` and a release is about to be approved, the skill verifies the documented control-gap RISK-NNN entry exists in the register.

**Step 1 — Read `sdlc-config.json:approval.mode`.** If not `solo_with_gap`, exit (no check needed).

**Step 2 — Grep the register for a control-gap entry.** Look for an entry whose Framework cross-references include `SOC2.CC8.1` and whose description references `solo_with_gap` or equivalent ("self-approval", "single-actor release").

**Step 3 — If absent, draft one.** Status: ACCEPTED (operator-acknowledged trade-off). Description: "Project operates in solo_with_gap approval mode — release submitter approves their own release. This is a documented control gap relative to SOC2 CC8.1 four-eyes ideal. Compensating controls: <list — typically: CI gates green, MFA on release operator, monthly audit log review>."

**Step 4 — Refuse approval until the entry is signed off** by the operator. The control gap must be deliberately acknowledged, not silently inherited.

### Phase 5 — Per-REQ ad-hoc audit

Same logic as Phase 1's Step 2 + Step 3, but produces a markdown report rather than blocking. Useful when an operator asks _"is REQ-XXX's risk record complete?"_ outside the SDLC orchestration flow.

### Phase 6 — Report

- For Phase 1 — the plan's injected sub-section + the block/allow decision.
- For Phase 2 — the new register entry + cross-link confirmation.
- For Phase 3 — the artefact path + summary line.
- For Phase 4 — the gap-entry confirmation + approval-blocking decision.
- For Phase 5 — markdown report per REQ.

## Configuration (sdlc-config.json)

```json
{
  "risk_register_keeper": {
    "enabled": true,
    "block_on_stage_1": false,
    "block_on_stage_3": true,
    "scoring": "likelihood-impact",
    "auto_open_on_high_risk_req": true,
    "auto_open_on_closed_incident": true,
    "stage_1_min_risk_class": "MEDIUM"
  }
}
```

Per the [#119 review](https://github.com/metasession-dev/DevAudit-Installer/issues/119#issuecomment-4631840651) defaults:

- `block_on_stage_1: false` — advisory at Stage 1 by default. Flip to `true` once the project's register is populated enough that the check is reliably surfacing real risks (not false-positives on sparse coverage).
- `block_on_stage_3: true` — per-REQ `risk-assessment.md` artefact is the hard gate.
- `scoring: 'likelihood-impact'` — default 3×3 matrix per `0-project-setup.md`. CVSS-aware scoring (Phase B) deferred.
- `stage_1_min_risk_class: 'MEDIUM'` — LOW REQs skip the Stage-1 hook (the orchestrator's classification already decided no register entry is warranted). MEDIUM/HIGH trigger.
- `auto_open_on_closed_incident: true` — fire Phase 2 on every `incident-export.yml` close. Set to `false` for projects with high incident volume + dedicated risk-management process.

## Principles

**Don't author canonical risk-treatment language.** The skill drafts stubs; the operator owns the final wording. Risk acceptance has legal + audit consequences; the operator's sign-off carries the audit value. Inventing canonical risk-treatment prose without operator review is exactly the kind of silent acceptance this skill exists to prevent.

**Calibrate, don't over-trigger.** Not every change introduces a register-worthy risk. A typo fix doesn't. A CSS tweak doesn't. The `stage_1_min_risk_class` default skips LOW REQs precisely for this reason. False-positive register entries (drafting noise the team has to edit-and-delete) dilute the register's audit value.

**The negative case is audit evidence too.** An `@risk-deferred: <rationale>` annotation in the plan's Risks-register-entries sub-section proves the operator considered the surface and decided no entry was needed. Auditors examine the negative case as well as the positive — empty/silent is the failure mode, not "considered + deferred with rationale".

**Status semantics are load-bearing.** OPEN = active and unmitigated. MITIGATED = controls landed and demonstrated effective. ACCEPTED = operator-acknowledged trade-off with periodic re-validation. CLOSED = no longer relevant. Don't flip OPEN → CLOSED to make the register green for an audit — auditors check the audit log.

**Sibling-skill awareness.** When this skill opens a RISK-NNN that maps to an SRS item, cross-link the SRS-ID (from `requirements-aligner`). When the risk relates to an architectural decision, cross-link the ADR-NNN (from `adr-author`). The three SoT-alignment skills work together; each produces its own per-REQ Tier 3 artefact but they share the per-REQ context.

**`solo_with_gap` is a deliberate trade-off, not a silent override.** The framework supports solo-dev projects via `solo_with_gap` approval mode — but only on the explicit basis that the control gap is documented in the risk register. Phase 4 enforces this; the alternative is silently inheriting a SOC 2 CC8.1 gap that an auditor will flag.

## References

- [DevAudit-Installer#121](https://github.com/metasession-dev/DevAudit-Installer/issues/121) — the issue this skill closes, with the case study + locked Phase A scope.
- `sdlc-implementer/SKILL.md` Phase 1 + Phase 3 — the parent-skill invocation contract.
- `sdlc/files/_common/governance/risk-register.md.template` — starter template installed via `devaudit bootstrap-governance`.
- `sdlc/files/_common/Implementation_Plan_TEMPLATE.md` — §4 Threat model gets a new "Risk register entries" sub-section in this PR (companion change).
- `sdlc/files/_common/1-plan-requirement.md` — stage-1 doc updated to point at the skill (companion change).
- `sdlc/files/_common/skills/requirements-aligner/SKILL.md` — sibling skill (same SoT-alignment family); see for the symmetric shape.
- `sdlc/files/_common/skills/adr-author/SKILL.md` — sibling skill (same family).
- `sdlc/files/_common/skills/governance-doc-author/SKILL.md` — Phase 0 routing cross-links to this skill ("register a new risk" vs "draft a ROPA / DPIA / incident-report").
- Meta-reviewer (META-COMPLY): `framework-registry-auditor` reviews the `risk_assessment` evidence type's clause mappings before the META-COMPLY sub-PR opens.
- Approval mode reference: `sdlc-config.example.json:approval.mode` — `dual_actor` vs `solo_with_gap` vs `auto_low_risk`.
