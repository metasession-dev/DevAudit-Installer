---
name: devaudit-configure
description: Walk the operator through checking and changing this repo's DevAudit settings in `sdlc-config.json` — where production deploys (railway, vercel, custom for AWS/self-hosted), the production URL secret and access-gated probe header, custom deploy settings (deploy_command, deploy_secrets, deployed_sha_url, deploy_trigger), runner/CI keys, and the E2E test tiers and release gate (release_gate_tier, post_deploy_full_regression, scheduled_full_regression, test_runner, test_tier_*, test_feature_command) — using `devaudit doctor` to find what disagrees with the repo's real setup and `devaudit configure` to validate and apply each change, then regenerating the workflows with `devaudit update` on a fix branch. Use when the operator says "configure devaudit", "change our preset", "we have no tests yet", "we deploy on Vercel, not Railway", "doctor says the host is wrong", "set up the production URL", "our prod is behind Vercel protection", "we deploy to AWS / our own servers", "change the CI runner", "which tests gate the release", "run the full regression before merge", "set up our test tiers", "doctor says the release gate is too slow", "check our devaudit config", or after adopting a new devaudit version. Do NOT use for implementing a tracked change (that's `sdlc-implementer`), for editing generated workflows by hand (they are overwritten on sync), or for handling secret values (the operator types them into `devaudit configure secret`).
version: 1.2.0
tags:
  - configuration
  - onboarding
  - deploy
  - testing
---

# DevAudit Configure

Helps the operator get this repo's `sdlc-config.json` right for how the project really deploys, runs CI and gates releases on its tests, one validated change at a time. The CLI does the detection, validation and writing; this skill holds the conversation, explains the evidence, and makes sure each change makes sense before it is applied (devaudit-installer#1040).

## Hard rules

- **Never edit `sdlc-config.json` directly.** Every change goes through `devaudit configure set`, which validates it and refuses or flags values that do not make sense. If `configure` refuses a key, explain why and stop; do not work around it with a manual edit.
- **Never ask for, read, print or store a secret value.** When a secret is needed, tell the operator to run `devaudit configure secret <NAME>` themselves (it hands over to `gh secret set`'s masked prompt). Do not run it on their behalf with a value.
- **Never edit generated workflows** (`.github/workflows/*.yml` written by devaudit). Change the config, then `devaudit update` regenerates them.
- **One change at a time, confirmed.** Show the dry run, get the operator's yes, then apply.
- **GitFlow.** Changes land on a `fix/<issue#>-<slug>` branch (create a tracking issue if there is none) and reach the integration branch by PR. Never commit to `main` or the integration branch directly.

## The registry and the preset ladder

`devaudit install` and `devaudit configure` (run with no arguments, in a terminal) ask the same questions, from one registry (Q0a to Q21; `docs/presets.md` lists them with the presets). A **preset** is a set of answers chosen together:

| Preset | Fits | Before a release | Approval |
| --- | --- | --- | --- |
| A | one developer who wants fast feedback | smoke tests block the merge | the author, gap recorded |
| B | a safety net | critical tests block; full pack after deploy and nightly | the author, gap recorded |
| C | a team with a compliance lead | the full pack blocks; again after deploy and nightly | a different person |
| D | the same team, full pack once | the full pack blocks; not run again after deploy | a different person |
| custom | anything else | you choose each setting | you choose |

The suggestion comes from one rule shared with `devaudit doctor` and `devaudit scan`: it only suggests a preset that can be offered, never D, and gives its reason in a sentence. A and B need a portal that allows a solo approver; B needs smoke tests; C and D need a full test pack and a second portal admin. Never tell the operator a preset makes the project compliant: each carries a gap, named in `docs/presets.md`.

`devaudit configure` with no arguments shows the answers with the current values as defaults, then every change as before/after, and writes only what changed. A preset switch removes the keys the target preset does not write. Without a terminal it asks nothing and exits 8: use `devaudit configure set <key> <value>` instead. Approval follows `approval.mode`: `dual_actor` (a different person) or `solo_with_gap` (the author, as a recorded control gap); changing it also needs the portal's approval policy to agree, which `devaudit doctor` checks (`approval-policy`).

## Starting with no tests

A project that answered "not yet" to "Does the project have automated end-to-end tests?" gets preset A suggested and B, C and D not offered. The path from there to a gated release:

1. **Finish the install on preset A.** Smoke only is not yet a gate, so A (smoke tests block the merge, approval by the author, the gap recorded) is the preset that fits. Use `custom` instead when A is not offered (the portal does not allow a solo approver yet) or when the team wants a different person to approve (Q11 "a different person"; preset A would record a gap the team does not want).
2. **Write the first tests.** Use the `e2e-test-engineer` skill to bootstrap a suite and add smoke tests (its Phase 1b and Phase 5; a requirement and an approved plan come first).
3. **Run `devaudit doctor`.** The `test-tiers` check should now pass.
4. **Run `devaudit configure`** to enable critical or full when those tests exist; the Q4 to Q8 answers update through the detection already there.

If the project also needs test data (a database to seed or reset), the data steps are added later (Q18 to Q20).

## Flow

### 1. Read the current state

```bash
devaudit doctor --json > /tmp/devaudit-doctor.json
devaudit configure list --json
```

From the doctor JSON, read the `onboarding` entries named `deploy-host`, `production-url`, `custom-deploy` and `ci-runner`, plus `secrets` and `reconcile-cli`, and the test entries `e2e-release-gate` and `test-tiers` (devaudit-installer#1059, #1060). From `configure list`, read the current values, which keys the host requires (`requiredByHost`) and which apply to this host (`applies`).

### 2. Explain what you found, in plain terms

Summarise for the operator, for example:

- *"sdlc-config.json says production deploys on Railway, but the last production deployments were created by the Vercel GitHub app, and there is a `vercel.json`. Doctor suggests switching the host to vercel."*
- *"Production answers 401 to an unauthenticated request, so the post-deploy health probe will fail unless `DEVAUDIT_PROBE_HEADER` is set."*
- *"The runner label `build-box-ci` has no registered repository runner; jobs will queue unless an organization runner carries it."*
- *"The release PR runs the critical tier. Your full regression has a median of 14 minutes, so running it before merge is affordable (`release_gate_tier full`); then the post-deploy run tests the same commit twice and can be switched off."*
- *"The smoke tier collects zero tests, so the release gate proves nothing yet. That needs tests, not a setting: the `e2e-test-engineer` skill writes them."*

Say what each finding means for the release gates, and what doctor could not check (it lists them, e.g. when `gh` has no access).

### 3. Ask what they want to change

Offer the doctor-suggested changes first, then ask whether there is anything else (prod URL, custom deploy command, runner, E2E keys).

For the test tiers and the release gate, doctor only proposes (tier C guidance: `--fix` never applies them); the operator decides and each change goes through `configure set`. The trade-offs and recommended combinations are in `docs/e2e-test-tiers.md` ("Choosing the release gate"). Points to raise:

- The gate keys need `e2e_regression_enabled` (`devaudit update --enable-e2e-regression`); without it they have no effect.
- Setting `release_gate_tier` makes the portal require an `E2E Release Gate (<tier>)` check that passed on the PR's current head before approval. A gate that ran on an earlier push counts as stale, so the operator re-runs it after a late push.
- A scheduled full regression (`scheduled_full_regression`) is an early signal only. It is never release evidence; a failure opens one `bug` issue.
- An empty or missing tier is a test gap, not a configuration gap: hand it to the `e2e-test-engineer` skill rather than pointing a tier at an unrelated command. If the operator wants something the evidence contradicts (e.g. keep `host: railway` while Vercel deploys), ask why; that reason is recorded with the change.

For a move to `custom` (AWS, self-hosted, Fly.io, Kubernetes, any deploy script), collect: the deploy command, the secrets it needs, whether the app exposes its running commit SHA (for `deployed_sha_url`), and when it should deploy (`push_to_main`, `git_tag` or `manual`). See `docs/adding-a-host.md` in the DevAudit-Installer repo for the custom-host contract.

### 4. Dry run, confirm, apply

For each change:

```bash
devaudit configure set <key> <value> --dry-run          # validation, workflow impact, follow-ups
devaudit configure set <key> <value> --yes              # after the operator confirms
devaudit configure set host railway --reason "<why>"    # only when the evidence contradicts the value
```

Show the operator the dry run's errors, warnings, the files the next `devaudit update` regenerates, and the "Still to do" follow-ups. An exit code of 2 means the value is invalid (explain and ask again); 8 means it needs a confirmation or `--reason`.

A doctor-suggested host fix can also be applied with `devaudit doctor --fix` (tier A; it asks, or `--yes`).

### 5. Secrets the change needs

List the follow-ups that are secrets (e.g. `VERCEL_TOKEN`, the production URL secret, `DEVAUDIT_PROBE_HEADER`, `deploy_secrets` entries) and ask the operator to run, in their own terminal:

```bash
devaudit configure secret <NAME>
```

Explain what each secret is for (`configure secret` prints it too). Wait for them to confirm before continuing.

### 6. Regenerate and verify

```bash
devaudit update
devaudit doctor
```

Check that the findings you fixed now pass and nothing new appeared. Review the regenerated workflows with the operator (a host change adds or removes `reconcile-deployment.yml` / `deploy-custom.yml`).

### 7. Open the PR

Commit `sdlc-config.json` and the regenerated files on the fix branch, with a message that names the change and, for a contradicted value, the reason. Open a PR to the integration branch listing: what changed, the evidence, the secrets the operator added (names only), and the doctor result after the change.

### 8. Mention the agent permission rules, once

If `devaudit doctor` reports `agent-permissions` as missing rules, tell the operator in one sentence that `devaudit agent-permissions apply` (documented in `docs/agent-permissions.md`) adds the recommended rules that keep agent sessions away from their personal access token to their user settings after a confirmation, and that running it is their choice. Never run it for them. Never edit their agent settings (`.claude/settings.json`, `~/.claude/settings.json`) yourself and never write the credential folder rules for them.

## What this skill does not do

- Change portal state, releases or approvals.
- Edit the operator's agent permission settings.
- Set environment variables or settings in the hosting provider (Vercel, Railway, AWS); it tells the operator what the gates need from them.
- Change keys `configure` does not manage. `devaudit configure get <key>` says whether a key is managed; `e2e_regression_enabled` is changed with `devaudit update --enable-e2e-regression` / `--disable-e2e-regression`.
