# Compliance Gates

DevAudit uses multiple GitHub Actions workflows to prove that a release is ready for review and, later, production. This page is the concise map of which workflow owns which gate.

The process view lives in [`docs/change-workflows.md`](./change-workflows.md). The deeper artifact rules live in [`docs/evidence-tiers.md`](./evidence-tiers.md) and the stage docs under `sdlc/files/_common/`.

## The gate model

Tracked releases and standalone housekeeping releases both rely on the same core verification shape:

1. run quality gates on `develop`
2. register the release record
3. upload evidence tied to that release
4. block PR merge until UAT approval exists
5. run production smoke after merge to `main`

## Workflow-to-gate mapping

| Workflow | When it runs | What it owns | Evidence/gate outcome |
| --- | --- | --- | --- |
| `ci.yml` | Push to `develop` | Quality verification: typecheck, SAST, dependency audit, E2E, build; release registration | Produces the raw CI/gate evidence that a reviewer later sees on the release |
| `compliance-evidence.yml` | Compliance-doc pushes and release-ticket updates on `develop` | Uploads committed markdown evidence and release-scoped docs | Fills the release completeness checklist with planning, test, governance, and release artifacts |
| `compliance-validation.yml` | PRs to `main` | PR-time validation of artifact presence, commit rules, and release truthfulness | Blocks merge when the evidence pack or commit contract is incomplete |
| `check-release-approval.yml` | PRs to `main` and reruns after portal approval | Reads portal approval state | Links the PR to the release (so the portal shows `pr_url` while still draft), then enforces the UAT four-eyes gate before merge |
| `post-deploy-prod.yml` | After merge to `main` | Production smoke, production evidence upload, incident creation on smoke failure | Advances the release into production review/released and records post-deploy proof |

## What reviewers should expect

### On `develop`

- the quality gates should be green before evidence compilation is treated as truthful
- the release record should exist in the portal
- CI-origin evidence should already be attached to that release

### On the PR to `main`

- `Compliance Validation` should confirm the change matches the declared workflow shape
- `Release Scope Integrity` should fail if a deferred REQ's commits are in the diff and it is not listed under `Absorbed predecessor releases` (`check-deferred-reqs-in-range.sh`)
- `DevAudit Release Approval` should stay red until the portal release is approved for UAT (a portal `deferred` release gets a specific message and stays red)
- once UAT approval is granted, rerunning the approval workflow should turn the gate green

#### `DevAudit Release Approval` re-dispatch/check-run lifecycle (devaudit-installer#788)

The portal's `release-approved` `repository_dispatch` re-triggers `check-release-approval.yml`, but `repository_dispatch` events carry no native pull-request context. GitHub's Feb-2025 check-run API changes (DevAudit-Installer#351) also forbid this re-trigger from PATCHing the *original* `pull_request`-triggered failed check run directly — so the workflow instead **posts a fresh `success` check run** on the approved SHA, then explicitly **concludes every other `DevAudit Release Approval` check run on that same SHA as `conclusion: neutral`** ("Superseded by a later approval check…") rather than leaving the pre-approval failed/pending one dangling. Concluding the stale run is best-effort — if it can't be patched for some reason, a `::warning::` annotation is logged and the fresh check run (already posted) remains authoritative regardless.

**PR resolution when `client_payload` is incomplete:** the workflow resolves which PR/SHA to refresh from `client_payload.approved_sha`/`client_payload.release_pr` when present. If both are missing or unresolvable, it falls back to "the most-recently-updated open PR against `main`" — a heuristic that could target the wrong PR if two release PRs are open against `main` concurrently. This fallback now emits a visible `::error::` annotation on the workflow run when it's used, rather than guessing silently.

### After merge to `main`

- the post-deploy workflow should upload production smoke evidence
- the release should advance into production review or released, depending on project configuration

## Gate families by concern

| Concern | Gate owner |
| --- | --- |
| Static/code quality | `ci.yml` |
| Security and dependency posture | `ci.yml` |
| Test execution and CI traceability | `ci.yml` |
| Markdown/governance/release-ticket evidence | `compliance-evidence.yml` |
| PR truthfulness and artifact completeness | `compliance-validation.yml` |
| UAT approval/four-eyes | `check-release-approval.yml` |
| Required-gate failure on the release PR (fix or documented exception, E2E first) | `sdlc-implementer` Phase 4 step 5a, `report-test-execution.sh resolve`, `validate-risk-acceptance-record.sh`, `validate-test-summary.sh` (see [e2e-test-tiers.md](e2e-test-tiers.md#when-a-tier-fails-fix-or-accept-devaudit-installer1016)) |
| Dependency-audit failure on the release PR (bump, or accept with an expiring documented risk) | `evaluate-npm-audit.sh` against `compliance/security/accepted-vulnerabilities.json` (`schemaVersion` 2 + `acceptanceRecord`), `validate-risk-acceptance-record.sh --kind dependency`, `sdlc-implementer` Phase 4 (see [Dependency-audit exceptions](#dependency-audit-exceptions-devaudit-installer1017)) |
| Deferred-REQ promotion gate (a deferred REQ's commits must not reach `main` unless listed under `Absorbed predecessor releases`) | `check-deferred-reqs-in-range.sh`, run by `check-release-pr-scope.sh` inside the existing Release Scope Integrity job (not a separate required check) |
| Production health and release close-out | `post-deploy-prod.yml` |

## See also

- [`docs/change-workflows.md`](./change-workflows.md)
- [`docs/evidence-tiers.md`](./evidence-tiers.md)
- [`docs/e2e-test-tiers.md`](./e2e-test-tiers.md)
- [`sdlc/src/blueprints/3-compile-evidence.raw.md`](../sdlc/src/blueprints/3-compile-evidence.raw.md)

## Dependency-audit exceptions (devaudit-installer#1017)

The `Quality Gates` dependency audit fails on any unaccepted `high`/`critical` advisory, including ones disclosed after the last push with no code change. A failing audit on a release PR is **fixed** (a dependency bump) or **accepted with a documented, expiring risk**; there is no silent allowlist.

`evaluate-npm-audit.sh` reads `compliance/security/accepted-vulnerabilities.json`. Each entry accepts one advisory at one dependency path and version (`advisoryId`, `package`, `vulnerableRange`, `vulnerableVersion`, `dependencyPath`, `introducedBy`, `approvedAt`, `expiresAt`, `approvedBy`, `reason`, `remediationIssue`, optional `compensatingControls`). It fails closed: a malformed file, an unmatched advisory, or an expired entry fails the gate again.

`"schemaVersion": 2` (new exceptions should use it) also requires `acceptanceRecord`: the repo-root-relative path of `compliance/security/risk-acceptances/<advisory>.md`, written from `.claude/skills/sdlc-implementer/references/dependency-risk-acceptance.md.template`. The helper runs `validate-risk-acceptance-record.sh --kind dependency` on it (advisories, reachability and exploitability, impact assessment, compensating controls, remediation, decision-maker, a future `review_by`, an exact `tracking_issue` URL), checks that it lists the advisory and that its `tracking_issue` equals `remediationIssue`, and records the path and SHA-256 in `dependency-risk-evaluation.json`. `schemaVersion` 1 entries still work and produce a warning.

The tracking issue carries the label `accepted-dependency-risk` and `Review by: YYYY-MM-DD` in its body. `devaudit doctor` (`accepted-exceptions`) flags exceptions expiring within 14 days or already expired, and labelled issues past their review date. Records upload as evidence type `accepted_dependency_risk`. The Python template's `pip-audit` step has no allowlist yet (parity is tracked with #995).

## Evidence attribution: documentation-only PRs (devaudit-installer#1019)

A PR that changes only documentation or compliance records is not the release's own work, so CI does not attach its test executions, head SHA or branch to the REQ named in its commits. The mechanism and the `Compliance-Record: REQ-XXX` trailer are described in [release-lineage-producer-contract.md](release-lineage-producer-contract.md#which-pull-requests-may-produce-a-release-scoped-execution-devaudit-installer1019).
