# Contributing

Thanks for looking. This repo holds the `devaudit` CLI, the plugin SDK, first-party plugins, and the SDLC framework templates that consumers sync. The web portal (`META-COMPLY`) is a separate repository.

## Pre-1.0 contribution policy

The project is pre-1.0. The contract surface (CLI command shape, plugin SDK types, SDLC template structure) is still moving. To avoid landing changes that get reworked or reverted shortly after, **external pull requests are not accepted by default at this stage**.

What you can do instead:

- **Open an issue** with the problem you're hitting, the change you'd propose, or a reference to a comparable tool's design. We respond on issues; we'll tell you if the change is in scope and whether to send a PR.
- **Security reports**: see [`SECURITY.md`](./SECURITY.md). Don't open public issues for those.
- **Questions**: open a discussion if Discussions are enabled, or an issue tagged `question` otherwise.

Once the contract surface stabilises (target: v1.0 release) we'll relax this policy and accept PRs without a prior issue conversation.

## If a maintainer asked you to PR

Local setup:

```sh
git clone https://github.com/metasession-dev/DevAudit-Installer.git
cd DevAudit-Installer

# Build the SDK once — the CLI and plugins depend on it via file: links.
( cd plugin-sdk && npm install --legacy-peer-deps && npm run build )

# CLI
( cd cli && npm install --legacy-peer-deps && npm test )

# Plugins (after SDK is built)
( cd plugins/devaudit-plugin-prisma && npm install --legacy-peer-deps && npm test )
( cd plugins/devaudit-plugin-evidence-export && npm install --legacy-peer-deps && npm test )
```

Conventions:

- **Conventional commits**: `feat(cli): …`, `fix(plugin-sdk): …`, `chore(docs): …`. The same scopes that appear in `git log` already.
- **TypeScript strict**. No `any`, no `as any`. `noUncheckedIndexedAccess` is on across the board.
- **Tests before behaviour changes**. Every behaviour-changing PR adds or updates a vitest case in the same package.
- **CI matrix is mandatory**: Linux, macOS, Windows on node 22. All three must be green.
- **One PR per logical change**. Keep PRs reviewable; split refactors from behaviour changes when you can.
- **Co-author tags** for AI assistance. Use `Co-Authored-By:` on the commit when an AI tool contributed substantively. The `git log` history shows the current pattern.

## What lives where

| Path | Contents |
|---|---|
| `cli/` | The `devaudit` CLI source, tests, bin entry |
| `plugin-sdk/` | The `@metasession.co/devaudit-plugin-sdk` package — plugin contract types |
| `plugins/devaudit-plugin-*/` | First-party plugins built against the SDK |
| `sdlc/` | Framework templates that get synced into consumer projects |
| `scripts/` | Bash installer scripts (`sdlc-onboard.sh`, `sync-sdlc.sh`, `upload-evidence.sh`) |
| `docs/` | Operator docs + design docs (including `devaudit-cli/` build plan + ADR) |
| `docs/ADR/` | Architectural Decision Records — immutable history |

## Licensing of contributions

By submitting a contribution, you agree it is licensed under the project's [Apache License 2.0](./LICENSE), per the License's contribution clause (§ 5).
