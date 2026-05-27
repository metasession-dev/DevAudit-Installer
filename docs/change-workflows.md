# Change workflows & release types

How different kinds of change move through the SDLC, what to expect at each step, and what release record each produces in the portal. This is the **process / client view**; for how the portal stores, gates, and *displays* what these workflows upload — and the release lifecycle states and four-eyes approval — see the portal's [Portal ↔ consumer integration](https://github.com/metasession-dev/devaudit/blob/main/docs/ci-integration.md) and [Releases & approvals](https://github.com/metasession-dev/devaudit/blob/main/docs/releases-and-approvals.md).

## Pick the workflow by change type

Every change starts from a GitHub issue and, if it's real product work, from a **requirement** (`REQ-XXX`). The commit type you'll use decides whether the requirement is mandatory:

| Change type | Commit types | Requirement? | Path | What to expect |
|---|---|---|---|---|
| **Feature / tracked change** | `feat` | **Yes** — `[REQ-XXX]` | `sdlc-implementer` (default) → Stages 1–5 | Plan + RTM entry, implementation, e2e via `e2e-test-engineer`, evidence, UAT four-eyes, prod deploy, prod approval |
| **Bug fix (behavioural)** | `fix` | **Yes** — `[REQ-XXX]` | `sdlc-implementer`, or manual Stages 1–5 | Same as a feature; risk class is usually LOW/MEDIUM so planning is lighter |
| **Refactor / perf** | `refactor`, `perf` | **Yes** — `[REQ-XXX]` | Stages 1–5 (often LOW risk) | Tests must prove behaviour is unchanged |
| **Housekeeping** | `chore`, `ci`, `build`, `test`, `compliance`, `revert` | **No** | Straight to a `chore:`/`ci:` PR | Local gates still run; no requirement, no evidence pack |
| **Trivial** (typo, format, dep bump) | `docs`, `chore` | **No** | Trivial-change escape hatch — skip Stages 1 & 3 | All gates **must still pass locally** before push |
| **Compliance-doc-only** | `compliance`, `docs` | references existing `REQ-XXX` | Push to `develop` (no code) | `compliance-evidence.yml` uploads docs; no quality gates run |

> **Enforced, not advised.** `feat` / `fix` / `refactor` / `perf` commits without a `[REQ-XXX]` in the subject or a `Ref: REQ-XXX` trailer are rejected locally by commitlint and at PR CI by `validate-commits.sh`. Housekeeping types are exempt. This is why implementation work always converges on a `REQ-XXX` release rather than a bare-date one. Start tracked work with the `sdlc-implementer` skill, which assigns the requirement from the issue in Phase 1. See [`implementing-an-sdlc-issue.md`](../sdlc/files/_common/implementing-an-sdlc-issue.md) for the full stage walkthrough and the "when it is NOT used" list.

## What to expect at each stage (tracked change)

| Stage | You / the skill do | The portal sees |
|---|---|---|
| **1 Plan** | Issue → `REQ-XXX` in `RTM.md`, risk class, `implementation-plan.md` (MEDIUM/HIGH) | nothing yet |
| **2 Implement** | Code on `develop`, gates green every commit; push to `develop` | `ci.yml` registers the release + uploads **gate evidence** (`security_scan`, `ci_pipeline`, `test_report`) at `environment=uat` |
| **3 Compile evidence** | test-scope / test-plan / security-summary / release ticket; UAT-env verification (Step 10) | `compliance-evidence.yml` uploads the **committed docs** scoped to the requirement; the release dashboard shows the completeness checklist filling in |
| **4 Submit for review** | Open PR to `main`; submit the release for **UAT review** | `compliance-validation.yml` checks artifacts + commit conventions; `check-release-approval.yml` blocks the merge until the release is approved; the portal shows the **four-eyes UAT approval** panel |
| **5 Deploy** | Merge `develop → main` (production deploy) | `post-deploy-prod.yml` runs prod smoke, uploads `environment=production` evidence, and advances each in-scope release to `prod_review`; a reviewer approves Production → Mark as Released |

The split of *which* workflow uploads *what* (and the exact evidence categories) is the **upload side**; how those artifacts are gated and rendered on the release dashboard is the **portal side** — see the integration doc linked above.

## Release types (process view)

A **release record** in the portal is keyed by `(project, version)`. The version is derived from the latest commit by [`derive-release-version.sh`](../sdlc/files/_common/scripts/derive-release-version.sh), and both `ci.yml` and `compliance-evidence.yml` call the same helper so a feature's code pushes and doc pushes converge on **one** record.

| Version shape | Produced by | Use |
|---|---|---|
| **`REQ-XXX`** | a commit with `[REQ-XXX]` in the subject or `Ref: REQ-XXX` in the body | the normal release for tracked work — one requirement, one release |
| **`vYYYY.MM.DD`** (bare date) | a commit with **no** REQ tag (housekeeping) | date-versioned release for ticketless work; CI auto-increments same-day collisions (`.2`, `.3`) |

Two structural cases:

- **Single-requirement release** — the common case. One `REQ-XXX` release carries its gates + docs + UAT record, goes through four-eyes once, deploys, gets a Production approval.
- **Bundled release** — several requirements promoted in one `develop → main` PR. Each `REQ-XXX` keeps its **own** release record: `compliance-evidence.yml` attributes each requirement's docs to its own release, and `post-deploy-prod.yml` promotes **every** in-scope requirement (not just the first). So a bundled deploy still yields per-requirement audit trails and per-requirement Production approvals.

> Keep implementation commits REQ-tagged. An untagged code merge falls back to a date version and, before the per-requirement attribution fixes, would scatter a bundle's evidence onto that date release — which is exactly why the REQ-tag rule is enforced.

For the **lifecycle states** a release moves through (`draft → uat_review → uat_approved → prod_review → prod_approved → released`), the `prod_review` vs `released` terminal-status options, and the four-eyes (`dual_actor`) rules, see the portal's [Releases & approvals](https://github.com/metasession-dev/devaudit/blob/main/docs/releases-and-approvals.md).

## See also

- [`implementing-an-sdlc-issue.md`](../sdlc/files/_common/implementing-an-sdlc-issue.md) — the operational stage-by-stage walkthrough (also synced into every consumer).
- [`e2e-local-db-ci.md`](./e2e-local-db-ci.md) — run the E2E gate against a disposable local database (never test against prod) via `e2e_setup_command` + `e2e_env`.
- [`sdlc-framework.md`](./sdlc-framework.md) — the framework's structure, tiers, and adapter layering.
- [`onboarding.md`](./onboarding.md) — `devaudit install` for a new consumer.
- Portal: [What is DevAudit](https://github.com/metasession-dev/devaudit/blob/main/docs/what-is-devaudit.md) · [Portal ↔ consumer integration](https://github.com/metasession-dev/devaudit/blob/main/docs/ci-integration.md) · [Releases & approvals](https://github.com/metasession-dev/devaudit/blob/main/docs/releases-and-approvals.md).
