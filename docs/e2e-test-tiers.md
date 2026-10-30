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

The three-tier model is generated: `e2e-regression.yml` is produced from `sdlc-config.json` when `e2e_regression_enabled` is true (opt in with `devaudit update --enable-e2e-regression`), together with its tier commands, release gate, nightly run and post-deploy run. The reference copy in the `e2e-test-engineer` skill materials and [`docs/e2e-local-db-ci.md`](./e2e-local-db-ci.md) (safe local/disposable backends in CI) remain useful background.

## Test data (#1116)

Where each tier gets its data is declared, not assumed. DevAudit owns the contract, the checks and the run record; the project owns the seed and reset code (the `e2e-test-data` skill helps write it).

| Key | Meaning |
| --- | --- |
| `e2e_data_isolation` | `none`, `ephemeral` (a fresh database per run), `shared_serialised` (an environment only the tests use, one run at a time), `shared` (other people use it too), `unknown` |
| `e2e_seed_command`, `e2e_seed_paths` | The seed, and the git-tracked files/folders that hold it (their hash tells when it changed) |
| `e2e_reset_command` | Puts the data back; also run after the tests, best effort, for a run that was killed |
| `e2e_preflight_command` | Exits non-zero when the fixtures the tests need are absent; a failed preflight **fails the run**, it is never turned into a skip |
| `e2e_leak_check_command` | Prints the number of rows left behind on its last line; recorded, never changes the outcome |
| `e2e_max_skipped` | Fails the run (and so the release gate) when more tests than this skipped; unset reports only |
| `feature_e2e_projects` | Limits the feature-PR run to these Playwright projects (default all) |

With `e2e_data_isolation` set and not `none`, `e2e-regression.yml` runs `scripts/e2e-data-lifecycle.sh` after the setup step (reset, seed, preflight) and after the tests (reset, leak check, skip budget); the smoke run in `ci.yml` and the feature run do not. With it unset, `none` or `unknown` the workflows are unchanged, even when `e2e_seed_command` is set. The run record is the `data` object in `e2e-regression-metadata.json` (`isolation`, `seedCommit`, `seedFilesHash`, `reset`, `preflight`, `leakCheck`, `workers`, `skipped`); it never holds a host name, URL, credential or row contents, and it is also sent to the portal as `runData`. `devaudit doctor` reports the `test-data` findings (see [`doctor.md`](./doctor.md)).

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

With `test_runner: pytest` the script defaults to `pytest -m smoke`, `pytest -m "smoke or critical"` and `pytest`, each writing JUnit XML to `$TEST_JUNIT_XML` (default `junit.xml`). A tier key always wins over the runner default, so `test_tier_smoke: "npx vitest run --project smoke"` works for Jest or Vitest. For the pytest **feature scope** the script runs the test files under `tests/` that mention the requirement id anywhere (title, docstring, comment or marker), with an exact-id match (`REQ-11` does not select `REQ-111`); a requirement that no file mentions is an error, never a silent full run. It does not use `pytest -k`, which only sees test, class and marker names and can never match `REQ-042`.

Jest and Vitest have no built-in default. `devaudit install` proposes editable commands for a detected Jest or Vitest repo, and the `e2e-test-engineer` skill's `references/tiers-per-runner.md` shows the directory convention and the `[REQ-XXX]` title tag each tier command relies on.

### pytest tier workflows (`test_runner: pytest`)

Setting `test_runner` to `pytest` makes `devaudit update` generate pytest versions of `feature-e2e.yml` and (when `e2e_regression_enabled`) `e2e-regression.yml` instead of the Playwright ones, whatever the stack. They set up Python (`python_version`, else any 3.x), install the project (`pip install -e ".[dev]"` or `requirements.txt`, plus `pytest`), apply `database_*`, `e2e_env` and `e2e_setup_command` as before, and run the tier through `scripts/run-test-tier.sh`. The JUnit XML is the `e2e_result`; there is no dev server, screenshot or HTML report.

- **Names and labels are unchanged.** The workflow is still `E2E Regression`, the job `E2E Regression Suite` and the artifact `e2e-regression-report`, so the portal shows the same `E2E Critical (pre-merge)` and `E2E Regression (post-deploy production)` checks and the same triage rules apply.
- **Triggers:** the `release_gate_tier` tier (default critical) on a PR into the release branch, the full tier after a successful production deployment, on the `scheduled_full_regression` schedule or on manual dispatch (`specs` is passed to `pytest`); `feature-e2e.yml` runs the tests whose files under `tests/` mention the branch's `REQ-XXX`.
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

> **Where the values come from.** A `${{ secrets.X }}` in `e2e_env` is read from a repository (or organisation) secret; a secret that exists only inside a GitHub environment, or has a different name, reads as empty and the dev server then fails to start. See [Where the values live](./e2e-local-db-ci.md#where-the-values-live-secrets-and-variables); the regression and feature workflows name any empty value in a `Check configuration values` step before the dev server starts (#1160).

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

### Which runs count before approval

The portal marks an acceptance criterion "tested" only from Playwright JSON results (`e2e_result` / `test_report`) whose test is tagged to that AC. Screenshots alone leave it "untested". Three runs upload results before a release is approved:

1. **The feature-PR run** (`feature-e2e.yml`): `npx playwright test --grep "<REQ>"` with no `--project`, so every Playwright project runs, `regression` included; the title selects the test (next section). Results are uploaded as `e2e_result`.
2. **The smoke run on the integration-branch push** (`ci.yml`): the `e2e_project` only.
3. **The release-PR gate tier** (`e2e-regression.yml`): `critical` by default, per `release_gate_tier`.

`devaudit doctor` (`test-tiers`) now reads each in-flight requirement's plan (`## 1. Goal + acceptance criteria`, `AC<n>` rows; `@e2e-deferred` rows skipped), lists the project tests with `playwright test --list --reporter=json` and reports per AC: **covered**; **screenshot-but-no-test** (a `compliance/evidence/<REQ>/screenshots/<REQ>-AC<n>-*.png` but no test titled `[REQ-XXX][ACn]`); **no-test**; or **covered, not re-run on the release PR** (information: its only test is in a project outside the smoke and release-gate projects). The first two are tier C findings with three options: add or retitle a test, raise the gate (`devaudit configure set release_gate_tier full`), or mark the AC not applicable on the portal with a reason. The check is static and local (no portal call, no PAT), never blocks a release, and is skipped for non-Playwright runners. The `sdlc-implementer` skill lists the findings in the Phase 4 handoff.

### Tagging for the feature run: the title carries the id

The feature-PR run selects tests with `--grep REQ-XXX`, which matches the **test title** (including enclosing `describe` titles), never an annotation. So every Playwright test covering a requirement needs both: `[REQ-XXX]` (and `[ACn]` where it proves an AC) in the title or a describe, **and** `tagTest('REQ-XXX', n)` in the body (the portal's join key). A test with only the annotation is silently left out of the feature run. `scripts/check-req-title-tags.sh [--req REQ-XXX]` reports every `tagTest()` call whose test and describes lack the id (`file:line: ...`, exit 1); the `e2e-test-engineer` skill runs it in Phase 5½ and does not continue while it reports offenders. It parses titles statically, so titles built at run time are not supported, and `REQ-11` does not satisfy `REQ-111`. Running whole spec files instead is possible through `test_feature_command` and is not the default.

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

## Choosing the release gate (#1059)

By default the full regression runs only **after** the production deploy, so a failure in the full pack surfaces once production is live. Best practice is to test the release candidate before it ships and keep the post-deploy run as a safety net. The trade-off is time (the full pack can take about an hour) and long-run flakiness, so the choice is per project:

| Key | Values | Default (today's behaviour) |
| --- | --- | --- |
| `release_gate_tier` | `none`, `smoke`, `critical`, `full`: the tier that runs on the PR into the release branch | `critical` when `e2e_regression_enabled` |
| `post_deploy_full_regression` | `true`, `false`: run the full regression after a successful production deployment | `true` |
| `scheduled_full_regression` | a five-field cron expression, or empty | off |

Recommended combinations:

- **Strictest (preset D):** `release_gate_tier: full` and `post_deploy_full_regression: false`. The release candidate is fully tested before merge and the same commit is not tested twice. Slowest.
- **Earlier signal:** keep `critical`, add `scheduled_full_regression: "0 3 * * *"` (nightly) and leave the post-deploy run on. Today's behaviour plus an early warning.
- **No E2E suite yet:** `smoke` or `none`.

Set them with `devaudit configure set release_gate_tier full` (validated; `--dry-run` shows the regenerated workflows). They need `e2e_regression_enabled`; with the workflow disabled they have no effect. With none of the three set nothing changes, and `devaudit update` never changes the gate on its own.

What the keys change in the generated workflows:

- `e2e-regression.yml` triggers: the pull request into the release branch (unless `none`), the post-deploy run (unless switched off) and the schedule; manual dispatch is always available. The run records the tier it executed in `e2e-regression-metadata.json`.
- `compliance-evidence.yml` reads that tier. The portal checks keep stable, distinct labels: `E2E Smoke (pre-merge)`, `E2E Critical (pre-merge)`, `E2E Full (pre-merge)` (all required) and `E2E Regression (post-deploy production)` (not required). For a project that configured `release_gate_tier` it also reports one run-level check, `e2e-release-gate`, labelled `E2E Release Gate (<tier>)`, with the tier and the head SHA in its details; the same key is reused on every re-run so a later success supersedes an earlier failure.
- `check-release-approval.yml` sends the configured tier to the portal as `releaseGateTier` on the release PR (only when configured), so the portal can require the gate before approval. It also sends the PR head commit as `prInfo.headSha` on every push to a release PR, so the portal can tell whether the gate ran on the current head: a gate that ran on an earlier commit counts as stale. The head SHA is the pull request's head commit, never the synthetic merge commit. **Deploy the portal first** (its migrations for the gate and the head SHA).
- A **scheduled run is not release evidence.** It runs on the integration branch, is never uploaded to the portal and can neither attach to a release nor raise a triage blocker. A failed scheduled run opens (or comments on) one `bug` issue titled `[scheduled regression] Full E2E failing on <integration branch>`.

`devaudit doctor` reviews the choice through two read-only checks, `e2e-release-gate` and `test-tiers` (see [doctor.md](doctor.md)): it proposes, you decide, and a change goes through `devaudit configure` and a normal PR.

#### Worked example: moving the full regression before merge

```bash
devaudit doctor                                    # e2e-release-gate: "median E2E Regression run is 14 min: the full tier is affordable before merge"
git switch -c fix/<issue#>-release-gate-full develop
devaudit configure set release_gate_tier full --dry-run     # validation, the three workflows it regenerates
devaudit configure set release_gate_tier full
devaudit configure set post_deploy_full_regression false    # doctor's note: otherwise the same commit is tested twice
devaudit update                                    # regenerates e2e-regression.yml, compliance-evidence.yml, check-release-approval.yml
devaudit doctor                                    # e2e-release-gate is clean; test-tiers still resolves the full tier
```

Commit the config and the regenerated workflows on that branch and open a PR to the integration branch; the next release PR runs the full tier and the portal requires its `E2E Release Gate (full)` check on the PR head. The `devaudit-configure` skill walks through the same steps in Claude Code. If doctor says a tier collects no tests, that is work for the `e2e-test-engineer` skill, not a setting.

The fix, accept or defer rules in [When a tier fails](#when-a-tier-fails-fix-or-accept-devaudit-installer1016) apply unchanged, now to whichever tier runs on the release PR. `E2E Regression Suite` stays a reviewer-verified check, not a GitHub branch-protection context.

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
