# Onboarding a new project

> **This is the operator's onboarding flow** — the first developer setting up a fresh DevAudit project. If you're a second / nth developer joining an **already-onboarded** project, see [`sdlc/files/_common/joining-an-existing-project.md`](../sdlc/files/_common/joining-an-existing-project.md) instead. `devaudit install` is destructive against team-shared state (repo secrets, branch protection); the second-dev path uses `devaudit join` which leaves all of that alone.

Onboarding collapses the v1.23.0 manual onboarding sequence (9 steps) into **two operator actions**:

1. Issue a Personal Access Token at `https://devaudit.metasession.co/settings/tokens`.
2. Run `devaudit install <consumer-path>` with the token exported.

Everything else — DevAudit project creation, API key issuance, GitHub secrets/variables, hook framework install, branch protection, first template sync — is handled by the CLI.

Onboarding is driven by the **`@metasession.co/devaudit-cli`** npm package (binary `devaudit`) — a cross-platform, native TypeScript tool with JSON output mode (`--json`) for CI. The package **ships the framework templates inside it**, so no DevAudit-Installer checkout is required. (The earlier bash installer, `scripts/sdlc-onboard.sh`, has been removed; the CLI is the only supported path.)

This document describes the underlying flow.

## Prerequisites

On the operator's machine:

- `git`, `gh` (GitHub CLI), `jq`, `curl`.
- `gh` authenticated against the consumer's GitHub repo with admin scope (`gh auth login`).
- Either `pre-commit` (for Python stacks) or `npx` (for Node stacks) available — the installer bootstraps the hook framework via these.
- Node ≥ 22 and the CLI installed: `npm install -g @metasession.co/devaudit-cli`.

On the DevAudit side:

- The operator has a DevAudit user account.
- That user is signed in to `https://devaudit.metasession.co`.

## Step 1 — Issue a Personal Access Token

1. Visit `https://devaudit.metasession.co/settings/tokens`.
2. Click **Create token**. Name it something memorable, e.g. `onboarding-cli`.
3. Copy the plaintext token shown once (`mctok_…`).

The PAT carries the operator's identity. Project creation, API key issuance, and audit-log entries all attribute to the operating user.

## Step 2 — Run the installer

Provide the token either by exporting it or with `devaudit auth login` (caches to `~/.config/devaudit/auth.json`):

```bash
export DEVAUDIT_USER_TOKEN="mctok_…"     # or: devaudit auth login
devaudit install ../path/to/new-consumer
```

If `sdlc-config.json` already exists in the target, `install` runs non-interactively from it (and preserves customisations like `app_env` / `build_env` / `e2e_*`); otherwise it prompts for the remaining values. The CLI will:

1. **Authenticate** — validates the PAT against DevAudit; aborts if invalid.
2. **Detect the stack and working directory** — reads `pyproject.toml` / `package.json` to infer `python` / `node` and find the manifest location.
3. **Configure** — interactive prompts for the remaining values (project slug, runtime version, source dirs, working directory, production URL secret name + value).
4. **Write `sdlc-config.json`** in the consumer's directory.
5. **Create the DevAudit project** (idempotent — skips if a project with this slug already belongs to the operator).
6. **Issue a project-scoped API key** named `Onboarding-issued` (idempotent — won't re-issue if one already exists; will warn).
7. **Set GitHub secrets** via `gh secret set`:
   - `DEVAUDIT_API_KEY` (the just-issued key)
   - `DEVAUDIT_USER_TOKEN` (the PAT)
   - The production URL secret (e.g. `META_AGENT_PROD_URL`)
8. **Set the GitHub variable** `DEVAUDIT_BASE_URL`.
9. **Bootstrap the hook framework** — `pre-commit install` for Python, `npx husky init` for Node.
10. **Configure branch protection on `main`** — required status checks: `Compliance Validation`, `DevAudit Release Approval`, `Quality Gates`. (Required-approving-reviews set to 0 by default; raise to 1+ once your team has more than one admin.)
11. **Sync framework templates** — populates all framework files in the consumer (SDLC/ stage docs, INSTRUCTIONS.md, AI pointer files, hooks, scripts, CI workflows) from the templates bundled in the CLI. Equivalent to a `devaudit update` run.

The consumer's working tree is left dirty so the operator can review the diff before committing.

## Step 3 — Review and ship the onboarding PR

```bash
cd ../new-consumer
git status                # confirm the files synced
git checkout -b feat/sdlc-onboarding
git add -A
git commit -m "feat: onboard <slug> to Metasession SDLC"
git push -u origin feat/sdlc-onboarding
gh pr create --base main
```

Open the PR for review. Once merged, the project is fully active under the SDLC framework.

### Step 3a — Replace the governance starters before your first production release

Step 11/12 of `devaudit install` (**Bootstrap governance docs**) dropped five starter templates into `compliance/governance/`:

- `ropa.md` — GDPR Art. 30
- `dpia.md` — GDPR Art. 35
- `ai-disclosure.md` — EU AI Act Art. 13
- `incident-report.md` — ISO 29119 3.5.4 / SOC 2 CC7.2 / GDPR Art. 33–34
- `periodic-review.md` — SOC 2 CC4.1 / ISO 27001 A.12.1

**Each file is a stub, not defensible audit evidence.** The first line of every file is a prominent `⚠️ STARTER TEMPLATE — REPLACE BEFORE GOING TO PRODUCTION` banner that intentionally renders inline in the portal so the placeholder status can't be missed.

Open each file, replace the `REPLACE — …` placeholders with content that reflects your project's actual processing activities / risks / response plan, and commit. The portal's framework-coverage panel will flip the corresponding clauses to COVERED on the next release after these land on `develop`.

See [`governance-templates.md`](./governance-templates.md) for the per-framework mapping and authoritative external references (ICO ROPA template, EDPB DPIA guidelines, NIST AI RMF, etc.).

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
- Template sync is idempotent (same inputs → same outputs).

## Worked example: onboarding META-AGENT (historical trace)

A trace of an early `devaudit install ../META-AGENT` run (the bash installer it replaced produced the same 11-step flow). The META-AGENT onboarding has since been reverted (META-AGENT is no longer an active consumer — see [consuming-projects.md](./consuming-projects.md)), but the trace is preserved here as a concrete demonstration of what onboarding does:

```text
══════════════════════════════════════════════════════════════
  Metasession SDLC Onboarding
  Consumer:  META-AGENT
  Path:      /home/william/Documents/SoftwareProjects/Metasession/META-AGENT
  DevAudit:  https://devaudit.metasession.co
══════════════════════════════════════════════════════════════

== 1/11 · Authenticate with DevAudit ==
  ✓ PAT accepted; DevAudit reachable at https://devaudit.metasession.co

== 2/11 · Detect stack and host ==
  ✓ Stack:                python
  ✓ Working directory:    mission-control-api
  ✓ Host (default):       railway

== 3/11 · Configure ==
  Project slug [meta-agent]:
  Python version [3.11]:
  Source dirs (space-sep) [src/ tests/]:
  Working directory [mission-control-api]:
  Production URL secret name [META_AGENT_PROD_URL]:
  Production URL (https://...): https://meta-agent.metasession.co

== 4/11 · Write sdlc-config.json ==
  ✓ Written to .../META-AGENT/sdlc-config.json

== 5/11 · Create / find DevAudit project ==
  ✓ Project 'meta-agent' created (id 4f3a2b1c…)

== 6/11 · Issue project API key ==
  ✓ API key issued (will be stored as repo secret DEVAUDIT_API_KEY)

== 7/11 · Set GitHub repo secrets and variables ==
  ✓ DEVAUDIT_API_KEY (secret)
  ✓ DEVAUDIT_USER_TOKEN (secret)
  ✓ META_AGENT_PROD_URL (secret)
  ✓ DEVAUDIT_BASE_URL (variable) = https://devaudit.metasession.co

== 8/11 · Bootstrap hook framework ==
  ✓ pre-commit hooks installed

== 9/11 · Configure branch protection on main ==
  ✓ Branch protection on main: required checks ["Compliance Validation","DevAudit Release Approval","Quality Gates"]
  ⚠ Required approving reviews set to 0 — raise to 1+ once your team has multiple admins.

== 10/11 · Sync SDLC templates ==
  ... 31 files synced ...
  ✓ Templates synced

== 11/11 · Done ==

  META-AGENT is onboarded.

  Next steps:
    cd .../META-AGENT
    git status
    git checkout -b feat/sdlc-onboarding
    git add -A
    git commit -m "feat: onboard meta-agent to Metasession SDLC"
    git push -u origin feat/sdlc-onboarding
    gh pr create --base main
```

Total wall time: ~30 seconds (assuming PAT already issued).

## Troubleshooting

| Symptom                                         | Cause                                       | Fix                                                                     |
| ----------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------- |
| `PAT rejected (HTTP 401)`                       | Token expired, revoked, or typo'd           | Re-issue at `/settings/tokens` and re-export                            |
| `Could not detect stack`                        | No `pyproject.toml` or `package.json` found | Create the dependency manifest first                                    |
| `Branch protection API call failed`             | `gh` token lacks admin scope on the repo    | `gh auth refresh -s admin:org` (or admin:repo)                          |
| `An 'Onboarding-issued' API key already exists` | Re-run after first onboarding               | Revoke the old key in the portal, then re-run                           |
| `pre-commit not on PATH`                        | Operator's machine doesn't have it          | `pip install pre-commit` then re-run (or manually `pre-commit install`) |

## See also

- [STACK_ADAPTER.md](../sdlc/STACK_ADAPTER.md) — the stack-adapter contract.
- [HOST_ADAPTER.md](../sdlc/HOST_ADAPTER.md) — the host-adapter contract.
- [ADR-001](./ADR/ADR-001-polyglot-sdlc-architecture.md) — why the framework is layered this way.
- [adding-a-stack.md](./adding-a-stack.md) / [adding-a-host.md](./adding-a-host.md) — adding new stacks or hosts.
