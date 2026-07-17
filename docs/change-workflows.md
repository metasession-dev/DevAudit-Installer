# Change workflows and release types

This is the process contract for choosing and executing a release path. The
operator-facing canonical steps are in [release playbooks](./release-playbooks/).
The `sdlc-implementer` skill and generated workflows must implement the same
contract; a difference is a defect.

## Choose the path

| Change type | Commit types | Requirement | Canonical path |
| --- | --- | --- | --- |
| Tracked feature, behavioral fix, refactor, or performance work | `feat`, `fix`, `refactor`, `perf` | `REQ-XXX` required | Feature branch -> PR to integration -> tracked release promotion |
| Housekeeping | `chore`, `ci`, `build`, `test`, `compliance`, `revert` | No new REQ | Feature branch -> PR to integration -> wait for tracked promotion |
| Trivial docs/formatting | `docs`, `chore` | No new REQ | Same lightweight integration path |
| Compliance-doc-only | `compliance`, `docs` | Existing REQ only | Feature branch -> PR to integration; attach to existing release |

A housekeeping type is not a way to avoid tracked controls. Anything affecting
runtime or user-visible behavior, authentication, data handling, production
risk, or material product behavior is tracked work. Production-impacting urgency
uses the hotfix path, not a direct push.

## Canonical GitFlow

```text
feature branch -> PR to $INTEGRATION_BRANCH -> terminal-green CI + required review
-> merge -> $INTEGRATION_BRANCH -> PR to $RELEASE_BRANCH
-> terminal-green release checks -> merge
```

Use configured branch names, normally `develop` and `main`. Protected
branches are never updated by normal direct pushes or local merges. Auto-merge
may be enabled, but a PR may merge only after all required checks are terminal
green on its current head SHA. Queued, running, stale, cancelled, unexpectedly
skipped, and failed checks are not green.

The exceptional hotfix route is:

```text
hotfix/* from $RELEASE_BRANCH -> PR to $RELEASE_BRANCH -> terminal-green checks
and review -> merge -> mandatory backmerge/* PR to $INTEGRATION_BRANCH
```

## Tracked release lifecycle

| Stage | Operator / agent action | Portal outcome |
| --- | --- | --- |
| 1 Plan | Allocate REQ, RTM entry, risk/test planning; HIGH/CRITICAL needs plan approval | Release can be created early for correctly scoped evidence |
| 2 Implement | Feature branch, tests/gates, integration PR, then merge | Integration CI registers the release and uploads gate evidence |
| 3 Evidence | Upload documents/artifacts and render first-class cycle history | Complete reviewer evidence: artifacts, cycles, checks, lineage |
| 4 Review | Truthful integration -> release PR; submit for UAT | Approval gate and full release check set apply to every in-scope REQ |
| 5 Deploy | Merge after terminal-green checks; wait for deployment and host verification | Deployment/smoke cycles, Production review, `released`, automated close-out PR |

The standard release check set is `Quality Gates`, `Release Scope Integrity`,
`Compliance Validation`, `DevAudit Release Approval`, and `E2E Regression
Suite`. External hosting checks are operational signals unless explicitly made
required by branch protection. Do not report production green while an E2E,
post-deploy, or host deployment check is queued or in progress.

## Release shapes and lineage

A release is keyed by `(project, version)`.

| Version | Meaning | Review treatment |
| --- | --- | --- |
| `REQ-XXX` | Tracked release | Active approval envelope with per-REQ evidence and lifecycle |
| `vYYYY.MM.DD` | Bare-date housekeeping/integration record | Historical CI context by default, not an active full release |

A tracked promotion can bundle multiple REQs and/or prior housekeeping work. Each
tracked REQ keeps a distinct release record. The approval envelope must include
`BUNDLED-CHANGES-REQ-XXX.md`, `BUNDLED-CHANGES-REQ-XXX.json`, a submitted bundle
manifest, and equivalent context in the ticket, test execution summary, security
summary, and AI-use note where relevant.

Evidence and test/deployment cycles remain owned by their source release. The
portal shows predecessors as linked historical context. It must not make an
absorbed bare-date record look abandoned or still pending approval.

## Housekeeping

Default housekeeping is lightweight: applicable local gates, PR review, and
terminal-green integration CI. No REQ, RTM row, evidence pack, portal UAT/prod
approval, or standalone close-out. It waits on the integration branch until the
next tracked release; that release explicitly absorbs it into its bundled
context.

A standalone housekeeping promotion is an exception for work that cannot wait.
Its release PR must state `Standalone housekeeping promotion` and why it
cannot wait. It still requires terminal-green CI and PR review. Portal UAT/prod
approval is off by default unless the project explicitly opts in. The portal
must label and close it as standalone housekeeping so it is not later bundled.

## Close-out and repair

After the portal reaches `released`, it dispatches `release-closed`. The
consumer's Release Close-out workflow opens a `chore/close-out-REQ-XXX` PR to
integration, which updates the RTM, archives the ticket, reconciles release
branch changes, and moves superseded predecessor tickets. Review and merge that
administrative PR. Manual workflow dispatch is fallback; local
`close-out-release.sh` use is recovery-only.

Use portal repair/backfill controls only for real historical gaps. Repairs must
be idempotent and audit-logged; never invent lineage or bundle membership from
uncertain history.
