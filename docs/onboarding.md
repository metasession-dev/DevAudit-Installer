# Onboarding a new project

> **This is the operator's onboarding flow** — the first developer setting up a fresh DevAudit project. If you're a second / nth developer joining an **already-onboarded** project, see [`sdlc/files/_common/joining-an-existing-project.md`](../sdlc/files/_common/joining-an-existing-project.md) instead. `devaudit install` is destructive against team-shared state (repo secrets, branch protection); the second-dev path uses `devaudit join` which leaves all of that alone.

Onboarding replaces the legacy manual setup sequence with **two operator actions**:

1. Issue a Personal Access Token at `https://devaudit.ai/settings/tokens`.
2. Run `npx @metasession.co/devaudit-cli@latest install <consumer-path>` with the token exported.

Everything else — DevAudit project creation, API key issuance, GitHub secrets/variables, hook framework install, branch protection, first template sync — is handled by the CLI.

Onboarding is driven by the **`@metasession.co/devaudit-cli`** npm package (binary `devaudit`) — a cross-platform, native TypeScript tool with JSON output mode (`--json`) for CI. The package **ships the framework templates inside it**, so no DevAudit-Installer checkout is required. (The earlier bash installer, `scripts/sdlc-onboard.sh`, has been removed; the CLI is the only supported path.) `npx` is the canonical zero-install invocation and pulls the latest version on first run; for a permanent install run `npm install -g @metasession.co/devaudit-cli` once, then the short forms `devaudit install` / `devaudit update` / `devaudit join` work everywhere.

This document describes the underlying flow.

## Prerequisites

On the operator's machine:

- `git`, `gh` (GitHub CLI), `jq`, `curl`.
- `gh` authenticated against the consumer's GitHub repo with admin scope (`gh auth login`).
- Either `pre-commit` (for Python stacks) or `npx` (for Node stacks) available — the installer bootstraps the hook framework via these.
- Node ≥ 22. The CLI itself does not need a global install — `npx @metasession.co/devaudit-cli@latest …` pulls it on first run. For repeat use, install globally: `npm install -g @metasession.co/devaudit-cli`.

On the DevAudit side:

- The operator has a DevAudit user account.
- That user is signed in to `https://devaudit.ai`.

## Step 1 — Issue a Personal Access Token

1. Visit `https://devaudit.ai/settings/tokens`.
2. Click **Create token**. Name it something memorable, e.g. `onboarding-cli`.
3. Copy the plaintext token shown once (`mctok_…`).

The PAT carries the operator's identity. Project creation, API key issuance, and audit-log entries all attribute to the operating user.

## Step 2 — Run the installer

Provide the token either by exporting it or with `devaudit auth login` (caches to `~/.config/devaudit/auth.json`):

```bash
export DEVAUDIT_USER_TOKEN="mctok_…"     # or: devaudit auth login

# Canonical zero-install invocation:
npx @metasession.co/devaudit-cli@latest install ../path/to/new-consumer

# Equivalent if you've run `npm install -g @metasession.co/devaudit-cli`:
devaudit install ../path/to/new-consumer
```

`install`/`join`/`uninstall` also each accept `--token <token>` (skips the env var / cached-login lookup for this one invocation) and `--base-url <url>` (points at a non-production portal — defaults to `DEVAUDIT_BASE_URL` env or `https://devaudit.ai`). Useful for a one-off run against a different account or a staging portal without touching your ambient environment. The global `--org <slug>` flag (any command) overrides which org context the invocation runs under, for an operator with access to more than one.

With `--yes`, `install` runs non-interactively from an existing `sdlc-config.json` (and preserves customisations like `app_env` / `build_env` / `e2e_*`); without it, `install` is guided and asks for the remaining values. The CLI will:

1. **Authenticate** — validates the PAT against DevAudit; aborts if invalid.
2. **Detect the stack and working directory** — reads `pyproject.toml` / `package.json` to infer `python` / `node` and find the manifest location.
3. **Configure** — the guided install ([Presets and the guided install](#presets-and-the-guided-install)): it detects what it can, suggests a preset, and shows one summary to accept, change or expand into every question (project slug, runtime version, source dirs, working directory and production URL secret are in the detailed questions).
4. **Write `sdlc-config.json`** in the consumer's directory. This file is the per-consumer source of truth that `devaudit update` leaves alone; see [`sdlc-config.json`: what it is, why `update` leaves it alone, how parameters get in](consuming-projects.md#sdlc-configjson-what-it-is-why-update-leaves-it-alone-how-parameters-get-in) for how values the wizard did not ask about get in later.
5. **Create the DevAudit project** (idempotent — skips if a project with this slug already belongs to the operator).
6. **Issue a project-scoped API key** named `Onboarding-issued` (idempotent — won't re-issue if one already exists; will warn). This key carries the `uploader` role — write access to evidence upload and release status for this one project — and is consumed **only by CI**; never export it locally, never hand it to an agent (see [`permissions-and-tokens-reference.md`](./credentials.md) for why).
   - **Your own viewer key** is issued by default (`viewer:<your email>:<hostname>`, read-only) and saved in the DevAudit config folder, never in the repo or a repo secret. Opt out with `--no-viewer-key`; see [`credentials.md`](./credentials.md).
7. **Set GitHub secrets** via `gh secret set`:
   - `DEVAUDIT_API_KEY` (the just-issued uploader key)
   - The production URL secret (e.g. `META_AGENT_PROD_URL`)

   (`DEVAUDIT_USER_TOKEN` — the PAT itself — is **not** written as a repo secret; devaudit-installer#912 removed that, since nothing in generated CI ever consumed it. It stays exactly where Step 2 put it: your local `devaudit auth login` cache or exported env var.)
8. **Set the GitHub variable** `DEVAUDIT_BASE_URL`.
9. **Bootstrap the hook framework** — `pre-commit install` for Python, `npx husky init` for Node.
10. **Set the default branch** to `integration_branch` (`develop` unless overridden in `sdlc-config.json`) — idempotent, no-op if already correct. GitHub creates every repo with `main` as default; without this, a contributor using GitHub's own UI (new-branch dropdown, "Compare & pull request") lands on `main` instead of `develop`, silently skipping the real Quality Gates workflow (which only triggers on PRs to the integration branch). See devaudit#731. Its sibling key, `release_branch` (`main` unless overridden), is where the tracked-release promotion PR (Step 3's follow-up) targets — override either if your repo uses different branch names.
11. **Configure branch protection** on both `main` (the release branch) and `develop` (the integration branch) — required status checks: `Compliance Validation`, `DevAudit Release Approval`, `Quality Gates`. Keep third-party hosting checks such as Vercel / Railway / Cloudflare informational unless you intentionally want them to gate merges. (Required-approving-reviews set to 0 by default; raise to 1+ once your team has more than one admin.) Every change into `develop`, template syncs included, must run `Quality Gates`: never put a skip-CI tag in a commit message on a PR branch, because GitHub then creates no check run and the PR stays BLOCKED (#1020).
12. **Sync framework templates** — populates all framework files in the consumer from the templates bundled in the CLI. Includes: SDLC/ stage docs, the canonical `INSTRUCTIONS.md`, the per-agent rule files (`AGENTS.md` for Codex/AGENTS-compatible agents, `CLAUDE.md` for Claude Code, `.cursorrules` for Cursor, `.windsurfrules` for Windsurf, `GEMINI.md` for Gemini CLI), the `.claude/skills/` orchestrator + sibling skills (Claude Code only — the other agents read `INSTRUCTIONS.md` on demand instead of auto-firing), git hooks, scripts, and CI workflows. Equivalent to a `devaudit update` run. **Any LLM-driven agent works** — Copilot, Aider, Continue, etc. read `INSTRUCTIONS.md` directly; the listed agents get a more ergonomic rule-file mechanism on top.

Want a stronger E2E safety net than the default blocking smoke gate? See [`e2e-test-tiers.md`](./e2e-test-tiers.md#opting-into-the-3-tier-regression-gate) for the opt-in 3-tier (`smoke`/`critical`/`regression`) model and its `devaudit update --enable-e2e-regression` flag — most projects don't need it.

The consumer's working tree is left dirty so the operator can review the diff before committing.

### Presets and the guided install

An interactive `devaudit install` (devaudit-installer#1116) does not start with 24 questions. It detects your stack, test runner and test groups (smoke, critical, full), deploy host, branches and runner, reads the project's approval policy from the portal when the project already exists, and suggests one **preset**: A solo and fast, B safety net, C team with a compliance lead, D the same as C with the full pack run once, before merge. [`presets.md`](./presets.md) says what each runs at the five moments, the evidence it produces and the gap it carries. A preset that cannot be offered is listed with the reason (for example "it needs a full test pack and none was found", or "this portal does not yet allow a solo approver; ask its operator to upgrade"); `custom` is always available and asks each setting.

You then see a summary, one line per setting, with a compliance line that is recomputed after every change. Choose **Yes** to write it, **Change one thing** to answer one setting's question and see the summary again, or **Detailed questions** to be asked everything that applies, with the summary's values as the defaults. An answer that departs from the preset is recorded as `custom` in `onboarding_preset`. Flags such as `--release-gate-tier` override the preset's value and are not asked.

A preset that means you approve your own releases (A, B, or answering "I approve my own") also needs the project's portal approval policy to allow it. Install asks before it sets that (it needs a project admin), and if the portal does not support it the repository keeps "approved by a different person" and says so in one line.

| Flag | Meaning |
| --- | --- |
| `--preset <A\|B\|C\|D\|custom>` | Apply that preset without the preset question. With `--yes`, A and B read the approval policy from the portal and refuse (exit code 2) unless it already allows self-approval with a recorded gap; C, D and `custom` need no check. |
| `--from-scan <file>` | Take the suggested preset and the standards from a scan report file. A report id is a portal feature that is not available yet (exit code 2). |

Re-running `install` on a project that has a configuration but no `onboarding_preset` offers "Keep my current settings" first and applies no preset or policy unless you choose one. `devaudit join` asks nothing and writes no preset or policy; it prints the project's preset. `--yes` without `--preset` behaves as before.

### Starting with no tests

A project that answers "not yet" to the end-to-end tests question gets preset A suggested, and B, C and D are not offered. The path from there to a gated release:

1. **Finish the install on preset A.** Smoke only is not yet a gate, so A (smoke tests block the merge, approval by the author, the gap recorded) is the preset that fits. Use `custom` instead when A is not offered (the portal does not allow a solo approver yet) or when the team wants a different person to approve (Q11 "a different person"; preset A would record a gap the team does not want).
2. **Write the first tests.** Use the `e2e-test-engineer` skill to bootstrap a suite and add smoke tests (its Phase 1b and Phase 5; a requirement and an approved plan come first).
3. **Run `devaudit doctor`.** The `test-tiers` check should now pass.
4. **Run `devaudit configure`** to enable critical or full when those tests exist; the Q4 to Q8 answers update through the detection already there.

The closing lines of a guided install that found no smoke tests say the same, and name `custom` when preset A was not offered. The `devaudit-configure` skill carries the same section.

### Test tiers and the release gate

`devaudit install` can record how your tests are tiered and which tier gates a release (devaudit-installer#1059, #1060). Nothing is written unless a flag or an answer names it, so a project that skips this keeps today's behaviour. The same keys can be set any time with `devaudit configure set`.

| Flag | Writes | Notes |
| --- | --- | --- |
| `--release-gate-tier <none\|smoke\|critical\|full>` | `release_gate_tier` | The E2E tier that must pass on the PR into the release branch. Needs `e2e_regression_enabled`. |
| `--post-deploy-full-regression <true\|false>` | `post_deploy_full_regression` | Whether the full regression also runs after the production deploy. |
| `--scheduled-full-regression <cron>` | `scheduled_full_regression` | Five-field cron for a nightly full run on the integration branch. |
| `--test-runner <playwright\|pytest>` | `test_runner` | `pytest` selects the pytest tier workflows. |
| `--test-tier-smoke`, `--test-tier-critical`, `--test-tier-full <command>` | `test_tier_*` | A single-line command per tier. |
| `--test-feature-command <command>` | `test_feature_command` | Must contain `{REQ}`. |

Values are validated exactly as `devaudit configure set` validates them, and a bad value stops the install before anything is touched.

Interactive runs detect the test runner and propose tiers: Playwright projects are used as they are, a pytest repo is offered the pytest tier workflows, and a Jest or Vitest repo gets editable proposed commands (blank skips a tier). Where `e2e_regression_enabled` is already true the run also asks which tier gates the release PR, with `critical` (today's behaviour) as the default. A flag or an existing key means that question is not asked. `--yes` applies only flags. A gate flag on a project that has not enabled the regression workflow is accepted and takes effect once it does (`devaudit update --enable-e2e-regression`); the install summary says so.

The summary ends with a pointer to `devaudit doctor`, whose `test-tiers` and `e2e-release-gate` checks review the choice later, and to the `e2e-test-engineer` skill for a project with no smoke tests yet.

### Host-adapter prerequisites

**Choosing the host (devaudit-installer#1022).** `devaudit install --host <name>` records `host` in `sdlc-config.json` (interactive runs ask; `--yes` keeps the host already recorded, else `railway`). Re-running `install` never resets a recorded host. Valid names are the adapters under `sdlc/files/hosts/`; an unknown name fails with the list. Optional secret on any host: `DEVAUDIT_PROBE_HEADER`, one full header line (e.g. `x-vercel-protection-bypass: <token>`) that `post-deploy-prod.yml` sends with the independent health probe and smoke checks, for a production origin behind an access gate; unset means unauthenticated probes, as before.

**Already onboarded with the wrong host, or the setup changed later?** Every project onboarded before 1.9.0 has `host: railway`, because `install` used to hardcode it. Run `devaudit doctor`: its `deploy-host` check compares the recorded host with where production really deploys (who created the production GitHub deployments, committed host files) and `devaudit doctor --fix` sets it. Change anything else (production URL secret, probe header, custom deploy settings, runner) with [`devaudit configure`](configure.md), or let the `devaudit-configure` skill walk you through it in Claude Code; then `devaudit update`. See [doctor.md](doctor.md#how-to-use-doctor).

Beyond the secrets `install` sets automatically (step 7 above), your chosen host adapter (`host` in `sdlc-config.json`; each declares its own `required_secrets` and quirks in `sdlc/files/hosts/<host>/adapter.json` — see [`HOST_ADAPTER.md`](../sdlc/HOST_ADAPTER.md)) may need a bit more:

| Host | Extra repo secret(s) | Local/runner tool | Why |
| --- | --- | --- | --- |
| `railway` | `RAILWAY_TOKEN` (advisory — only needed if the recovery path is ever used) | `railway` CLI on `PATH` for whoever runs self-hosted-runner jobs | Consumed only by `reconcile-deployment.yml`, the manual recovery workflow for when Railway's `deployment_status` webhook fails to reach GitHub (devaudit-installer#841). Not needed for normal push-to-main CI. |
| `custom` | none by default; whatever `deploy_secrets` names (cloud credentials, an SSH key) | whatever `deploy_command` calls | Your deploy runs in the synced `deploy-custom.yml`, which records the GitHub deployment the production gate waits for. No webhook to lose, so no reconcile workflow. See [adding-a-host.md](adding-a-host.md#the-custom-host-aws-self-hosted-anything-devaudit-installer1022). |
| `vercel` | `VERCEL_TOKEN` (advisory — only needed if the recovery path is ever used; plus an optional `VERCEL_TEAM_ID` secret for a team project; the workflow passes both to the lookup) | none (the lookup uses curl + jq against the Vercel REST API) | Consumed only by `reconcile-deployment.yml`, the manual recovery workflow for when Vercel's `deployment_status` event never reaches GitHub (devaudit-installer#1022). Vercel's own Git integration handles deploy + status in normal operation. |

`devaudit doctor`'s `secrets` and `reconcile-cli` checks (devaudit-installer#843, #1022) read the same `adapter.json` data, so they never drift from this table — a `railway`-host consumer missing `RAILWAY_TOKEN` or the CLI, or a `vercel`-host consumer missing `VERCEL_TOKEN`, sees an advisory warning; `reconcile-cli` stays silent for Vercel because its lookup needs no CLI. The `deploy-host`, `production-url`, `custom-deploy` and `ci-runner` checks (devaudit-installer#1040) go further: they check the recorded host against the repo's real deploys, the production URL secret and an access-gated origin, the `custom` deploy keys, and that the CI runner label exists.

## Step 3 — Review and ship the onboarding PR

```bash
cd ../new-consumer
git status                # confirm the files synced
git checkout -b feat/sdlc-onboarding
git add -A
git commit -m "feat: onboard <slug> to Metasession SDLC"
git push -u origin feat/sdlc-onboarding
gh pr create --base develop
```

Open the PR for review. Once merged, the project is active under the SDLC framework on `develop` — promote `develop` to `main` via a separate release PR when you're ready to go live (see devaudit#731).

### Pre-existing files and conflicts

`install` writes into a fixed set of paths (`.github/workflows/`, `.husky/`, `scripts/`, `.claude/skills/`, pointer files, and more — see `docs/consuming-projects.md#what-update-touches-precisely`). Since devaudit-installer#930, if your project already has a file at one of those paths — most commonly your own `.github/workflows/ci.yml`, `.prettierrc.json`, or `.husky/pre-commit` from before onboarding — `install` does **not** overwrite it. Devaudit has no record of ever writing that file, so it can't prove it's safe to replace; instead it's left exactly as it is, the framework's own version is written to `<path>.devaudit-new` next to it, and the conflict is reported at the end of the run (and any time afterward via `devaudit doctor`'s `sync-conflicts` check).

For most of these paths the fix is to migrate your existing content into devaudit's equivalent (a `sdlc-config.json` key, `.devaudit-patches/`, or simply deleting your version and taking `<path>.devaudit-new` if devaudit's is a superset). **`ci.yml` is the one exception worth calling out by name**: if your project already has its own `.github/workflows/ci.yml` doing something devaudit's generated Quality Gates workflow doesn't cover, don't try to make devaudit's file absorb it — rename your existing workflow to something like `.github/workflows/project-ci.yml` first (a plain `git mv`, no functional change), then re-run `install`. That frees the `ci.yml` filename for devaudit's own gate and lets both workflows run side by side.

### Step 3a — Author the governance docs before your first production release

`devaudit install` no longer auto-seeds governance docs (changed in v0.1.36 — placeholders were auto-uploading as evidence on first CI push). Two equivalent ways to produce them:

**Skill-driven (recommended).** Invoke the `governance-doc-author` skill — synced into every consumer at `.claude/skills/governance-doc-author/`. Six-phase flow per doc: route → confirm starter → gather source data → author → verify framework attribution → commit + portal-verify. The skill names which framework clauses each doc closes and ticks the per-section checklist as you go.

**Manual.** Run `npx @metasession.co/devaudit-cli@latest bootstrap-governance` (or `devaudit bootstrap-governance` if globally installed) to drop five starters into `compliance/governance/`:

- `ropa.md` — GDPR Art. 30
- `dpia.md` — GDPR Art. 35
- `ai-disclosure.md` — EU AI Act Art. 13
- `incident-report.md` — ISO 29119 3.5.4 / SOC 2 CC7.2 / GDPR Art. 33–34
- `periodic-review.md` — SOC 2 CC4.1 / ISO 27001 A.12.1

Each starter is a stub — first line is a prominent `⚠️ STARTER TEMPLATE — REPLACE BEFORE COMMITTING` banner. Each carries a `## Uploading this artefact` block + `## Framework checklist` section so you can tick each clause's requirements before commit.

Open each file, replace the `REPLACE — …` placeholders with content that reflects your project's actual processing activities / risks / response plan, and commit. The portal's framework-coverage panel will flip the corresponding clauses to COVERED on the next release after these land on `develop`.

See [`governance-templates.md`](./governance-templates.md) for the per-framework mapping and authoritative external references (ICO ROPA template, EDPB DPIA guidelines, NIST AI RMF, etc.).

### Step 3b — Bootstrap the Software Requirements Specification

`docs/SRS.md` is the project's living spec — what `e2e-test-engineer` derives tests from, and what `requirements-aligner` checks every future requirement against. Like the governance docs above, `devaudit install` deliberately does not author this for you: `requirements-aligner` explicitly refuses to write an SRS from scratch (it only maintains one that already exists), so this is the one manual bootstrap step in an otherwise-automated pipeline.

1. File an **SRS Bootstrap** issue in the consumer repo — synced by `install`/`update` to `.github/ISSUE_TEMPLATE/srs-bootstrap.yml`. It walks through identifying the project's Must/Should/Could/Won't requirements using MoSCoW prioritisation.
2. Work the issue from `SDLC/SRS_TEMPLATE.md` (synced alongside the stage docs in step 11 above) — it has the `REQ-AREA-NNN` ID scheme, the MoSCoW conventions, and two worked Given/When/Then examples to copy the format from.
3. Commit the result as `docs/SRS.md` on `develop`.

From the next requirement onward, use the **Requirement** issue template instead of SRS Bootstrap again — `requirements-aligner` takes over incremental maintenance automatically (advisory at Stage 1, blocking at Stage 3, per `sdlc-config.json`'s `requirements_aligner` defaults).

## Your viewer key and the other credentials

`DEVAUDIT_API_KEY`, the key `install` issues for CI, is the uploader key: **CI only**, never exported locally and never handed to an agent. Reads of portal state use your own **viewer key**, issued by default by `install` and `join` and saved in `~/.config/devaudit/viewer-keys.json`. The full model (who holds which credential, where it lives, lookup order, rotate and revoke, what to do when someone leaves) is in [`credentials.md`](./credentials.md). If AI coding agents work in this project, also add the recommended permission rules that keep their sessions away from your PAT: [`agent-permissions.md`](./agent-permissions.md) (optional; `devaudit doctor` tells you whether they are in place).

Retrofitting a project that was onboarded before the viewer key was per person: run `devaudit join` (or `devaudit auth viewer-key set` if you already have a key).

## Polyglot monorepos (multiple targets in one repo) — deprecated

> **Deprecated, scheduled for removal.** The `targets`/`--add-target` mechanic described below is not properly supported and will be removed in a future release. **Do not onboard new polyglot-monorepo projects.** `example-polyglot-app` is currently the one known consumer still using it (see [`consuming-projects.md`](./consuming-projects.md)); everyone else should onboard each independently-gated stack as its own separate repo/consumer instead. `install --add-target` now refuses for any repo that doesn't already have an existing `targets` array — see below.

By default, `install` describes one repo as one stack: `sdlc-config.json`'s flat top-level fields (`stack`, `working_directory`, `devaudit.project_slug`, etc.) are sugar for a single implicit target. The `targets` array below let a polyglot monorepo — one GitHub repo with more than one independently-gated stack — onboard each stack as its own target instead of separate repos:

```jsonc
{
  // present only once there's more than one target — a single-target repo
  // never has this key, and its flat fields keep meaning what they always did
  "targets": [
    { "name": "example-polyglot-api", "stack": "python", "working_directory": "example-polyglot-api", "devaudit": { "project_slug": "example-polyglot-api", "api_key_secret": "EXAMPLE_POLYGLOT_API_API_KEY" } },
    { "name": "example-polyglot-ui", "stack": "node", "working_directory": "example-polyglot-ui", "devaudit": { "project_slug": "example-polyglot-ui", "api_key_secret": "EXAMPLE_POLYGLOT_UI_API_KEY" } }
  ]
}
```

(a real excerpt from `example-polyglot-app`'s current `sdlc-config.json` — the one consumer still using this mechanic; see the deprecation notice above.)

**Onboarding a second target.** Run `install` again, pointed at the new target's subdirectory, with `--add-target`:

```bash
devaudit install ../monorepo/example-polyglot-ui --add-target
```

Without `--add-target`, `install` refuses (rather than clobbering) when it detects the target directory/slug doesn't match what's already configured. Given the deprecation above, `--add-target` now also refuses outright for any repo that doesn't already have an existing `targets` array — it no longer accepts first-time adoption. For a repo that already has `targets`, it still reads the existing config, migrates a legacy flat config to the `targets` array shape if needed, and appends the new target — the first target's fields are preserved untouched.

**What becomes target-aware once `targets` has more than one entry:**

- **CI workflow files** are namespaced per target: `ci.yml` → `ci-example-polyglot-api.yml` / `ci-example-polyglot-ui.yml`, and the job/check names inside them get a `(example-polyglot-api)` / `(example-polyglot-ui)` suffix so two targets' pipelines don't collide on the same filename or check name.
- **Trigger paths** are scoped to each target's `working_directory`, so a commit touching only `example-polyglot-ui/` doesn't fire `example-polyglot-api`'s pipeline and vice versa (a target at the repo root can't be scoped this way and keeps unscoped triggers).
- **`api_key_secret` names** are derived per target (not the single `DEVAUDIT_API_KEY` every single-target repo uses) — GitHub repo secrets are repo-scoped, not per-directory, so reusing that name across targets would have the second target's install silently overwrite the first target's key.
- **Branch protection** required checks are applied per target (`Quality Gates (web)`, `Quality Gates (api)`, …) via a read-merge-write against GitHub's API — a second target's `install`/`--add-target` run unions its check into whatever's already required rather than replacing the list, so it can't silently drop another target's requirement.
- **`devaudit update`** resyncs every target's namespaced CI files and re-verifies branch protection for all of them in one run, not just the most-recently-installed target.
- **Hook framework bootstrap** (husky for a Node target, pre-commit for a Python target) coexists in one repo: whichever framework bootstraps second delegates into the first's hook file (via a `pre-commit run --hook-stage commit "$@"` line appended to `.husky/pre-commit`) instead of git's single `core.hooksPath` silently dropping the first framework's checks.

Single-target repos are unaffected by all of the above — no `targets` array, no namespacing, byte-identical output to pre-#689 installs.

## What onboarding can't do (and why)

Some operations remain out of scope by design:

| Step                                       | Why                                                                        |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| Sign you up for DevAudit                   | Identity establishment is a user action, not an automated one.             |
| Issue the first PAT                        | Chicken-and-egg: the PAT is the auth credential the script consumes.       |
| Walk REQ-001 through Stages 0–5            | Product decisions (what to build, what risk class) belong to humans.       |
| Click "Approve" in the Release Approval UI | The approval control: a different person under `dual_actor`, a recorded gap under `solo_with_gap`. |
| Review and approve the onboarding PR       | Code review is a control. (See `Compliance Validation` for the soft gate.) |

Everything else is automated.

## Idempotence

Re-running the script on the same consumer is safe:

- `sdlc-config.json` is rewritten with the wizard-owned values from the current answers (stack, host, project slug, runtime version, working directory, source dirs, production URL secret, `devaudit` block); every other existing key (`app_env`, `build_env`, `e2e_*`, `database_*`, ...) is preserved.
- DevAudit project lookup returns the existing project; no duplicate created.
- API key issuance skips with a warning if `Onboarding-issued` already exists (revoke first in the portal if you want a fresh one).
- GitHub secrets/variables overwrite via `gh secret set` / `gh variable set`.
- Hook framework install is idempotent at the framework level.
- Branch protection re-applies via PUT (idempotent at the GH API).
- Template sync is idempotent (same inputs → same outputs), and manifest-driven since devaudit-installer#930: a file left untouched since the last sync updates silently, a hand-edited one is preserved and reported as a conflict rather than overwritten — see [Pre-existing files and conflicts](#pre-existing-files-and-conflicts) above.

## Worked example: onboarding EXAMPLE-PYTHON-SERVICE (historical trace)

A trace of an early `devaudit install ../EXAMPLE-PYTHON-SERVICE` run (the bash installer it replaced produced the same 11-step flow). The EXAMPLE-PYTHON-SERVICE onboarding has since been reverted (EXAMPLE-PYTHON-SERVICE is no longer an active consumer — see [consuming-projects.md](./consuming-projects.md)), but the trace is preserved here as a concrete demonstration of what onboarding does. The example below uses the historical `devaudit.ai` host from that period; current public entry points use `https://devaudit.ai`.

```text
══════════════════════════════════════════════════════════════
  Metasession SDLC Onboarding
  Consumer:  EXAMPLE-PYTHON-SERVICE
  Path:      /home/william/Documents/SoftwareProjects/Metasession/EXAMPLE-PYTHON-SERVICE
  DevAudit:  https://devaudit.ai
══════════════════════════════════════════════════════════════

== 1/12 · Authenticate with DevAudit ==
  ✓ PAT accepted; DevAudit reachable at https://devaudit.ai

== 2/12 · Detect stack and host ==
  ✓ Stack:                python
  ✓ Working directory:    example-python-service
  ✓ Host (default):       railway

== 3/12 · Configure ==
  Project slug [example-app]:
  Python version [3.11]:
  Source dirs (space-sep) [src/ tests/]:
  Working directory [example-python-service]:
  Production URL secret name [META_AGENT_PROD_URL]:
  Production URL (https://...): https://app.example.com

== 4/12 · Write sdlc-config.json ==
  ✓ Written to .../EXAMPLE-PYTHON-SERVICE/sdlc-config.json

== 5/12 · Create / find DevAudit project ==
  ✓ Project 'example-app' created (id 4f3a2b1c…)

== 6/12 · Issue project API key ==
  ✓ API key issued (will be stored as repo secret DEVAUDIT_API_KEY)

== 7/12 · Set GitHub repo secrets and variables ==
  ✓ DEVAUDIT_API_KEY (secret)
  ✓ META_AGENT_PROD_URL (secret)
  ✓ DEVAUDIT_BASE_URL (variable) = https://devaudit.ai

== 8/12 · Bootstrap hook framework ==
  ✓ pre-commit hooks installed

== 9/12 · Set default branch ==
  ✓ main -> develop

== 10/12 · Configure branch protection ==
  ✓ Branch protection on main: required checks ["Compliance Validation","DevAudit Release Approval","Quality Gates"]
  ✓ Branch protection on develop: required checks ["Quality Gates"]
  ⚠ Required approving reviews set to 0 — raise to 1+ once your team has multiple admins.

== 11/12 · Sync SDLC templates ==
  ... 31 files synced ...
  ✓ Templates synced

== 12/12 · Done ==

  EXAMPLE-PYTHON-SERVICE is onboarded.

  Next steps:
    cd .../EXAMPLE-PYTHON-SERVICE
    git status
    git checkout -b feat/sdlc-onboarding
    git add -A
    git commit -m "feat: onboard example-app to Metasession SDLC"
    git push -u origin feat/sdlc-onboarding
    gh pr create --base main
```

The command starts immediately, but the full operator onboarding flow usually takes about 5-10 minutes depending on prompts, GitHub API latency, and how much project-specific information you need to confirm.

## Verify the install

`install`'s own step-by-step output (as in the trace above) is optimistic — it reports what it *did*, not whether everything it wrote is actually in a healthy state (a secret write can silently fail, a hook bootstrap can be skipped on an unusual git layout, etc.). Run `devaudit doctor` right after onboarding finishes to confirm independently:

```bash
cd .../your-project
devaudit doctor
```

A clean run looks like:

```
Running devaudit doctor — checking required tools...

  ✓ node     v22.4.0 (require >=22)
  ✓ git      git version 2.45.0
  ✓ gh       gh version 2.55.0
  ✓ jq       jq-1.7.1
  ✓ curl     curl 8.5.0
  ✓ releases no pending release tickets
  ✓ srs             docs/SRS.md present
  ✓ rtm             compliance/RTM.md has at least one requirement row
  ✓ semgrep         1.78.0
  ✓ e2e-regression  not opted in
  ✓ secrets         all required secrets present (DEVAUDIT_API_KEY)
  ✓ pre-push-hook   present (.husky/pre-push)
  ✓ reconcile-cli   skipped (reconcile-deployment.yml not present)

All required tools present.
```

A realistic failure right after onboarding — a secret write that didn't take:

```
  ⚠ secrets         missing repo secret(s): DEVAUDIT_API_KEY — expected from `devaudit install`
```

That's a warning, not a tool-gate failure (exit code stays `0` unless a *required tool* is missing) — but it means something `install` was supposed to configure didn't land, and it's worth fixing before your first tracked requirement rather than discovering it when `requirements-aligner` or CI trips over it later. See [`docs/doctor.md`](./doctor.md) for the full check contract.

## Troubleshooting

| Symptom                                         | Cause                                       | Fix                                                                     |
| ----------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------- |
| `PAT rejected (HTTP 401)`                       | Token expired, revoked, or typo'd           | Re-issue at `/settings/tokens` and re-export                            |
| `Could not detect stack`                        | No `pyproject.toml` or `package.json` found | Create the dependency manifest first                                    |
| `Branch protection API call failed`             | `gh` token lacks admin scope on the repo    | `gh auth refresh -s admin:org` (or admin:repo)                          |
| `An 'Onboarding-issued' API key already exists` | Re-run after first onboarding               | Revoke the old key in the portal, then re-run                           |
| `pre-commit not on PATH`                        | Operator's machine doesn't have it          | `pip install pre-commit` then re-run (or manually `pre-commit install`) |

## See also

- [`docs/doctor.md`](./doctor.md) — the full `devaudit doctor` contract used in "Verify the install" above.
- [STACK_ADAPTER.md](../sdlc/STACK_ADAPTER.md) — the stack-adapter contract.
- [HOST_ADAPTER.md](../sdlc/HOST_ADAPTER.md) — the host-adapter contract.
- [ADR-001](./ADR/ADR-001-polyglot-sdlc-architecture.md) — why the framework is layered this way.
- [`docs/skills.md`](./skills.md) — the `requirements-aligner` skill that maintains `docs/SRS.md` after Step 3b's bootstrap.
- [adding-a-stack.md](./adding-a-stack.md) / [adding-a-host.md](./adding-a-host.md) — adding new stacks or hosts.
- [consuming-projects.md](./consuming-projects.md) — which consumers are polyglot-monorepo (`targets`, deprecated) vs single-target.
- [consuming-projects.md#offboarding-a-project](./consuming-projects.md#offboarding-a-project) — removing a project: `devaudit uninstall` reverses the steps this doc walks through.
- [`credentials.md`](./credentials.md) — every credential this flow issues, including your own viewer key, where each lives, the lookup order, and rotate / revoke / leaving.
- [devaudit#867](https://github.com/metasession-dev/devaudit/issues/867) — the umbrella issue for the viewer-key + read-back API + fleet-doctor work referenced above.
