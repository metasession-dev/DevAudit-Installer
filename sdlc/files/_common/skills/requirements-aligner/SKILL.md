---
name: requirements-aligner
description: Catch drift between docs/SRS.md (the requirements source-of-truth) and the in-flight implementation. Runs at Stage 1 (plan APPROVAL) and Stage 3 (evidence pack) of the SDLC. Parses each REQ's acceptance criteria, fuzzy-matches each AC against existing SRS items, proposes new `REQ-AREA-NNN` stubs for behaviour the SRS doesn't yet describe, flags potentially-stale SRS items whose source-of-truth file was modified without the SRS prose being updated, and produces a per-REQ `compliance/evidence/REQ-XXX/srs-alignment.md` artefact that traces the audit back from code to spec. Use when invoking on a single REQ ("align SRS for REQ-066", "what SRS items did this REQ need?", "is the SRS in sync with this branch?"); when `sdlc-implementer` delegates at Stage 1 plan-approval or Stage 3 evidence-compilation; when running a branch-wide audit ("audit SRS drift across this PR's commits"). Do NOT use for SRS authoring from scratch (the operator drafts new items; this skill proposes the IDs and stubs); for changing the SRS prose conventions themselves (those are operator decisions); for framework-clause mapping of the `srs_alignment` evidence type (that's META-COMPLY's `framework-registry-auditor`).
---

# Requirements Aligner

Catches the class of drift the wawagardenbar-app REQ-066 cycle surfaced: code, tests, and screenshots shipped across 10 ACs in 6 PRs while `docs/SRS.md` stayed untouched. Seven new SRS items + one stale item were filed retroactively after release. This skill catches them at Stage 1 or Stage 3, before merge.

The skill is **Phase A scope** (per [DevAudit-Installer#119](https://github.com/metasession-dev/DevAudit-Installer/issues/119) review): Stage 1 + Stage 3 hooks only. Stage 2 (commit-time advisory) + Stage 5 (post-release audit) + automatic follow-up issue filing all defer to Phase B/C — the v1 surface is the safest enforcement points.

## What this skill owns

| Artefact | Lives at | Tier |
|---|---|---|
| `docs/SRS.md` (the SoT, project-spanning) | Top-level project docs | 2 (project strategy) |
| `compliance/evidence/REQ-XXX/srs-alignment.md` (per-REQ Tier 3 evidence) | Per-REQ evidence directory | 3 (per-REQ) |

The skill does **not** own the SRS prose conventions (operator decision). It does propose new `REQ-AREA-NNN` IDs + Given/When/Then stubs the operator then edits.

## Scope

**In scope**

- Phase 1 (Stage-1 hook) — parse plan AC table → fuzzy-match against `docs/SRS.md` → propose new IDs / flag stale → inject into plan's "SRS items proposed/touched" section.
- Phase 2 (Stage-3 hook) — drop `compliance/evidence/REQ-XXX/srs-alignment.md` with the per-REQ trace from AC to SRS item.
- Per-REQ alignment audit (operator invocation).
- Branch-wide alignment audit (operator invocation — walks every REQ touched on the branch).

**Out of scope**

- Drafting SRS prose from scratch — the skill proposes stubs; the operator authors final language.
- Stage 2 (commit-time advisory) — deferred to Phase B.
- Stage 5 (post-release audit) — deferred to Phase B.
- Automatic follow-up issue filing — deferred to Phase C (default OFF per [#119 review](https://github.com/metasession-dev/DevAudit-Installer/issues/119#issuecomment-4631840651)).
- Threat modelling, ADR drafting, risk-register entries — adjacent skills (`adr-author`, `risk-register-keeper`).
- Framework-clause mapping of the `srs_alignment` evidence type — that's META-COMPLY's `framework-registry-auditor`.

## The workflow

Five phases. Phase 0 routes; Phases 1–2 are the SDLC stage hooks; Phases 3–4 are utilities; Phase 5 reports.

### Phase 0 — Route

Determine what's being aligned:

- **Stage-1 plan APPROVAL** — `sdlc-implementer` (or operator) says *"align SRS for REQ-XXX before approving the plan"* → Phase 1.
- **Stage-3 evidence pack** — `sdlc-implementer` (or operator) says *"drop the srs-alignment.md for REQ-XXX"* → Phase 2.
- **Per-REQ ad-hoc audit** — operator says *"is the SRS in sync with REQ-XXX?"* / *"what SRS items did this REQ need?"* → Phase 3.
- **Branch-wide audit** — operator says *"audit SRS drift across this branch"* / *"every REQ on develop since main needs an SRS check"* → Phase 4.

The skill does not fire spontaneously. The parent skill (`sdlc-implementer`) invokes it at Stages 1 + 3 per the parent's SKILL.md delegation contract.

### Phase 1 — Stage-1 plan APPROVAL hook

Input: the REQ's `compliance/plans/REQ-XXX/implementation-plan.md` plus the working-tree diff.

**Step 1 — Parse the AC table.** The implementation plan template carries an "Acceptance Criteria" or equivalent section listing AC1, AC2, … with one-line descriptions of each behavioural change.

**Step 2 — Fuzzy-match each AC against `docs/SRS.md`.** For each AC, search the SRS for items whose:
- *Title* phrase appears in the AC description, OR
- *Implementation source-of-truth* footnote names a file the AC's diff touches, OR
- *Given/When/Then* prose semantically aligns with the AC (use the AC's verbs + nouns as the match-key).

**Step 3 — Categorise each AC:**

| AC ⇒ SRS state | Action |
|---|---|
| **Exact match** — AC traces 1:1 to an existing SRS item, no behavioural delta | Record the mapping; no SRS edit needed |
| **Match + drift** — existing SRS item covers the AC's surface but the behaviour has shifted (e.g. new field, new edge case, new error path) | Flag the item as *potentially stale*; the plan must mark it for update in this cycle OR justify why the SRS prose still covers it |
| **No match** — AC introduces behaviour the SRS doesn't yet describe | Propose new `REQ-AREA-NNN` (next free ID per area — see Step 4) with a Given/When/Then stub the operator edits |
| **Reverse drift** — an SRS item points at code that's been removed in this REQ | Propose deprecation: the SRS item is now obsolete |

**Step 4 — Allocate new SRS-IDs.** Scan `docs/SRS.md` for the max-existing ID per `REQ-AREA` prefix (`REQ-ORDER`, `REQ-INV`, `REQ-OPS`, etc.) and propose `+1` for each new item. The skill does NOT support cross-branch ID coordination — if two parallel branches both consume the same next-free ID, git merge on `docs/SRS.md` is the canonical conflict signal. Re-run the skill post-merge to re-allocate.

**Step 5 — Inject into the implementation plan.** The plan's "SRS items proposed/touched" section (added to `Implementation_Plan_TEMPLATE.md` alongside this skill's introduction) carries a table:

```markdown
## SRS items proposed/touched

| AC | SRS item | Status | Notes |
|---|---|---|---|
| AC1 | REQ-ORDER-005 (existing) | unchanged | Trace-only |
| AC2 | REQ-INV-010 (new — proposed) | stub | <one-line behaviour description> |
| AC3 | REQ-INV-011 (new — proposed) | stub | <one-line> |
| AC4 | REQ-ORDER-002 (existing) | stale — update needed | <one-line: what's drifted> |
```

For **deferred** items (the operator decides the AC genuinely doesn't need an SRS entry), the row carries `@srs-deferred: <reason>` so the deferral is visible.

**Step 6 — Block plan APPROVAL** until each AC has either:
- (a) an existing SRS item it traces to, with no drift, OR
- (b) a new SRS-ID stub added in this cycle, OR
- (c) an explicit `@srs-deferred: <reason>` annotation in the AC row.

The block is configurable via `sdlc-config.json` — see *Configuration* below. For projects with sparse SRS, the **ramp-up mode** defaults to audit-only for the first N runs (default 5) so operators get used to the surface before it starts blocking.

### Phase 2 — Stage-3 evidence pack hook

Input: the REQ's implementation plan (post-approval) and the working-tree diff.

**Step 1 — Generate `compliance/evidence/REQ-XXX/srs-alignment.md`.** Format:

```markdown
---
req: REQ-XXX
generated_by: requirements-aligner
generated_at: <ISO timestamp>
---

# SRS alignment — REQ-XXX

## ACs traced

| AC | SRS item | Action this cycle |
|---|---|---|
| AC1 | REQ-ORDER-005 | unchanged |
| AC2 | REQ-INV-010 | added (new — see Phase 1 stub) |
| AC3 | REQ-INV-011 | added (new) |
| AC4 | REQ-ORDER-002 | updated (drift) |

## Operator sign-off

I have reviewed the AC-to-SRS-item traces above and confirm:
- [ ] Each AC has a defensible SRS item.
- [ ] New SRS items have been edited from stubs to canonical Given/When/Then prose.
- [ ] Stale items have been brought current.

**Reviewer:** <operator-name>
**Date:** <YYYY-MM-DD>
```

**Step 2 — Tag for upload.** The CI's `compliance-evidence.yml` uploads this file as `evidence_type=srs_alignment` (added to META-COMPLY's `EVIDENCE_TYPE_REGISTRY` in the paired sub-PR). The framework-coverage matrix then closes `ISO29119.3.4` (Test Plan — requirements traceability) and `SOC2.CC2.1` (Communication of policies — when paired with INSTRUCTIONS.md) for this REQ.

**Step 3 — Return gap status to the running `sdlc-implementer` context (devaudit-installer#212 Gap 3).** In addition to producing the artefact, the skill returns a **gap status** to `sdlc-implementer`:

- `CLEAN` — all ACs trace to SRS items, no unresolved drift. The orchestrator continues with the rest of Stage 3.
- `GAPS_FOUND` — one or more ACs don't trace to SRS items, or drift is unresolved (no `@srs-deferred` annotation). Return the gap details (which ACs, what's missing). The orchestrator handles the gap per its [requirements gap flow](../sdlc-implementer/SKILL.md#requirements-gap-flow-devaudit-installer212): if `block_on_stage_3: true`, halt for the operator to resolve; if false, warn and continue.

The `block_on_stage_3` check verifies **artefact content** (no unresolved gaps without `@srs-deferred`), not just artefact existence. A `srs-alignment.md` with unresolved gaps and no `@srs-deferred` annotations fails the block. (Skills run in the same invocation context; control returns synchronously when this skill exits. See `sdlc-implementer/SKILL.md` § *Sub-skill return semantics*.)

### Phase 3 — Per-REQ ad-hoc audit

Same logic as Phase 1's Step 2 + Step 3, but produces a markdown report rather than blocking. Useful when an operator asks *"is REQ-XXX's SRS coverage healthy?"* outside the SDLC orchestration flow.

### Phase 4 — Branch-wide audit

For each REQ that has commits on the current branch (or in a specified range), run Phase 3. Produces an aggregated report listing per-REQ alignment status across the branch.

### Phase 5 — Report

- For Phase 1 — the plan's injected table + the block/allow decision.
- For Phase 2 — the artefact path + summary line.
- For Phase 3 / 4 — markdown report (one per REQ, or aggregated for branch audit).

## Configuration (sdlc-config.json)

```json
{
  "requirements_aligner": {
    "enabled": true,
    "block_on_stage_1": false,
    "block_on_stage_3": true,
    "auto_file_followup_issue": false,
    "ramp_up_runs": 5
  }
}
```

Per the [#119 review](https://github.com/metasession-dev/DevAudit-Installer/issues/119#issuecomment-4631840651) defaults:

- `block_on_stage_1: false` — advisory at Stage 1 by default. Operators flip to `true` once the SRS is populated enough that the skill is reliably catching real drift, not false-positives on sparse coverage.
- `block_on_stage_3: true` — the per-REQ evidence pack is the hard gate (the Stage 3 artefact is what actually lands as evidence; missing it leaks).
- `auto_file_followup_issue: false` — the skill never opens GitHub issues automatically. If gaps are detected at Stage 1 and the operator chooses to defer, the operator files the follow-up issue manually (or asks the skill to draft one, then confirms before filing).
- `ramp_up_runs: 5` — on projects whose SRS is sparse, the first 5 invocations are audit-only regardless of `block_on_stage_1`. After 5 successful runs the configured blocking kicks in.

## Principles

**Don't author the SRS prose.** The skill proposes IDs + stubs the operator edits. Inventing canonical SRS language without operator review is exactly the kind of silent-drift this skill exists to prevent.

**Fuzzy-match, don't presume.** When an AC matches an SRS item with low confidence, the skill surfaces the candidate and asks. False-positive matches (linking an unrelated SRS item to an AC) are worse than no match — they hide the gap they were trying to surface.

**Block at Stage 3, advise at Stage 1.** The implementation plan can carry `@srs-deferred` annotations and ship. The evidence pack cannot — the per-REQ `srs-alignment.md` artefact must exist before Stage 3 completes. This is the asymmetric enforcement the [#119 review](https://github.com/metasession-dev/DevAudit-Installer/issues/119#issuecomment-4631840651) recommended.

**Sibling-skill awareness.** When this skill proposes a new SRS-ID for an AC that documents an architectural decision, cross-link the proposed `adr-author` ADR (and vice versa). When it proposes an SRS-ID covering a HIGH-risk behaviour, cross-link the proposed `risk-register-keeper` RISK entry. The three SoT-alignment skills work together; each produces its own per-REQ Tier 3 artefact but they share the per-REQ context.

**Ramp-up is the kindness.** Projects whose `docs/SRS.md` is sparse will trip every check on first contact. Audit-only first 5 runs gives operators time to populate the SoT before the blocking enforces.

## References

- [DevAudit-Installer#119](https://github.com/metasession-dev/DevAudit-Installer/issues/119) — the issue this skill closes, with the case study (wawagardenbar-app REQ-066) + the locked Phase A scope.
- `sdlc-implementer/SKILL.md` Phase 1 + Phase 3 — the parent-skill invocation contract.
- `sdlc/files/_common/Implementation_Plan_TEMPLATE.md` — carries the "SRS items proposed/touched" section this skill populates (companion change in this PR).
- `sdlc/files/_common/3-compile-evidence.md` — the test-scope template gains an SRS-ID cross-reference table (companion change in this PR).
- Sibling skills (forthcoming): `adr-author` (DevAudit-Installer#120), `risk-register-keeper` (DevAudit-Installer#121).
- Meta-reviewer (META-COMPLY): `framework-registry-auditor` reviewed the `srs_alignment` evidence type's clause mappings before the META-COMPLY sub-PR opened. Per #119 sequencing.
- Memory cross-link: `project_srs_supersedes_requirements` (docs/SRS.md is the requirements SoT — REQ-AREA-NNN; RTM uses REQ-XXX); `feedback_check_git_before_filing_from_umbrella` (Phase 5 post-release audit must grep git before claiming SRS-IDs are missing — deferred to Phase B but worth noting).
