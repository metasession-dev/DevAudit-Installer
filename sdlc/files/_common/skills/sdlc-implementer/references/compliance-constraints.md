# Compliance constraints (per framework)

The `sdlc-implementer` skill was audited against the five compliance frameworks DevAudit is designed to support. No framework breaks structurally; six architectural constraints + one process risk preserve the controls each framework expects. This document is the long-form audit.

The constraints are enforced in `SKILL.md` and in the smoke pass. Where applicable, the portal itself enforces them server-side as a defence-in-depth measure.

## The six architectural constraints

### 1. Never skip the UAT review gate

| | |
|---|---|
| **What** | The skill must not attempt to merge a PR while the `DevAudit Release Approval` check is red. |
| **Why (framework)** | ISO 27001 A.8.32 (Change management); SOC 2 CC8 (Change management); EU AI Act Art. 14 (Human oversight). The UAT gate is the load-bearing human-oversight checkpoint. |
| **Enforcement** | Portal-side via `check-release-approval.yml` workflow status check + branch protection. Skill-side: never call `gh pr merge` until the check is green. |
| **Failure mode if violated** | Merge bypasses human review entirely. Auditor's question "did a human approve this change?" cannot be answered with evidence. |

### 2. For HIGH/CRITICAL, never act as the UAT approver

| | |
|---|---|
| **What** | The skill must verify at Phase 4 that the configured UAT reviewer (in `compliance/plans/REQ-XXX/implementation-plan.md` §Four-eyes attestation slot) differs from the skill-trigger user. If they match, halt. |
| **Why (framework)** | SOC 2 CC8.1 — segregation of duties; ISO 27001 A.5.15 (Access control — duty segregation). The change-author cannot also be the change-approver for higher-risk work. |
| **Enforcement** | Portal-side: the release-approval API rejects self-approval for MEDIUM/HIGH/CRITICAL risk classes. Skill-side: refuses to open the PR if the configured reviewer matches the trigger user. |
| **Failure mode if violated** | One human approves their own work. The four-eyes principle is paper-only. |

### 3. Plan checkpoint mandatory for HIGH/CRITICAL

| | |
|---|---|
| **What** | At Phase 1 step 8, the skill pauses for human approval of the plan **iff** risk class is HIGH or CRITICAL. LOW/MEDIUM pass through automatically. Can be forced on for all classes via `--require-plan-approval` flag or `DEVAUDIT_REQUIRE_PLAN_APPROVAL=1` env var. |
| **Why (framework)** | EU AI Act Art. 14 (Human oversight for high-risk AI systems); SOC 2 CC3 (Risk assessment requires human judgement); ISO 29119 §6 (Test management — planning is a documented human step). For HIGH/CRITICAL work the plan IS the design — human review must precede code. |
| **Enforcement** | Skill-side. Phase 1 explicitly halts and waits for the human's "go" before Phase 2. |
| **Failure mode if violated** | Code is written + tests are designed + evidence is captured for a HIGH/CRITICAL change without a single human-checkpointed plan. Auditor cannot evidence the design step. |

### 4. Change-request loop triggers full UAT re-review

| | |
|---|---|
| **What** | When new commits land on a PR after a UAT change-request, the portal's release-approval state resets. The skill respects the reset, surfaces a "UAT re-review needed" comment, and never assumes the prior approval still covers the new changes. |
| **Why (framework)** | ISO 27001 A.14.2.4 (Restrictions on changes to software packages — each change goes through controls); SOC 2 CC8.1 (Each change requires approval). Treating "approval given once, all subsequent commits inherit it" would make UAT a one-shot rubber-stamp. |
| **Enforcement** | Portal-side: the release-approval state machine resets on new commits to the linked branch. Skill-side: re-requests review explicitly via the portal API after each change-request iteration. |
| **Failure mode if violated** | Drive-by changes ship under cover of an old approval. The audit trail shows "approved once" — but the approved diff is not the diff that shipped. |

### 5. AI involvement disclosed on every commit

| | |
|---|---|
| **What** | Every commit the skill creates carries a `Co-Authored-By: Claude <noreply@anthropic.com>` trailer (or equivalent for the specific Claude model in use). |
| **Why (framework)** | ISO 27001 — transparency norms; EU AI Act Art. 13 (Transparency and provision of information to deployers); GDPR Art. 22 (data subjects' right to know about automated decisions, where applicable). When an auditor traces a commit, the AI involvement must be visible. |
| **Enforcement** | Skill-side. Every `git commit` call includes the trailer. CI's `compliance-validation.yml` workflow can be configured to grep for `Co-Authored-By` on PRs labelled with the AI-touched marker; this is optional but recommended. |
| **Failure mode if violated** | AI-generated code is indistinguishable from human-authored code in the audit trail. Future-proofing against tightening AI-disclosure regulations breaks. |

### 6. All portal mutations through audit-logged APIs

| | |
|---|---|
| **What** | The skill calls `devaudit push` and the standard portal HTTP APIs — never a database back-channel, never a service-role-key-equivalent that bypasses the audit log. |
| **Why (framework)** | ISO 27001 A.12.4 (Logging and monitoring); SOC 2 CC4 + CC7 (Monitoring activities + system operations). Every action that affects compliance state must produce an audit-log entry attributable to a human identity (the user whose PAT is in `DEVAUDIT_USER_TOKEN`). |
| **Enforcement** | Skill-side. All portal interaction goes through `devaudit push` or `curl`/`gh api` against the documented REST endpoints. |
| **Failure mode if violated** | Compliance-affecting actions land on the portal with no audit-log trail. Auditor's "who did this?" question is unanswerable. |

## The one process risk

### 7. Rubber-stamping at UAT

| | |
|---|---|
| **What** | If the UAT reviewer approves without actually reading the change, the controls are formally satisfied but substantively hollow. |
| **Why (framework)** | SOC 2 CC4.1 (Monitoring activities — the entity should detect this via its own QA sampling). Not enforced by any control mechanism; relies on human discipline. |
| **Enforcement** | Not architectural. Mitigations: the SKILL.md's Principles section names the UAT reviewer as "the load-bearing human"; the portal's UAT-review UI intentionally adds friction (no one-click approve from email); org policy should random-sample approvals for QA. |
| **Failure mode if violated** | Auditors detect approval velocity that doesn't match human reading time. Spot-checks reveal approvals on changes the approver couldn't articulate. Trust erodes. |

## What's NOT a compliance break

Audited and cleared:

- **Audit log attribution** (ISO 27001 A.12.4): Actions flow through the user's tokens (`DEVAUDIT_USER_TOKEN`, `GH_TOKEN`); commits carry `Co-Authored-By`; UAT approval is a genuine human act recorded on the portal. The auditor's question "did this human review this?" is answered by the UAT-approval event on the portal, not by the commit signature.
- **GDPR Art. 22** (Automated decisions about data subjects): Doesn't apply. The skill makes technical decisions, not decisions about people. If the issue being implemented IS Art. 22 work (an algorithm that decides about data subjects), the implementation plan captures DPA/DPIA requirements at Phase 1 — same as today.
- **EU AI Act high-risk classification of the skill itself**: The skill is a productivity tool, not high-risk under Annex III. Art. 14 (Human oversight) is satisfied by the HIGH/CRITICAL plan checkpoint + the always-on UAT gate.
- **ISO 29119 test adequacy**: Human at UAT reviews test scope. Same caveat as #7 above — depends on UAT reviewer paying attention.
