# DevAudit Installer

> **DevAudit is more than a self-hosted compliance evidence portal — it enforces an SDLC that satisfies ISO 29119, ISO 27001, SOC 2, GDPR, and the EU AI Act.** Whether you're a vibe coder, traditional engineer, or non-technical builder, DevAudit ensures your software development lifecycle meets the requirements auditors actually check.

This repo — `DevAudit-Installer` — holds two of DevAudit's three pillars:

1. **The SDLC framework** (`sdlc/`) — stage docs, templates, adapters per stack/host, AI skills.
2. **The CLI + compliance gates** (`cli/`, `plugin-sdk/`, `plugins/*`, plus the CI workflow templates under `sdlc/files/ci/`) — what onboards your project and what runs on every push/PR.

The third pillar — the evidence portal — lives at [`metasession-dev/devaudit`](https://github.com/metasession-dev/devaudit) (running at <https://devaudit.metasession.co>). For the three-pillar story, the standards coverage map, and the end-to-end walkthrough, **start at the portal repo's docs**:

- [What is DevAudit](https://github.com/metasession-dev/devaudit/blob/main/docs/what-is-devaudit.md) — the three pillars in depth
- [Standards coverage](https://github.com/metasession-dev/devaudit/blob/main/docs/standards-coverage.md) — clause-by-clause mapping for ISO 29119 / ISO 27001 / SOC 2 / GDPR / EU AI Act
- [Implementing an SDLC issue](https://github.com/metasession-dev/devaudit/blob/main/docs/implementing-an-sdlc-issue.md) — GitHub issue → merged-and-deployed, with sample AI prompts at each stage

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

## What's in here

```
.
├── sdlc/                            # The framework templates (synced to consumers)
│   ├── ai-rules/                    # INSTRUCTIONS-SDLC.md + Claude/Cursor/Windsurf rule files
│   ├── files/                       # Templates emitted into consumer repos
│   │   ├── _common/                 # Universal: stage docs, scripts, skills
│   │   ├── ci/                      # Workflow templates (ci.yml, compliance, etc.)
│   │   ├── stacks/                  # Node + Python adapters (more to come)
│   │   └── hosts/                   # Railway adapter (more to come)
│   ├── .claude/                     # Claude Code skills used during framework maintenance
│   ├── article.md                   # Long-form article on the framework design
│   ├── CLAUDE.md                    # Guidance for AI tools editing the templates
│   ├── HOST_ADAPTER.md              # Contract for adding a host adapter
│   ├── STACK_ADAPTER.md             # Contract for adding a stack adapter
│   └── SKILLS.md                    # Contract for adding skills
├── scripts/
│   ├── sdlc-onboard.sh              # 11-step interactive consumer onboarding
│   ├── sync-sdlc.sh                 # Sync framework templates into existing consumers
│   ├── upload-evidence.sh           # Push evidence artefacts to the DevAudit portal
│   └── validate-adapter.cjs         # Validate stack/host/skill manifests against their schemas
├── docs/
│   ├── onboarding.md                # Operator walkthrough for sdlc-onboard.sh
│   ├── sdlc-framework.md            # Framework overview
│   ├── consuming-projects.md        # Operator manual for consumer maintainers
│   ├── adding-a-stack.md            # How to add a new stack adapter
│   ├── adding-a-host.md             # How to add a new host adapter
│   ├── adding-a-skill.md            # How to add a Claude Code skill
│   ├── devaudit-cli/                # Design docs for the proposed `devaudit` CLI
│   └── ADR/                         # Architectural decision records
└── INSTRUCTIONS.md                  # Standards for working in this repo
```

## Quick start — onboarding a consumer project

```bash
# 1. Issue a DevAudit Personal Access Token at https://devaudit.metasession.co/settings/tokens
export DEVAUDIT_USER_TOKEN="mctok_..."

# 2. Run the CLI against your consumer project's repo
devaudit install ../path/to/your-consumer-project
```

The 11-step native onboarding flow will:

1. Validate the PAT against the DevAudit portal.
2. Detect your project's stack (Node or Python) and host (Railway).
3. Create the project record in DevAudit and issue a project API key.
4. Set the GitHub repo secrets and apply branch protection on `main`.
5. Bootstrap the hook framework (husky for Node, pre-commit for Python).
6. Sync framework templates (`SDLC/`, workflows, scripts, hooks, AI rule files).
7. Leave the working tree dirty for you to review + commit + open an onboarding PR.

Full walkthrough: [`docs/onboarding.md`](./docs/onboarding.md).

## Quick start — syncing an existing consumer

When the framework is updated, re-sync each consumer:

```bash
devaudit update v1.x.y ../path/to/consumer-1 ../path/to/consumer-2
```

For each consumer the CLI:

- Reads the consumer's `sdlc-config.json` to resolve their stack + host adapters
- Copies all templates from `sdlc/files/` into the consumer's tree
- Fires plugin `beforeSync` / `afterSync` lifecycle hooks
- Leaves the working tree dirty for you to review + commit

### Legacy bash flow

The original bash scripts (`scripts/sdlc-onboard.sh`, `scripts/sync-sdlc.sh`) remain in-tree as a fallback for cases where the CLI can't be installed (e.g. no Node ≥ 22 available, air-gapped onboarding). Behaviour is equivalent; the CLI is the supported path going forward.

## Architecture

The framework follows a three-layer polyglot adapter pattern (ADR-001 in `docs/ADR/`):

- **Process layer** (`sdlc/files/_common/`) — stage docs 0–5, test policies, evidence shape. Stack-agnostic.
- **Stack adapters** (`sdlc/files/stacks/<name>/`) — language-specific commands and hooks (Node, Python today).
- **Host adapters** (`sdlc/files/hosts/<name>/`) — deployment-specific deploy-wait and prod-URL logic (Railway today).

Adding a new stack or host means dropping a new `adapter.json` + supporting files; no installer-script changes required.

## Future direction

The bash installer is being replaced by the `devaudit` CLI — **v0.1.x is published to npm today** (see "Install the CLI" above) and supports the install / update / push / doctor / status / auth / plugin command surface. End-state goals (multi-provider Git, organisation policy, multi-stack adapters beyond Node + Python, single-binary distribution via brew/scoop/curl) are tracked in the [design brief](./docs/devaudit-cli/README.md) and [build plan](./docs/devaudit-cli/build-plan.md).

## Related repositories

| Repo | Role |
|---|---|
| [`metasession-dev/devaudit`](https://github.com/metasession-dev/devaudit) | DevAudit evidence portal (Next.js app running at `devaudit.metasession.co`). The reframing / standards-coverage / SDLC-walkthrough docs live there. |
| [`metasession-dev/wawagardenbar-app`](https://github.com/metasession-dev/wawagardenbar-app) | Active consumer — Node/Next.js on Railway. |
| [`metasession-dev/META-AGENT`](https://github.com/metasession-dev/META-AGENT) | Active consumer — Python. |
| [`metasession-dev/META-JOBS`](https://github.com/metasession-dev/META-JOBS) | Active consumer — Node. Onboarded 2026-05-18. |
| `metasession-dev/META-ATS` | Onboarding paused (resumable). |

The current portal-side consumers table is the authoritative version: see [`README.md`](https://github.com/metasession-dev/devaudit/blob/main/README.md) §Consuming projects.

## Contributing

See [`INSTRUCTIONS.md`](./INSTRUCTIONS.md) for the working conventions in this repo, and the `adding-a-stack.md` / `adding-a-host.md` / `adding-a-skill.md` guides for adding new framework artefacts.
