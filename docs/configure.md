# `devaudit configure` and the `devaudit-configure` skill

Change a consumer repo's DevAudit settings (`sdlc-config.json`) and repo secrets with validation, instead of hand-editing JSON and hoping the generated workflows still make sense (devaudit-installer#1040).

Use it when the repo's real setup differs from what onboarding recorded: production deploys on Vercel, AWS or your own servers rather than Railway; the production URL secret changed; production sits behind an access gate; CI should run on a different runner; an E2E setting needs adjusting.

Run [`devaudit doctor`](./doctor.md) first: its `deploy-host`, `production-url`, `custom-deploy` and `ci-runner` checks tell you what disagrees with the repo and which `configure` command fixes it.

```bash
devaudit configure list [--json]                      # keys configure manages, current values, what the host requires
devaudit configure get <key>                          # one key: value, meaning, allowed values
devaudit configure set <key> <value> [--dry-run] [--yes] [--reason "<why>"]
devaudit configure secret <NAME> [--dry-run]          # set a repo secret through gh's masked prompt
```

Implementation: [`cli/src/commands/configure.ts`](../cli/src/commands/configure.ts), keys in [`cli/src/lib/repo-config-keys.ts`](../cli/src/lib/repo-config-keys.ts), deploy-host detection in [`cli/src/lib/deploy-detect.ts`](../cli/src/lib/deploy-detect.ts).

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

**Test tier commands (any runner):**

```bash
devaudit configure set test_runner pytest
devaudit configure set test_tier_smoke "pytest -m smoke"
devaudit configure set test_feature_command "pytest -k {REQ}"
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
