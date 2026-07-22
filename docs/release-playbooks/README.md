# Release playbooks

These playbooks are the operator-facing canonical process for a DevAudit SDLC
release. `sdlc-implementer`, generated workflows, and helper scripts implement
this contract. A conflict between this directory and executable SDLC behavior
is a defect: correct one or the other in the same change.

Use the configured branch names throughout this document:

```bash
INTEGRATION_BRANCH="${INTEGRATION_BRANCH:-develop}"
RELEASE_BRANCH="${RELEASE_BRANCH:-main}"
```

| Playbook | Use it for | Release identity | Approval path |
| --- | --- | --- | --- |
| [High-risk](./high-risk-release.md) | Tracked work affecting auth, data, security, payments, production infrastructure, or similar material risk | `REQ-XXX` | UAT and production review |
| [Low-risk](./low-risk-release.md) | Tracked work with limited blast radius | `REQ-XXX` | Project approval policy |
| [Housekeeping](./housekeeping-release.md) | Docs, CI, build, dependency, formatting, or administrative work with no material behavior change | Bare-date history, or an explicit standalone housekeeping promotion | PR review only by default |

## Non-negotiable controls

### Normal GitFlow

Normal work always follows this sequence:

```text
feature branch -> PR to integration -> terminal-green checks -> merge
integration -> PR to release -> terminal-green checks -> merge
```

The release PR is the truthful promotion envelope. It may include more than
one tracked release. It must say so in its title/body and point to each release
ticket. Do not directly push or locally merge into a protected integration or
release branch.

Auto-merge is a convenience, not evidence. A PR is ready only when every
required check is terminal green on its current head SHA. Queued, running,
stale, cancelled, unexpectedly skipped, or failed checks mean `waiting` or
`blocked`, never green. If auto-merge does not fire after that verification,
manual merge is allowed.

### Hotfix exception

Use a hotfix only for production-impacting urgency: broken production, urgent
security risk, or an impaired release capability that cannot wait. The path is:

```text
hotfix/* from release -> PR to release -> terminal-green checks and review
-> merge -> mandatory backmerge/* PR to integration
```

High priority while production is healthy remains normal GitFlow. A hotfix does
not waive evidence, cycle reporting, review, deployment verification, or the
backmerge.

### Required release evidence

Tracked releases have two evidence layers:

1. Uploaded documents and artifacts.
2. First-class test/deployment cycles and release checks.

The portal is the review source of truth. Reviewers must be able to see the
release identity and title, SDLC stage, cycle ordinal within source release and
stage, cycle kind, outcome, workflow/run link, commit SHA, branch, related
evidence, and incident/remediation reference when relevant. Do not reconstruct
cycle history from artifact filenames when portal cycle data is available.

At Stage 3, render the portal-backed table with
`scripts/render-test-cycles.sh` where available. At Stage 5, verify that both
production deployment and production smoke cycles exist and have terminal
successful outcomes before Production approval or `released`.

### Bundled release contract

When a tracked `REQ-XXX` promotion absorbs prior integration or housekeeping
work, it is an approval envelope, not a reassignment of history. The tracked
release must contain:

- `compliance/pending-releases/BUNDLED-CHANGES-REQ-XXX.md`
- `compliance/pending-releases/BUNDLED-CHANGES-REQ-XXX.json`
- a submitted bundle manifest
- bundled context in the release ticket, test-execution summary, security
  summary, and AI-use note when AI-assisted bundled work exists

Source evidence and cycles remain owned by their source release. The portal
ownership and journey views must show predecessors as linked historical context,
not active approvals. The close-out moves absorbed predecessor tickets to
`compliance/superseded-releases/` when the manifest identifies them.

Incident evidence follows the same ownership rule. `incident-report*.md` and
`nil-incident-report*.md` must carry frontmatter that identifies
`incident_kind`, `source_release`, and a stable semantic id. The generated
evidence workflow uploads only incident artefacts owned by the derived release,
or by an explicitly listed bundle predecessor; inherited incident artefacts are
uploaded to their source release and referenced through lineage, never relabelled
as evidence newly produced by the approval envelope.

### Close-out

`released` in the portal is the trigger for close-out, not merely a merged PR.
The normal path is:

```text
portal release marked released
-> repository_dispatch(release-closed)
-> Release Close-out workflow
-> chore/close-out-REQ-XXX PR to integration
-> review and merge
```

The close-out PR reconciles the release branch into integration, updates the
RTM, archives the release ticket, and handles superseded predecessors. It is an
administrative reconciliation PR and should not acquire a second release
approval gate. Manual workflow dispatch is the first fallback; running
`scripts/close-out-release.sh` locally is last-resort catch-up or recovery
only. A release is not operationally complete until its close-out is complete.

## Required checks

For a tracked release promotion, inspect the current PR-head results for the
configured required checks. The standard set is:

- `Quality Gates`
- `Release Scope Integrity`
- `Compliance Validation`
- `DevAudit Release Approval`
- `E2E Regression Suite`

External platform checks are not a substitute for the repo-owned SDLC gates.
After merge, `post-deploy-prod.yml` must itself finish successfully and confirm
the hosting-platform deployment for the merged SHA reached terminal `success`.
Do not call production green while E2E, post-deploy, or host deployment remains
queued or in progress.

Treat `deployment_status_timeout`, `deployment_status_missing`, and a terminal
provider failure as distinct blocked outcomes. A health probe corroborates
availability but never substitutes for a terminal deployment status. Retain the
deployment ID, SHA, environment, final observed state, target URL, elapsed time,
and probe result; inspect provider logs and fix forward before retrying.

Generated production deployment-status workflows accept exact `production` or
`prod` environments and qualified provider labels ending in `/ production` or
`/production`, for example `Wawa Garden Bar / production`. UAT, staging,
preview, and failed deployment statuses must not create production evidence.

A consumer-enabled post-merge regression must also reach a terminal successful
outcome before production approval. A timeout is a failed execution, not an
absence of evidence: retain its partial Playwright report, traces, screenshots,
server logs, and execution metadata; classify the cause before opening or
updating an incident or recording an approved exception.

When full regression is triggered by a successful production
`deployment_status`, its evidence importer must record it as Stage 5 production
E2E evidence for the tracked REQ scope. It must not fall back to
`_compliance-docs`; if the artifact cannot prove the in-scope REQ, stop and fix
the attribution before approval.

On Linux self-hosted runners, generated CI validates inotify capacity before
Turbopack/Playwright starts. A failure from
`scripts/check-self-hosted-runner.sh` is runner infrastructure, not product-test
evidence. Apply the durable host fix in
[`docs/self-hosted-runner-ci.md`](../self-hosted-runner-ci.md), then rerun CI.

### Host Gate Topology

For a host that waits for GitHub CI before deploying, only pre-deploy
eligibility checks may belong to the `main` push check suite. Post-deploy
production evidence and full regression start from a successful production
`deployment_status` event, or an explicit manual recovery dispatch. They still
block production approval and release after deployment, but cannot block the
deployment they need to verify.

For Railway, deploy protected `main` after pre-deploy eligibility only. Do not
use post-deploy, full-regression, portal-approval, or external-host checks as
deployment eligibility requirements. If Railway skipped an approved SHA due to
CI gating, redeploy that exact SHA, wait for its deployment status, then rerun
post-deploy verification. Record the recovery; a healthy prior deployment is
not evidence for the new SHA.

For a reviewed `develop -> main` promotion, release-scope integrity may use an
exactly-one pending release ticket or exactly-one active RTM row as the selected
tracked scope. That fallback is not ordinary commit ownership and must remain
disabled for feature, housekeeping, hotfix, and integration CI contexts.

## Operator recovery and historical data

Use the portal's audit-loggable repair/backfill controls only for genuine
historical gaps such as missing lineage, cycle records, or requirement matrix
rows. Re-run them idempotently and retain their audit event. Never invent bundle
membership from guesswork; record unknown historical provenance as unknown.
Reconcile legacy unknown/incorrect cycle outcomes from the corresponding GitHub
Actions run before treating them as evidence.

If an immutable historical E2E Regression run completed but its evidence import
was skipped, recover by re-importing that exact run artifact against its original
run ID, attempt, head SHA, timestamps, source event, and tracked REQ. Record the
operation as reconciliation. Do not create a fresh Playwright execution and label
it as the historical run.

The detailed paths are in the linked playbooks. `sdlc-implementer` is the
default route for a tracked issue; the manual paths are the fallback.
