# DevAudit Installer

> Single source of truth for the Metasession SDLC framework — templates, adapter manifests, AI-tool rule files, and installer scripts that onboard a consumer project to the compliance pipeline.

The DevAudit web portal (the running compliance service at <https://devaudit.metasession.co>) lives in a separate repository (`META-COMPLY`). This repo holds everything a consumer project needs to adopt the Metasession SDLC and to push evidence to the portal.

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

The current onboarding flow is the bash installer. A polished CLI (`devaudit`) is in design — see [`docs/devaudit-cli/`](./docs/devaudit-cli/README.md).

```bash
# 1. Issue a DevAudit Personal Access Token at https://devaudit.metasession.co/settings/tokens
export DEVAUDIT_USER_TOKEN="mctok_..."

# 2. Run the installer against your consumer project's repo
cd path/to/DevAudit-Installer
./scripts/sdlc-onboard.sh ../path/to/your-consumer-project
```

The script will:

1. Validate the PAT against the DevAudit portal.
2. Detect your project's stack (Node or Python) and host (Railway).
3. Create the project record in DevAudit and issue a project API key.
4. Set the GitHub repo secrets and apply branch protection on `main`.
5. Bootstrap the hook framework (husky for Node, pre-commit for Python).
6. Sync framework templates (`SDLC/`, workflows, scripts, hooks, AI rule files).
7. Leave the working tree dirty for you to review + commit + open an onboarding PR.

Full walkthrough: [`docs/onboarding.md`](./docs/onboarding.md).

## Quick start — syncing an existing consumer

When the framework is updated (a new version is tagged on this repo), re-sync each consumer:

```bash
cd path/to/DevAudit-Installer
./scripts/sync-sdlc.sh v1.x.y ../path/to/consumer-1 ../path/to/consumer-2
```

The script tags the framework, then for each consumer it:

- Reads the consumer's `sdlc-config.json` to resolve their stack + host adapters
- Copies all templates from `sdlc/files/` into the consumer's tree
- Installs any missing devDependencies declared by the stack adapter
- Leaves the working tree dirty for you to review + commit

## Architecture

The framework follows a three-layer polyglot adapter pattern (ADR-001 in `docs/ADR/`):

- **Process layer** (`sdlc/files/_common/`) — stage docs 0–5, test policies, evidence shape. Stack-agnostic.
- **Stack adapters** (`sdlc/files/stacks/<name>/`) — language-specific commands and hooks (Node, Python today).
- **Host adapters** (`sdlc/files/hosts/<name>/`) — deployment-specific deploy-wait and prod-URL logic (Railway today).

Adding a new stack or host means dropping a new `adapter.json` + supporting files; no installer-script changes required.

## Future direction

The bash installer is being replaced by a single-binary CLI (`devaudit`) that supports multi-stack, multi-provider Git, organisation policy enforcement, and a plugin marketplace. Design and engineering plan: [`docs/devaudit-cli/`](./docs/devaudit-cli/README.md).

## Related repositories

| Repo | Role |
|---|---|
| `metasession-dev/META-COMPLY` | DevAudit web portal (the running service at devaudit.metasession.co) |
| `metasession-dev/META-ATS`, `META-JOBS`, `wawagardenbar-app`, `META-AGENT` | Consumer projects using this framework |

## Contributing

See [`INSTRUCTIONS.md`](./INSTRUCTIONS.md) for the working conventions in this repo, and the `adding-a-stack.md` / `adding-a-host.md` / `adding-a-skill.md` guides for adding new framework artefacts.
