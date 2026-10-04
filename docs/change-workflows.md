# Change workflows and release types

This is the process contract for choosing and executing a release path. The
operator-facing canonical steps are in [release playbooks](./release-playbooks/).
The `sdlc-implementer` skill and generated workflows must implement the same
contract; a difference is a defect.

## Choose the path

| Change type                                                    | Commit types                                           | Requirement        | Canonical path                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------ | ------------------ | ----------------------------------------------------------------- |
| Tracked feature, behavioral fix, refactor, or performance work | `feat`, `fix`, `refactor`, `perf`                      | `REQ-XXX` required | Feature branch -> PR to integration -> tracked release promotion  |
| Housekeeping                                                   | `chore`, `ci`, `build`, `test`, `compliance`, `revert` | No new REQ         | Feature branch -> PR to integration -> wait for tracked promotion |
| Trivial docs/formatting                                        | `docs`, `chore`                                        | No new REQ         | Same lightweight integration path                                 |
| Compliance-doc-only                                            | `compliance`, `docs`                                   | Existing REQ only  | Feature branch -> PR to integration; attach to existing release   |

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

| Stage       | Operator / agent action                                                        | Portal outcome                                                                              |
| ----------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| 1 Plan      | Allocate REQ, RTM entry, risk/test planning; HIGH/CRITICAL needs plan approval | Release can be created early for correctly scoped evidence                                  |
| 2 Implement | Feature branch, tests/gates, integration PR, then merge                        | Integration CI registers the release and uploads gate evidence                              |
| 3 Evidence  | Upload documents/artifacts and render first-class test execution history       | Complete reviewer evidence: artifacts, iterations, test executions, checks, lineage         |
| 4 Review    | Truthful integration -> release PR; submit for UAT                             | Approval gate and full release check set apply to every in-scope REQ                        |
| 5 Deploy    | Merge after terminal-green checks; wait for deployment and host verification   | Deployment and smoke test executions, Production review, `released`, automated close-out PR |

The standard release check set is `Quality Gates`, `Release Scope Integrity`,
`Compliance Validation`, `DevAudit Release Approval`, and `E2E Regression
Suite`. External hosting checks are operational signals unless explicitly made
required by branch protection. Do not report production green while an E2E,
post-deploy, or host deployment check is queued or in progress.

## Release shapes and lineage

A release is keyed by `(project, version)`.

| Version       | Meaning                                   | Review treatment                                             |
| ------------- | ----------------------------------------- | ------------------------------------------------------------ |
| `REQ-XXX`     | Tracked release                           | Active approval envelope with per-REQ evidence and lifecycle |
| `vYYYY.MM.DD` | Bare-date housekeeping/integration record | Historical CI context by default, not an active full release |

A tracked promotion can bundle multiple REQs and/or prior housekeeping work. Each
absorbed predecessor REQ keeps its own release record (linked as historical
context); a REQ declared into a bundle up front does not get one (see
[Bundling several issues into one release](#bundling-several-issues-into-one-release)).
The approval envelope must include
`BUNDLED-CHANGES-REQ-XXX.md`, `BUNDLED-CHANGES-REQ-XXX.json`, a submitted bundle
manifest, and equivalent context in the ticket, test execution summary, security
summary, and AI-use note where relevant.

Evidence and test/deployment executions remain owned by their source release. The
portal shows predecessors as linked historical context. It must not make an
absorbed bare-date record look abandoned or still pending approval.

## Bundling several issues into one release

Several small, independent issues can ship as **one release**: declare them with
`Bundles: #A, #B` in the triggering issue or when invoking `sdlc-implementer`
(never inferred from prose). Eligibility: no CRITICAL member, risk tiers within one
step of each other, no overlapping files. Each issue still gets its own REQ, plan,
acceptance criteria, ticket, RTM row and **its own commit** (so any one can be
reverted), but they share one branch (`feat/bundle-<slug>`), one integration PR,
one release PR, and one portal release.

| Concept | How a declared bundle behaves |
| ------- | ----------------------------- |
| Portal release | **One**, keyed by the core REQ (the REQ whose number names `BUNDLED-CHANGES-<core>.{md,json}`). There is no portal release named after a member. |
| Evidence | Every member's evidence keeps the member's own REQ as its requirement tag, but is filed under the core's release (`scripts/resolve-bundle-release.sh <REQ>` decides; CI and the compliance-document upload call it for you). The portal shows each member as a requirement of the one release. |
| Approval | One UAT approval and one production approval for the whole bundle. If UAT requests changes the whole bundle's release drops out of approval, even if only one REQ needed rework; bundle scope also freezes at UAT submission. |
| Tickets and RTM | One `RELEASE-TICKET-REQ-XXX.md` and one RTM row per REQ (the compliance validator requires both). Members are **not** listed under "Absorbed predecessor releases"; that field is only for earlier, separate releases being absorbed. |
| Manifest | The committed `BUNDLED-CHANGES-<core>.{md,json}` lists members as `role: "co_tracked"`. That is a local declaration: `derive-release-version.sh` and CI regeneration read it, but `submit-bundle-manifest.sh` does not send `co_tracked` members to the portal (predecessors and housekeeping are still submitted). |
| Close-out | The close-out PR releases the members with the core: their tickets move to `approved-releases/`, Status `RELEASED`, a `Released with bundle` backlink, RTM `RELEASED`. Absorbed predecessors are still superseded. |

Limits: declared bundles are supported by the Node CI template. The Python template
does not generate bundled changes, and `feature-e2e.yml` handles a single REQ per
run, so it skips a multi-REQ bundle PR.

If you find a portal release named after a bundled member (an older consumer
version created these), do not submit it for review. Update the consumer
(`devaudit update`), leave the empty draft alone, and report it; there is no portal
action to discard an empty draft yet.

## Housekeeping

Default housekeeping is lightweight: applicable local gates, PR review, and
terminal-green integration CI. No REQ, RTM row, evidence pack, portal UAT/prod
approval, or standalone close-out. It waits on the integration branch until the
next tracked release; that release explicitly absorbs it into its bundled
context.

**Bundle scope freezes at UAT submission.** The submitted markdown/JSON manifest
is the approval-scope declaration, not a rolling scan of later integration
history. An unrelated hotfix or mandatory `main` back-merge remains independent
housekeeping and must not mutate an active REQ. A legitimate scope change returns
the REQ to implementation/evidence, updates the canonical manifest, and requires
a new UAT submission.

A standalone housekeeping promotion is an exception for work that cannot wait.
Its release PR must state `Standalone housekeeping promotion` and why it
cannot wait. It still requires terminal-green CI and PR review. Portal UAT/prod
approval is off by default unless the project explicitly opts in. The portal
must label and close it as standalone housekeeping so it is not later bundled.
The release PR must also include the validated declaration
`compliance/standalone-housekeeping/STANDALONE-HOUSEKEEPING-vYYYY.MM.DD.json`.

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
