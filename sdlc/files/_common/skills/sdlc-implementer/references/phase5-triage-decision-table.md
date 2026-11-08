# Choosing the resolution for a failed execution (Phase 5)

A project admin resolves each failed execution in the portal (release page, journey panel). Use this table to decide which resolution to hand them. The classification comes from `e2e-test-engineer` Phase 6.

| Classification | Resolution | Remediation reference | Needs a committed record |
| --- | --- | --- | --- |
| Flake, and a rerun of the same SHA passed | `retry_passed` (resolving cycle = the passing rerun) | none | no |
| Run was cancelled and a later run in the same stage passed | `superseded` (the portal usually does this itself) | none | no |
| Flake that cannot be reproduced, test-authoring bug, or seed-data gap | `accepted_exception` | tracking issue for the underlying fix | yes: `accepted-e2e-failure-<spec>.md` |
| Application defect already fixed forward in a later release | `incident_remediated` | the fix PR or incident issue | no |
| Application defect still open | `accepted_exception` | the incident issue | yes |

## The post-deploy run tests the deployed SHA

The post-deploy regression run executes the specs at the deployed SHA. A spec fix merged to `develop` afterwards cannot produce a `retry_passed` for a release whose SHA is already deployed: the rerun would test different code. For a failure caused by a stale or wrong spec, use `accepted_exception` with the fix PR as the remediation reference.

## Rules

- `accepted_exception` is never automatic: the operator chooses it, and the record needs an impact assessment, a decision-maker, a date and a review date.
- "Known unrelated flake" is not a resolution and is not evidence.
- The release may close on the commit that was actually tested; an open defect stays tracked in its own issue.
