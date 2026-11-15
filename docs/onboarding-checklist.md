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

| Area | Keys | What they decide |
| --- | --- | --- |
| Branches and deploy | `integration_branch`, `release_branch`, `host`, `production_url_secret`, `runner`; for `custom`: `deploy_command`, `deploy_secrets`, `deploy_trigger` | Where PRs land and where production deploys. A wrong `host` generates the wrong workflows. |
| Preset | `onboarding_preset`, `compliance_frameworks` | The bundle of gate strictness and approver ([`presets.md`](./presets.md)). |
| Approval | `approval.mode`, `release_branch_required_reviews`, `production_review.terminal_status` | Who may approve a release. Solo approval records a control gap. |
| Test tiers | `test_runner`, `test_tier_smoke`, `test_tier_critical`, `test_tier_full`, `test_feature_command` (needs `{REQ}`), `e2e_project`, `e2e_projects` | What smoke, critical and full run ([`e2e-test-tiers.md`](./e2e-test-tiers.md)). |
| Release gate | `e2e_regression_enabled` (change it with `devaudit update --enable-e2e-regression` or `--disable-e2e-regression`), `release_gate_tier`, `post_deploy_full_regression`, `scheduled_full_regression` | What blocks the PR into the release branch, and what runs after the deploy and on a schedule. |
| Test data | `e2e_data_isolation`, `e2e_seed_paths`, `e2e_reset_command`, `e2e_seed_command`, `e2e_preflight_command`, `e2e_leak_check_command`, `e2e_max_skipped`, `e2e_setup_command`, `e2e_env` | Where the tests get their data, so unattended runs never touch production. |
| UAT | `uat.enabled`, `uat.url`, `uat.required_risk_classes`, `uat.human_pack`, `uat.mode` | Whether UAT runs, when the human pack is written and who executes it. `auto` needs an independent human reviewer. |
| Build | `source_dirs`, `node_version`, `install_flags`, `app_env`, `build_env`, `database_*`, `sast_baseline`, `accepted_dep_risks` | Whether CI is green. Workflows read repository-level secrets only. |

Set secrets with `devaudit configure secret <NAME>`; the value never passes through devaudit.

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
