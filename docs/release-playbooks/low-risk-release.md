# Playbook: low-risk tracked release

This is a tracked `REQ-XXX` release with limited blast radius. It skips the
High/Critical plan-approval pause, but it is still a real requirement: it has a
release record, evidence, first-class cycle history, and the project's approval
policy.

## Canonical route

```text
feature/REQ-XXX-* -> PR to integration -> terminal-green CI and review -> merge
evidence and UAT review -> integration -> release PR -> terminal-green checks
-> merge -> post-deploy verification -> portal released -> automated close-out PR
```

Use `sdlc-implementer` with `Implement issue #N under the SDLC.` unless a
manual recovery is necessary. The skill must create the feature branch; it must
not commit directly to a protected branch.

## Manual route

### Stages 1-3: plan, implement, evidence

1. Allocate `REQ-XXX`, create the RTM entry and LOW test scope/test plan.
2. Branch from `$INTEGRATION_BRANCH` as `feat/REQ-XXX-short-description`.
3. Implement with tests and run the applicable local gates.
4. Commit with `Ref: REQ-XXX`, push the feature branch, and open a PR to
   `$INTEGRATION_BRANCH`.
5. After terminal-green checks and required review, merge the integration PR.
6. Compile/upload evidence. Render first-class cycle history with
   `scripts/render-test-cycles.sh` where available rather than writing cycle
   history from filenames.
7. Write the release ticket and submit the release for UAT review.

### Stage 4: truthful promotion PR

Open the release PR only from `$INTEGRATION_BRANCH` to `$RELEASE_BRANCH`. It
must name every in-scope `REQ-XXX`, link their release tickets, and state whether
it is bundled. Check the current PR head SHA for `Quality Gates`, `Release Scope
Integrity`, `Compliance Validation`, `DevAudit Release Approval`, and `E2E
Regression Suite`. A pending or running check is waiting, not green.

Under `auto_low_risk` the portal may approve UAT automatically; otherwise apply
the configured approval policy. The author may self-merge only where the project
policy permits it and every required check is terminal green on the current
head SHA.

### Stage 5: deploy, approve, close out

After the merge, wait for `post-deploy-prod.yml` to reach a terminal successful
state and for its hosting deployment check to confirm terminal success for the
merged SHA. Confirm production deployment and smoke cycles are present and
successful on the portal. Do not call production green while any of those are
still in progress.

When the portal reaches `released`, let `repository_dispatch(release-closed)`
open the `chore/close-out-REQ-XXX` PR to `$INTEGRATION_BRANCH`. Review and merge
that reconciliation PR. Use manual workflow dispatch only if the dispatch fails;
use `scripts/close-out-release.sh` locally only for documented recovery.

## Bundled and superseded work

If the promotion includes prior housekeeping or earlier release rows, use the
bundle artifacts and submitted manifest described in [README](./README.md).
The successor owns the approval envelope; predecessors retain their own
evidence/cycles and are linked as historical context. Do not silently relabel
their evidence as belonging to the successor.

## Hotfix

For an actual production emergency: create `hotfix/REQ-XXX-*` from
`$RELEASE_BRANCH`, PR to `$RELEASE_BRANCH`, complete checks/review/evidence,
merge, then immediately open a `backmerge/*` PR into `$INTEGRATION_BRANCH`.
High priority without production impact stays on the normal route.
