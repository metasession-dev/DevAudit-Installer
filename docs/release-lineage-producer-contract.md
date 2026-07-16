# Release Lineage Producer Contract

This document is the producer-side contract summary for the first-class release-lineage and test-cycle model introduced under umbrella `#397`.

Machine-readable source of truth:

- [`contracts/release-lineage-contract.json`](../contracts/release-lineage-contract.json)

Typed helper for CLI and generated workflow code:

- [`cli/src/lib/release-lineage-contract.ts`](../cli/src/lib/release-lineage-contract.ts)

The portal receiving side is implemented separately in `metasession-dev/devaudit`. This document defines what DevAudit-Installer producers are allowed and expected to emit.

## Scope

The contract covers three things:

1. first-class test-cycle lifecycle events
2. evidence-lineage fields on uploads
3. bundled-release manifests for approval envelopes

It does not yet mean every generated workflow emits all of these fields. That rollout happens in later leaf issues. This issue establishes the canonical contract first so later workflow work does not invent its own payload shapes.

## Canonical values

### SDLC stages

| Code | Name | Meaning |
| --- | --- | --- |
| `1` | `plan` | planning and scoping; documents only |
| `2` | `implement_test` | implementation-time governed execution such as CI gates, security, and E2E |
| `3` | `compile_evidence` | evidence preparation and release-ticket compilation; documents only |
| `4` | `uat_review` | UAT and reviewer validation |
| `5` | `production` | deploy, smoke, production approval, release finalisation |

### Environments

- `ci`
- `uat`
- `production`

### Cycle kinds

- `quality_gate`
- `e2e`
- `security`
- `uat`
- `deployment`
- `smoke`

### Providers

- `github_actions`
- `manual`

### Outcomes

Non-terminal:

- `running`

Terminal:

- `passed`
- `failed`
- `cancelled`
- `skipped`
- `timed_out`
- `action_required`
- `unknown`

### Evidence scopes

- `release`
- `stage`
- `cycle`
- `approval`

The key rule is simple: uploads are only `cycle` scoped when they are execution outputs from a real governed run. Documents do not become cycles just because they were uploaded during a release.

## What is and is not a cycle

Cycle-scoped evidence is execution output such as:

- E2E results
- screenshots from execution
- security scan output
- gate outcome summaries
- smoke-test output
- deployment execution output when tied to a real deployment cycle

Release-, stage-, or approval-scoped evidence includes:

- release tickets
- RTMs
- implementation plans
- test plans
- test execution summaries
- security summaries
- bundled-change manifests
- approval records

These documents may describe a cycle, but they do not create one.

## Lifecycle payloads

The contract defines three payload families:

### 1. `test_cycle.started`

Emitted when a governed execution begins.

Required properties:

- `schemaVersion`
- `idempotencyKey`
- `sourceRelease`
- `sdlcStage`
- `environment`
- `cycleKind`
- `provider`
- `startedAt`
- `outcome = "running"`

`completedAt` must not be present.

### 2. `test_cycle.completed`

Emitted under `if: always()` when the execution reaches a terminal state.

Required properties:

- everything needed to identify the cycle
- `completedAt`
- terminal `outcome`

### 3. `test_cycle.reconciled`

Only for late correction of a previously recorded terminal cycle.

Use this when:

- a workflow result arrives late
- a run attempt was misclassified
- a post-failure correction needs to append an audit trail

Do not use it as the normal completion path.

## Idempotency keys

Recommended shape:

`provider:project-or-repo:workflow-or-source:run-or-ticket:attempt:stage:release`

Current contract regex:

`^(github|manual):[A-Za-z0-9._/-]+:[A-Za-z0-9._/-]+:[A-Za-z0-9._:-]+:[A-Za-z0-9._:-]+:[A-Za-z0-9._:-]+:[A-Za-z0-9._-]+$`

Example:

`github:metasession-dev/wawagardenbar-app:Quality-Gates:12345:attempt:2:stage:2:REQ-093`

The key must be stable across retries for the same logical cycle record.

## Evidence upload compatibility

During rollout there are two portal capability states.

### Legacy portal

Supports only:

- `testCycleId`

Producer behaviour:

- skip first-class cycle lifecycle API calls
- keep uploading evidence normally
- send only `testCycleId` as the cycle grouping key

### First-class lineage portal

Supports:

- cycle lifecycle endpoints
- `evidenceScope`
- `testCycleRecordId`
- legacy `testCycleId`

Producer behaviour:

- create/update cycle lifecycle records independently of evidence upload
- upload execution evidence with `evidenceScope=cycle`
- include `testCycleRecordId`
- preserve `testCycleId` during dual-write rollout

The helper `renderEvidenceLineageFields()` in the CLI contract module exists specifically so later workflow code can render both modes consistently.

## Bundle manifest

`BUNDLED-CHANGES-REQ-XXX.md` remains the human-readable narrative.

The machine-readable companion:

- `BUNDLED-CHANGES-REQ-XXX.json`

must describe:

- the approval envelope release
- the core release
- constituent release membership
- relationship type (`superseded`, `absorbed`, `inherited`)
- role (`core`, `predecessor`, `tracked_sibling`, `follow_up`, `housekeeping`)
- optional PR and commit range context
- non-release work items kept separate from real release rows
- manifest hash and generator metadata

Evidence ownership does not move to the approval envelope. The manifest creates lineage visibility, not evidence reassignment.

## Rollout expectations

This contract is intentionally ahead of full emission. The implementation sequence is:

1. portal additive schema and tolerant APIs
2. installer contract definition
3. installer cycle-event emission
4. installer bundle-manifest generation/submission
5. portal read model and reviewer UI hardening

That order avoids generated workflows emitting data the portal cannot accept.
