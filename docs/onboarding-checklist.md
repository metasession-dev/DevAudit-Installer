# Checklist: set up, review and maintain an onboarded project

A short checklist for an operator who has run `devaudit install` and wants the SDLC to implement an issue the way the project intends. Each step points to the document that holds the detail. Current behaviour lives in the code and templates: `cli/src/lib/repo-config-keys.ts` (the keys `configure` manages) and `sdlc/files/sdlc-config.example.json` (every key, with comments).

## 1. Verify the install

- `devaudit doctor` checks tools, the onboarding invariants, the deploy host, the production URL, the runner, the release gate, the test tiers, the test data and the Stage 3 evidence. See [`doctor.md`](./doctor.md).
- `devaudit doctor --fix --dry-run` lists the repairs; `--fix` applies them. `--explain <check>` and `--guided` explain a finding.
- `devaudit status .` confirms the framework files are present. A second developer runs `devaudit join`, not `install` ([`joining-an-existing-project.md`](../sdlc/files/_common/joining-an-existing-project.md)).
- Repeat `doctor` after every configuration change.

## 2. Review `sdlc-config.json`

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

## 3. Make the SDLC implement an issue as intended

- Give each issue a risk class, acceptance criteria (ACs) and a requirement id. The `sdlc-implementer` skill triages it into tracked work or the lightweight (housekeeping) path.
- At plan approval, `scripts/show-sdlc-config.sh <RISK>` prints what the configuration will do for that issue: who approves, what blocks the release PR, what runs after deploy, whether UAT applies. Read it before approving the plan; if it is not what you want, change the configuration first.
- Tracked work follows the stages in `sdlc/files/_common/0-project-setup.md` to `5-deploy-main.md`. Branches are `feature/<issue#>-<slug>` or `fix/<issue#>-<slug>`, PR'd into the integration branch; the integration branch goes to the release branch by PR.
- Keep the AI rule files (`CLAUDE.md` and the others) accurate for the project; the agent follows them.

## 4. SRS, requirements traceability and tests

- **SRS (`docs/SRS.md`).** Each requirement is a `REQ-AREA-NNN` entry with testable ACs. For an existing codebase, bootstrap it from current behaviour first (Step 3b in [`onboarding.md`](./onboarding.md)). The `requirements-aligner` skill then runs at plan approval and at evidence time, proposes stubs for behaviour the SRS does not describe and flags drift ([`skills.md`](./skills.md)).
- **Risk and decisions.** Each requirement needs a risk class in its traceability row. It drives the UAT pack, `risk-register-keeper` entries and `adr-author` ADRs.
- **Tests.** The `e2e-test-engineer` skill bootstraps or maintains the pack; `e2e-test-data` owns seeds, resets and leak checks; `e2e-ci-reliability` diagnoses long-run failures that differ each time.
- **Tagging.** Every test that covers a requirement needs `[REQ-XXX]` (and `[ACn]`) in its title or a describe, and `tagTest('REQ-XXX', n)` in its body. The feature run matches titles; the portal matches the tag; screenshots alone leave an AC "untested". `scripts/check-req-title-tags.sh` reports offenders ([`e2e-test-tiers.md`](./e2e-test-tiers.md)).
- **No tests yet.** Follow "Starting with no tests" in [`onboarding.md`](./onboarding.md).

## 5. Also consider

- **Portal.** Sign-in, `DEVAUDIT_API_KEY`, plan limits, and the approval policy and claimed standards, which `doctor` compares with the local configuration (the portal wins).
- **GitHub.** Branch protection and required checks on the release and integration branches ([`branch-protection-setup.md`](./branch-protection-setup.md)).
- **Runner.** Hosted or self-hosted, and the `CI_RUNNER_LABEL` variable ([`self-hosted-runner-ci.md`](./self-hosted-runner-ci.md)).
- **Governance documents** for the standards you claim: RoPA, DPIA, AI disclosure, periodic review ([`governance-templates.md`](./governance-templates.md)).
- **Deploy checks.** A health probe, and a bypass header if production sits behind an access gate.
- **Drift.** Re-run `devaudit update` after each framework release, and `devaudit doctor --fleet` across several projects.
- **Pilot.** Run one low-risk issue end to end before relying on the setup.
