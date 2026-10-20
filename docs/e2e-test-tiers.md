# E2E Test Tiers

DevAudit distinguishes between fast blocking E2E coverage and broader regression coverage. The point is to keep PR feedback fast without pretending that every end-to-end assertion belongs in the same gate.

## The tier model

| Tier | When it runs | Purpose | Typical scope |
| --- | --- | --- | --- |
| Smoke | Every push to `develop` via the main CI gate | Fast signal that the app starts and the main happy path still works | Health path, boot path, one or two core journeys |
| Critical | PR to `main` when configured | Pre-merge protection for must-not-break flows | High-value authenticated or business-critical journeys |
| Regression | Post-merge and scheduled runs when configured | Broad coverage and hotfix discovery | Full pack, lower-frequency but wider blast radius |

## How the tiers relate

- Smoke is the minimum blocking E2E gate.
- Critical is a pre-merge expansion of smoke for teams that need a stronger PR gate.
- Regression is the wide net. It is allowed to be slower because it does not have to run on every `develop` push.

**Playwright report bundle upload (#1018):** the HTML report zip is uploaded best-effort on top of the canonical JSON results. If the multipart upload is rejected (HTTP 400/413) below the 25 MB presigned threshold, `upload-evidence.sh` retries once through the presigned flow and, on any failure, logs the file size, upload path and response headers. A zip error no longer produces a silent partial archive, and when a non-passing run's report cannot be uploaded the job summary says so ("Playwright report unavailable"); use the `e2e-regression-report` Actions artifact on the source run in that case. Passing runs stay non-blocking.

**Critical and regression carry distinct portal check labels** — `E2E Critical (pre-merge)` and `E2E Regression (post-deploy production)` respectively (devaudit-installer#787). Before this, both tiers reported under the identical `E2E Regression` label/workflow/job name everywhere a human looked, so a reviewer looking at a develop→main PR — where a regression-tier check is structurally guaranteed absent because production doesn't exist yet — had no way to tell "this is fine, that tier just hasn't run yet" from "something is actually wrong." The workflow's own `name:` field and job name are unchanged (renaming those risks breaking a consumer's existing branch-protection required-check-name reference) — only the portal-facing check label built in `compliance-evidence.yml.template` is tier-aware. A consumer running an `e2e-regression.yml` copied before this fix needs to re-sync `compliance-evidence.yml` (`devaudit update`) to pick up the distinct labels.

## What DevAudit ships today

The generated framework requires the blocking E2E gate in `ci.yml`.

The broader three-tier pattern is documented and available as a reference workflow through the `e2e-test-engineer` skill materials:

- [`docs/e2e-local-db-ci.md`](./e2e-local-db-ci.md) for safe local/disposable backends in CI
- [`sdlc/files/_common/skills/e2e-test-engineer/references/e2e-regression-3-tier.yml`](../sdlc/files/_common/skills/e2e-test-engineer/references/e2e-regression-3-tier.yml) for the optional smoke/critical/regression split

## Tier commands for any test runner (#1060)

Tiers are about speed and risk; scope is about what changed. They are separate axes, and the same names apply to every runner so each tier keeps one portal label and one set of triage rules.

| Axis | Name | Meaning |
| --- | --- | --- |
| Tier | `smoke` | Minutes. The app starts and the core path works |
| Tier | `critical` | Smoke plus the must-not-break journeys or endpoints (optional: without one, the release gate falls back to smoke) |
| Tier | `full` | Everything in the integration/E2E suite (the Playwright `regression` project) |
| Scope | `feature` | Only tests tagged with the branch's requirement (`[REQ-XXX]`) |

Unit tests are not tiered: run the whole unit suite on every PR and locally. Tiering applies to slower suites (E2E, API, integration, contract).

Each tier is a single-line shell command in `sdlc-config.json`, run from `working_directory` by the synced `scripts/run-test-tier.sh`:

| Key | Runs | Unset default (`test_runner: playwright`) |
| --- | --- | --- |
| `test_tier_smoke` | the smoke gate in `ci.yml` | `npx playwright test --project=<e2e_project>` |
| `test_tier_critical` | the critical tier in `e2e-regression.yml` | the `critical` Playwright project, or `smoke` when none is defined |
| `test_tier_full` | the full tier in `e2e-regression.yml` | the `regression` Playwright project |
| `test_feature_command` | the in-scope run in `feature-e2e.yml`; `{REQ}` is replaced with the id | `npx playwright test --grep <REQ>` |
| `test_runner` | which defaults the script uses: `playwright` or `pytest` | `playwright` |

With `test_runner: pytest` the script defaults to `pytest -m smoke`, `pytest -m "smoke or critical"`, `pytest` and `pytest -k <REQ>`, each writing JUnit XML to `$TEST_JUNIT_XML` (default `junit.xml`). A tier key always wins over the runner default, so `test_tier_smoke: "npx vitest run --project smoke"` works for Jest or Vitest. ### pytest tier workflows (`test_runner: pytest`)

Setting `test_runner` to `pytest` makes `devaudit update` generate pytest versions of `feature-e2e.yml` and (when `e2e_regression_enabled`) `e2e-regression.yml` instead of the Playwright ones, whatever the stack. They set up Python (`python_version`, else any 3.x), install the project (`pip install -e ".[dev]"` or `requirements.txt`, plus `pytest`), apply `database_*`, `e2e_env` and `e2e_setup_command` as before, and run the tier through `scripts/run-test-tier.sh`. The JUnit XML is the `e2e_result`; there is no dev server, screenshot or HTML report.

- **Names and labels are unchanged.** The workflow is still `E2E Regression`, the job `E2E Regression Suite` and the artifact `e2e-regression-report`, so the portal shows the same `E2E Critical (pre-merge)` and `E2E Regression (post-deploy production)` checks and the same triage rules apply.
- **Triggers:** critical on a PR into the release branch, the full tier after a successful production deployment or on manual dispatch (`specs` is passed to `pytest`); `feature-e2e.yml` runs the tests whose files under `tests/` mention the branch's `REQ-XXX`.
- **Markers:** register `smoke` and `critical` in `pyproject.toml` (`[tool.pytest.ini_options] markers = [...]`) and tag tests with them; tag requirements by putting `REQ-XXX` in the test name, a marker or the docstring.
- **A custom tier command must write JUnit XML to `$TEST_JUNIT_XML`**, or the evidence upload fails.
- A Python project without `test_runner: pytest` keeps the existing workflows.

A project that sets none of these keys regenerates the same inline Playwright commands as before. Setting `test_tier_critical` or `test_tier_full` replaces only the unscoped command of the regression step; the `e2e/ci-reliability/regression-run.sh` hook, the `workflow_dispatch` spec filter, the 40-minute timeout and the outcome handling stay as they were.

Set them with `devaudit configure set test_tier_smoke "<command>"` (`--dry-run` shows the regenerated workflows).

## Opting into the 3-tier regression gate

Most projects don't need this — the blocking smoke gate above is mandatory and on by default. This is an opt-in stronger safety net (a full pack that runs at ~55 minutes), for projects that want pre-merge `critical` protection and/or a post-deploy `regression` sweep on top of smoke.

1. **Flip the config and regenerate CI in one step** (devaudit-installer#876): `devaudit update --enable-e2e-regression <path>`. This sets `e2e_regression_enabled: true` in `sdlc-config.json` and syncs, which generates `e2e-regression.yml` plus the matching `compliance-evidence.yml` listener (gated per #869) — no manual JSON edit needed.
2. **Add `critical`/`regression` named projects to your own `playwright.config.ts`.** The CLI step above only flips the config and regenerates CI — it does not, and cannot generically, scaffold the actual test projects; that's real test authorship, left to the operator/agent. Without this, the generated workflow has nothing to run.
3. **Run `devaudit doctor` to self-verify.** Its existing `e2e-regression` check (`checkE2eRegressionConsistency`) catches drift between the flag and the Playwright config in either direction — flag on with no matching Playwright projects, or Playwright projects present with the flag still off.
4. **Turn it back off** with `devaudit update --disable-e2e-regression <path>` — sets the flag back to `false` and removes the generated workflow cleanly (it does not linger as dead CI content).

A plain `devaudit update` with neither flag never touches `e2e_regression_enabled` — it's pure opt-in, not something a routine sync can silently flip.

## Shared backends: a fixed concurrency group

By default `e2e-regression.yml` uses the group `${{ github.workflow }}-${{ github.ref }}` and cancels in-progress runs only for `pull_request`. The group is per ref, so a PR-to-main `critical` run, a `workflow_dispatch` run on another ref and the post-deploy `regression` run each get their own group and can run **at the same time**. If your specs mutate a **shared** backend (e.g. a shared UAT database that mutating specs restore afterwards), overlapping runs overwrite each other's data and produce flaky failures that look like regressions, and a cancelled run can leave the shared data dirty.

Set a fixed group in `sdlc-config.json` (devaudit-installer#969):

```json
"e2e_concurrency_group": "uat-e2e-data"
```

- Every trigger of `e2e-regression.yml` then shares that one group, and `cancel-in-progress` is `false` (a running job is never killed mid-mutation).
- `e2e_concurrency_cancel_in_progress: true` restores cancellation with the fixed group, if you really want it.
- Empty or absent (the default) leaves the generated workflow exactly as before.
- `ci.yml` (smoke) and `feature-e2e.yml` get no group; they are expected not to mutate shared data.

**Caveat:** GitHub keeps at most **one running and one pending** run per group. A newer queued run replaces an older queued one, so a queued PR `critical` run can be silently superseded by a later dispatch even with `cancel-in-progress: false`. A fixed group reduces overlap; it does not guarantee every queued run executes. Re-run any run that shows as cancelled by replacement.

## Before enabling: how the generated workflows use `e2e_env` and your Playwright config

Read this before putting real credentials in `e2e_env` or turning on `e2e_regression_enabled`. Four behaviours of the generated workflows interact with your own Playwright setup.

### Where `e2e_env` is applied

| Workflow | `e2e_env` scope | Notes |
| --- | --- | --- |
| `e2e-regression.yml` | **Job-wide** (every step in the job) | Merged with `database_env` and `app_env` into the job's `env:` block (`buildE2eRegressionJobEnv`). Precedence on a duplicate key: `database_env` < `app_env` < `e2e_env`. |
| `ci.yml` | **E2E steps only**: setup, dev-server start, the E2E test step and the authenticated/seed steps | `database_env` and `app_env` are still applied job-wide; `e2e_env` overrides them only on the E2E steps (`buildE2eSetupStep`, `buildE2eDevServerStep`, `buildE2eTestStep`, `buildAuthenticatedE2eStep`). |
| `feature-e2e.yml` | **E2E steps only**: the same setup, dev-server and test steps | The test step is `buildFeatureE2eTestStep`. `database_env` and `app_env` are job-wide as in `ci.yml`. |

So if `e2e_env` carries credentials for a shared or real backend, in `e2e-regression.yml` every step of the job sees them, not just the Playwright process.

### Review `globalSetup` / `globalTeardown` before pointing `e2e_env` at a real backend

When `e2e_env` carries real credentials, your Playwright `globalSetup` / `globalTeardown` (including legacy ones written when E2E only ever ran against a disposable local stack) run against **that backend**. In one consumer this meant a legacy global setup that created an admin user with a known password and a global teardown that deleted organisations by name, both of which would have executed against the real service. Before enabling, read your global setup and teardown, and guard or remove anything that creates privileged users, resets data, or deletes by name. Prefer a disposable backend (see [`e2e-local-db-ci.md`](./e2e-local-db-ci.md)).

### `feature-e2e.yml` runs every Playwright project

`feature-e2e.yml` runs `npx playwright test --grep "$REQ_ID"` with **no `--project` flag**, so every project defined in your `playwright.config.ts` runs there, not only the one named in `e2e_project`. (`ci.yml` passes `--project=<e2e_project>`; `e2e-regression.yml` passes the tier's project.) A project that must not run in that workflow, for example a destructive `regression` project or one that needs a backend the feature job does not have, needs a guard in the config. `GITHUB_WORKFLOW` holds the workflow's `name:`, which is `Feature In-Scope E2E` for this workflow:

```ts
const inFeatureE2e = process.env.GITHUB_WORKFLOW === 'Feature In-Scope E2E';

projects: [
  { name: 'smoke', /* ... */ },
  // Skip the heavy/destructive project when the feature workflow runs.
  ...(inFeatureE2e ? [] : [{ name: 'regression', /* ... */ }]),
],
```

### Keep specs under `e2e/`, or anchor your `testMatch`

The documented layout and the generated workflows assume specs live under `e2e/`. A Playwright `testMatch` glob such as `e2e/**/*.spec.ts` also matches `tests/e2e/playwright/...`, because the pattern is not anchored to the repo root. If you keep a second suite under `tests/e2e/`, set `testDir` explicitly and either anchor the pattern or add a `testIgnore` for the other tree, then check with `npx playwright test --list` that only the specs you expect are picked up.

## When a tier fails: fix or accept (devaudit-installer#1016)

A failing **required** check on the release PR (E2E first, then the dependency audit and the other required gates) blocks the release until it is **fixed or accepted with a documented exception**. Nothing at any tier is accepted automatically.

**Which run files the issue.** The `bug, priority:high` issue ("[hotfix] Post-merge regression ...") is opened only by the **post-deploy** full regression (`e2e-regression.yml`, `deployment_status` trigger, `Open hotfix issue on post-merge regression`). A failure of the critical tier on the PR into the release branch opens no issue: the `E2E Regression Suite` check goes red and the portal holds approval until the failure is resolved. The post-deploy issue is a prompt to triage; it accepts nothing and reverts nothing.

**Only `Quality Gates` is a GitHub-required check** (`cli/src/lib/branch-protection-checks.ts`; see [release playbooks, Required checks](./release-playbooks/README.md#required-checks)). `E2E Regression Suite` is a reviewer-verified item, so the hold on a release with an unresolved E2E failure comes from the portal's `execution_triage_missing` blocker and the `sdlc-implementer` `[Blocked]` stop, not from GitHub branch protection. There is no third, silent path: "known unrelated flakes" is not a disposition, and a `test-execution-summary.md` cannot read PASS while a failure is unresolved.

1. **See it early.** The `sdlc-implementer` PR watcher comments on the issue and updates the status sticky within one poll of a red required check on the release PR, and escalates after `phase4.gate_timeout_hours` (default 24).
2. **Classify.** `e2e-test-engineer` Phase 6 puts each failure in a bucket: flake, test bug, application defect, seed-data gap.
3. **Choose exactly one:**
   - **Fix**: a `fix/<issue#>-<slug>` PR into the integration branch and a green re-run on the PR head SHA. Record a verified re-run with `report-test-execution.sh resolve --resolution-type retry_passed --resolved-by-cycle-id <passing cycle>`. When the release PR's head is the integration branch, the fix moves that head and re-runs the release checks; that is expected.
   - **Accept**: copy `.claude/skills/sdlc-implementer/references/e2e-accepted-failure.md.template` to `compliance/evidence/REQ-XXX/accepted-e2e-failure-<spec>.md` and fill it in: the failing specs, CI run and SHA, evidence of the classification, an **impact assessment** (affected journeys and requirements, data/security/compliance exposure, blast radius, likelihood and severity, compensating controls), why it does not block this release, the decision-maker, a **review date in the future**, and a **tracking issue** labelled `accepted-e2e-failure` whose body carries `Review by: YYYY-MM-DD`. `scripts/validate-risk-acceptance-record.sh --kind e2e <record>` rejects an unedited or incomplete record. It is never created automatically: the operator decides.
4. **Record it in the portal without touching the release head.** `report-test-execution.sh resolve` clears the portal's `execution_triage_missing` directly: `--resolution-type accepted_exception` now **requires** `--remediation-reference <tracking issue>` and `--record <record>` (validated before any network call). A compliance-record PR into the integration branch is optional and must never be a prerequisite for the release PR going green. The portal also records the same `accepted_exception` disposition on the release check of that run, when exactly one undispositioned check of the run has the failed outcome (metasession-dev/devaudit#904); otherwise waive the check from the release page. A **cancelled** run needs no triage when a later run in the same SDLC stage passes: the portal resolves it as `superseded` automatically (devaudit#903). Failed and timed-out runs still need a matching retry or a decision.
5. **Refresh the summary.** Regenerate `test-execution-summary.md` after the release PR's CI is terminal and after every re-run, triage, fix or deferral: the `CI as of: <run>/<attempt> @ <sha>` stamp, the Test executions table from `render-test-executions.sh` (every CI attempt, including a failed attempt 1 that attempt 2 superseded) and the `## E2E failures & triage` table. `validate-test-summary.sh` fails a failure that has no row, a row without a valid classification/disposition/reference, a stamped summary without the generated table or older than the PR head (`DEVAUDIT_PR_HEAD_SHA`), and, when the CI results are available (`E2E_RESULTS_JSON`), a mismatch with them (`reconcile-e2e-summary.sh`). A summary without the stamp still passes, with a warning, so releases already in flight are not broken.
6. **Stay honest over time.** `devaudit doctor` (`accepted-exceptions`) flags an open `accepted-e2e-failure` issue past its review date or without one; `fleet-doctor` reads it from the doctor JSON.

**Deferring instead.** If the work should not ship now, close the release PR unmerged and declare `- **Release intent:** deferred-to-next - <reason>` on the release ticket. The RTM row becomes `DEFERRED` (non-terminal) and `check-deferred-reqs-in-range.sh` fails any later `develop -> main` PR that contains the deferred REQ's commits unless the release ticket lists it under `Absorbed predecessor releases`. See [release playbooks, Deferred releases](./release-playbooks/README.md#deferred-releases).

## Screenshot density across tiers

DevAudit also distinguishes between feature-proof captures and regression-proof captures:

- feature runs can record denser screenshot evidence to prove a new flow
- regression runs should keep the canonical proof points and avoid re-capturing low-value intermediate noise

That distinction is carried through the `evidenceShot` helper and the `feature` vs `regression` origin metadata.

## Practical guidance

- Put the fastest, highest-signal journeys into smoke.
- Promote only genuinely business-critical paths into critical.
- Keep the full pack for regression, then use failures there to decide whether a spec should be promoted upward.
- Do not use regression-size suites as a per-push gate if the feedback cost becomes the dominant burden.

## See also

- [`docs/e2e-local-db-ci.md`](./e2e-local-db-ci.md)
- [`docs/compliance-gates.md`](./compliance-gates.md)
- [`sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`](../sdlc/files/_common/skills/e2e-test-engineer/SKILL.md)
