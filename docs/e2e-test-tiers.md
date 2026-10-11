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

**Critical and regression carry distinct portal check labels** — `E2E Critical (pre-merge)` and `E2E Regression (post-deploy production)` respectively (devaudit-installer#787). Before this, both tiers reported under the identical `E2E Regression` label/workflow/job name everywhere a human looked, so a reviewer looking at a develop→main PR — where a regression-tier check is structurally guaranteed absent because production doesn't exist yet — had no way to tell "this is fine, that tier just hasn't run yet" from "something is actually wrong." The workflow's own `name:` field and job name are unchanged (renaming those risks breaking a consumer's existing branch-protection required-check-name reference) — only the portal-facing check label built in `compliance-evidence.yml.template` is tier-aware. A consumer running an `e2e-regression.yml` copied before this fix needs to re-sync `compliance-evidence.yml` (`devaudit update`) to pick up the distinct labels.

## What DevAudit ships today

The generated framework requires the blocking E2E gate in `ci.yml`.

The broader three-tier pattern is documented and available as a reference workflow through the `e2e-test-engineer` skill materials:

- [`docs/e2e-local-db-ci.md`](./e2e-local-db-ci.md) for safe local/disposable backends in CI
- [`sdlc/files/_common/skills/e2e-test-engineer/references/e2e-regression-3-tier.yml`](../sdlc/files/_common/skills/e2e-test-engineer/references/e2e-regression-3-tier.yml) for the optional smoke/critical/regression split

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
