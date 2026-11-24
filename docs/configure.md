# `devaudit configure` and the `devaudit-configure` skill

Change a consumer repo's DevAudit settings (`sdlc-config.json`) and repo secrets with validation, instead of hand-editing JSON and hoping the generated workflows still make sense (devaudit-installer#1040).

Use it when the repo's real setup differs from what onboarding recorded: production deploys on Vercel, AWS or your own servers rather than Railway; the production URL secret changed; production sits behind an access gate; CI should run on a different runner; an E2E setting needs adjusting.

Run [`devaudit doctor`](./doctor.md) first: its `deploy-host`, `production-url`, `custom-deploy` and `ci-runner` checks tell you what disagrees with the repo and which `configure` command fixes it, and its `e2e-release-gate` and `test-tiers` checks review the release gate and the test tiers (proposals only; you choose and apply them with `configure set`).

```bash
devaudit configure list [--json]                      # keys configure manages, current values, what the host requires
devaudit configure get <key>                          # one key: value, meaning, allowed values
devaudit configure set <key> <value> [--dry-run] [--yes] [--reason "<why>"]
devaudit configure secret <NAME> [--dry-run]          # set a repo secret through gh's masked prompt
```

Implementation: [`cli/src/commands/configure.ts`](../cli/src/commands/configure.ts), keys in [`cli/src/lib/repo-config-keys.ts`](../cli/src/lib/repo-config-keys.ts), deploy-host detection in [`cli/src/lib/deploy-detect.ts`](../cli/src/lib/deploy-detect.ts).

## `devaudit configure` with no arguments

Run in a terminal with no subcommand, `devaudit configure` asks the same questions as the guided install ([`onboarding.md`](./onboarding.md#presets-and-the-guided-install)) with this project's current values as the defaults. The preset question starts at the preset recorded in `onboarding_preset`; "Keep my current settings" is offered when none is recorded. After the answers it lists every change as `key: before -> after`, keys the new preset does not write as `removed`, and the workflows the next `devaudit update` regenerates, asks once, and writes only what changed. If nothing changed it writes nothing.

- **Switching presets** writes exactly the target preset's keys and removes the ones it does not write (C to A leaves no `release_gate_tier`, `post_deploy_full_regression` or `scheduled_full_regression`). C to D changes `post_deploy_full_regression` to `false`, and D to C changes it back.
- **A change that enables a test tier** (the release gate question, or moving to preset B, C or D) asks where the tests get their data (Q18) straight away when `e2e_data_isolation` is unset.
- **A change that turns on an unattended regression** (a schedule, or a run after every deploy) prints the current `e2e_data_isolation` in the before/after summary: "these runs happen without anyone watching; your tests use <answer>". It asks nothing new.
- **The approval policy on the portal** is a separate action that needs a project admin. If the portal does not accept a solo policy, the approval settings in `sdlc-config.json` are left as they are and the rest is written.
- **Without a terminal** (no TTY, `CI` set or `--json`) it asks nothing, writes nothing and exits 8: use `devaudit configure set <key> <value>` in scripts. A declined confirmation also exits 8.
- A new review count on the release branch reaches GitHub through `devaudit update`, which asks before lowering an existing branch.
- **`devaudit configure --preset <A|B|C|D|custom> --yes`** applies a preset with no terminal and no question: every other question keeps its current answer, and nothing is asked or confirmed. A preset the repository cannot be offered is refused (exit 2) and nothing is written. A preset that means the author approves needs the approval policy set on the portal with your personal token (`devaudit auth login`); without one the approval settings are left as they are and a warning says so. It is what a DevAudit delivery run uses to apply the preset its issue names ([`delivery-runs.md`](./delivery-runs.md)). `--yes` without `--preset` exits 2.

## `configure set`: what it checks

1. **The key is one `configure` manages.** Unknown keys are refused; `configure list` shows them. `e2e_regression_enabled` is refused with a pointer to `devaudit update --enable-e2e-regression` / `--disable-e2e-regression`, which also syncs the workflow.
2. **The value has the right shape.** Types (string, whole number, `true`/`false`, a list as JSON or `A,B,C`, an object as JSON), allowed values (`deploy_trigger`: `push_to_main`, `git_tag`, `manual`; `host`: a shipped adapter, `railway`, `vercel` or `custom`), secret names (`^[A-Z][A-Z0-9_]*$`), `deployed_sha_url` must be https, and keys like `runner` cannot be empty.
3. **The value agrees with the repo.** For `host`, the same evidence `doctor`'s `deploy-host` check uses (who created the production deployments, committed host files) is compared with the new value. If the evidence clearly points elsewhere, the change needs an interactive confirmation plus a reason, or `--reason "<why>"` in a script; without either it is not applied (exit `8`). Mixed evidence is a warning only.
4. **The key fits the host.** Setting a `custom`-only key (`deploy_command`, `deploy_secrets`, `deployed_sha_url`, `deployed_sha_jq`, `deploy_trigger`) on another host is a warning.

Then it prints:

- **what the next `devaudit update` regenerates**, e.g. for `host railway -> custom`: `deploy-custom.yml (added)`, `reconcile-deployment.yml (removed)`, `post-deploy-prod.yml`;
- **what is still to do**: keys the host requires that are not set (`host custom requires deploy_command`) and secrets the change needs (`VERCEL_TOKEN`, the production URL secret, every `deploy_secrets` entry), each with its command.

`--dry-run` does all of this and writes nothing. Without `--dry-run`, an uncontradicted change asks for confirmation (skip it with `--yes`; a non-interactive run applies it, because the command itself is the instruction). The file keeps its key order and two-space formatting.

Exit codes: `0` applied, unchanged or dry run; `2` invalid key or value; `8` not applied (needs a confirmation or `--reason`).

## Dotted keys and the onboarding keys

A key with a dot lives inside a section of `sdlc-config.json`: `approval.mode` is `approval.mode` in the `approval` object, and `production_review.terminal_status` is in `production_review`. `configure set` writes only that value; the section's other fields and the file's key order are kept, and a missing section is created.

| Key | Values | What it does |
| --- | --- | --- |
| `approval.mode` | `dual_actor` (default), `solo_with_gap` | Who may approve a release: a different person, or the author with a recorded control gap. Read by the `sdlc-implementer` and `risk-register-keeper` skills; the portal has its own approval policy, which `doctor` compares with this one. |
| `production_review.terminal_status` | `prod_review` (default), `released` | Where `post-deploy-prod.yml` leaves a release: waiting for a person to confirm production, or released automatically. |
| `release_branch_required_reviews` | `0`, `1` (default), `2` | Approving reviews GitHub requires on the release branch. `devaudit install` applies it. `devaudit update` keeps the branch at it: raising is automatic; **lowering an existing branch asks for a confirmation** that states the recorded control gap, and without a terminal it only reports the difference. `0` lets the author merge their own release PR. |
| `compliance_frameworks` | `soc-2`, `iso-27001`, `iso-29119`, `gdpr`, `eu-ai-act` (a list, or empty) | The standards the project needs evidence for. The portal's claimed standards win when they differ. |
| `onboarding_preset` | `A`, `B`, `C`, `D`, `custom` | The onboarding preset the project chose. A missing key means `custom`. |
| `e2e_data_isolation` | `none`, `ephemeral`, `shared_serialised`, `shared` | Where the end-to-end tests get their data. Unset keeps today's behaviour. |
| `uat.human_pack` | `risk` (default), `always`, `never` | When a tracked REQ needs the human UAT pack (`uat-briefing.md`, `uat-test-procedure.md`, `uat-execution-record.md`): `risk` means MEDIUM risk and above, from the RTM Risk cell. Read by `validate-compliance-artifacts.sh`, the `sdlc-implementer` skill and `devaudit doctor` (`stage3-evidence`). `never` is the product owner's choice and has a compliance cost: no documented human acceptance testing for those releases. |
| `uat.mode` | `manual` (default), `auto` | Who executes the pack's procedure. `manual`: a tester runs it by hand. `auto`: the `sdlc-implementer` agent executes it step by step on the UAT environment, stores per-step evidence under `compliance/evidence/REQ-XXX/uat/` and fills `uat-execution-record.md` (front matter `execution_mode: agent_executed`); a named human who is independent of the author then reviews and signs, and can require a manual re-run. Only matters while the pack applies. `devaudit doctor` warns when `auto` is combined with `approval.mode: solo_with_gap` (no independent reviewer) or when `uat.enabled` is not true (no UAT environment to run on). |
| `e2e_seed_paths`, `e2e_reset_command`, `e2e_preflight_command`, `e2e_leak_check_command`, `e2e_max_skipped`, `feature_e2e_projects` | lists, one-line commands, a number | Test-data settings the project owns. They are defined now and take effect with the test-data work of DevAudit-Installer#1116 (work package WP15); no generated file reads them yet. |

| `delivery.enabled` | `true`, `false` (default) | Whether the repository accepts [DevAudit Delivery runs](./delivery-runs.md). `true` generates `.github/workflows/devaudit-delivery.yml` and `.devaudit/delivery-prompt.md` at the next `devaudit update`; `false` removes them. Set by `devaudit install --delivery`; `devaudit doctor` reports the `delivery-workflow` check while it is true. |
| `delivery.github_token_source` | `secret`, `app` | Where a delivery run gets the GitHub token it pushes with: the repository secret `DEVAUDIT_AGENT_GITHUB_TOKEN` (a machine user's token, the pilot path) or a short-lived token the portal mints from the DevAudit Agent GitHub App (the product path). Set by `devaudit install --delivery`. `devaudit doctor` fails `delivery-workflow` when it is missing or invalid, or `secret` without the secret. See [`delivery-runs.md`](./delivery-runs.md#the-agents-github-token). |
| `delivery.agent_git_name` | a one-line name, at most 100 characters, no `<` or `>` (default `DevAudit Agent`) | The name of the git author of a delivery run's commits. The address is never configured: it is the noreply address of the token's own GitHub identity. |
| `delivery.max_turns`, `delivery.max_minutes` | a whole number from 10 to 1000 (default 200); a whole number from 10 to 360 (default 90) | The most agent turns, and the longest time in minutes, one delivery run may take (`--max-turns` and the job's `timeout-minutes`). |
| `report_only_e2e_enabled` | `true` (default), `false` | Whether `ci.yml` runs the report-only authenticated E2E steps (the seed step and the step that runs `report_only_e2e_projects`, default `e2e_projects`). `false` removes both and keeps `e2e_projects`. The step cannot fail the job and its results are not evidence; it runs on every pull request and every merge (#1297). Needs `devaudit update`. |
| `report_only_e2e_projects` | list of Playwright projects | The projects the report-only step runs; unset means `e2e_projects`; an empty list runs none (#1297). Needs `devaudit update`. |
| `paths_ignore_pull_request` | `true` (written for a new install), `false` (an onboarded project until it opts in) | Also apply `paths_ignore` to pull requests into the integration branch. `false`: every pull request runs the full Quality Gates, as before. `true`: a pull request that changes only `paths_ignore` paths (and `sdlc-config.json`) does not start `ci.yml`, and `ci-status-fallback.yml` reports the required `Quality Gates` status for it, under that name only for such a pull request; a pull request with any other file runs the full gates. Needs `devaudit update` to regenerate the two workflows (`pull-requests: read` is added to the fallback). A pattern that matches a workflow file is never applied to a pull request: a pull request that edits a workflow always runs the gates (#1299). See [`compliance-gates.md`](./compliance-gates.md#docs-only-pull-requests-1290). |
| `e2e_report_include_traces` | `true`, `false` (default) | Whether the Playwright report zip uploaded as evidence keeps traces and videos. `false` leaves out `playwright-report/trace/`, the trace zips under `playwright-report/data/` and `*.webm`, so the zip stays under the portal's upload cap (DevAudit-Installer#1275). Read at run time by `scripts/playwright-report-evidence.sh`. |

None of these regenerates a workflow, so `configure set` for them prints no list of files. `release_branch_required_reviews` takes effect at the next `devaudit update`.

## `configure secret`

```bash
devaudit configure secret VERCEL_TOKEN
```

Explains what the secret is for (the production URL, the probe header, a host adapter requirement, a `deploy_secrets` entry) or warns that nothing generated reads it, then hands the terminal to `gh secret set <NAME>`. You paste the value at gh's masked prompt; devaudit never sees, prints or stores it. It refuses to run without an interactive terminal (in CI, use `gh secret set` directly).

## Recipes

**Vercel:**

```bash
devaudit configure set host vercel --dry-run
devaudit configure set host vercel
devaudit configure secret VERCEL_TOKEN                # webhook-loss recovery lookups
devaudit configure secret DEVAUDIT_PROBE_HEADER       # only if production is behind Deployment Protection,
                                                      # value e.g. "x-vercel-protection-bypass: <token>"
devaudit update && devaudit doctor
```

`devaudit doctor --fix` applies the host change for you when its `deploy-host` check finds the mismatch.

**AWS, self-hosted, Fly.io or Kubernetes (`custom`):**

```bash
devaudit configure set host custom
devaudit configure set deploy_command "./scripts/deploy.sh"
devaudit configure set deploy_secrets AWS_ACCESS_KEY_ID,AWS_SECRET_ACCESS_KEY
devaudit configure set deployed_sha_url https://app.example.com/version
devaudit configure set deployed_sha_jq .commit
devaudit configure secret AWS_ACCESS_KEY_ID
devaudit configure secret AWS_SECRET_ACCESS_KEY
devaudit update && devaudit doctor
```

See [adding-a-host.md](adding-a-host.md#the-custom-host-aws-self-hosted-anything-devaudit-installer1022) for what `deploy-custom.yml` does with these.

**CI runner:**

```bash
devaudit configure get runner                         # explains self-hosted vs a fixed label
devaudit configure set runner ubuntu-latest
```

`runner: self-hosted` means "choose at run time from the `CI_RUNNER_LABEL` variable"; `doctor`'s `ci-runner` check tells you whether a runner with that label is registered.

**Release gate (which E2E tier must pass before merge to the release branch):**

```bash
devaudit configure set release_gate_tier full --dry-run
devaudit configure set release_gate_tier full
devaudit configure set post_deploy_full_regression false
devaudit configure set scheduled_full_regression "0 3 * * *"
```

All three need `e2e_regression_enabled`. See [e2e-test-tiers.md](e2e-test-tiers.md#choosing-the-release-gate-1059) for the trade-offs and the recommended combinations.

**Test tier commands (any runner):**

```bash
devaudit configure set test_runner pytest
devaudit configure set test_tier_smoke "pytest -m smoke"
devaudit configure set test_feature_command 'npx jest -t "{REQ}]"'
```

`test_runner: pytest` also replaces the Playwright `feature-e2e.yml` and `e2e-regression.yml` with pytest ones. Each tier command is a single line of at most 500 characters; `test_feature_command` must contain `{REQ}`. Unset keys keep the runner default. See [e2e-test-tiers.md](e2e-test-tiers.md#tier-commands-for-any-test-runner-1060).

## The `devaudit-configure` skill

In Claude Code, the [`devaudit-configure`](../sdlc/files/_common/skills/devaudit-configure/SKILL.md) skill (synced into every consumer's `.claude/skills/`) holds the conversation around these commands. Trigger it with phrases like "configure devaudit", "we deploy on Vercel, not Railway", "doctor says the host is wrong", "our prod is behind Vercel protection", "we deploy to AWS", or "change the CI runner".

It:

1. runs `devaudit doctor --json` and `devaudit configure list --json`;
2. explains each finding and its evidence in plain terms, and what doctor could not check;
3. asks what you want to change, and asks why when you want something the evidence contradicts;
4. shows `configure set … --dry-run` (validation, regenerated files, follow-ups) and applies only after you confirm;
5. asks **you** to run `devaudit configure secret <NAME>` for each secret (it never handles secret values);
6. runs `devaudit update` and `devaudit doctor`, and opens a `fix/<issue#>-<slug>` PR to the integration branch with the change, the evidence and the doctor result.

It never edits `sdlc-config.json` or generated workflows directly, never changes portal state, and does not change settings inside the hosting provider (it tells you what the gates need from it).

## See also

- [`docs/doctor.md`](./doctor.md) — how to run doctor and `doctor --fix`.
- [`docs/onboarding.md`](./onboarding.md) — choosing the host at install.
- [`docs/adding-a-host.md`](./adding-a-host.md) — the host adapter contract and the `custom` host.
