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

If `sdlc-config.json` already exists in the target, `install` runs non-interactively from it (and preserves customisations like `app_env` / `build_env` / `e2e_*`); otherwise it prompts for the remaining values. The CLI will:

1. **Authenticate** — validates the PAT against DevAudit; aborts if invalid.
2. **Detect the stack and working directory** — reads `pyproject.toml` / `package.json` to infer `python` / `node` and find the manifest location.
3. **Configure** — interactive prompts for the remaining values (project slug, runtime version, source dirs, working directory, production URL secret name + value).
4. **Write `sdlc-config.json`** in the consumer's directory.
5. **Create the DevAudit project** (idempotent — skips if a project with this slug already belongs to the operator).
6. **Issue a project-scoped API key** named `Onboarding-issued` (idempotent — won't re-issue if one already exists; will warn). This key carries the `uploader` role — write access to evidence upload and release status for this one project — and is consumed **only by CI**; never export it locally, never hand it to an agent (see [`permissions-and-tokens-reference.md`](./articles/permissions-and-tokens-reference.md) for why).
   - **Optional:** pass `--with-viewer-key` to also issue a second, read-only `viewer`-role key (`Onboarding-issued (viewer)`), stored as `DEVAUDIT_VIEWER_API_KEY`. A viewer key can only reach the portal's read-back endpoints (`GET .../checks`, `GET .../cycles`) — never upload evidence or approve a release — so, unlike the uploader key, it's safe to persist locally for an agent (e.g. `sdlc-implementer`) to query release/check/cycle status. The raw value is printed to the terminal once, at mint time (devaudit-installer#945) — see "Opting into the read-only viewer key" below for how to capture it. Off by default; existing installs are unaffected. See devaudit#867.
7. **Set GitHub secrets** via `gh secret set`:
   - `DEVAUDIT_API_KEY` (the just-issued uploader key)
   - `DEVAUDIT_VIEWER_API_KEY` (only if `--with-viewer-key` was passed)
   - The production URL secret (e.g. `META_AGENT_PROD_URL`)

   (`DEVAUDIT_USER_TOKEN` — the PAT itself — is **not** written as a repo secret; devaudit-installer#912 removed that, since nothing in generated CI ever consumed it. It stays exactly where Step 2 put it: your local `devaudit auth login` cache or exported env var.)
8. **Set the GitHub variable** `DEVAUDIT_BASE_URL`.
9. **Bootstrap the hook framework** — `pre-commit install` for Python, `npx husky init` for Node.
10. **Set the default branch** to `integration_branch` (`develop` unless overridden in `sdlc-config.json`) — idempotent, no-op if already correct. GitHub creates every repo with `main` as default; without this, a contributor using GitHub's own UI (new-branch dropdown, "Compare & pull request") lands on `main` instead of `develop`, silently skipping the real Quality Gates workflow (which only triggers on PRs to the integration branch). See devaudit#731. Its sibling key, `release_branch` (`main` unless overridden), is where the tracked-release promotion PR (Step 3's follow-up) targets — override either if your repo uses different branch names.
11. **Configure branch protection** on both `main` (the release branch) and `develop` (the integration branch) — required status checks: `Compliance Validation`, `DevAudit Release Approval`, `Quality Gates`. Keep third-party hosting checks such as Vercel / Railway / Cloudflare informational unless you intentionally want them to gate merges. (Required-approving-reviews set to 0 by default; raise to 1+ once your team has more than one admin.)
12. **Sync framework templates** — populates all framework files in the consumer from the templates bundled in the CLI. Includes: SDLC/ stage docs, the canonical `INSTRUCTIONS.md`, the per-agent rule files (`AGENTS.md` for Codex/AGENTS-compatible agents, `CLAUDE.md` for Claude Code, `.cursorrules` for Cursor, `.windsurfrules` for Windsurf, `GEMINI.md` for Gemini CLI), the `.claude/skills/` orchestrator + sibling skills (Claude Code only — the other agents read `INSTRUCTIONS.md` on demand instead of auto-firing), git hooks, scripts, and CI workflows. Equivalent to a `devaudit update` run. **Any LLM-driven agent works** — Copilot, Aider, Continue, etc. read `INSTRUCTIONS.md` directly; the listed agents get a more ergonomic rule-file mechanism on top.

Want a stronger E2E safety net than the default blocking smoke gate? See [`e2e-test-tiers.md`](./e2e-test-tiers.md#opting-into-the-3-tier-regression-gate) for the opt-in 3-tier (`smoke`/`critical`/`regression`) model and its `devaudit update --enable-e2e-regression` flag — most projects don't need it.

The consumer's working tree is left dirty so the operator can review the diff before committing.

### Host-adapter prerequisites

Beyond the secrets `install` sets automatically (step 7 above), your chosen host adapter (`host` in `sdlc-config.json`; each declares its own `required_secrets` and quirks in `sdlc/files/hosts/<host>/adapter.json` — see [`HOST_ADAPTER.md`](../sdlc/HOST_ADAPTER.md)) may need a bit more:

| Host | Extra repo secret(s) | Local/runner tool | Why |
| --- | --- | --- | --- |
| `railway` | `RAILWAY_TOKEN` (advisory — only needed if the recovery path is ever used) | `railway` CLI on `PATH` for whoever runs self-hosted-runner jobs | Consumed only by `reconcile-deployment.yml`, the manual recovery workflow for when Railway's `deployment_status` webhook fails to reach GitHub (devaudit-installer#841). Not needed for normal push-to-main CI. |
| `vercel` | none | none | Vercel's own Git integration handles deploy + status; no reconciliation workflow is generated for this host. |

`devaudit doctor`'s `secrets` and `railway-cli` checks (devaudit-installer#843) read the same `adapter.json` data, so they never drift from this table — a `railway`-host consumer missing `RAILWAY_TOKEN` or the CLI sees an advisory warning, and a `vercel` (or any non-Railway) consumer never sees either check fire.

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

## Opting into the read-only viewer key

`DEVAUDIT_API_KEY` — the key `install` issues by default (Step 2, item 6) — carries the `uploader` role: it can upload evidence and mutate release state for this one project. It's meant for **CI only**, set as a repo secret and never exported to a local shell or handed to an AI coding agent — a leaked uploader key can forge evidence or approve a release on your behalf.

`DEVAUDIT_VIEWER_API_KEY` (devaudit#867) is the safe alternative: a second, project-scoped key with the `viewer` role, which can only reach the portal's read-back endpoints (`GET .../checks`, `GET .../cycles`, release lookup) — it can never upload evidence or approve anything. That's what makes it the one credential in this system safe to persist locally or hand to an agent. `sdlc-implementer` (devaudit-installer#876) now prefers it automatically for Phase 5's portal-state read whenever `sdlc-config.json` has one configured, falling back to the uploader key otherwise — see [`permissions-and-tokens-reference.md`](./articles/permissions-and-tokens-reference.md) for the full credential model.

**Capturing the raw value (devaudit-installer#945).** GitHub repo secrets are write-only — nothing, including `gh secret list`, can read one back after it's set. So `install` prints the raw value to the terminal exactly once, immediately after it's minted, with an explicit "won't be shown again" warning and the literal command to persist it:

```
⚠ DEVAUDIT_VIEWER_API_KEY (read-only, safe to persist locally) — shown once, will not be shown again:
  <raw-value>

Add it to this project's .env now: echo "DEVAUDIT_VIEWER_API_KEY=<raw-value>" >> .env
```

Copy it into `.env` right then — there's no later recovery path. `.env`/`.env.local` are unconditionally gitignored by DevAudit's sentinel entries, so this can't land in a commit. If you miss it, there's no "show me again" command by design (same reasoning as a cloud provider's one-time access-key display); recover by revoking the key in the portal UI and re-running `devaudit install --force-team-config --with-viewer-key`, which mints a fresh one and prints it the same way.

**What it covers.** Phase 5's "read portal state" lookup, and any other read-only status check you point it at — nothing more.

**What it doesn't cover — the write-side gap.** Every `sdlc-implementer` step below still writes, and no key (viewer or uploader) currently ships with a "hand this to an agent safely" story for writes — the viewer key structurally can't do them, and the uploader key is the same one CI uses, never meant to leave CI secrets:

| Step | Script | Needs |
| --- | --- | --- |
| Phase 1 step 3 — create the portal release | `scripts/upload-evidence.sh` | Uploader key (write) |
| Phase 4/5 — record a UAT execution | `scripts/record-uat-execution.sh` | Uploader key (write) |
| Post-deploy — report test execution | `scripts/report-test-execution.sh` | Uploader key (write) |
| Deployment reconciliation | `scripts/reconcile-railway-deployment.sh` (or the equivalent for your host adapter) | Uploader key (write) |

**The design decision (devaudit-installer#845):** these stay operator/CI-only by design — a session running `sdlc-implementer` locally without the uploader key should expect to hand these specific steps to CI's own automatic runs or to the operator, not treat it as a missing-credential bug to work around. A narrower third key (e.g. a "record-only" role that can create releases and record UAT/test executions but never approve one) was considered and rejected for now — it would be new portal-side scope with its own blast-radius analysis, not something to build speculatively ahead of a concrete operator-experience problem it solves. If that changes, revisit here.

**At fresh install**, pass the flag to issue both keys in one step:

```bash
devaudit install ../path/to/new-consumer --with-viewer-key
```

**Retrofitting onto an already-onboarded consumer** — the actual gap this section exists for — needs `--force-team-config` too, since issuing a new repo secret is one of the operator-mode-only steps that plain `install` skips once a project is fully onboarded (see Step 2's mode-detection notice):

```bash
devaudit install --force-team-config --with-viewer-key
```

This is idempotent — it warns and leaves the existing key alone if one was already issued, rather than reissuing it. `--force-team-config` on its own also re-affirms every other team-shared config (repo secrets, branch protection) beyond just the viewer key, so only reach for it here when retrofitting the viewer key is actually what you want — not as a routine re-run.

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
| Click "Approve" in the Release Approval UI | Four-eyes regulatory control; the whole point of the framework.            |
| Review and approve the onboarding PR       | Code review is a control. (See `Compliance Validation` for the soft gate.) |

Everything else is automated.

## Idempotence

Re-running the script on the same consumer is safe:

- `sdlc-config.json` is overwritten with the wizard answers (rerun applies the new answers).
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
  Project slug [meta-agent]:
  Python version [3.11]:
  Source dirs (space-sep) [src/ tests/]:
  Working directory [example-python-service]:
  Production URL secret name [META_AGENT_PROD_URL]:
  Production URL (https://...): https://meta-agent.metasession.co

== 4/12 · Write sdlc-config.json ==
  ✓ Written to .../EXAMPLE-PYTHON-SERVICE/sdlc-config.json

== 5/12 · Create / find DevAudit project ==
  ✓ Project 'meta-agent' created (id 4f3a2b1c…)

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
    git commit -m "feat: onboard meta-agent to Metasession SDLC"
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
  ✓ railway-cli     skipped (reconcile-deployment.yml not present)

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
- [`articles/permissions-and-tokens-reference.md`](./articles/permissions-and-tokens-reference.md) — every credential this flow issues, including the optional viewer key, and what's at risk if each leaks.
- [devaudit#867](https://github.com/metasession-dev/devaudit/issues/867) — the umbrella issue for the viewer-key + read-back API + fleet-doctor work referenced above.
