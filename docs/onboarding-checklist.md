# Checklist: set up, review and maintain an onboarded project

A short checklist for an operator who has run `devaudit install` and wants the SDLC to implement an issue the way the project intends. Each step points to the document that holds the detail. Current behaviour lives in the code and templates: `cli/src/lib/repo-config-keys.ts` (the keys `configure` manages) and `sdlc/files/sdlc-config.example.json` (every key, with comments).

## 1. Start with the latest version of devaudit

`devaudit doctor` does not tell you the CLI is out of date (tracked in #1265), and the files `install` and `update` write come from the templates bundled in the CLI you run. An old CLI syncs old workflows and scripts, and `doctor` still passes. So check first:

```bash
devaudit --version                                   # what you have
npm view @metasession.co/devaudit-cli version        # what is published
npm install -g @metasession.co/devaudit-cli@latest   # upgrade a global install
```

`devaudit_synced_version` in `sdlc-config.json` records the version that last synced the project's files. If it is older than the published version, run `devaudit update` with the latest CLI and review the diff.

### When to use `npx` instead of a global install

`npx @metasession.co/devaudit-cli@latest <command>` downloads and runs the newest published CLI for that one command, with no global install to keep current. Use it when:

- **You have no global install, or are not sure it is current.** `npx @metasession.co/devaudit-cli@latest doctor` checks the project with the newest checks, including ones added after your installed version. It is the quickest way to see whether the project has drifted from what the current framework expects.
- **You want to review or change configuration with the current key list and validation.** `npx @metasession.co/devaudit-cli@latest configure` (or `configure list`, `configure set <key> <value> --dry-run`) knows the newest keys and allowed values. An older CLI refuses keys it does not know, or validates a value against stale rules.
- **You are running `install` or `update`.** These write the framework files, so they must come from the newest templates.
- **You are in CI, on a shared machine, or trying a command once.** Nothing is left installed.

Node 22 or later is required either way. For daily use, a global install is faster to start; refresh it with the `npm install -g` command above.

## 2. Verify the install

- `devaudit doctor` checks tools, the onboarding invariants, the deploy host, the production URL, the runner, the release gate, the test tiers, the test data and the Stage 3 evidence. See [`doctor.md`](./doctor.md).
- `devaudit doctor --fix --dry-run` lists the repairs; `--fix` applies them. `--explain <check>` and `--guided` explain a finding.
- `devaudit status .` confirms the framework files are present. A second developer runs `devaudit join`, not `install` ([`joining-an-existing-project.md`](../sdlc/files/_common/joining-an-existing-project.md)).
- Repeat `doctor` after every configuration change.

## 3. Review `sdlc-config.json`

Use `devaudit configure list`, `get <key>` and `set <key> <value> --dry-run`. The dry run names the generated workflows the next `devaudit update` rewrites. `devaudit configure` with no arguments asks the guided questions with the current values as defaults ([`configure.md`](./configure.md)).

| Area | Key | Values you can apply | What it decides |
| --- | --- | --- | --- |
| Branches and deploy | `integration_branch` | any branch name (default `develop`) | Where implementation PRs land and where gate evidence is uploaded. |
| | `release_branch` | any branch name (default `main`) | The protected production branch the integration branch is promoted to. |
| | `host` | `railway`, `vercel`, `custom` | Which host adapter generates the deploy and reconcile workflows. A wrong value generates the wrong workflows. |
| | `production_url_secret` | a repo secret name: upper case letters, digits and `_`, starting with a letter | The secret holding the production URL used by the post-deploy probe. |
| | `runner` | `self-hosted` (the runner is read at run time from the `CI_RUNNER_LABEL` variable; the value `github-ci` there means `ubuntu-latest`), or any fixed `runs-on` label such as `ubuntu-latest` | Which machine runs CI. Cannot be empty. |
| | `deploy_command`, `deploy_secrets`, `deployed_sha_url`, `deployed_sha_jq`, `deploy_trigger` | a one-line command; a list of secret names; an `https://` URL; a `jq` expression; `push_to_main`, `git_tag` or `manual` | Only for `host: custom`: how the deploy runs and how the deployed commit is read back. Setting them on another host is a warning. |
| Preset | `onboarding_preset` | `A`, `B`, `C`, `D`, `custom` (missing means `custom`) | The recorded bundle of gate strictness and approver (see [`presets.md`](./presets.md)). A solo and fast; B critical tests block, full pack after deploy; C a second approver and the full tests block; D as C, with the full pack run once, before merge. |
| | `compliance_frameworks` | a list of `soc-2`, `iso-27001`, `iso-29119`, `gdpr`, `eu-ai-act`, or empty | The standards the project needs evidence for. The portal's claimed standards win when they differ. |
| Approval | `approval.mode` | `dual_actor` (default: the approver differs from the author), `solo_with_gap` (the author approves, with a recorded control gap) | Who may approve a release. |
| | `release_branch_required_reviews` | `0`, `1` (default), `2` | Approving reviews GitHub requires on the release branch. `0` lets the author merge their own release PR. Lowering an existing branch asks for confirmation. |
| | `production_review.terminal_status` | `prod_review` (default: a person confirms production), `released` (completes automatically) | Where `post-deploy-prod.yml` leaves a release. |
| Test tiers | `test_runner` | `playwright` (default), `pytest` | Which runner's defaults the tiers use. |
| | `test_tier_smoke`, `test_tier_critical`, `test_tier_full` | a single-line shell command, at most 500 characters; unset keeps the runner default (Playwright: the `smoke`, `critical` and `regression` projects) | What each tier runs. A custom pytest command must write JUnit XML to `$TEST_JUNIT_XML`. |
| | `test_feature_command` | a single-line command containing `{REQ}`; unset keeps the default (`--grep` for the id) | What the feature-scope run executes for a branch's requirement. |
| | `e2e_project` | a Playwright project name | The project of the blocking smoke gate. |
| | `e2e_projects` | a list of Playwright project names, or empty | Projects that need a logged-in session (report-only gate). |
| Release gate | `e2e_regression_enabled` | `true`, `false` (set with `devaudit update --enable-e2e-regression` or `--disable-e2e-regression`, not `configure set`) | Whether the three-tier workflow `e2e-regression.yml` exists. The other release-gate keys need it on. |
| | `release_gate_tier` | `none`, `smoke`, `critical`, `full` (unset means `critical`) | The tier that must pass on the PR into the release branch. `full` can take about an hour. |
| | `post_deploy_full_regression` | `true` (default), `false` | Whether the full pack runs after a production deploy. Set `false` when `release_gate_tier` is `full`, so the same commit is not tested twice. |
| | `scheduled_full_regression` | a five-field cron expression such as `0 3 * * *`, or empty for no schedule | A timed full run on the integration branch. It is not release evidence and never blocks approval. |
| | `e2e_regression_timeout_minutes` | a whole number above 0 (default 55) | Job timeout of the regression workflow. |
| | `e2e_concurrency_group`, `e2e_concurrency_cancel_in_progress` | a group name or empty; `true`, `false` (default) | Queue runs instead of overlapping them when the tests change a shared backend. |
| Test data | `e2e_data_isolation` | `none`, `ephemeral` (a fresh database per run), `shared_serialised` (a shared environment only these tests use, one run at a time), `shared` (others use it too); unset keeps today's behaviour | Where the tests get their data. Anything other than `none` makes the workflow run the reset, seed and preflight steps around the tests. |
| | `e2e_seed_paths` | a list of files or folders held in version control | Where the seed lives. |
| | `e2e_reset_command`, `e2e_preflight_command`, `e2e_leak_check_command` | a single-line shell command, or empty to unset | Reset the data; fail the run when the seed fixtures are absent; print the rows left behind. |
| | `e2e_seed_command`, `e2e_setup_command` | a shell command, or empty | Seed fixtures before the run; stand up a disposable local database before the dev server. |
| | `e2e_max_skipped` | a whole number, 0 or more | The most skipped tests a run may have. |
| | `feature_e2e_projects` | a list of Playwright project names (unset runs all) | Which projects the feature-PR run uses. |
| | `e2e_report_include_traces` | `true`, `false` (default) | Keep traces and videos in the Playwright report zip uploaded as evidence. Off keeps the zip under the portal's upload cap. |
| | `e2e_env`, `e2e_start_command`, `e2e_port` | an object of env values (may reference `${{ secrets.NAME }}`); a command; a port above 0 (default 3000) | The environment, dev-server start and port for the E2E steps. Override every remote key to keep production severed. |
| UAT | `uat.enabled` | `true`, `false` (default `false`) | Whether the UAT-environment verification step (Stage 3 Step 10) applies at all. Edit in `sdlc-config.json`; `configure set` does not manage it. |
| | `uat.url`, `uat.required_risk_classes` | a URL; a list of `payment`, `destructive_migration`, `realtime`, `physical_ux`, or `["*"]` for every requirement | The UAT environment, and which requirements must be verified on it. Edit in the file. |
| | `uat.human_pack` | `risk` (default: MEDIUM risk and above), `always`, `never` | When the human UAT pack (briefing, procedure, execution record) is written. `never` is a compliance cost the product owner owns. |
| | `uat.mode` | `manual` (default: a tester runs the procedure), `auto` (the agent runs it, a named independent human reviews and signs) | Who executes the pack. `doctor` warns when `auto` is combined with `solo_with_gap`, or when `uat.enabled` is not `true`. |
| Build | `node_version`, `python_version`, `working_directory` | a version string; a version string; a directory relative to the repo root | The CI toolchain and where the app lives. |
| | `source_dirs`, `sast_baseline`, `accepted_dep_risks` | space-separated directories; a whole number, 0 or more; text | What SAST scans, the number of accepted pre-existing findings, and accepted dependency risks. |
| | `install_flags`, `typescript_check_env` | for example `--legacy-peer-deps`; an object such as `{ "NODE_OPTIONS": "--max-old-space-size=4096" }` | Flags appended to `npm ci`; env for the TypeScript check step only. |
| | `database_service`, `database_image`, `database_port`, `database_env`, `app_env`, `build_env` | for example `postgres` or `mongodb`, an image name, a port, and objects of env values; empty for no database | The CI database service and the env for the app, tests and build. |
| | `paths_ignore` | a list of globs | Paths that do not trigger CI on push. |

Set secrets with `devaudit configure secret <NAME>`; the value never passes through devaudit.

### Production checks and the deploy host

After a production deploy, `post-deploy-prod.yml` does three things, and all three depend on the `host` and production settings above:

1. **Verifies the deploy with the host.** It waits for the GitHub deployment the host records and checks it succeeded.
2. **Probes production health independently.** It requests `<production URL>/` up to 30 times, ten seconds apart, and needs a 2xx or 3xx answer. The URL comes from the repo secret named by `production_url_secret`.
3. **Runs the production smoke checks and records the evidence** in the portal. They run only when both the host verification and the health probe succeeded; the release then moves to production review (or straight to released, per `production_review.terminal_status`).

Set up each host as follows, then run `devaudit update && devaudit doctor`. Use `--dry-run` first to see which workflows change.

| Host | Configure | Secrets | Notes |
| --- | --- | --- | --- |
| `railway` (the default) | `devaudit configure set production_url_secret <NAME>` | the production URL secret; `RAILWAY_TOKEN` (advisory) | Railway's own deploy triggers on push to the release branch. `RAILWAY_TOKEN` and the `railway` CLI are used only by the manual recovery workflow `reconcile-deployment.yml`, for when Railway's `deployment_status` event never reaches GitHub. |
| `vercel` | `devaudit configure set host vercel`, then `production_url_secret` | the production URL secret; `VERCEL_TOKEN` (advisory, plus `VERCEL_TEAM_ID` for a team project) | Vercel's Git integration deploys on push. The token is used only by the recovery workflow. If production sits behind Deployment Protection, also set `DEVAUDIT_PROBE_HEADER` (below). |
| `custom` (AWS, self-hosted, Fly.io, Kubernetes) | `host custom`, `deploy_command`, `deploy_secrets`, `deployed_sha_url`, `deployed_sha_jq`, `deploy_trigger`, `production_url_secret` | every name listed in `deploy_secrets`; the production URL secret | Your deploy runs in the generated `deploy-custom.yml`, which records the GitHub deployment the gate waits for. `deployed_sha_url` (https) with `deployed_sha_jq` lets the check confirm the deployed commit; without them the deploy is verified by the health check only. |

- **The production URL secret.** Pick the name, set the value with `devaudit configure secret <NAME>`, and record the name with `devaudit configure set production_url_secret <NAME>`. `doctor` (`production-url`) checks that the name is set and the secret exists. It never reads the value.
- **Production behind an access gate** (Vercel Deployment Protection, basic auth, an IP allow-list). An unauthenticated probe sees 401, 403 or 407 and the check fails. Set the optional secret `DEVAUDIT_PROBE_HEADER` to one full header line, for example `x-vercel-protection-bypass: <token>`. The probe and the smoke checks send it. Unset means unauthenticated probes. `doctor` warns when production answers 401, 403 or 407 and the header is missing.
- **Wrong host recorded.** Projects onboarded before 1.9.0 have `host: railway` whatever they use. `doctor` (`deploy-host`) compares the recorded host with who actually creates the production deployments and the committed host files, and `devaudit doctor --fix` corrects it. Changing a host the evidence contradicts needs a reason.
- **Runner.** `runner: self-hosted` reads the `CI_RUNNER_LABEL` variable at run time. `doctor` (`ci-runner`) checks a runner with that label is registered.
- **Recipes.** Full command sequences for Vercel, `custom`, the runner and the release gate are in [`configure.md`](./configure.md#recipes), and the per-host prerequisites in [`onboarding.md`](./onboarding.md#host-adapter-prerequisites). In Claude Code, the `devaudit-configure` skill walks through it ("we deploy on Vercel", "our production is behind Vercel protection").
- **Verify.** `doctor` checks `deploy-host`, `production-url`, `custom-deploy` (host `custom` only), `ci-runner` and `secrets`. The first real proof is the first production deploy, so watch that `post-deploy-prod.yml` run reach the smoke checks.

## 4. Make the SDLC implement an issue as intended

- Give each issue a risk class, acceptance criteria (ACs) and a requirement id. The `sdlc-implementer` skill triages it into tracked work or the lightweight (housekeeping) path.
- At plan approval, `scripts/show-sdlc-config.sh <RISK>` prints what the configuration will do for that issue: who approves, what blocks the release PR, what runs after deploy, whether UAT applies. Read it before approving the plan; if it is not what you want, change the configuration first.
- Tracked work follows the stages in `sdlc/files/_common/0-project-setup.md` to `5-deploy-main.md`. Branches are `feature/<issue#>-<slug>` or `fix/<issue#>-<slug>`, PR'd into the integration branch; the integration branch goes to the release branch by PR.
- Keep the AI rule files (`CLAUDE.md` and the others) accurate for the project; the agent follows them.

## 5. SRS, requirements traceability and tests

- **SRS (`docs/SRS.md`).** Each requirement is a `REQ-AREA-NNN` entry with testable ACs. For an existing codebase, bootstrap it from current behaviour first (Step 3b in [`onboarding.md`](./onboarding.md)). The `requirements-aligner` skill then runs at plan approval and at evidence time, proposes stubs for behaviour the SRS does not describe and flags drift ([`skills.md`](./skills.md)).
- **Risk and decisions.** Each requirement needs a risk class in its traceability row. It drives the UAT pack, `risk-register-keeper` entries and `adr-author` ADRs.
- **Tests.** The `e2e-test-engineer` skill bootstraps or maintains the pack; `e2e-test-data` owns seeds, resets and leak checks; `e2e-ci-reliability` diagnoses long-run failures that differ each time.
- **Tagging.** Every test that covers a requirement needs `[REQ-XXX]` (and `[ACn]`) in its title or a describe, and `tagTest('REQ-XXX', n)` in its body. The feature run matches titles; the portal matches the tag; screenshots alone leave an AC "untested". `scripts/check-req-title-tags.sh` reports offenders ([`e2e-test-tiers.md`](./e2e-test-tiers.md)).
- **No tests yet.** Follow "Starting with no tests" in [`onboarding.md`](./onboarding.md).

## 6. Run each test tier once to prove the setup

Do this before relying on the gates: a gate that has never run may be red on the first real PR, or may select no tests and pass for the wrong reason. Run the tiers from the cheapest up, and read the test list as well as the result.

1. **List what each tier selects, without running it.** `devaudit doctor` (`test-tiers` check) collects the tests for every tier the project declares and reports a tier that resolves to none. To see the command: `RUN_TEST_TIER_DRY_RUN=1 scripts/run-test-tier.sh smoke` (also `critical`, `full`, `feature REQ-XXX`).
2. **Smoke, locally.** `scripts/run-test-tier.sh smoke`. It must pass and be fast (minutes). It is the blocking Quality Gates check on every PR.
3. **Critical and full, locally if the data allows.** `scripts/run-test-tier.sh critical`, then `full`. If `e2e_data_isolation` is not `none` or unset, the data lifecycle (reset, seed, preflight) must be set up first (`e2e-test-data` skill), so the run never touches production.
4. **Then run them in CI, where the real environment is.** With `e2e_regression_enabled`, dispatch the regression workflow on the integration branch: `gh workflow run e2e-regression.yml --ref <integration-branch>` (the `specs` input is a spec list or `--grep` pattern; empty runs the full pack), and watch it with `gh run watch`. The smoke tier runs on any PR (`ci.yml`). The feature tier needs a branch named for a requirement and a test tagged for it, so open a small PR on `feature/<issue#>-<slug>` for a REQ that has tagged tests and check that `feature-e2e.yml` selected them.
5. **Check the evidence arrived.** Each run uploads results to the portal. A tier that passes in CI but whose ACs still show "untested" in the portal is missing `tagTest('REQ-XXX', n)` (section 5).
6. **Fix before moving on.** A failure on the first run is usually environment (data, secrets, `e2e_env`, runner), not the app: use `e2e-ci-reliability` for long-run failures that differ each time, and do not lower a gate to get green.

Re-run `devaudit doctor` after the first full pass, and again after any change to a tier command.

## 7. Using an AI agent for the SRS and the tests

The framework ships skills to the project (`.claude/skills/` and the equivalents for other agents). Ask the agent in plain words and name the skill, so it follows the framework's procedure instead of improvising. Always review what it writes: it proposes, you decide. The agent should read the project's own `CLAUDE.md` first, and it should show the diff and the command output rather than summarise.

**SRS up to date** (`requirements-aligner`)

- "Use the requirements-aligner skill to bootstrap `docs/SRS.md` from the current behaviour of this codebase. List the proposed `REQ-AREA-NNN` entries with their acceptance criteria and wait for my approval before writing."
- "Run requirements-aligner on issue #123. For each acceptance criterion, say whether the SRS already describes it, and propose stubs for the ones it does not."
- "Compare `docs/SRS.md` with the code and the traceability matrix. List requirements with no test, tests that name a requirement the SRS no longer has, and behaviour in the code with no requirement. Do not edit anything yet."

**E2E tests up to date and set up properly** (`e2e-test-engineer`, `e2e-test-data`)

- "Use the e2e-test-engineer skill to assess this project's e2e setup: detect the stack, the Playwright projects (`smoke`, `critical`, `regression`) and how each tier maps to `sdlc-config.json`. Report gaps and propose the fixes in order."
- "No e2e suite exists. Use e2e-test-engineer to bootstrap one for the detected stack, starting with a smoke test of the core path, and tag each test with `[REQ-XXX]` in the title and `tagTest('REQ-XXX', n)`."
- "For REQ-014, derive the scenarios its acceptance criteria need, add or update the tests, retire any that no longer apply, and run `scripts/check-req-title-tags.sh --req REQ-014`."
- "Use e2e-test-data to set up where the tests get their data: propose `e2e_data_isolation`, the seed, reset, preflight and leak-check commands, and show me before changing `sdlc-config.json`."

**Configuration and first run**

- "Run `devaudit doctor` and explain each finding in plain words. Apply nothing yet; show `devaudit doctor --fix --dry-run` and tell me which proposals you would apply and why."
- "Use the devaudit-configure skill to review `sdlc-config.json`: tell me what each test-tier, release-gate, UAT and approval setting does today, and what happens for a HIGH-risk issue. Propose changes as `devaudit configure set ... --dry-run` commands."
- "Run each test tier once as in section 6 of `docs/onboarding-checklist.md`: print what each selects, run smoke locally, then dispatch the regression workflow and report the results and any failure's cause."
- "Run `scripts/show-sdlc-config.sh MEDIUM` and tell me whether what it describes is what this project wants."

**Tips**

- Give the agent the issue number or REQ id, and say what "done" means (the tests pass, the SRS entry is approved, `doctor` is clean).
- Keep it to one job per request. Review the SRS change before the tests that depend on it.
- Do not let the agent change a gate, a skip budget or an approval setting to make a run pass. Those are your decisions.

## 8. Also consider

- **Portal.** Sign-in, `DEVAUDIT_API_KEY`, plan limits, and the approval policy and claimed standards, which `doctor` compares with the local configuration (the portal wins).
- **GitHub.** Branch protection and required checks on the release and integration branches ([`branch-protection-setup.md`](./branch-protection-setup.md)).
- **Runner.** Hosted or self-hosted, and the `CI_RUNNER_LABEL` variable ([`self-hosted-runner-ci.md`](./self-hosted-runner-ci.md)).
- **Governance documents** for the standards you claim: RoPA, DPIA, AI disclosure, periodic review ([`governance-templates.md`](./governance-templates.md)).
- **Deploy checks.** A health probe, and a bypass header if production sits behind an access gate.
- **Drift.** Re-run `devaudit update` after each framework release, and `devaudit doctor --fleet` across several projects.
- **Pilot.** Run one low-risk issue end to end before relying on the setup.
