# The CI pipeline: what runs, and the one required check

`devaudit install` and `devaudit update` generate **one** workflow that reports the required check `Quality Gates`: `.github/workflows/ci.yml` (named `CI Pipeline`; `ci-<target>.yml` for each target of a multi-target repository). A **plan** job decides what each run does; every other job reads its decision. There are no trigger path filters, so the workflow always starts and `Quality Gates` is always reported (DevAudit-Installer#1335, [ADR-004](./ADR/ADR-004-single-ci-pipeline.md)).

Everything runs on the project's own runner (`runner`, `CI_RUNNER_LABEL`): nothing here requires GitHub-hosted minutes.

Sources: `sdlc/files/ci/ci.yml.template` (Node), `sdlc/files/ci/python/ci.yml.template` (Python), the fragments in `sdlc/files/ci/fragments/`, and the scripts `scripts/ci-plan.sh`, `scripts/ci-required-check.sh`, `scripts/find-tested-run.sh` and `scripts/provenance-gated-commit.sh`.

## What runs when

| Event | Mode | Change with code | Change with only `paths_ignore` paths |
| --- | --- | --- | --- |
| Pull request into the integration branch | `feature` | the quality gates; the Feature In-Scope E2E (when the REQ has a tagged test) or the E2E scope decision upload (when it has none) | nothing else |
| Push to the integration branch (a merge) | `merge` | release registration; the gates, or the pull request run's result reused; the evidence upload | nothing else |
| Pull request into the release branch | `release` | Release Scope Integrity and Release provenance (the gates do not run again) | the same |
| Pull request into the release branch from `hotfix/*` or `fix/hotfix-*` | `hotfix` | the gates, always | the gates, always |
| Manual run (`workflow_dispatch`) | `manual` | the gates; on the integration branch also registration and upload | the same |

The jobs of a run: `Plan`, `Register Release`, `Run quality gates` (job id `quality-gates`), `Upload Evidence`, `E2E scope decision`, `Feature In-Scope E2E`, `Release Scope Integrity`, `Release provenance` and `Quality Gates`. A job the plan did not ask for shows as skipped; that is expected, not a problem.

The plan writes its decision (mode, change kind, reason, REQ, reuse and its reason) to the run's summary, and the `Quality Gates` job adds each job's result and how long it waited for a runner and ran.

## The required check `Quality Gates`

`Quality Gates` is the only check branch protection requires (`cli/src/lib/branch-protection-checks.ts`), and only the `required-check` job of `ci.yml` has that name. It runs after the jobs it judges with `if: always()`, so it reports even when a run fails or is cancelled. It **fails** when:

1. the plan failed (or wrote no mode);
2. the plan asked for the gates and they did not succeed;
3. the plan asked for the release registration and it did not succeed;
4. a merge with code neither ran the gates nor reused a pull request result;
5. the plan asked for release provenance and it did not succeed.

A skipped or cancelled job that should have run counts as not succeeded. A cancelled run (a newer push to the same pull request) therefore reports `Quality Gates` as failed for the older commit, never as passed. The Feature In-Scope E2E, the scope decision, the evidence upload and Release Scope Integrity are not judged: they are not in the job's `needs`, so they never delay or decide it, as before.

The plan also fails loudly when a tool it needs (`git`, `jq`, `python3`; `gh` for a merge) or a synced script (`provenance-gated-commit.sh`, `classify-pr-attribution.sh`, `find-tested-run.sh`) is missing. It never falls back to a default plan.

## Documentation-only changes

The plan classifies the changed files with `scripts/provenance-gated-commit.sh pr-docs-only` and the `paths_ignore` list (plus other targets' directories, and always `sdlc-config.json`):

- a pull request: the files changed since the merge base with the base branch;
- a push: the files changed since the previous commit of the branch (`github.event.before`); an unknown or all-zero previous commit counts as code.

The change is `docs-only` only when every file matches `paths_ignore`. It is `code` when any file does not, when **any file under `.github/workflows/` changed** (whatever `paths_ignore` says, #1299), when the list is empty, or when it has 3000 files or more. A new install's `paths_ignore` covers `SDLC/**`, `compliance/**`, `docs/**`, `.devaudit/**`, `.github/ISSUE_TEMPLATE/**`, `*.md` and `**/*.md`; `devaudit doctor` (`pull-request-gates`) names any documentation path a project's list leaves out.

Skipping the gates hides nothing from the compliance checks: the compliance validators run in `compliance-validation.yml` on the release pull request, release provenance still requires a real gate run on the latest code-bearing commit, and evidence attribution is decided separately (below).

**Attribution is separate.** Whether a pull request's evidence may attach to a release (its tested SHA, branch and executions) is decided by `scripts/classify-pr-attribution.sh` (#1019), as before, in the plan for the feature E2E and again inside `upload-evidence.sh` and `report-test-execution.sh`. See [compliance-gates.md](./compliance-gates.md#evidence-attribution-documentation-only-prs-devaudit-installer1019).

## A merge reuses the pull request run's result

The gates run on the pull request and, when the integration branch has not moved, the merge produces the same tree. The merge then reuses the pull request run's result instead of running the gates again (#1298, always on since #1335):

- The pull request run records the tree it tested (a small `tested-tree` artifact with that tree and its `gate-outcomes.json`) next to `ci-results`.
- On the merge, the plan runs `scripts/find-tested-run.sh`, which reuses a run only when **all** hold: exactly one merged pull request has the pushed commit as its merge commit, into the integration branch, from this repository, not opened by Dependabot or another bot; the latest pull request run of this workflow on its head commit completed and its `Quality Gates` job concluded `success` (the run's overall conclusion is not used, because the non-blocking feature E2E in the same run may fail); its `ci-results` and `tested-tree` artifacts have not expired; every gate in `gate-outcomes.json` is `success`; and the recorded tree equals the merged tree. Any doubt runs the gates in full.
- On reuse, `Run quality gates` is skipped, `Upload Evidence` downloads `ci-results` from the pull request run, adds `reused_from_run`, `reused_from_pr` and `reused_tested_tree` to `gate-outcomes.json`, and still records the merge run's quality-gate execution on the portal; the release check carries `reusedFromRun` and `reusedFromPr`.
- The integration branch moving between the pull request run and the merge changes the tree, so the gates run again. "Require branches to be up to date before merging" makes reuse the common case.
- Reuse needs GitHub Actions artifact storage. When the account's artifact quota is exhausted the artifacts are missing and the gates simply run again.

## Release pull requests: provenance

On a pull request into the release branch (not a hotfix), `Release provenance` finds the latest first-parent commit in `origin/<release>..<head>` that touches a path outside `paths_ignore` (any `.github/workflows/` change counts as code) and requires a successful `Quality Gates` on it from a **push or manual run of this workflow** (#971, #1335). A success from a pull request run never counts, so a release pull request's own check cannot certify itself. When every commit in the range is documentation-only, a push-run success on the head is enough. The check waits up to five minutes for a run still in progress, then fails naming the commit; rerun CI on it, or push it through the integration branch. Release Scope Integrity runs next to it, unchanged.

## Hotfix pull requests

A pull request from `hotfix/*` or `fix/hotfix-*` into the release branch runs the full gates in the same workflow run. (Before #1335 a separate workflow dispatched `ci.yml` and watched it, holding the runner the dispatched run needed.)

## The feature E2E

`Feature In-Scope E2E` runs the specs tagged with the pull request's REQ and uploads them as stage-2, `origin=feature` evidence, as before ([e2e-test-tiers.md](./e2e-test-tiers.md)). It is non-blocking. Its evidence keeps the workflow name `Feature In-Scope E2E`. A Playwright config that must leave a project out of this run tests `process.env.GITHUB_JOB === 'feature-e2e'` (or `process.env.DEVAUDIT_E2E_SCOPE === 'feature'`): `GITHUB_WORKFLOW` is `CI Pipeline` now.

## Concurrency

- Pull requests: one group per pull request; a newer push cancels the older run (including its feature E2E).
- Pushes to the integration branch: one group per commit, never cancelled. A docs-only push (frequent, evidence pull requests) cannot cancel or displace the evidence run of a code merge.

## Trust model and limits

- A pull request run executes the pull request's own `ci.yml` and `scripts/`, as before, so a pull request can change what its own checks do; review is the control. Release provenance relies only on push and manual runs on the integration branch, which run the reviewed, merged files.
- A merge commit created by `GITHUB_TOKEN` (for example GitHub auto-merge armed by a workflow) starts no workflow, so it gets no `Quality Gates` of its own.
- The plan checks out with full history on every run.
- The runner needs `git`, `jq`, `python3`, `gh` and `curl` ([self-hosted-runner-ci.md](./self-hosted-runner-ci.md)).

## Upgrading from the earlier layout

The next `devaudit update` rewrites `ci.yml` and removes `ci-status-fallback.yml`, `quality-gates-provenance.yml` and `feature-e2e.yml` (and their `-<target>` variants).

- If you modified one of those three, `update` keeps it and warns: **delete it before merging the sync**, because it would report a second `Quality Gates` check. `devaudit doctor` (`ci-pipeline`) reports any that is left.
- `paths_ignore_pull_request` and `reuse_pull_request_gates` are retired: documentation-only skipping and merge reuse are always on. `devaudit configure set` refuses them; remove them from `sdlc-config.json` (`devaudit doctor` names them).
- A Playwright config that tests `GITHUB_WORKFLOW === 'Feature In-Scope E2E'` must test `GITHUB_JOB === 'feature-e2e'` instead (`devaudit doctor` names the file).
- A `.devaudit-patches/ci.yml.patch` made against the old `ci.yml` no longer applies: re-create it against the new file, or move the change into an `sdlc-config.json` key.
- A second code merge no longer cancels the first merge's run.
- Branch protection needs no change.
