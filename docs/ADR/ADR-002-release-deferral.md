# ADR-002: Release deferral: portal-owned state, git-visible intent

| Field    | Value                                                                                                                  |
| -------- | ---------------------------------------------------------------------------------------------------------------------- |
| Status   | Accepted                                                                                                               |
| Date     | 2026-10-11                                                                                                             |
| Decision | The ticket `Release intent` field is the sole declaration of deferral; the portal `deferred` state is portal-owned and admin-only |
| Tracked  | devaudit-installer#956 (phases 3a-1 to 3a-3 shipped; 3b open); portal state: metasession-dev/devaudit#887             |
| Author   | DevAudit Engineering                                                                                                   |

## Context

A tracked REQ can finish Phases 1-4, and even reach portal `uat_approved`, while its release PR is closed unmerged because the work is meant to ship with the next release. Before this change nothing recorded that. The closed PR, the portal release (which had no defer or cancel route and sat at its last state), the pending release ticket and the RTM row all disagreed, and nothing stopped the REQ's commits reaching `main` under another release's approval, or its ticket staying pending forever. Prior controls (`generate-bundled-changes.sh` refusing silent absorption) covered only part of that.

The existing terms did not fit. *Superseded* is terminal and means a successor absorbed the scope at close-out. *Abandoned* means the work was dropped. A parked REQ is neither: it is reversible and its work remains pending.

Two sources of truth exist. The consuming repo holds tickets, the RTM and the commits; the portal holds release state, approvals and the audit log. The decision is who owns which part of a deferral.

## Decision

1. **Intent lives in git, in one place.** The ticket field `- **Release intent:** deferred-to-next — <reason, PR #N closed unmerged>` is the sole declaration of deferral. The portal does not write back into the ticket and no PR is opened on its behalf.
2. **The portal `deferred` state is portal-owned.** It is entered from `draft`, `uat_review`, `uat_rejected` or `uat_approved`; resume returns to `draft`; a deferred release can be superseded by a successor. Defer and resume are admin-only (`POST /api/releases/[id]/defer` and `/resume`), authenticated by a session or a personal access token. CI, API and viewer keys cannot defer or resume, and the state is not settable through the CI status PATCH. The portal records `release.deferred` and `release.resumed` audit events.
3. **The RTM gets a `DEFERRED` status.** It is non-terminal. `validate-compliance-artifacts.sh` accepts it; `validate-commits.sh` and `derive-release-version.sh` (steps 4 and 4-bis) ignore deferred tickets and rows, so a parked REQ is never derived as the in-flight release.
4. **A promotion gate enforces no silent absorption.** `check-deferred-reqs-in-range.sh`, a failing step of `check-release-pr-scope.sh` inside the existing Release Scope Integrity job, fails a `develop -> main` PR when a deferred REQ's commits are in the diff and it is not listed under `Absorbed predecessor releases`. It is not a separate required check; `Quality Gates` stays the only required context. `check-release-approval` gives a specific message for a portal `deferred` release and still fails.
5. **Deferred tickets stay in `compliance/pending-releases/`.** There is no deferred directory; the field and the RTM status carry the state.
6. **Diagnosis is read-only.** `devaudit doctor` reports `release-pr-closed`, `deferred-will-ship`, `predecessors-none` and `bundle-members` (alongside the existing `releases` check) under the additive `deferral` and `proposals` JSON keys. They are non-gating and use the viewer key (`DEVAUDIT_VIEWER_API_KEY`, falling back to `DEVAUDIT_API_KEY`), skipping gracefully when data is missing. Today an admin defers and resumes manually.

## Consequences

### Positive

- Intent is reviewable, diffable and survives portal outages or a closed PR; the audit trail has both the git declaration and the portal events.
- The privilege boundary is explicit: a human admin must defer. No automation credential can park an approved release or resume it.
- A deferred REQ cannot ship unapproved: the gate and the no-silent-absorption guards close the path from both ends.
- The vocabulary separates deferred (reversible), superseded (terminal) and abandoned (dropped), which keeps lineage and audit views honest.

### Negative

- Declaration and portal state are two manual steps and can drift (for example a ticket marked deferred while the portal release is still `uat_approved`). Doctor reports this but does not repair it until phase 3b.
- Deferral by an admin PAT is a manual operation with no CLI or skill command yet.
- Consumers receive the ticket field, RTM status and gate only after a release and `devaudit update`.
- Declared bundles are a Node-template feature, so deferral into a bundle is unavailable for `stack: python`.

### Neutral

- The promotion gate runs only on the `develop -> main` promotion PR; Stage 4 feature PRs are unaffected.

## Considered alternatives

### Alternative A: A separate `deferred-releases/` directory

Move deferred tickets out of `pending-releases/`. **Rejected**: every script that scans pending tickets (validators, evidence upload, close-out, doctor) would need a new location, and a ticket moving directories turns a reversible state into a rename with history noise. The field plus RTM status gives the same signal with no move.

### Alternative B: Portal as the sole declaration, or portal writing back via PR

Treat portal `deferred` as the truth and have the portal open a PR to set the ticket. **Rejected**: git-side gates (validators, derive, the promotion gate) must work offline and without portal credentials, and a portal-authored write-back needs a write credential into consumer repos that the trust model avoids. It would also make the repo's view of the release depend on portal availability.

### Alternative C: CI-key-driven defer

Let CI or an API key set the state (for example from the closed-PR event or the status PATCH). **Rejected**: it would let an automation credential park or resume a release, including an approved one, with no human accountable. Keeping defer and resume admin-only preserves the four-eyes posture.

## Open items (phase 3b of #956, not implemented)

- `devaudit doctor --fix` with tiered remediation: tier A, B and C proposals, and the remaining doctor checks D1, D2 and D5.
- A `deferral_max_age_days` doctor setting, default 30 (planned).
- `--fix` exits non-zero when proposals remain unapplied.
- `--fleet` must not forward `--fix`; fleet sweeps stay read-only.
- Interactive prompts for proposals, with non-interactive rules.
- Any CLI or skill command that calls defer or resume (needs a human admin PAT, never CI/API/viewer keys).

## References

- Issue #956 (release deferral lifecycle); metasession-dev/devaudit#887 (the `deferred` state) and #886 (status-PATCH hardening).
- [Deferring a finished REQ into the next release](../change-workflows.md#deferring-a-finished-req-into-the-next-release)
- [Release playbooks: deferred releases](../release-playbooks/README.md#deferred-releases)
- [Doctor: release-deferral diagnosis](../doctor.md)
- [Release lineage and test-execution audit model](../release-lineage-and-test-execution-audit-model.md)
