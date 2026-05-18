# Onboarding a new project

`scripts/sdlc-onboard.sh` collapses the v1.23.0 manual onboarding sequence (9 steps) into **two operator actions**:

1. Issue a Personal Access Token at `https://devaudit.metasession.co/settings/tokens`.
2. Run the onboarding script with the token exported.

Everything else — DevAudit project creation, API key issuance, GitHub secrets/variables, hook framework install, branch protection, first template sync — is handled by the script.

## Prerequisites

On the operator's machine:

- `bash`, `jq`, `curl`, `gh` (GitHub CLI).
- `gh` authenticated against the consumer's GitHub repo with admin scope (`gh auth login`).
- Either `pre-commit` (for Python stacks) or `npx` (for Node stacks) available — the script bootstraps the hook framework via these.

On the DevAudit side:

- The operator has a DevAudit user account.
- That user is signed in to `https://devaudit.metasession.co`.

## Step 1 — Issue a Personal Access Token

1. Visit `https://devaudit.metasession.co/settings/tokens`.
2. Click **Create token**. Name it something memorable, e.g. `onboarding-cli`.
3. Copy the plaintext token shown once (`mctok_…`).

The PAT carries the operator's identity. Project creation, API key issuance, and audit-log entries all attribute to the operating user.

## Step 2 — Run the onboarding script

```bash
cd path/to/DevAudit-Installer
export META_COMPLY_USER_TOKEN="mctok_…"
./scripts/sdlc-onboard.sh ../path/to/new-consumer
```

The script will:

1. **Authenticate** — validates the PAT against DevAudit; aborts if invalid.
2. **Detect the stack and working directory** — reads `pyproject.toml` / `package.json` to infer `python` / `node` and find the manifest location.
3. **Configure** — interactive prompts for the remaining values (project slug, runtime version, source dirs, working directory, production URL secret name + value).
4. **Write `sdlc-config.json`** in the consumer's directory.
5. **Create the DevAudit project** (idempotent — skips if a project with this slug already belongs to the operator).
6. **Issue a project-scoped API key** named `Onboarding-issued` (idempotent — won't re-issue if one already exists; will warn).
7. **Set GitHub secrets** via `gh secret set`:
   - `META_COMPLY_API_KEY` (the just-issued key)
   - `META_COMPLY_USER_TOKEN` (the PAT)
   - The production URL secret (e.g. `META_AGENT_PROD_URL`)
8. **Set the GitHub variable** `META_COMPLY_BASE_URL`.
9. **Bootstrap the hook framework** — `pre-commit install` for Python, `npx husky init` for Node.
10. **Configure branch protection on `main`** — required status checks: `Compliance Validation`, `DevAudit Release Approval`, `Quality Gates`. (Required-approving-reviews set to 0 by default; raise to 1+ once your team has more than one admin.)
11. **Run `sync-sdlc.sh`** — populates all framework files in the consumer (SDLC/ stage docs, INSTRUCTIONS.md, AI pointer files, hooks, scripts, CI workflows).

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

## What the script can't do (and why)

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

## Worked example: onboarding META-AGENT

A trace of what `./scripts/sdlc-onboard.sh ../META-AGENT` looked like the first time:

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
  ✓ API key issued (will be stored as repo secret META_COMPLY_API_KEY)

== 7/11 · Set GitHub repo secrets and variables ==
  ✓ META_COMPLY_API_KEY (secret)
  ✓ META_COMPLY_USER_TOKEN (secret)
  ✓ META_AGENT_PROD_URL (secret)
  ✓ META_COMPLY_BASE_URL (variable) = https://devaudit.metasession.co

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
