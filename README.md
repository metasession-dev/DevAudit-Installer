# DevAudit Installer

> **DevAudit is more than a self-hosted compliance evidence portal — it enforces an SDLC that satisfies ISO 29119, ISO 27001, SOC 2, GDPR, and the EU AI Act.** Whether you're a vibe coder, traditional engineer, or non-technical builder, DevAudit ensures your software development lifecycle meets the requirements auditors actually check.

This repo — `DevAudit-Installer` — is the **framework + client** side of DevAudit: the SDLC you run and the tooling that gets installed into your project. It holds two of DevAudit's three pillars:

1. **The SDLC framework** (`sdlc/`) — stage docs, templates, per-stack/host adapters, and AI skills (`sdlc-implementer`, `e2e-test-engineer`).
2. **The CLI + compliance gates** (`cli/`, `plugin-sdk/`, `plugins/*`, and the CI workflow templates under `sdlc/files/ci/`) — what onboards your project and what runs on every push/PR to feed the portal.

The third pillar — the **evidence portal** (the product/server side: what you see, the source of truth for releases, evidence, and approvals) — lives at [`metasession-dev/devaudit`](https://github.com/metasession-dev/devaudit) (running at <https://devaudit.metasession.co>). **Topics are split, not duplicated:** the product story, standards coverage, the portal UI, release lifecycle/approvals, and the API are documented there; the CLI, onboarding, the SDLC process, the skills, and the workflows that upload evidence are documented here. Each side cross-references the other.

Start at the portal for the big picture:

- [What is DevAudit](https://github.com/metasession-dev/devaudit/blob/main/docs/what-is-devaudit.md) — the three pillars in depth
- [Standards coverage](https://github.com/metasession-dev/devaudit/blob/main/docs/standards-coverage.md) — clause-by-clause mapping for ISO 29119 / ISO 27001 / SOC 2 / GDPR / EU AI Act

## Install the CLI

```sh
npm install -g @metasession.co/devaudit-cli
devaudit --help
```

Requires Node ≥ 22. Native binaries (no Node runtime) via brew / scoop / `curl | sh` are on the roadmap — see [`docs/devaudit-cli/`](./docs/devaudit-cli/README.md).

| Package | Purpose |
|---|---|
| [`@metasession.co/devaudit-cli`](https://www.npmjs.com/package/@metasession.co/devaudit-cli) | The `devaudit` binary |
| [`@metasession.co/devaudit-plugin-sdk`](https://www.npmjs.com/package/@metasession.co/devaudit-plugin-sdk) | Plugin contract types |
| [`@metasession.co/devaudit-plugin-prisma`](https://www.npmjs.com/package/@metasession.co/devaudit-plugin-prisma) | First-party plugin — Prisma migration hooks |
| [`@metasession.co/devaudit-plugin-evidence-export`](https://www.npmjs.com/package/@metasession.co/devaudit-plugin-evidence-export) | First-party plugin — bulk evidence bundle export |

## Quick start — onboard a consumer project

```bash
# 1. Issue a DevAudit Personal Access Token at https://devaudit.metasession.co/settings/tokens
export DEVAUDIT_USER_TOKEN="mctok_..."

# 2. Run the CLI against your consumer project's repo
devaudit install ../path/to/your-consumer-project
```

The native onboarding flow validates the PAT, detects your stack (Node/Python) + host (Railway), creates the project + a CI API key in the portal, sets GitHub secrets and branch protection on `main`, bootstraps the hook framework, syncs the framework templates, and drops five **starter** governance docs (ROPA, DPIA, AI disclosure, incident report, periodic review) into `compliance/governance/` — then leaves the tree dirty for you to review + open an onboarding PR. **The governance starters are stubs you must replace before going to production** — see [`docs/governance-templates.md`](./docs/governance-templates.md). Full walkthrough: [`docs/onboarding.md`](./docs/onboarding.md).

**Joining a project that's already been onboarded?** You're the second (or nth) developer — `install` is the *operator's* command and would silently rotate the team's CI secrets. Use `devaudit join` instead. Full guide: [`sdlc/files/_common/joining-an-existing-project.md`](./sdlc/files/_common/joining-an-existing-project.md) (synced into every consumer's `SDLC/`).

## Quick start — keep a consumer in sync

When the framework is updated, re-sync each consumer. The common case is *"from inside the consumer's repo"* — a bare `update` syncs the current directory:

```bash
# from inside the consumer's repo (the common case):
npx @metasession.co/devaudit-cli@latest update

# from anywhere, syncing one or several:
devaudit update <label> ../consumer-1 ../consumer-2
```

The CLI reads each consumer's `sdlc-config.json`, copies the templates from its bundled `sdlc/files/`, fires plugin `beforeSync`/`afterSync` hooks, and leaves the tree dirty for review. It bundles the framework, so it needs no DevAudit-Installer checkout at runtime.

## The SDLC at a glance

Trunk-based (`develop` → `main`), one owner-developer partnered with AI agents. Every tracked change runs five stages:

```
0 Project setup → 1 Plan (REQ-XXX, risk, plan) → 2 Implement & test (gates green)
→ 3 Compile evidence (+ UAT verification) → 4 Submit for review (PR + UAT four-eyes)
→ 5 Deploy to main (prod smoke + Production approval)
```

- **Default path:** the **`sdlc-implementer`** skill takes one GitHub issue through Stages 1–5 unattended (pausing at the portal UAT gate), delegating e2e work to **`e2e-test-engineer`**.
- **When it's NOT used:** trivial/housekeeping changes (`docs`/`chore`/`ci`…) skip the ceremony; e2e-only or planning-only work is done directly. Implementation commits (`feat`/`fix`/`refactor`/`perf`) **must** cite a `[REQ-XXX]` — enforced by commitlint + `validate-commits.sh`.

→ Which workflow applies to which change type, and what release each produces: [**`docs/change-workflows.md`**](./docs/change-workflows.md).
→ The stage-by-stage operational walkthrough (synced into every consumer): [**`implementing-an-sdlc-issue.md`**](./sdlc/files/_common/implementing-an-sdlc-issue.md).

## Architecture

The framework follows a three-layer polyglot adapter pattern ([ADR-001](./docs/ADR/ADR-001-polyglot-sdlc-architecture.md)):

- **Process layer** (`sdlc/files/_common/`) — stage docs 0–5, test policies, evidence shape, skills. Stack-agnostic.
- **Stack adapters** (`sdlc/files/stacks/<name>/`) — language-specific commands and hooks (Node, Python today).
- **Host adapters** (`sdlc/files/hosts/<name>/`) — deployment-specific deploy-wait and prod-URL logic (Railway today).

Adding a new stack or host means dropping a new `adapter.json` + supporting files; no installer-script changes. The CLI substitutes each consumer's `sdlc-config.json` into the templates at `install`/`update` time.

## Documentation

**This repo (framework, CLI, process):**

| Doc | What |
|---|---|
| [`docs/onboarding.md`](./docs/onboarding.md) | `devaudit install` operator walkthrough |
| [`docs/consuming-projects.md`](./docs/consuming-projects.md) | Operator manual for consumer maintainers |
| [`docs/sdlc-framework.md`](./docs/sdlc-framework.md) | Framework structure, tiers, adapter layering, schematic |
| [`docs/governance-templates.md`](./docs/governance-templates.md) | Five starter templates (ROPA, DPIA, AI disclosure, incident report, periodic review) installed once into `compliance/governance/`. **Replace before going to production.** |
| [`docs/change-workflows.md`](./docs/change-workflows.md) | Change types → workflow → release type, and what to expect |
| [`sdlc/files/_common/implementing-an-sdlc-issue.md`](./sdlc/files/_common/implementing-an-sdlc-issue.md) | Operational stage-by-stage walkthrough (synced to consumers) |
| [`sdlc/SKILLS.md`](./sdlc/SKILLS.md) · [`docs/adding-a-skill.md`](./docs/adding-a-skill.md) | The skills (`sdlc-implementer`, `e2e-test-engineer`) + authoring new ones |
| [`docs/adding-a-stack.md`](./docs/adding-a-stack.md) · [`docs/adding-a-host.md`](./docs/adding-a-host.md) | Adapter contracts |
| [`INSTRUCTIONS.md`](./INSTRUCTIONS.md) | Working conventions for this repo |

**Portal repo (product, server, the things you see):**

| Doc | What |
|---|---|
| [What is DevAudit](https://github.com/metasession-dev/devaudit/blob/main/docs/what-is-devaudit.md) | The three pillars, value proposition |
| [Standards coverage](https://github.com/metasession-dev/devaudit/blob/main/docs/standards-coverage.md) | Clause-by-clause standards mapping |
| [Portal ↔ consumer integration](https://github.com/metasession-dev/devaudit/blob/main/docs/ci-integration.md) | API, evidence categories, when/how artifacts are displayed |
| [Releases & approvals](https://github.com/metasession-dev/devaudit/blob/main/docs/releases-and-approvals.md) | Release lifecycle states, types, four-eyes approval |
| [Implementing an SDLC issue](https://github.com/metasession-dev/devaudit/blob/main/docs/implementing-an-sdlc-issue.md) | Audience walkthrough with sample AI prompts |

## Related repositories

| Repo | Role |
|---|---|
| [`metasession-dev/devaudit`](https://github.com/metasession-dev/devaudit) | DevAudit evidence portal (Next.js, `devaudit.metasession.co`). Product/standards/portal-UI/release docs live there; the authoritative consumers table too. |
| [`metasession-dev/wawagardenbar-app`](https://github.com/metasession-dev/wawagardenbar-app) | Active consumer — Node/Next.js on Railway. |
| [`metasession-dev/META-JOBS`](https://github.com/metasession-dev/META-JOBS) | Active consumer — Node. |

## Contributing

See [`INSTRUCTIONS.md`](./INSTRUCTIONS.md) for working conventions, and the `adding-a-stack.md` / `adding-a-host.md` / `adding-a-skill.md` guides for adding framework artefacts. DevAudit-Installer does not run its own SDLC against itself — CI green is the merge bar.
