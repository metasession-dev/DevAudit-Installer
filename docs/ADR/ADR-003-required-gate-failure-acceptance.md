# ADR-003: A failed required gate is fixed or accepted with a documented exception

| Field    | Value                                                                                                                  |
| -------- | ---------------------------------------------------------------------------------------------------------------------- |
| Status   | Accepted                                                                                                               |
| Date     | 2026-10-17                                                                                                             |
| Decision | A failing required check on a release PR blocks UAT until it is fixed or accepted with a documented exception recorded in the portal |
| Tracked  | devaudit-installer#1016 (E2E), #1017 (dependency audit); portal companion: metasession-dev/devaudit#901                 |
| Author   | DevAudit Engineering                                                                                                   |

## Context

On wawagardenbar-app REQ-109 a required E2E check failed on the release PR (one spec, attempt 1), passed on a re-run with no code change, and the `test-execution-summary.md` still read "PASS (with known unrelated flakes)". The failure was only found at portal UAT approval, about two weeks after the PR opened, and the triage that eventually happened lived in a PR comment and an unmerged branch. The framework had no halt, no required outcome, no required record and no way to record the decision in the portal without merging into the release head (which, for a `develop` to `main` PR, is circular).

Silent acceptance ("known unrelated flakes") must not be possible, and the decision must be recorded where the portal can see it, not only in git.

## Decision

1. **Exactly two outcomes.** A failing required check on the release PR is **fixed** (a `fix/` PR, then a green re-run on the PR head SHA) or **accepted** with a documented exception. `sdlc-implementer` Phase 4 step 5a halts `[Blocked]` and offers those two paths; it never proceeds to UAT or evidence upload with an unresolved failure.
2. **Acceptance is a record, never automatic.** `accepted-e2e-failure-<spec>.md` (template in `sdlc-implementer/references/`) states the failure, the evidence behind the classification, an impact assessment, why it does not block this release, the decision-maker, a review date in the future and a tracking issue. `validate-risk-acceptance-record.sh` enforces the shape; the operator makes the decision, the agent only drafts.
3. **The portal records the decision directly.** `report-test-execution.sh resolve` is the only path: `accepted_exception` requires `--remediation-reference` and `--record`. A compliance-record PR is optional and never a prerequisite for the release PR going green.
4. **The summary cannot hide a failure.** `validate-test-summary.sh` requires a `## E2E failures & triage` row (classification, disposition, reference) for every failure, and `reconcile-e2e-summary.sh` compares the summary with the CI results. Summaries carrying a `CI as of:` stamp are validated strictly (generated executions table, stamp matches the PR head); summaries without it warn, so releases in flight are not broken.
5. **Failures are visible early and exceptions expire.** The PR watcher comments on the issue and updates the sticky within one poll of a red required check and escalates at `phase4.gate_timeout_hours`. `devaudit doctor` (`accepted-exceptions`) flags exceptions past their review date.

The same pattern applies to the dependency-audit gate (#1017) with a dependency risk-acceptance record.

## Consequences

### Positive

- A failure is either fixed or visibly accepted, with an owner, an impact statement and an expiry, in git and in the portal.
- The REQ-109 shape (summary PASS, CI exit 1 on a different spec, passing re-run) fails validation.

### Negative / costs

- Accepting a failure now costs a record and a tracking issue; that is the intent.
- `accepted_exception` callers (the Phase 5 post-deploy triage) must supply a record; the skill text was updated accordingly.
- The new evidence type `accepted_e2e_failure` must exist in the portal's evidence-type contract (the installer copy is synced from the portal repo).

### Not decided here

The portal's display of exceptions and its blocking semantics are portal-owned (metasession-dev/devaudit#901).
