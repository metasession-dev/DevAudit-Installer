# Release lineage and test-cycle audit model

**Status:** Proposed implementation specification  
**Scope:** DevAudit-Installer producers, generated consumer workflows, and the DevAudit portal  
**Audience:** Release reviewers, auditors, SDLC maintainers, and implementation agents

## Purpose

The release portal must tell a truthful, reviewable story of how a change moved through the SDLC. A reviewer must be able to determine, without reconstructing GitHub Actions history:

- what the final approval covers;
- which earlier releases or housekeeping changes were absorbed;
- why each predecessor was superseded rather than abandoned;
- which SDLC stages were executed for each constituent release;
- how many genuine execution cycles ran at each stage;
- which cycles failed, passed, were skipped, or remain unresolved;
- which evidence was produced by each cycle;
- which evidence was inherited by the final approval envelope; and
- who approved and released the final scope, at what commit and deployment.

A bundled release must not flatten its predecessors into one release record or reassign all historical evidence to the final REQ. The final tracked release is the **approval envelope**. Every constituent release remains a distinct, immutable record linked to that envelope.

## Current behaviour and gap

The current implementation has useful foundations:

- evidence can carry `sdlcStage` and `testCycleId`;
- the portal groups evidence by `test_cycle_id`;
- cycle labels are numbered by chronology;
- releases can point to `superseded_by_release_id`;
- the successor can store structured `bundle_context` parsed from `BUNDLED-CHANGES-REQ-XXX.md`; and
- bundled-change evidence and absorbed predecessor rows are visible on the release dashboard.

However, the portal currently derives a cycle from the presence of evidence carrying the same string identifier. This creates four material limitations:

1. A document upload can appear to be a test execution even though no test execution occurred.
2. A failed workflow that produces no evidence can disappear from the release history.
3. Global labels such as `Cycle 14/16` show chronology but become difficult to read when the list is grouped by stage.
4. Evidence and predecessor releases can be attributed to the final REQ without preserving which constituent release and stage originally produced them.

REQ-093 demonstrates the result. The chronological numbering logic can correctly identify the earliest and latest evidence groups, but the reviewer sees non-sequential labels inside stage-grouped sections. Some Stage 3 evidence-pack uploads are counted as cycles, while several Stage 5 groups have no authoritative outcome metadata. The result is technically grouped evidence, not yet a complete test-execution and release-lineage model.

## Design principles

1. **A release is not a cycle.** A release is a governed scope of change. A cycle is one execution attempt at one SDLC stage for one source release.
2. **An evidence upload is not a cycle.** Documents can describe a release, stage, or cycle, but uploading a document does not prove an execution occurred.
3. **Bundling preserves identity.** A predecessor remains queryable under its original release identifier, status, stage history, and evidence.
4. **Superseded does not mean abandoned.** The record must identify the successor, reason, absorbed scope, and final disposition.
5. **Evidence is referenced, not reassigned.** Evidence remains owned by the source release and cycle that produced it. A successor approval may inherit it through an explicit relationship.
6. **Stage counts and chronology are separate views.** Stage grouping answers how many attempts a stage needed. A timeline answers how the overall release evolved.
7. **Outcomes are producer facts.** The portal must not infer pass or fail from filenames, artifact presence, or display order when an authoritative workflow result is available.
8. **Final approval freezes scope.** The release snapshot records the exact constituent releases, cycles, evidence, commits, and approvals that were reviewed.
9. **No silent branch-window attribution.** A later REQ must not absorb every earlier row merely because it is the next tracked release on the branch. The producer must submit explicit bundle membership or the portal must flag the scope for reconciliation.

## Terminology

| Term | Meaning |
|---|---|
| Approval envelope | The tracked release whose UAT and production approval covers the final bundled scope. |
| Constituent release | A distinct tracked, housekeeping, follow-up, or process release included in an approval envelope. |
| Superseded release | A release that did not complete independently and whose scope continued under a named successor. |
| Non-release work item | A commit or commit range absorbed into a release without having had a separate release record. |
| SDLC stage | A governed phase such as planning, implementation/test, evidence compilation, review/UAT, or deployment. |
| Test cycle | A real execution attempt at one stage for one source release. |
| Stage cycle number | The chronological ordinal within a source release and stage, such as UAT Cycle 2 of 3. |
| Timeline event | A release, workflow, approval, supersession, deployment, or incident event shown in global chronology. |
| Inherited evidence | Evidence owned by a constituent release or cycle and included in the successor's approval scope by reference. |

## Reviewer and auditor experience

### 1. Release header

The first viewport must state the approval outcome and scope:

```text
REQ-093 - Released
Bundled tracked release - 4 constituent releases
Final commit: <sha>    Production deployment: <deployment/run>
UAT approved: <actor/time>    Released: <actor/time>
```

While work is ongoing, the same area must show the current stage, current blocker, latest completed cycle, and next required action. It must never imply that CI is green while a required workflow is queued or running.

### 2. Release lineage

The dashboard must show the approval envelope and its constituents as explicit records:

```text
REQ-093 - final approval envelope - Released
|- REQ-090 - Superseded by REQ-093
|- housekeeping-2026-07-10 - Superseded by REQ-093
|- follow-up fix #495 - Superseded by REQ-093
`- non-release housekeeping commits - Absorbed by REQ-093
```

Each constituent row must link to its own release view and show:

- original title and summary;
- release type;
- PR and commit range;
- original lifecycle status;
- successor and supersession reason;
- stage/cycle summary;
- unresolved incidents or exceptions; and
- whether its evidence is inherited into the final approval.

Non-release work items are shown separately because they do not have a release lifecycle to preserve.

### 3. Stage and cycle matrix

The primary reviewer summary is a matrix derived from first-class test execution records, not evidence counts:

| Constituent release | Plan | Implement/test | Evidence | UAT | Production | Final disposition |
|---|---:|---:|---:|---:|---:|---|
| REQ-090 | Complete | 3 cycles | Complete | 1 cycle | Not run | Superseded |
| Housekeeping release | N/A | 2 cycles | Partial | Not run | Not run | Absorbed |
| Follow-up fix | Complete | 2 cycles | Complete | Not run | Not run | Absorbed |
| REQ-093 | Complete | 3 cycles | Complete | 2 cycles | 1 cycle | Released |

The UI must distinguish `Not run`, `Not applicable`, `Inherited`, `Incomplete`, and `0 recorded cycles`. These states are not interchangeable.

### 4. Stage-scoped cycle labels

Cycles are numbered within their source release and stage:

```text
REQ-093 - Implement/test - Cycle 3 of 3 - Passed
REQ-093 - UAT - Cycle 2 of 2 - Passed
REQ-090 - UAT - Cycle 1 of 1 - Passed - Inherited by REQ-093
```

The portal may also display the external run identifier, but it must not use that identifier as the human sequence number. Global `Cycle N/total` labels must not be the primary label inside stage-grouped views.

Each cycle expands to show:

- start and completion time;
- workflow, job, run ID, and run attempt;
- source branch and commit SHA;
- environment;
- authoritative outcome and conclusion;
- failure or skip reason;
- linked incident and remediation;
- superseding/retry cycle where applicable; and
- evidence produced during that execution.

### 5. Chronological journey

A separate timeline must describe how the bundle evolved. For example:

```text
1. Housekeeping release opened
2. CI failure identified a behavioural change
3. A tracked REQ was created and absorbed the housekeeping scope
4. CI failed; an incident and follow-up fix were opened
5. The follow-up release was included in the final approval envelope
6. CI passed
7. UAT failed, was remediated, and passed on Cycle 2
8. Production deployed and smoke verification passed
9. Production approval was recorded
10. The envelope was marked Released and predecessors remained Superseded
```

Stage grouping and chronology must both be available because they answer different audit questions.

### 6. Evidence browser

Evidence must be browsable through this hierarchy:

```text
Approval envelope
|- Constituent release
|  |- Release-level documents
|  |- SDLC stage
|  |  |- Stage-level documents
|  |  `- Cycle
|  |     `- Execution evidence
|  `- Incidents and exceptions
`- Final approval and deployment evidence
```

Release tickets, RTMs, plans, bundled-change manifests, security summaries, and AI-use notes are not cycles. Screenshots, gate outcomes, coverage, E2E reports, test results, and smoke results can be execution-scoped.

Inherited evidence must be labelled with its original owner and inheritance path. The UI must not present 74 UAT artifacts and 2 production artifacts as one undifferentiated effective set.

### 7. Final audit snapshot

When the approval envelope reaches `released`, the portal must freeze an immutable snapshot containing:

- bundle membership and reasons;
- constituent release statuses;
- commit and PR scope;
- stage completion states;
- cycle identifiers, order, and outcomes;
- evidence identifiers and content hashes;
- inherited-evidence relationships;
- incidents, exceptions, and remediation;
- required check-suite conclusions;
- UAT and production approvals; and
- deployment and production smoke provenance.

Later corrections must append an audit event or a new snapshot version. They must not silently rewrite the approved record.

## Target data model

The portal should add first-class entities while retaining the current columns during migration.

### `release_bundle_memberships`

One row per relationship between an approval envelope and a constituent release:

| Field | Purpose |
|---|---|
| `id` | Stable UUID. |
| `approval_release_id` | Successor/approval envelope. |
| `member_release_id` | Existing constituent release row. |
| `role` | `core`, `predecessor`, `tracked_sibling`, `follow_up`, `housekeeping`. |
| `relationship` | `superseded`, `absorbed`, `inherited`. |
| `reason` | Human-readable reason for inclusion. |
| `scope_summary` | What work is carried forward. |
| `commit_from` / `commit_to` | Optional bounded commit range. |
| `pr_number` / `pr_url` | Original review context. |
| `included_at` | When the membership became authoritative. |
| `included_by` | Actor or CI identity. |
| `manifest_version` | Source manifest version. |

Add a uniqueness constraint on `(approval_release_id, member_release_id)`. Keep `superseded_by_release_id` as a convenient lifecycle pointer, but validate it against the membership row.

Non-release commits remain in `bundle_context.items` or move to a separate `release_bundle_work_items` table. They must not be represented as fake releases.

### `test_cycles`

One row per actual execution attempt:

| Field | Purpose |
|---|---|
| `id` | Portal UUID used by evidence foreign keys. |
| `project_id` | Owning project. |
| `source_release_id` | Release whose scope was under test. |
| `sdlc_stage` | Governed stage number/code. |
| `environment` | `ci`, `uat`, `production`, or another configured environment. |
| `suite_kind` | `quality_gate`, `e2e`, `security`, `uat`, `deployment`, `smoke`, etc. |
| `provider` | `github_actions`, `manual`, or another trusted source. |
| `external_run_id` | Provider run identifier. |
| `external_run_attempt` | Provider rerun attempt. |
| `external_job_id` | Optional job identifier where one run contains several stage executions. |
| `idempotency_key` | Stable producer key, unique per project. |
| `started_at` / `completed_at` | Actual execution chronology. |
| `outcome` | `running`, `passed`, `failed`, `cancelled`, `skipped`, `timed_out`, `action_required`, `unknown`. |
| `outcome_reason` | Failure, cancellation, or skip explanation. |
| `commit_sha` / `branch` | Tested source provenance. |
| `workflow_name` / `workflow_url` | Reviewer navigation. |
| `incident_reference` | Optional linked incident. |
| `created_at` / `updated_at` | Ingestion audit timestamps. |

The stage-scoped sequence is derived deterministically from `started_at`, then `idempotency_key`, within `(source_release_id, sdlc_stage)`. It is frozen in the final audit snapshot. A late historical event may alter an in-progress display ordinal but must emit a reconciliation audit event.

### Evidence relationship

Add nullable `test_execution_record_id` to `compliance_evidence`, referencing first-class test execution records. Until the portal upload API is renamed, producer fields may be mapped at the transport boundary to the existing multipart field names, but generated projects must use test-execution terminology.

Evidence also retains `release_id`, which must remain the source release that owns the evidence. The approval envelope gains access through bundle membership; ingestion must not rewrite `release_id` to the successor.

Add or formalise evidence scope:

- `release`: release ticket, RTM, plans, summaries, bundle manifest;
- `stage`: stage completion or review document;
- `execution`: execution output tied to `test_execution_record_id`;
- `approval`: approval signature, final audit snapshot, deployment decision.

### Audit events and snapshots

The portal audit log must include at least:

- `release.bundle_member_added`;
- `release.bundle_member_removed` before approval;
- `release.superseded`;
- `test_cycle.started`;
- `test_cycle.completed`;
- `test_cycle.reconciled`;
- `evidence.inherited`;
- `release.approval_snapshot_created`; and
- `release.approval_snapshot_corrected`.

The final snapshot can be stored as versioned JSON initially, provided it is schema-validated, content-hashed, and immutable after creation.

## Producer contracts

### Cycle event contract

DevAudit-Installer must produce explicit lifecycle events. A representative payload is:

```json
{
  "schemaVersion": 1,
  "idempotencyKey": "github:owner/repo:workflow:12345:attempt:2:stage:2:req:REQ-093",
  "sourceRelease": "REQ-093",
  "sdlcStage": 2,
  "environment": "ci",
  "cycleKind": "quality_gate",
  "provider": "github_actions",
  "externalRunId": "12345",
  "externalRunAttempt": 2,
  "commitSha": "abc123",
  "branch": "develop",
  "startedAt": "2026-07-15T08:00:00Z",
  "completedAt": "2026-07-15T08:11:00Z",
  "outcome": "passed",
  "workflowUrl": "https://github.com/owner/repo/actions/runs/12345"
}
```

The workflow must create/update the cycle independently of evidence upload. Completion reporting must run under `if: always()` so a failed execution is recorded even when artifact generation fails.

Only execution artifacts receive the returned test execution record identifier. Release-level and stage-level documents must omit a cycle identifier.

### Bundle manifest contract

`BUNDLED-CHANGES-REQ-XXX.md` remains the human-readable artifact. The installer must also generate a versioned, machine-readable manifest, for example `BUNDLED-CHANGES-REQ-XXX.json`, containing:

- approval release identifier;
- core release identifier;
- each constituent release identifier and relationship;
- original title, PR, commit range, and scope summary;
- why it was superseded or absorbed;
- evidence inheritance policy;
- non-release work items kept separately;
- generation time, repository, and generator version; and
- a deterministic manifest hash.

The manifest must be produced from explicit release tickets and release orchestration state. Commit scanning can suggest non-release work but must not decide predecessor-release ownership by itself.

## DevAudit-Installer implementation plan

### Phase I1 - contracts and SRS

1. Add the cycle-event, evidence-scope, and bundle-manifest schemas to the installer.
2. Add SRS requirements and RTM/test coverage for each producer obligation.
3. Document canonical SDLC stage codes and environment values.
4. Define compatibility behaviour for portals that only accept `testCycleId`.
5. Update evidence-tier documentation so document uploads cannot be classified as execution cycles.

### Phase I2 - workflow and CLI production

1. Extend the CLI and `upload-evidence.sh` with test execution lifecycle operations or a dedicated command such as `devaudit cycle start|complete`.
2. Add fields for source release, stage, environment, kind, run attempt, timestamps, result, and idempotency key.
3. Update generated CI, E2E, compliance-evidence, UAT, post-deploy, and production-smoke templates.
4. Ensure terminal reporting executes for success, failure, cancellation, and timeout paths.
5. Stop applying `--test-cycle` to release-level document uploads.
6. Preserve the legacy `testCycleId` field during dual-write rollout.

### Phase I3 - explicit bundle production

1. Extend `generate-bundled-changes.sh` to emit validated Markdown and JSON from one structured source.
2. Add constituent release identifiers, relationships, PRs, commit ranges, and reasons.
3. Update `extract-release-metadata.sh` to return the structured manifest and hash.
4. Update the release preparation workflow to submit bundle membership before review begins.
5. Require operator/agent reconciliation when a candidate predecessor is ambiguous.
6. Prevent a branch-window scan from automatically attributing unrelated predecessors to the latest REQ.

### Phase I4 - generated reports and skills

1. Update `sdlc-implementer` to maintain the bundle manifest as release scope changes.
2. Update the evidence compilation stage to query first-class test executions, not group uploaded files.
3. Generate cycle tables per constituent release and stage in `test-execution-summary.md`.
4. Include the same bundle identity in security, AI-use, incident, release-ticket, and completion reports where relevant.
5. Update release playbooks for scope escalation from housekeeping to tracked change.
6. Update close-out behaviour so predecessor tickets move to `superseded-releases` with an explicit successor and reason.
7. Ensure the final release summary states that it is bundled and names its constituents.

### Phase I5 - producer verification

Add contract and rendered-workflow tests covering:

- pass, failure, cancellation, timeout, and rerun attempts;
- a run that fails before evidence upload;
- one workflow containing different stage executions;
- document uploads that do not create cycles;
- explicit predecessor membership;
- ambiguous predecessors rejected or held for reconciliation;
- Markdown/JSON bundle parity;
- legacy portal fallback; and
- idempotent retry without duplicate test execution records.

## DevAudit portal implementation plan

### Phase P1 - additive schema and repositories

1. Add `release_bundle_memberships`, test execution records, and approval snapshot storage.
2. Add `test_execution_record_id` and evidence scope to `compliance_evidence`.
3. Add indexes and uniqueness constraints for project/release/stage chronology and idempotency.
4. Retain `bundle_context` and `superseded_by_release_id` during migration; do not require backward-compatible cycle terminology in generated producer artefacts.
5. Add repository and service methods with project and organisation ownership checks.

### Phase P2 - ingestion APIs

1. Add authenticated, idempotent cycle start/upsert/complete endpoints.
2. Extend evidence upload endpoints to accept a test execution record key and scope.
3. Add a versioned bundle-manifest ingestion endpoint.
4. Resolve constituent releases by project and exact release identifier; never by nearest date alone.
5. Reject cross-project links, self-supersession, cycles without a source release, and evidence/cycle ownership mismatches.
6. Emit audit events for every lifecycle and reconciliation mutation.
7. Keep current upload APIs tolerant of legacy producers.

### Phase P3 - release journey read model

Add a release journey API returning:

- approval-envelope metadata and readiness;
- constituent releases and lineage;
- stage completion and cycle counts per constituent;
- cycle outcomes and links;
- evidence grouped by owner/scope/stage/cycle;
- inherited evidence relationships;
- incidents and unresolved exceptions;
- required, running, queued, failed, and successful checks;
- deployment and approval events; and
- a chronologically ordered event stream.

The read model must expose provenance and unresolved states rather than converting unknown values to pass or complete.

### Phase P4 - reviewer UI

1. Replace the global cycle label as the primary label with release/stage-scoped numbering.
2. Add the constituent release matrix and lineage navigation.
3. Add stage filters and a chronological timeline toggle.
4. Show first/latest markers and the current active cycle while a release is in progress.
5. Separate release documents, stage documents, and cycle evidence.
6. Label inherited evidence with source release, source stage, and inheritance reason.
7. Display superseded predecessors in active release context while retaining their own detail pages.
8. Surface missing outcomes, unverified evidence, incomplete matrices, queued checks, and attribution conflicts as distinct findings.
9. Add an approval-scope confirmation showing the exact bundle snapshot before UAT and production approval.
10. Render the same lineage and cycle model in shared reviewer links and audit-pack exports.

### Phase P5 - readiness and approval rules

1. Compute readiness from authoritative cycles and required checks, not artifact quantity.
2. Prevent approval while a required check is queued, running, action-required, failed, cancelled, or unknown.
3. Require every failed required cycle to have a later passing cycle, accepted exception, or explicit supersession disposition.
4. Require bundle membership and evidence inheritance conflicts to be resolved before approval.
5. Require the final production cycle, deployment provenance, and smoke result before `released`.
6. Create and hash the approval snapshot atomically with the approval event.

### Phase P6 - portal verification

Add unit, integration, API, database, and browser tests covering:

- stage-scoped cycle numbering and deterministic chronology;
- late-arriving cycle events and reconciliation audit events;
- cycles with no evidence and evidence with no cycle;
- retries and idempotency;
- bundle membership and predecessor navigation;
- evidence remaining owned by its source release;
- inherited evidence display and approval scope;
- unknown/queued checks blocking readiness;
- final snapshot immutability;
- audit-pack export parity; and
- legacy release fallback.

## Existing-data repair and backfill

Existing releases must be repaired conservatively, beginning with REQ-090 through REQ-093.

1. Dry-run the repair and report proposed releases, memberships, cycles, excluded document-only groups, outcomes, and confidence.
2. Create inferred test execution records only for groups containing execution evidence.
3. Use workflow run metadata and timestamps to recover stage, attempt, outcome, commit, and URL.
4. Mark incomplete reconstructions as `legacy_inferred` with `unknown` outcomes; do not manufacture pass results.
5. Convert explicit `superseded_by_release_id` links and structured bundle items into membership rows.
6. Require manual confirmation where historical branch-window logic attributed several predecessors to one REQ without explicit source evidence.
7. Keep document-only groups as release/stage evidence and remove them from displayed cycle totals.
8. Preserve old fields and rows for forensic comparison.
9. Emit a repair audit event with before/after hashes and the operator identity.
10. Regenerate, but do not overwrite, audit snapshots through a versioned correction process.

The repair endpoint must support `dryRun`, return warnings and conflicts, and be idempotent. It must never silently relink evidence between releases.

## Deployment sequence

The implementation order is deliberately portal-first for compatibility:

1. Agree schemas, SRS requirements, and acceptance tests in both repositories.
2. Deploy additive portal schema, tolerant APIs, legacy read fallback, and audit logging.
3. Release the installer with dual-write cycle and bundle contracts.
4. Update consuming projects so generated workflows emit the new contracts.
5. Enable the new portal read model and reviewer UI behind a feature flag.
6. Verify one non-production rehearsal release end to end.
7. Enable the new approval gates for newly created releases.
8. Backfill and manually reconcile REQ-090 through REQ-093.
9. Enable the new UI for legacy releases, retaining provenance/confidence labels.
10. Remove legacy derivation only after all supported installer versions have aged out.

Installer and portal changes should be implemented as separate, individually reviewable issues and feature branches. The portal additive foundation must reach production before consumer workflows start requiring the new API contract.

## SRS and documentation impact

The implementation must update, at minimum:

### DevAudit-Installer

- `docs/SRS.md`;
- `docs/sdlc-framework.md`;
- `docs/evidence-tiers.md`;
- `docs/release-playbooks/*`;
- CLI and script command references;
- `sdlc-implementer` and relevant evidence/testing skills;
- generated workflow documentation; and
- producer/portal contract tests.

### DevAudit portal

- portal SRS and RTM;
- API documentation;
- data retention and audit-event documentation;
- reviewer and auditor guidance;
- evidence ownership and inheritance rules; and
- migration/repair runbook.

Existing documents `docs/issues/test-cycles-producer.md` and `docs/issues/test-cycles-portal.md` describe the original evidence-grouping implementation. Their statement that no dedicated cycle entity is required is superseded by this design because the reviewer requirement now includes test execution lifecycle, failed executions with no artifacts, stage-specific counts, release ownership, and immutable audit snapshots.

## Acceptance criteria

The work is complete only when all of the following are true:

1. A reviewer can see cycle counts per SDLC stage and constituent release without counting artifacts.
2. A cycle label identifies source release, stage, ordinal, total stage cycles, and outcome.
3. The timeline clearly identifies the first and latest events and explains every retry or failure.
4. Document uploads do not increase cycle counts.
5. Failed executions remain visible even when no evidence artifact was uploaded.
6. Every bundled predecessor remains a distinct release with its original evidence and a successor link.
7. The final approval envelope names every constituent release and non-release work item.
8. Inherited evidence shows its source release, source stage/cycle, and reason for inclusion.
9. Unknown, queued, and running required checks cannot be represented as green or complete.
10. Production release requires deployment provenance and a passing or formally excepted production verification cycle.
11. The released snapshot is immutable, content-hashed, and reproducible in the audit-pack export.
12. Existing releases are shown with explicit legacy/inferred confidence rather than fabricated certainty.
13. Installer and portal SRS, tests, playbooks, generated workflows, and public API documentation agree on the same contract.

## Non-goals

- Do not create fake release records for individual housekeeping commits.
- Do not duplicate evidence into the successor release merely to make it visible.
- Do not treat every GitHub workflow as a test execution; only governed execution attempts qualify.
- Do not erase failed, cancelled, superseded, or abandoned attempts from the audit history.
- Do not infer release bundling solely from dates, branch names, or the next REQ number.
- Do not replace detailed evidence with the summary matrix; the matrix is a navigational audit view over the underlying records.

## Expected final resolution

For an in-progress release, the portal shows the current approval envelope, its preserved constituent releases, the stage currently running, completed and unresolved cycles, required checks still in progress, and the exact next gate.

For a completed release, the portal shows an immutable journey from original scope through every predecessor, stage, cycle, incident, remediation, approval, deployment, and production verification. A reviewer can understand what happened quickly; an auditor can follow every summary value back to the original release, execution, evidence, actor, and timestamp.
