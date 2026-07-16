# Change workflows & release types

How different kinds of change move through the SDLC, what to expect at each step, and what release record each produces in the portal. This is the **process / client view**; for how the portal stores, gates, and _displays_ what these workflows upload — and the release lifecycle states and four-eyes approval — see the portal's [Portal ↔ consumer integration](https://github.com/metasession-dev/devaudit/blob/main/docs/ci-integration.md) and [Releases & approvals](https://github.com/metasession-dev/devaudit/blob/main/docs/releases-and-approvals.md).

## Pick the workflow by change type

Every change starts from a GitHub issue and, if it's real product work, from a **requirement** (`REQ-XXX`). The commit type you'll use decides whether the requirement is mandatory:

| Change type                          | Commit types                                           | Requirement?                  | Path                                            | What to expect                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------ | ----------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Feature / tracked change**         | `feat`                                                 | **Yes** — `[REQ-XXX]`         | `sdlc-implementer` (default) → Stages 1–5       | Plan + RTM entry; `sdlc-implementer` Phase 1 delegates to `requirements-aligner` (SRS-ID column on AC table), `adr-author` (ADR-worthiness verdict + draft), and `risk-register-keeper` (RISK-NNN entries for MEDIUM/HIGH); implementation; e2e via `e2e-test-engineer`; Phase 3 evidence pack includes per-REQ `srs-alignment.md` + `architecture-decision.md` + `risk-assessment.md` traceability artefacts; UAT four-eyes; prod deploy; prod approval |
| **Bug fix (behavioural)**            | `fix`                                                  | **Yes** — `[REQ-XXX]`         | `sdlc-implementer`, or manual Stages 1–5        | Same as a feature; risk class is usually LOW/MEDIUM so planning is lighter and `risk-register-keeper` skips Stage-1 hook for LOW by default                                                                                                                                                                                                                                                                                                              |
| **Refactor / perf**                  | `refactor`, `perf`                                     | **Yes** — `[REQ-XXX]`         | Stages 1–5 (often LOW risk)                     | Tests must prove behaviour is unchanged; SoT-alignment skills fire same as for `feat`                                                                                                                                                                                                                                                                                                                                                                    |
| **Housekeeping**                     | `chore`, `ci`, `build`, `test`, `compliance`, `revert` | **No**                        | Straight to a `chore:`/`ci:` PR                 | Applicable local gates still run; full E2E remains CI/UAT-owned unless local prerequisites are confirmed; no requirement, no evidence pack, no SoT-alignment skill invocations                                                                                                                                                                                                                                                                                                                                                              |
| **Trivial** (typo, format, dep bump) | `docs`, `chore`                                        | **No**                        | Trivial-change escape hatch — skip Stages 1 & 3 | Applicable local checks must pass before push; full E2E remains CI/UAT-owned unless local prerequisites are confirmed                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Compliance-doc-only**              | `compliance`, `docs`                                   | references existing `REQ-XXX` | Push to `develop` (no code)                     | `compliance-evidence.yml` uploads docs; no quality gates run                                                                                                                                                                                                                                                                                                                                                                                             |

> **Enforced, not advised.** `feat` / `fix` / `refactor` / `perf` commits without a `[REQ-XXX]` in the subject or a `Ref: REQ-XXX` trailer are rejected locally by commitlint and at PR CI by `validate-commits.sh`. Housekeeping types are exempt. This is why implementation work always converges on a `REQ-XXX` release rather than a bare-date one. Start tracked work with the `sdlc-implementer` skill, which assigns the requirement from the issue in Phase 1. See [`implementing-an-sdlc-issue.md`](../sdlc/files/_common/implementing-an-sdlc-issue.md) for the full stage walkthrough and the "when it is NOT used" list.

## Workflow triage (the pickup-time decision)

The table above is a reference; **this section is the decision you make when you pick an issue up** — which of the six change-types applies, and therefore which path runs. The [`sdlc-implementer`](../sdlc/files/_common/skills/sdlc-implementer/SKILL.md) skill runs this automatically as its **Phase 0** before assigning any `REQ-XXX`, so the skill routes rather than always running the full ceremony. Done by hand, it's the same four moves: **classify → announce → confirm → route**.

**Classify — inference-first; labels are optional input.** Highest-precedence signal wins:

1. An explicit `type:*` / `risk:*` label on the issue → **authoritative**.
2. A conventional-commit prefix in the issue title — `feat` / `fix` / `refactor` / `perf` → **tracked**; `chore` / `ci` / `build` / `test` / `docs` / `compliance` → **housekeeping / doc-only**.
3. The issue template — Requirement → tracked; Bug → fix (tracked); Task → housekeeping.
4. Body heuristics — acceptance criteria, or risk signals (auth, payments, RBAC, data egress, AI decisioning) → tracked, and raise the risk class.

**Announce — a "Workflow Decision" block** so the path is explicit before work starts:

> **Workflow decision — #N**
>
> - **Change type:** \<Feature | Bug fix | Refactor/Perf | Housekeeping | Trivial | Compliance-doc-only\>
> - **Commit type:** \<feat | fix | refactor | chore | docs | …\>
> - **Requirement:** \<REQ-XXX assigned | none\>
> - **Risk:** \<LOW | MEDIUM | HIGH | CRITICAL\>
> - **Path:** \<Full SDLC Stages 1–5 | Lightweight (gates → chore PR) | Doc-only push\>
> - **Gates/evidence:** \<…\>
> - **Your approvals:** \<UAT four-eyes + Production approval | PR review only\>
> - **Skipped:** \<…\>
>   Proceed? _(or reclassify)_

**Confirm — pause-when-it-matters.** Pause for an explicit go on **tracked / heavier** paths, or when the classification is ambiguous; **announce-and-auto-proceed** for trivial / housekeeping. You can always reclassify.

**Route:** tracked → Stages 1–5 (below); housekeeping / trivial → the [trivial-change escape hatch](../sdlc/files/_common/implementing-an-sdlc-issue.md) (no `REQ-XXX`, no evidence pack); compliance-doc-only → a docs push against the existing `REQ-XXX`. Routing chooses _which workflow to drive_, not whether to keep going — `sdlc-implementer` drives whichever path through to merge, skipping only the ceremony the change-type doesn't need.

**Labels are an accelerator and a record, not a prerequisite.** Routing works with zero labels; when present they are authoritative, and the triage step writes the inferred `type:*` / `risk:*` labels back so the issue ends up labelled. The minimal set is `type:feature` · `type:fix` · `type:refactor` · `type:chore` · `type:docs` · `type:compliance` and `risk:low` · `risk:medium` · `risk:high`.

## What to expect at each stage (tracked change)

| Stage                   | You / the skill do                                                                         | The portal sees                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 Plan**              | Issue → `REQ-XXX` in `RTM.md`, risk class, `implementation-plan.md` (MEDIUM/HIGH)          | nothing yet                                                                                                                                                                                                                                                                                                                                                                |
| **2 Implement**         | Code on `develop`, gates green every commit; push to `develop`                             | `ci.yml` registers the release + uploads **gate evidence** (`security_scan`, `ci_pipeline`, `test_report`) at `environment=uat`                                                                                                                                                                                                                                            |
| **3 Compile evidence**  | test-scope / test-plan / security-summary / release ticket; UAT-env verification (Step 10) | `compliance-evidence.yml` uploads the **committed docs** scoped to the requirement; the release dashboard shows the completeness checklist filling in                                                                                                                                                                                                                      |
| **4 Submit for review** | Open PR to `main`; submit the release for **UAT review**                                   | `compliance-validation.yml` checks artifacts + commit conventions; `check-release-approval.yml` blocks the merge until the release is approved; the portal shows the **four-eyes UAT approval** panel                                                                                                                                                                      |
| **5 Deploy**            | Merge `develop → main` (production deploy)                                                 | `post-deploy-prod.yml` runs prod smoke, uploads `environment=production` evidence, and advances each in-scope release to `prod_review`; a reviewer approves Production → Mark as Released. On `released`, the portal fires `release-closed` and `close-out-release.yml` reconciles the ticket automatically (→ `RELEASED`, RTM row flipped, moved to `approved-releases/`) |

The split of _which_ workflow uploads _what_ (and the exact evidence categories) is the **upload side**; how those artifacts are gated and rendered on the release dashboard is the **portal side** — see the integration doc linked above.

## Release types (process view)

A **release record** in the portal is keyed by `(project, version)`. The version is derived from the latest commit by [`derive-release-version.sh`](../sdlc/files/_common/scripts/derive-release-version.sh), and both `ci.yml` and `compliance-evidence.yml` call the same helper so a feature's code pushes and doc pushes converge on **one** record.

| Version shape                 | Shape        | Produced by                                                                             | Use                                                                                             |
| ----------------------------- | ------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **`REQ-XXX`**                 | tracked      | a commit with `[REQ-XXX]` in the subject or `Ref: REQ-XXX` in the body                  | the normal release for tracked work — one requirement, one release                              |
| **`vYYYY.MM.DD`** (bare date) | housekeeping | a commit with **no** REQ tag (`docs`/`chore`/`ci`/`build`/`test`/`compliance`/`revert`) | date-versioned release for ticketless work; CI auto-increments same-day collisions (`.2`, `.3`) |

Three structural cases:

- **Single-requirement (tracked) release** — the common case. One `REQ-XXX` release carries its gates + docs + UAT record, goes through four-eyes once, deploys, gets a Production approval.
- **Bundled (tracked) release** — several requirements promoted in one `develop → main` PR. Each `REQ-XXX` keeps its **own** release record: `compliance-evidence.yml` attributes each requirement's docs to its own release, and `post-deploy-prod.yml` promotes **every** in-scope requirement (not just the first). So a bundled deploy still yields per-requirement audit trails and per-requirement Production approvals.
- Under the first-class lineage contract, the final tracked release is the **approval envelope**. Absorbed predecessors stay distinct releases linked by explicit bundle membership; their evidence remains owned by the source release and becomes visible to the approval envelope by lineage, not reassignment.
- **Housekeeping release** — bare-date version, no per-REQ ceremony. The portal auto-skips the four per-REQ completeness items (test-scope, test-plan, implementation-plan, test-execution-summary). What's still required: the four CI gates green AND two release-scoped artefacts (`RELEASE-TICKET-<version>.md` + `security-summary-<version>.md`). Both are **auto-generated** by CI (`generate-housekeeping-release-ticket.sh` + `generate-security-summary.sh`, DevAudit-Installer v0.1.41+) and surfaced as an auto-PR for operator sign-off. Same UAT → production four-eyes flow as tracked.

Once a truthful tracked `REQ-XXX` release exists for the same branch window, that tracked release becomes authoritative. Any earlier bare-date housekeeping row for the same work should be treated as predecessor history only: it can be superseded/bundled under the tracked release and removed from the active reviewer queue without deleting the audit trail.

Likewise, if an older `develop -> main` release PR no longer matches the governing release context, the framework closes it as superseded and regenerates the truthful PR rather than letting two competing release PRs stay open.

## PR status contract

The installer treats three GitHub-owned checks as the authoritative SDLC merge surface:

- `Quality Gates`
- `Compliance Validation`
- `DevAudit Release Approval`

Everything else should be interpreted deliberately:

- hosting-platform suites such as `vercel`, `railway-app`, and `cloudflare-workers-and-pages` are operational signals, not release gates, unless a consumer intentionally makes them required in branch protection
- automated reconciliation branches (`chore/close-out-*`) are administrative close-out traffic, not feature or release PRs, so heavy PR workflows should not be the thing that defines whether they can merge

Consumer guidance:

1. Keep required branch protection checks limited to repo-owned SDLC checks unless there is an explicit reason to gate on an external platform.
2. Remove stale hosting integrations that still attach check suites after the platform is no longer in use.
3. Scope hosting-platform PR status reporting away from `chore/close-out-*` and similar administrative branches where possible.
4. Treat external queued/pending suites on the same SHA as noise unless branch protection explicitly says otherwise.

> Keep implementation commits REQ-tagged. An untagged code merge falls back to a date version and, before the per-requirement attribution fixes, would scatter a bundle's evidence onto that date release — which is exactly why the REQ-tag rule is enforced.

For the canonical producer payloads behind cycle lifecycle events, evidence scopes, and bundled-release manifests, see [`release-lineage-producer-contract.md`](./release-lineage-producer-contract.md).

For the **lifecycle states** a release moves through (`draft → uat_review → uat_approved → prod_review → prod_approved → released`), the `prod_review` vs `released` terminal-status options, and the four-eyes (`dual_actor`) rules, see the portal's [Releases & approvals](https://github.com/metasession-dev/devaudit/blob/main/docs/releases-and-approvals.md).

> **Want the step-by-step?** [`release-playbooks/`](./release-playbooks/) walks a **high-risk**, a **low-risk**, and a **housekeeping** release end-to-end — each written twice, once for driving it with an AI agent (the prompts you type) and once by hand.

## See also

- [`release-playbooks/`](./release-playbooks/) — step-by-step playbooks for high-risk / low-risk / housekeeping releases, with the AI prompts and the manual commands side by side.
- [`implementing-an-sdlc-issue.md`](../sdlc/files/_common/implementing-an-sdlc-issue.md) — the operational stage-by-stage walkthrough (also synced into every consumer).
- [`e2e-local-db-ci.md`](./e2e-local-db-ci.md) — run the E2E gate against a disposable local database (never test against prod) via `e2e_setup_command` + `e2e_env`.
- [`sdlc-framework.md`](./sdlc-framework.md) — the framework's structure, tiers, and adapter layering.
- [`onboarding.md`](./onboarding.md) — `devaudit install` for a new consumer.
- Portal: [What is DevAudit](https://github.com/metasession-dev/devaudit/blob/main/docs/what-is-devaudit.md) · [Portal ↔ consumer integration](https://github.com/metasession-dev/devaudit/blob/main/docs/ci-integration.md) · [Releases & approvals](https://github.com/metasession-dev/devaudit/blob/main/docs/releases-and-approvals.md).
