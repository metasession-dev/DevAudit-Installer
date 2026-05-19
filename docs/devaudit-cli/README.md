# `devaudit` CLI — design brief

> Single binary for installing, maintaining, and operating the Metasession SDLC across any engineering organisation. Targets the enterprise end-state: multi-stack, multi-provider, policy-enforced, plugin-extensible.

## Naming glossary

A reader picking this up cold should know:

- **`devaudit`** — the CLI binary itself (what a user types in their terminal).
- **DevAudit-Installer** — this repository (`metasession-dev/DevAudit-Installer`). Holds the CLI source, the SDLC framework templates the CLI bundles, and the installer scripts the CLI eventually replaces.
- **DevAudit** — the running compliance portal at `devaudit.metasession.co` (source in `metasession-dev/META-COMPLY`). The CLI authenticates against it and uploads evidence to it.

## Vision

A single binary — `devaudit` — that lets any engineering organisation adopt the Metasession SDLC across their entire portfolio of projects from one command. Auth links to DevAudit (the compliance portal at `devaudit.metasession.co`). Artefacts upload automatically. Organisation-level policies enforce compliance baselines across every project. Plugins extend the CLI for stack-specific or organisation-specific needs.

The CLI source lives in this repo alongside the templates it bundles, so a CLI release and a template release ship from the same commit. There is no cross-repo coordination for routine template changes — the binary and the templates it embeds move together.

The experience matches what developers already expect from tools like the Vercel CLI, Supabase CLI, Firebase CLI, GitHub CLI, and Railway CLI — but with the depth that compliance-bound organisations need: policy-as-code, RBAC, centralised reporting, multi-provider Git, multi-stack support.

This document describes the **end-state**. No incremental phasing is exposed — the CLI ships as the enterprise-ready product. The engineering sequencing required to get there is captured separately in [build-plan.md](./build-plan.md).

## Current state — what already exists

This CLI is a **port and expansion** of capabilities that already ship as bash scripts and templates in this repo. The underlying logic exists; the CLI wraps it in a polished UX and adds the enterprise features (multi-provider Git, org policy, plugins) that bash can't economically deliver:

| Capability                                          | Implemented today as                                                                                                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Onboard a new consumer                              | `DevAudit-Installer/scripts/sdlc-onboard.sh` (11-step interactive bash flow, PR [#305](https://github.com/metasession-dev/devaudit/pull/305))                                           |
| Sync framework templates to consumers               | `DevAudit-Installer/scripts/sync-sdlc.sh` (reads `sdlc-config.json`, applies stack + host adapters)                                                                                     |
| Upload evidence to the portal                       | `DevAudit-Installer/scripts/upload-evidence.sh`                                                                                                                      |
| Stack/host abstraction (foundation for multi-stack) | `sdlc/files/stacks/{node,python}/adapter.json` + `sdlc/files/hosts/railway/adapter.json` (polyglot architecture, [#287](https://github.com/metasession-dev/devaudit/issues/287)) |
| Reusable skills                                     | `sdlc/files/_common/skills/` (Claude Code Skills as a first-class SDLC artefact, [#307](https://github.com/metasession-dev/devaudit/pull/307))                                   |
| DevAudit project + API key issuance                 | DevAudit REST API: `GET/POST /api/projects` + `GET/POST /api/projects/{id}/api-keys`                                                                                             |
| GitHub secrets + branch protection                  | `gh` CLI calls inside `sdlc-onboard.sh`                                                                                                                                          |
| Org-level groupings (nascent)                       | DevAudit portal: `/admin/organisations`                                                                                                                                          |

What does **not** exist today and must be built as prerequisites: OAuth callback endpoint, policy engine, plugin registry, GitLab/Bitbucket/self-hosted provider abstraction, stack adapters for Go/Rust/Java/.NET/PHP, RBAC enforcement at the portal API layer.

## Core principles

- **One command to onboard**, one to update, one to push artefacts, one to enforce policy.
- **Smart defaults** with non-blocking confirmation prompts.
- **Auto-detection** of stack, package manager, monorepo structure, CI provider, editor, Git provider.
- **Cross-platform**: Linux, macOS, Windows — native, not just WSL.
- **JSON-friendly**: every command supports `--json` for CI/scripting.
- **Secure by default**: tokens in `~/.config/devaudit/auth.json` mode 0600; opt-in telemetry only; PAT and OAuth flows both.
- **Idempotent**: rerunning any command on the same project is safe.
- **Provider-agnostic**: GitHub, GitLab, Bitbucket, self-hosted Git — first-class.
- **Organisation-aware**: policies, shared config, and reporting at the org level.
- **Extensible**: plugins ship via a registry; org-private plugin sources supported.

## What the CLI does

### Command surface

```
devaudit install [path]                       # interactive onboarding
devaudit update  [path]                       # sync framework templates
devaudit push    <evidence|audit|compliance>  # upload an artefact
devaudit doctor                               # verify install: tools on PATH, auth valid, config valid
devaudit status  [path]                       # show project's framework state

devaudit auth login [--provider <name>]       # browser OAuth or PAT paste
devaudit auth logout
devaudit auth status

devaudit org list                             # list orgs the user belongs to
devaudit org switch <slug>                    # switch active org context
devaudit org policy list                      # show org's policy baselines
devaudit org policy apply [path]              # apply org policy to a project (or all org projects)
devaudit org report [--format html|json|csv]  # generate org-wide compliance report

devaudit plugin list                          # list installed + available plugins
devaudit plugin install <name>                # install from registry or URL
devaudit plugin remove <name>
devaudit plugin update                        # update all installed plugins

devaudit config get|set|list                  # CLI config (telemetry on/off, default org, etc.)

devaudit --help
devaudit --version
```

Common flags on every command:

- `--json` — machine-readable output, one JSON object per line
- `--yes` / `-y` — accept all interactive defaults (CI-friendly)
- `--dry-run` — preview, don't mutate
- `--verbose` / `-v` — extra detail
- `--no-color` — strip ANSI
- `--org <slug>` — override active org context for this invocation

### Stack support

Stacks are first-class adapters consumed by the CLI from `sdlc/files/stacks/<name>/`. The CLI ships with adapters for:

- **Node** (`adapter.json`) — npm, husky, commitlint, ESLint, Prettier, TypeScript, Playwright
- **Python** (`adapter.json`) — pip, pre-commit, ruff, mypy, pytest
- **Go** (`adapter.json`) — lefthook, golangci-lint, go test, go vet, govulncheck
- **Rust** (`adapter.json`) — cargo-husky, clippy, cargo test, cargo audit
- **Java** (`adapter.json`) — Maven/Gradle, spotless, spotbugs, JUnit, OWASP dependency-check
- **.NET** (`adapter.json`) — dotnet-format, Roslyn analyzers, xUnit, security-code-scan
- **PHP** (`adapter.json`) — Composer, PHP_CodeSniffer, PHPStan, PHPUnit

UI frameworks (Next.js, React, Angular, Vue) are **not** stacks — they're choices within a stack. The CLI doesn't ask about them. Monorepos are handled via `working_directory` in `sdlc-config.json`, not a separate stack.

Adding a new stack remains additive — one `adapter.json` + a `hooks/` directory; no CLI code changes.

### Hosts

Host adapters live in `sdlc/files/hosts/<name>/`. Shipped:

- **Railway**, **Vercel**, **Fly.io**, **Kubernetes**, **AWS ECS**, **Self-hosted Docker**

Auto-detected from project markers (`railway.toml`, `vercel.json`, `fly.toml`, `Dockerfile`, etc.) with operator override via `--host`.

### Git providers

The CLI talks to Git providers through a `GitProvider` interface that abstracts:

- Repo metadata (`getRepoMeta`)
- Secrets and variables (`setSecret`, `setVariable`)
- Branch protection (`applyBranchProtection`)
- PR creation (`createPullRequest`)

Implementations:

- **GitHub** — _shipped_. Uses `gh` CLI when present; falls back to direct REST against `api.github.com` using `GH_TOKEN` / `GITHUB_TOKEN` for everything except secret-set (which requires sodium encryption — `gh` CLI required for that one operation).
- **GitLab** — _planned_. Will use `glab` CLI when present; falls back to direct REST.
- **Bitbucket** — _planned_. Direct REST against the Bitbucket Cloud / Server API.
- **Self-hosted** — _planned_. Generic Git + manual configuration prompts for everything that can't be automated (no API access).

Auto-detected from `git remote get-url origin` URL pattern; non-GitHub remotes currently throw a clear "not yet supported" error.

### Authentication

The CLI supports two flows, both producing the same `mctok_...` PAT stored at `~/.config/devaudit/auth.json` (mode 0600). The token is sent on portal API calls via the `X-DevAudit-Token` HTTP header.

**Browser OAuth** is the default flow when `/cli-auth` ships on the portal (workstream B in [build-plan.md](./build-plan.md)):

1. `devaudit auth login` opens `https://devaudit.metasession.co/cli-auth` in the user's browser.
2. User authenticates via the portal's existing NextAuth flow.
3. Portal generates a CLI token (`mctok_...`) and redirects to `http://127.0.0.1:<random-port>/callback?token=...`.
4. CLI's local listener captures the token and stores it at `~/.config/devaudit/auth.json`.

**PAT paste** is the fallback for headless environments (containers, SSH sessions, CI) and the path that works against the portal today (no `/cli-auth` endpoint required). User pastes a token issued at `/settings/tokens`. As of the latest portal release the `X-DevAudit-Token` header is live and the portal dual-accepts the legacy `X-Meta-Comply-Token`, so a CLI build talking to the portal can use either header during the migration window.

**`DEVAUDIT_USER_TOKEN` env var** takes precedence over both — CI uses this.

There is no "Account ID" prompt; the token carries the identity.

### Organisation features

Organisations are first-class entities in DevAudit (the portal already has `/admin/organisations`; this CLI surfaces them).

**Shared configuration**: An org-level `org-config.json` stored on the portal defines defaults for member projects (e.g. default sast_baseline, required risk classes for UAT, approved dependency-risk allow-lists). `devaudit install` and `devaudit update` apply org defaults transparently; consumers can override per-project.

**Policy-as-code**: Orgs define policy bundles (YAML or JSON-Schema) that get evaluated against consumer `sdlc-config.json` + observed CI evidence. Examples:

- "All node projects must have `sast_baseline: 0`."
- "All projects must run E2E tests in CI."
- "All MEDIUM/HIGH risk REQs must have `implementation-plan.md` before merge."

`devaudit org policy apply` checks policy compliance across all org projects and writes a report. CI gates can include `devaudit org policy check --strict` to block merges that violate policy.

**RBAC**: Three roles — `admin` (full org control), `operator` (manage projects, apply policy), `viewer` (read-only reporting). Roles enforced by the portal API; CLI commands surface "permission denied" cleanly when the operator lacks rights.

**Centralised reporting**: `devaudit org report` generates an HTML/JSON/CSV report covering every org project — RTM status, compliance gate history, evidence completeness, recent releases. Exportable for auditors.

### Plugin marketplace

Plugins extend the CLI with org-specific or stack-specific behaviour:

- **Plugin SDK** — _shipped_. TypeScript package (`@metasession-dev/devaudit-plugin-sdk`) defines the plugin contract: `Plugin` / `PluginContext` / `PluginManifest` types, 9 lifecycle hooks (`beforeInstall`, `afterInstall`, `beforeUpdate`, `afterUpdate`, `beforePush`, `afterPush`, `beforeSync`, `afterSync`, `onDoctor`), and a zero-dep `validateManifest()` shape checker.
- **Plugin loader** — _shipped_. The CLI scans `~/.config/devaudit/plugins/<name>/` at startup, validates each manifest, dynamic-imports the main module, and registers plugin-contributed commands under `devaudit <plugin-name> <sub-cmd>`. Lifecycle hooks fire in `install` / `update` / `push` / `doctor` with per-plugin error isolation — a misbehaving plugin can't crash the CLI.
- **Plugin registry** — _planned_. Plugins will be discovered via the DevAudit portal's `/plugins` registry. Org-private plugins will ship from private npm registries or Git URLs. Until the registry lands, plugins must be placed in `~/.config/devaudit/plugins/<name>/` manually.
- **`devaudit plugin install/list/remove/update`** — _shipped_ for direct Git URL installs. `install <git-url>` clones + npm-installs + validates; `list` discovers + reports; `remove <name>` rm-rfs the dir; `update` git-pulls each plugin dir. Portal-registry-backed name resolution (`devaudit plugin install devaudit-plugin-prisma`) remains _planned_.

Initial first-party plugins to ship in-tree:

- `devaudit-plugin-prisma` — automate Prisma migration deploy hooks for node consumers.
- `devaudit-plugin-supabase` — Supabase project / RLS policy linting.
- `devaudit-plugin-evidence-export` — bulk export evidence bundles for external audits.

### Distribution

Multiple channels, all from a single source build:

- **Homebrew tap** (`brew install metasession-dev/tap/devaudit`) — macOS/Linux native binary
- **Scoop manifest** (`scoop install devaudit`) — Windows native binary
- **`curl -fsSL https://devaudit.metasession.co/install.sh | sh`** — shell installer that detects OS/arch and grabs the right binary
- **npm** (`npm i -g @metasession-dev/devaudit-cli`) — for Node users who prefer it
- **GitHub Releases** — raw binaries for direct download / system-package management

Single-binary builds compile via **Node SEA** (Single Executable Application — bundled into Node 22+) — same TypeScript source tree, just a different build pipeline. No Go/Rust rewrite needed.

### Operational surface

| Concern         | Decision                                                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cross-platform  | Linux/macOS/Windows native (single binary; no WSL requirement)                                                                                                                       |
| Token storage   | `~/.config/devaudit/auth.json` (Linux/macOS, mode 0600); `%APPDATA%\devaudit\auth.json` (Windows)                                                                                    |
| Telemetry       | Opt-in only, off by default. First-run prompt; toggle via `devaudit config telemetry on\|off`. Never collects project slugs, repo URLs, file paths.                                  |
| Versioning      | CLI semver decoupled from framework template version. CLI bundles a template snapshot at release time; `devaudit update --templates-from-channel stable\|beta\|main` fetches latest. |
| Exit codes      | `0` success, `1` generic, `2` usage, `3` auth, `4` API, `5` filesystem, `6` git/provider, `7` adapter, `8` policy violation, `9` plugin error                                        |
| Log conventions | `consola` pretty by default; `--json` for structured one-JSON-object-per-line; `--no-color` strips ANSI; `--verbose` includes HTTP request/response (tokens redacted)                |
| Offline mode    | `devaudit install --offline` runs local-only steps; portal-touching operations defer until next online run                                                                           |
| Self-update     | CLI checks for updates on every run (rate-limited to once per 24h); `devaudit upgrade` performs the update                                                                           |

## Out of scope

- Anything the CLI delegates to existing tools (running tests, building, deploying — those remain the stack's responsibility).
- Replacing `gh` / `glab` / `git` — the CLI uses them when present, falls back to direct REST when not.
- Building a DevAudit web-portal replacement — the portal exists at `devaudit.metasession.co` and this CLI is a complement, not a substitute.
- AI-agent integration — Claude Code Skills already cover that surface ([#307](https://github.com/metasession-dev/devaudit/pull/307)).

## Deliverables expected

These follow as separate documents:

1. [build-plan.md](./build-plan.md) — engineering plan: workstreams, dependencies, sequencing, realistic effort, risks
2. [ADR-001: language and distribution](./ADR-001-language-and-distribution.md) — why Node/TS, single-binary via Node SEA, multi-channel distribution

## References

- [Onboarding walkthrough](../onboarding.md) — the current operator-facing bash flow; becomes obsolete once the CLI ships
- [Adding a stack](../adding-a-stack.md) — how the polyglot adapter pattern works
- [Adding a host](../adding-a-host.md) — same, for hosts
- [Adding a skill](../adding-a-skill.md) — Claude Code Skills as SDLC artefacts
- [Consuming projects guide](../consuming-projects.md) — current operator manual
