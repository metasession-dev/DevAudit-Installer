# `devaudit doctor`

The single-repo health check for a DevAudit consumer. Run it locally, in CI, or swept across every project your account can see with `--fleet`.

```bash
devaudit doctor          # human-readable
devaudit doctor --json   # machine-readable — suitable for CI
devaudit doctor --fleet  # sweep every project you have access to, checked out locally as siblings
devaudit doctor --fix [--yes] [--reason <text>] [--dry-run]   # propose and apply repairs (one project)
```

Implementation: [`cli/src/commands/doctor.ts`](../cli/src/commands/doctor.ts) (single-repo), [`cli/src/commands/fleet.ts`](../cli/src/commands/fleet.ts) (`--fleet`).

## How to use doctor

Run it from the root of a consumer repo (anywhere inside the checkout works).

1. **After `devaudit install` or `devaudit update`, run `devaudit doctor`.** Read the output top to bottom:
   - `✓` / `✗` lines under the tool check: a `✗` means a required tool is missing (exit `6`); install it and re-run.
   - `⚠` lines are onboarding, deploy-config and release findings. They never fail plain `doctor`; each says what is wrong and, where it can, which command fixes it.
   - `skipped (…)` means doctor could not check something (for example `gh` is not authenticated, or no portal key); it is not a pass.
2. **See what doctor would change, without changing anything:** `devaudit doctor --fix --dry-run`. Every proposal is listed as `planned` (tier A or B) or `reported` (tier C guidance with the exact command to run).
3. **Apply the fixes:** `devaudit doctor --fix`. Interactively it asks before each change (tier A), and for portal changes it also asks for a reason (tier B). In CI or scripts pass `--yes` for tier A; tier B (portal changes) is interactive-only and is never applied non-interactively; anything not authorised stays unapplied and the run exits `8`.
4. **Change a setting doctor does not fix itself** (production URL secret, custom deploy command, runner, E2E keys, secrets) with [`devaudit configure`](./configure.md), which validates the change and tells you what the next `devaudit update` will regenerate. In Claude Code, the [`devaudit-configure`](./configure.md#the-devaudit-configure-skill) skill walks you through it.
5. **Regenerate and re-check:** `devaudit update`, then `devaudit doctor` again; the findings you fixed should now pass. Commit on a `fix/<issue#>-<slug>` branch and open a PR.

### Worked example: a repo onboarded with the wrong deploy host

A repo deploys production on Vercel but was onboarded before `install` asked where production deploys, so its `sdlc-config.json` says `host: railway`.

```text
$ devaudit doctor
  ⚠ deploy-host     sdlc-config.json says host `railway`, but this repo deploys with vercel (high confidence: 2 recent production deployment(s) created by vercel[bot] (Vercel GitHub app))
  ⚠ production-url  the latest production deployment (https://….vercel.app) answers 401 to an unauthenticated request, so the post-deploy probe will fail; set DEVAUDIT_PROBE_HEADER (…)

$ devaudit doctor --fix
  Set host to vercel in sdlc-config.json? › yes
  ✓ [A] set-config host: applied — sdlc-config.json host: "railway" -> "vercel"; run `devaudit update` to regenerate the workflows; add the repo secret VERCEL_TOKEN: devaudit configure secret VERCEL_TOKEN
  i [C] add-probe-header DEVAUDIT_PROBE_HEADER: reported — devaudit configure secret DEVAUDIT_PROBE_HEADER

$ devaudit configure secret VERCEL_TOKEN            # paste at gh's masked prompt
$ devaudit configure secret DEVAUDIT_PROBE_HEADER   # e.g. x-vercel-protection-bypass: <token>
$ devaudit update && devaudit doctor
```

## Exit codes

- **`0`** — all required tools present.
- **`6`** — one or more required tools missing.
- **`8`** — `--fix` only: proposals remain unapplied (no TTY, declined or cancelled confirmation, `CI` set without `--yes` for tier A, a tier B proposal without an interactive terminal, a failed portal call, or guidance-only proposals). Tool failures (`6`) take precedence. `--fix --dry-run` exits `0`.
- **`2`** — `--fleet` combined with `--fix` or `--reason`, or `--reason` without `--fix`.

Onboarding-checklist gaps, release-closeout drift and release-deferral findings are reported but **do not** affect the exit code of plain `doctor` — they're warnings, not tool-preflight failures. Only `--fix` adds exit code `8`. A CI step that wants to gate on them should parse `--json` output itself rather than relying on the process exit code.

## What it checks

### 1. Required tools on PATH (gating)

`node` (>=22), `git`, `gh`, `jq`, `curl`. This is the only group that sets exit code `6` on failure.

### 2. Onboarding-checklist invariants (non-gating, consumer projects only)

Skipped entirely (reported as `ok` with a "skipped" detail) when not run inside a consumer project (no `sdlc-config.json` at the repo root).

| Check | What it verifies |
| --- | --- |
| `srs` | `docs/SRS.md` exists — the one manual bootstrap step nothing in the framework authors on a consumer's behalf. |
| `rtm` | `compliance/RTM.md` has at least one real `REQ-XXX` row, not just the generated skeleton. |
| `semgrep` | Informational only — local semgrep availability. CI installs its own copy independently, so this only affects local pre-commit SAST runs. |
| `e2e-regression` | `e2e_regression_enabled` in `sdlc-config.json` agrees with whether `playwright.config.ts` actually defines `critical`/`regression` projects — catches either side drifting from the other. With `test_runner: pytest` there are no Playwright projects; the tiers are pytest markers and the `test-tiers` check covers them. |
| `secrets` | Required GitHub repo secrets are present (`gh secret list`): the configured `api_key_secret` name (default `DEVAUDIT_API_KEY`), the viewer-key secret if configured, and (devaudit-installer#843) the resolved host adapter's own `required_secrets` from its `adapter.json` (e.g. `RAILWAY_TOKEN` for the `railway` host — never reported for a non-Railway consumer). Presence only — `gh secret list` never returns values. `DEVAUDIT_USER_TOKEN` is deliberately not checked here (devaudit-installer#912) — it's never a repo secret; it's the operator's local credential (see `--fleet` below). |
| `pre-push-hook` | `.husky/pre-push` or `.git/hooks/pre-push` exists — this is what enforces the `sdlc-implementer` sentinel. |
| `reconcile-cli` | devaudit-installer#843/#1022 (named `railway-cli` before #1022) — the CLI the host adapter's `reconcile.required_cli` names (Railway: `railway`) is on `PATH`, checked only when `.github/workflows/reconcile-deployment.yml` is actually present in this consumer's synced files. Skipped when the host has no recovery workflow or its lookup needs no CLI (Vercel: curl + jq), so a consumer never sees a false positive for a tool it will never need. |
| `commitlint-config-shadowing` | devaudit-installer#942 — a legacy commitlint config (`.commitlintrc*`, `commitlint.config.{js,cjs,ts,cts}`, or a `package.json#commitlint` field) that commitlint's fixed search order loads *before* the managed `commitlint.config.mjs`, silently defeating its `Sdlc-Implementer-Sentinel:` exemption. Skipped when `commitlint.config.mjs` is not synced. |
| `sync-conflicts` | devaudit-installer#930 — lists every unresolved entry in `.devaudit/sync-manifest.json` with `conflict: true` (a managed file `update` detected as locally modified and left untouched, with the fresh upstream content sitting in a sibling `<path>.devaudit-new`). Non-gating — resolve each by following [sync-conflict-review.md](sync-conflict-review.md). Reports "skipped" if no manifest exists yet (never synced under a devaudit-installer#930-or-later CLI). |
| `accepted-exceptions` | devaudit-installer#1016/#1017 — lists every open GitHub issue labelled `accepted-e2e-failure` or `accepted-dependency-risk` whose body has no `Review by: YYYY-MM-DD` date or whose review date has passed, and every entry of `compliance/security/accepted-vulnerabilities.json` that has expired or expires within 14 days (the CI dependency gate fails on it again once expired), so a documented exception cannot quietly become permanent. Non-gating. The issue half is skipped when `gh` is missing or unauthenticated; the file half needs no `gh`. |
| `patch-conflicts` | devaudit-installer#1023 — lists every `.devaudit-patches/*.patch` the last `update` skipped because it no longer applies cleanly (the affected file carries the **unpatched** upstream template), with its linked upstream issue and the date it was first seen, read from the `patches` map in `.devaudit/sync-manifest.json`. Non-gating — re-roll or remove each patch following [consuming-projects.md § Re-rolling a conflicting patch](consuming-projects.md#re-rolling-a-conflicting-patch) and [sync-conflict-review.md](sync-conflict-review.md). Reports "skipped" if no manifest exists yet. |
| `deploy-host` | devaudit-installer#1040 — the `host` in `sdlc-config.json` matches where production really deploys. Evidence, strongest first: who created the repo's production GitHub deployments (`vercel[bot]`, the Railway app, or a GitHub Actions workflow, which means `custom`), then committed host files (`vercel.json`, `.vercel/`, `railway.json`/`railway.toml`, `fly.toml`, `serverless.yml`, `appspec.yml`, `terraform/`, `k8s/`, `helm/`). A confident mismatch carries a tier A `set-config` proposal (`doctor --fix` sets `host`); mixed evidence is reported without a proposal. What could not be checked (no `gh` access) is listed. |
| `production-url` | devaudit-installer#1040 — `production_url_secret` is set and that repo secret exists (by name; values are never read). When GitHub records a production deployment URL and it answers `401`/`403`/`407` to an unauthenticated request while `DEVAUDIT_PROBE_HEADER` is absent, it warns that the post-deploy probe will fail and names the secret to add. |
| `custom-deploy` | devaudit-installer#1040 — host `custom` only (skipped otherwise): `deploy_command` is set, every `deploy_secrets` entry is a valid secret name and exists, `deployed_sha_url` is https, `deploy_trigger` is `push_to_main`, `git_tag` or `manual`. Notes when no `deployed_sha_url` is set (the deploy is then verified by a health check only). |
| `ci-runner` | devaudit-installer#1040 — the runner CI will use exists. `runner: self-hosted` resolves through the `CI_RUNNER_LABEL` variable (`github-ci`, the default, is GitHub-hosted); any other label, or the resolved one, must be carried by a registered repository runner. Not checked when the runner list is not visible (needs repo admin; organization runners are not listed). |
| `e2e-release-gate` | devaudit-installer#1059 — reviews the E2E release gate (`release_gate_tier`, `post_deploy_full_regression`, `scheduled_full_regression`). Reports a gate set while `e2e_regression_enabled` is not true (no workflow is generated), an invalid gate value, a `full` gate with no `regression` project and no `test_tier_full` command, and a `full` gate whose recent `E2E Regression` runs (median of the last 30 finished runs, via `gh run list`) are longer than the limit that actually stops them: the fixed 40-minute timeout on the test command, or `e2e_regression_timeout_minutes` (default 55) when the Playwright `e2e/ci-reliability/regression-run.sh` hook exists. Only in the second case does it propose raising that key; otherwise it proposes sharding through the hook or moving slow tests out of the tier. Notes, not failures: `full` together with a post-deploy run (the same commit is tested twice), a configured cron with no scheduled run in the last 7 days, and a recommendation from the median run time (under 20 minutes: `full` is affordable before merge; otherwise `critical` plus a schedule). Read-only: every finding is tier C guidance that names the `devaudit configure` command, and nothing is applied by `--fix`. Run history that `gh` cannot show is listed as not checked. |
| `test-tiers` | devaudit-installer#1060 — each tier the project declares resolves to tests. Tests are found by collecting, never by running them: `pytest --collect-only -q`, `npx playwright test --list --project=<p>`, or the collect-only form of a custom `test_tier_*` command (pytest, Playwright, Jest `--listTests`, Vitest `list`; any other custom command is listed as not checkable). Reports a declared tier with zero tests, the smoke tier being empty on a project that has tests (with a pointer to the `e2e-test-engineer` skill) or on one with no tests yet, test files with no `REQ-XXX` tag (so the feature scope cannot select them), and recent regression runs longer than their timeout (the `full` gate reports that itself). Notes: no `critical` tier or one identical to smoke (the two-tier setup, `release_gate_tier smoke`), RTM requirements with no test in any tier (a heuristic), and a custom command that cannot be collected. Jest and Vitest repos are pointed at `devaudit configure set test_tier_smoke`. Read-only; tier C guidance only. |

### 3. Release closeout drift (non-gating)

`checkReleaseCloseoutDrift` — a reconciliation safety net. Flags any release ticket still sitting in `compliance/pending-releases/` whose portal release is already `released` (i.e. a close-out that was missed, e.g. a dropped dispatch). Calls the DevAudit portal API using `sdlc-config.json`'s `devaudit.project_slug`/`devaudit.base_url` plus a read key (see [Portal reads](#portal-reads-use-the-viewer-key)); skips gracefully if any of those aren't available. `compliance/pending-releases/` is resolved from the repo root, so the check gives the same answer from any subdirectory.

### 4. Release-deferral diagnosis (non-gating, read-only; #956)

A release PR closed without releasing leaves a ticket, the portal release and `develop` disagreeing. The ticket's `- **Release intent:** deferred-to-next — <reason>` line is the **sole declaration** of a deferral; deferred tickets stay in `compliance/pending-releases/`. These checks diagnose the mismatches; plain `doctor` never changes anything (repairs are opt-in via [`--fix`](#devaudit-doctor---fix)). They are reported under the `deferral` key of `--json`, never affect the exit code, and each degrades to `skipped (…)` when its data source is missing (no `compliance/`, git ref, `gh`, portal key, or network).

| Check | Situation | Warns when |
| --- | --- | --- |
| `release-pr-closed` | D3 | The ticket's linked release PR is closed unmerged (`gh pr view`), the portal release is still `draft`/`uat_review`/`uat_approved`, and the ticket has no `Release intent`. Needs `gh` and a portal key; without a key the closed PR is noted but not flagged. |
| `deferred-will-ship` | D4 | A deferred REQ's commits (`[REQ-x]` subject tag or `Ref: REQ-x` trailer, ignoring `Release-Closeout:` commits) are on `develop` (not yet on `main`) and no pending, non-deferred ticket lists it under `Absorbed predecessor releases` — it will ship unapproved. |
| `predecessors-none` | D6 | A ticket says `Absorbed predecessor releases: None` while another pending `REQ-<n>` ticket has commits since the last tag (or the merge-base with `main`). TypeScript port of the guard in `generate-bundled-changes.sh`. |
| `bundle-members` | D7 | For a declared bundle (`BUNDLED-CHANGES-<core>.json`): a `co_tracked` member ticket is still pending after the core ticket was archived or released on the portal, or a member has its own orphan `draft` portal release. Report only. |
| `deferred-portal-sync` | D1 | A ticket declares `Release intent: deferred-to-next` but its portal release is `draft`/`uat_review`/`uat_rejected`/`uat_approved`, not `deferred`. Needs a portal key. |
| `deferred-ticket-sync` | D2 | The portal release is `deferred` but the pending ticket has no `Release intent: deferred-to-next` (the ticket field is the sole declaration; the portal never writes it back). This can be an accidental deferral, so the repair is a decision, not a default: record it in the ticket, resume the portal release, or leave it (#1083). |
| `deferral-age` | D5 | A `deferred` portal release is older than `deferral_max_age_days` (`sdlc-config.json`, a positive integer, default `30`; an invalid value falls back to 30 and is noted) or past its portal review-by date (`deferredUntil`). Age comes from the portal's `deferredAt`. |
| `releases` | D8 | The existing check in section 3: portal `released` while the ticket is still pending. |

D1, D2 and D5 need the portal (viewer key is enough) and report `skipped (…)` without one, exactly like D3/D7. The repairs for all of these are in [`devaudit doctor --fix`](#devaudit-doctor---fix); the manual portal route (below) remains the fallback.

**Defer and resume are admin-only.** The portal `deferred` state is entered/left with `POST /api/releases/[id]/defer` and `/resume`, which reject CI, API and viewer keys. They are session-only on the portal today: a personal access token sent to them is answered with a redirect to the HTML sign-in page, which the CLI client reports as "this portal route does not accept a personal access token; use the portal UI" instead of a success (#1099). Until the portal accepts a PAT there (metasession-dev/devaudit#923), defer and resume from the portal UI. The read-only viewer key `doctor` uses can never do this.

### Portal reads use the viewer key

Every portal read in `doctor` is read-only (`GET /api/ci/releases/resolve`) and uses `DEVAUDIT_VIEWER_API_KEY` from the environment or the repo-root `.env`, falling back to `DEVAUDIT_API_KEY`. Issue the viewer key with `devaudit install --with-viewer-key`. Key values are never printed. With neither key set, portal-backed checks report `skipped`.

### `--json` shape

`--json` keeps `ok`, `tools`, `releaseCloseoutDrift` and `onboarding` exactly as before (`onboarding` gained `deploy-host`, `production-url`, `custom-deploy` and `ci-runner` at the end, #1040, then `e2e-release-gate` and `test-tiers`, #1059/#1060) and adds (additively):

- `deferral` — the seven checks of section 4 (`[]` outside a consumer project).
- `proposals` — flat list (deploy/CI findings from `onboarding` are appended after the release ones) of `{ check, subject, detail, remediation }`, where `remediation` is `{ id, tier, summary, plan[], needsPortal, data? }` (tier `A` local + reversible, `B` portal state change, `C` git history/code; `data` carries the machine-readable parameters `--fix` uses, such as the ticket path and portal release id). Plain `doctor` only describes them.
- `fix` — only with `--fix`: `{ dryRun, outcomes[], unapplied }`, one outcome per proposal `{ id, check, subject, tier, status, message, uatApprovalIdsAtDefer? }` with `status` one of `applied`, `unchanged`, `planned`, `unapplied`, `failed`, `reported`.

## `devaudit doctor --fix`

`--fix` is opt-in, runs on **one** project (never with `--fleet`), and acts on the `proposals` of the run. Flags: `--yes` (global), `--reason <text>`, `--dry-run` (global).

| Tier | What | Rule |
| --- | --- | --- |
| **A** local + reversible | Ticket `Release intent` field, RTM `DEFERRED` row, `Absorbed predecessor releases` line (D4 when exactly one next ticket exists, D6); `host` in `sdlc-config.json` for a `deploy-host` mismatch (`set-config`, validated exactly like `devaudit configure set`, followed by the secrets and keys the new host still needs) | Confirm interactively, or accept with `--yes`. Edits are idempotent: a second run changes nothing. |
| **B** portal state change | Defer / resume (D1, D2, D3, D5) | **Interactive terminal only.** Needs the operator's PAT (`DEVAUDIT_USER_TOKEN` / `devaudit auth login`), a **typed reason** **and** an explicit confirmation. `--yes` and `--reason` never replace either, and there is no non-interactive path (#1099). An outcome is reported `applied` only on a confirming JSON response from the portal. Never uses `DEVAUDIT_API_KEY`, `DEVAUDIT_VIEWER_API_KEY` or any CI key: with only those available the action fails with a clear message. |
| **C** git history / code, or guidance | Reverting a deferred REQ's commits (D4 alternative); closing out a drifted release (`./scripts/close-out-release.sh <REQ>`); the `devaudit configure` command for a deploy/CI finding (`production-url`, `custom-deploy`, `ci-runner`, `e2e-release-gate`, `test-tiers`), including `devaudit configure secret <NAME>` for a missing secret | Never executed; the commands are printed and never count as unapplied. |

- **Interactive** (TTY, `CI` unset, no `--json`): prompts for the resolution (D3: defer / abandon / reopen; abandon and reopen are guidance only), the reason, and a final confirmation.
- **Non-interactive** (`--json`, no TTY, or `CI` set): never prompts. A proposal the flags do not authorise stays unapplied and the run exits `8`. Tier A needs `--yes`; tier B (including D3) is never applied non-interactively. A D5 stale deferral is never resumed non-interactively: it needs an interactive choice of resume / extend / abandon (only resume changes the portal). A D2 undeclared deferral is never decided non-interactively either: it needs an interactive choice of record / resume / leave. *Record* writes only the ticket's `Release intent` and the RTM `DEFERRED` row (use it when the deferral was intended); *resume* returns the portal release to `draft` (use it when the deferral was a mistake) and does not restore the UAT approvals the defer superseded, so they must be given again.
- **`--dry-run`** prints each step as `planned` and changes nothing (exit `0`).
- A failed portal call is reported with its cause (401 token rejected, 403 not an admin, 404 release not found, 409 wrong state, 422 invalid input, timeout) and counts as unapplied. If the local edits of a D3 defer were made before a portal failure, the next run's D1 proposes the portal step again.
- After a successful portal defer the portal records the UAT approvals it superseded in its audit field `uat_approval_ids_at_defer`; the ids returned by the portal (when it returns them) are printed and included in the JSON outcome. A successful resume also removes the ticket's `Release intent` and flips a `DEFERRED` RTM row back to `TESTED - PENDING SIGN-OFF`.
- Applied actions are always printed; secrets are never printed.
- Read-only runs (`doctor` without `--fix`) send only the viewer key to the portal, never the PAT. When `DEVAUDIT_USER_TOKEN` is set in the environment, `doctor` reports a `pat-env` note (the variable name, never the value): agent sessions started from that shell inherit it, so prefer `devaudit auth login`.

## `suspectedOrigin` tagging

Every onboarding-checklist and closeout-drift result carries a first-pass `suspectedOrigin: 'framework' | 'consumer-drift' | 'unknown'` (devaudit-installer#867):

- **`consumer-drift`** — the check reflects this consumer's own repo state (e.g. a missing file, a missing secret).
- **`unknown`** — the check depends on the operator's local machine/auth state rather than either repo (e.g. `secrets`/`pre-push-hook` when `gh` isn't authenticated).
- **`framework`** — reserved for cases that point at the framework/portal itself rather than anything a consumer could have done.

Tool-preflight checks (`node`/`git`/`gh`/`jq`/`curl`) are untagged — they describe the operator's own machine, not either repo. This is a *first-pass* signal: [`fleet-doctor`](./fleet-doctor.md) re-evaluates it with cross-consumer evidence (the same anomaly across every consumer is strong evidence for `framework`; one consumer diverging from every sibling is strong evidence for `consumer-drift`) rather than trusting the single-repo tag as final.

## Plugin extension point: `onDoctor`

Plugins can extend `doctor` via the `onDoctor` lifecycle hook (`plugin-sdk/src/lifecycle.ts`), invoked at the end of `runDoctor` via `discoverPlugins`/`runHook`, after the built-in checks have run. Two example implementations:

- [`plugins/devaudit-plugin-prisma/src/hooks/on-doctor.ts`](../plugins/devaudit-plugin-prisma/src/hooks/on-doctor.ts) — checks Prisma schema/migrations layout.
- [`plugins/devaudit-plugin-evidence-export/src/hooks/on-doctor.ts`](../plugins/devaudit-plugin-evidence-export/src/hooks/on-doctor.ts).

See [`plugin-sdk/README.md`](../plugin-sdk/README.md) for the general plugin-authoring contract and the full lifecycle-hook list; `onDoctor` follows the same `LoadedPlugin`/context shape as the other lifecycle hooks (`beforeSync`, `afterSync`, etc.).

## `--fleet`: sweeping every project you can see

`devaudit doctor --fleet` (devaudit-installer#861) is a self-service, multi-tenant fleet sweep — any DevAudit account can run it, not just Metasession's own operator tooling:

1. Calls `GET /api/projects` on the portal with your `DEVAUDIT_USER_TOKEN` to list every project your account can see (org membership or an explicit access grant — enforced portal-side by the same authz every other API call goes through). This is the actual tenant-isolation boundary: it is structurally impossible to see, let alone sweep, a project outside your own access, because the portal never returns it.
2. For each project with a `repo_url`, looks for a local checkout as a sibling of the current directory (`../<repo-name>`, matching the naming convention `fleet-doctor`'s Discover phase already used) — not found locally is a skip, not a failure.
3. As defense-in-depth (`repo_url` is an unverified string on the portal, not a proven ownership link — see devaudit-installer#861's design notes), confirms the local checkout's own `git remote get-url origin` actually matches `repo_url` before running anything against it; a mismatch is skipped.
4. Runs `devaudit doctor --json` against each matched local checkout and reports the aggregate — `--json` for machine consumption, human-readable otherwise.

**`--fleet` is read-only and never forwards `--fix`** (`doctor --fleet --fix` / `--reason` are rejected with exit `2`; repair one project at a time). It never files issues, opens branches, or otherwise acts on your behalf — it only reports. Automated write actions (filing upstream issues, driving hotfixes, invoking `sdlc-implementer`) are a separate, deliberate choice layered on top — see [`docs/fleet-doctor.md`](./fleet-doctor.md) for how Metasession's own operator automation does this for its own fleet using `--fleet` as its discovery+collection step.

## See also

- [`docs/configure.md`](./configure.md) — `devaudit configure` and the `devaudit-configure` skill: validated changes to `sdlc-config.json` and repo secrets.
- [`docs/fleet-doctor.md`](./fleet-doctor.md) — Metasession's own automated fleet sweep, built on top of `devaudit doctor --fleet`, adding org-boundary enforcement and automated write actions for its own consumers.
- [`docs/onboarding.md`](./onboarding.md) — run `devaudit doctor` after `devaudit install` to confirm onboarding actually landed.
- [`docs/sdlc-framework.md`](./sdlc-framework.md) — how `doctor` fits into verifying the SDLC process is implemented and healthy, not just described.
