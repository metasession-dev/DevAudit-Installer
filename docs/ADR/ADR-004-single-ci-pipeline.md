# ADR-004: One CI workflow, one plan job, one required check

**Status:** Accepted
**Date:** 2026-11-26
**Deciders:** DevAudit-Installer maintainers
**Related:** [#1335](https://github.com/metasession-dev/DevAudit-Installer/issues/1335) (design and implementation), superseded issues #1330-#1333, #1334 (close-out wait), #971 (release provenance), #1019 (attribution), #1290, #1298, #1299, #1311; [docs/ci-pipeline.md](../ci-pipeline.md). Partly supersedes [ADR-001](./ADR-001-polyglot-sdlc-architecture.md) (`ci-status-fallback` as a shared workflow).

## Context

The generated CI satisfied simple rules (gate code before it merges, skip the expensive gates for documentation, cancel superseded runs, do not test the same tree twice, attribute evidence to the right release, one required check) through mechanisms that each patched a gap left by another:

- documentation skipping lived in workflow **path filters**, so when `ci.yml` did not start nobody reported the required check; a **status-fallback workflow** reported it, with a job whose name was computed so a code pull request never got a second `Quality Gates`;
- that fallback status could make a release pull request look gated, so a separate **provenance workflow** (also named `CI Pipeline`) had to require a real `ci.yml` success, and dispatched and watched `ci.yml` for hotfixes while holding the runner it needed;
- the **feature E2E** was its own workflow with its own change detection, a silent fallback when a script was missing, no concurrency group, and a second full setup on the same runner;
- **merge reuse** added a fourth check name, and both it and pull-request skipping were **opt-in keys**, so projects onboarded earlier never got either and every key doubled the shapes to test.

Each step was reasonable alone; together they were hard to reason about, and the next five proposed fixes (#1330-#1333) would have added more.

## Decision

1. One workflow per target (`ci.yml`) produces `Quality Gates`. `ci-status-fallback.yml`, `quality-gates-provenance.yml` and `feature-e2e.yml` are no longer generated.
2. No trigger path filters. A `plan` job (`scripts/ci-plan.sh`) decides from the event and the diff, with one list (`paths_ignore`) through the existing path matcher.
3. A `required-check` job named `Quality Gates` (`scripts/ci-required-check.sh`) runs `if: always()` and passes only when every job the plan asked for succeeded.
4. Merge reuse is always on, judged by the pull request run's `Quality Gates` job; documentation-only skipping is always on. `reuse_pull_request_gates` and `paths_ignore_pull_request` are retired.
5. Attribution (#1019) stays a separate rule in `classify-pr-attribution.sh`.
6. The feature E2E is a non-blocking job of `ci.yml`; specs select it with `GITHUB_JOB=feature-e2e`.
7. Release provenance is a job of `ci.yml` and counts only push and manual runs, so a release pull request run cannot certify itself. Hotfix pull requests run the gates in the same run.
8. Pull request runs are cancelled by a newer push; pushes to the integration branch are never cancelled.
9. The gate job keeps id `quality-gates` and every evidence string is unchanged; only display names moved.
10. Self-hosted runners only: no GitHub-hosted minutes are required anywhere.

## Consequences

- Fewer moving parts: one producer of the required check, one decision point, one path list, no second check name, no opt-in variants.
- Every documentation-only pull request or push still occupies the runner for a few seconds (`Plan`, `Quality Gates`). On a single runner a job that waits for another run's check must not hold the runner while it waits (#1334).
- Consumers take one larger sync diff. Configs that guarded on `GITHUB_WORKFLOW === 'Feature In-Scope E2E'`, modified copies of the removed workflows, and `.devaudit-patches` against the old `ci.yml` need a manual step; `devaudit doctor` (`ci-pipeline`) names them.
- The runner needs `python3` for every project (the path matcher), not only those that had enabled documentation-only skipping.

## Alternatives rejected

- **Keep the status fallback and add what was missing** (concurrency on the feature workflow, a doctor finding, a run summary): each fix adds a layer to the problem this ADR removes.
- **Run the cheap classification jobs on GitHub-hosted runners** to keep them off a busy self-hosted runner: rejected by the maintainer; consumers must never be forced to spend hosted minutes.
- **Keep the keys opt-in**: older projects would keep the costly behaviour forever, and every key doubles the tested shapes.
