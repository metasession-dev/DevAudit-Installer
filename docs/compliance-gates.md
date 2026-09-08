# Compliance Gates

DevAudit uses multiple GitHub Actions workflows to prove that a release is ready for review and, later, production. This page is the concise map of which workflow owns which gate.

The process view lives in [`docs/change-workflows.md`](./change-workflows.md). The deeper artifact rules live in [`docs/evidence-tiers.md`](./evidence-tiers.md) and the stage docs under `sdlc/files/_common/`.

## The gate model

Tracked releases and housekeeping releases both rely on the same core verification shape:

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
| `check-release-approval.yml` | PRs to `main` and reruns after portal approval | Reads portal approval state | Enforces the UAT four-eyes gate before merge |
| `post-deploy-prod.yml` | After merge to `main` | Production smoke, production evidence upload, incident creation on smoke failure | Advances the release into production review/released and records post-deploy proof |

## What reviewers should expect

### On `develop`

- the quality gates should be green before evidence compilation is treated as truthful
- the release record should exist in the portal
- CI-origin evidence should already be attached to that release

### On the PR to `main`

- `Compliance Validation` should confirm the change matches the declared workflow shape
- `DevAudit Release Approval` should stay red until the portal release is approved for UAT
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
| Production health and release close-out | `post-deploy-prod.yml` |

## See also

- [`docs/change-workflows.md`](./change-workflows.md)
- [`docs/evidence-tiers.md`](./evidence-tiers.md)
- [`docs/e2e-test-tiers.md`](./e2e-test-tiers.md)
- [`sdlc/src/blueprints/3-compile-evidence.raw.md`](../sdlc/src/blueprints/3-compile-evidence.raw.md)
