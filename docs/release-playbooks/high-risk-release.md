# Playbook: high-risk tracked release

Use this `REQ-XXX` route for work involving authentication, authorization,
payments, sensitive data, security controls, audit logging, production
infrastructure, or comparable material risk. HIGH and CRITICAL work requires an
approved plan before implementation and independent review under the configured
approval policy.

## Canonical route

```text
feature/REQ-XXX-* -> plan approval -> PR to integration -> terminal-green CI
and independent review -> merge -> evidence + UAT review -> release PR
-> terminal-green checks -> merge -> deploy/smoke/host verification
-> production approval -> released -> automated close-out PR
```

Run `Implement issue #N under the SDLC.` for the normal path. The skill must
pause after the plan for explicit HIGH/CRITICAL approval, delegate e2e work,
and preserve the feature-branch -> integration PR -> release PR sequence.

## Manual route

### Stage 1: plan before code

Allocate `REQ-XXX`; update the RTM; write an implementation plan, threat model,
risk treatment, rollback plan, test scope, and test plan. Obtain explicit plan
approval before creating implementation commits.

### Stage 2: feature branch and integration

Branch from `$INTEGRATION_BRANCH` as `feat/REQ-XXX-short-description`. Implement
against the approved plan, run unit/integration/e2e/security gates, and commit
with `Ref: REQ-XXX`. Push the feature branch and open a PR to
`$INTEGRATION_BRANCH`. Merge only after all required integration checks are
terminal green on the current head SHA.

A second reviewer reading the implementation before it merges is good practice
for HIGH/CRITICAL work and is expected as a human/process norm, but **nothing
in this pipeline enforces it today** — `$INTEGRATION_BRANCH` branch protection
ships with `required_approving_review_count: 0` for every project, every risk
tier (`cli/src/install/branch-protection.ts`). Do not read "independent
reviewer" here as a gate the pipeline will stop you from skipping. The two
human gates this pipeline actually enforces are Stage 4's required review on
`$RELEASE_BRANCH` (see below) and Stage 3's `dual_actor` UAT/production
approval on the portal (`approver != release_creator`, `sdlc-config.json`
`approval.mode`). See `docs/sdlc-framework.md`'s Stage 4 diagram for where the
"MEDIUM/HIGH risk -> second human reviewer" language is actually enforced.

### Stage 3: auditable evidence

Upload the test execution summary, security summary, AI-use record, required
reports, and release ticket. Evidence has two layers: documents/artifacts and
first-class test/deployment executions. Render the execution table from portal data with
`scripts/render-test-executions.sh` where it is available. A reviewer must be able
to identify source release/title, stage, ordinal, kind, outcome, workflow link,
SHA/branch, evidence, and any incident/remediation.

If this release absorbs integration or housekeeping work, generate and submit
`BUNDLED-CHANGES-REQ-XXX.md` and `.json`, then include the same bundled context
in the release ticket, test-execution summary, security summary, and AI-use note
where relevant. Predecessor evidence remains source-owned and is shown as linked
history in the portal.

Submit the release for UAT review after evidence is complete.

### Stage 4: promotion and UAT gate

Open the truthful PR from `$INTEGRATION_BRANCH` to `$RELEASE_BRANCH`. State every
in-scope REQ and the bundled scope in the PR. All required checks must be
terminal green on the current PR head SHA: `Quality Gates`, `Release Scope
Integrity`, `Compliance Validation`, `DevAudit Release Approval`, and `E2E
Regression Suite`. Do not merge while any is queued, running, stale, skipped
unexpectedly, or failed.

The reviewer must record the actual UAT execution before approving the portal
release. `scripts/submit-for-uat-review.sh` only moves the release into review;
after UAT is performed, run `scripts/record-uat-execution.sh` with the tested
SHA/build, reviewer identity, checklist/evidence references, and truthful
outcome. A failed UAT execution needs a remediation reference and returns to the
change-request loop. A passed Stage 4 execution is required before UAT approval.

### Stage 5: production and close-out

After merge, wait for `post-deploy-prod.yml` and the hosting-platform deployment
status for the merged SHA to reach terminal success. Verify production deployment
and smoke test execution records and their production evidence. Only then can the required
independent production approval move the portal release to `released`.

Where post-merge regression is enabled, it must also finish terminal success.
Treat a timeout as failed verification; retain partial reports/traces/screenshots,
server logs, and execution metadata, then classify the cause before an incident
or approved exception is recorded.

The portal dispatches `release-closed`, which opens the close-out PR back to
`$INTEGRATION_BRANCH`. Review and merge it. Manual dispatch is fallback; local
close-out scripts are recovery-only.

## Hotfix

For production-impacting urgency, branch `hotfix/REQ-XXX-*` from
`$RELEASE_BRANCH`, retain plan/review/evidence/execution controls, PR to release,
and after merge immediately open the mandatory `backmerge/*` PR to integration.
Never use a direct push to either protected branch.
