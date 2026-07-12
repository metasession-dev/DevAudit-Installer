# Contributing

Thanks for looking. This repo holds the `devaudit` CLI, the plugin SDK, first-party plugins, and the SDLC framework templates that consumers sync. The web portal lives in a separate repository — [`metasession-dev/devaudit`](https://github.com/metasession-dev/devaudit) (formerly `META-COMPLY`; renamed during the 2026-05 repo split).

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

## Branching Strategy — GitFlow

This repository uses a **GitFlow** branching model with five branch types:

### Branch roles

| Branch | Purpose | Direct push? |
|---|---|---|
| `main` | Production — stable, tagged framework versions | **No** — PR only |
| `develop` | Integration — active work merges here | **No** — PR only |
| `feature/*` | New work — branched from `develop` | Yes (to the feature branch) |
| `fix/*` | Bug fixes — branched from `develop` | Yes (to the fix branch) |
| `hotfix/*` | Production hotfixes — branched from `main` | Yes (to the hotfix branch) |

### Workflow

**Developing a feature or fix:**

1. Branch from `develop`: `git checkout develop && git pull && git checkout -b feature/<issue#>-<short-slug>`
2. Implement the change, committing with Conventional Commits
3. Open a PR into `develop`: `gh pr create --base develop --head feature/<issue#>-<short-slug>`
4. CI must pass on the PR before merging
5. Merge into `develop` (merge commits to preserve audit trail)

**Shipping a release:**

1. Open a PR from `develop` into `main`: `gh pr create --base main --head develop`
2. CI must pass on `develop` before merging to `main`
3. Merge `develop` → `main` (merge commits)
4. Tag the release: `git tag vX.Y.Z`

**Hotfixing production:**

1. Branch from `main`: `git checkout main && git pull && git checkout -b hotfix/<issue#>-<short-slug>`
2. Implement the fix
3. Open a PR into `main`: `gh pr create --base main --head hotfix/<issue#>-<short-slug>`
4. After merge, immediately back-merge the hotfix into `develop` to keep the integration branch in sync
5. The repo automation opens a `backmerge/* -> develop` PR for reviewed hotfix merges; merge that PR before cutting the next release from `develop`

### Branch naming

- **Feature branches:** `feature/<issue#>-<short-slug>` (e.g. `feature/213-fix-terminology`)
- **Fix branches:** `fix/<issue#>-<short-slug>` (e.g. `fix/205-ci-gate-timeout`)
- **Hotfix branches:** `hotfix/<issue#>-<short-slug>` (e.g. `hotfix/301-prod-crash`)

### Commit conventions

- **Conventional Commits** for all messages: `feat(cli): …`, `fix(sdlc): …`, `docs(sdlc): …`, `chore(docs): …`
- Reference the issue number in the commit body where relevant
- Include `Co-Authored-By:` for AI-assisted commits
- CI must pass on `develop` before merging to `main`

## What lives where

| Path | Contents |
|---|---|
| `cli/` | The `devaudit` CLI source, tests, bin entry |
| `plugin-sdk/` | The `@metasession.co/devaudit-plugin-sdk` package — plugin contract types |
| `plugins/devaudit-plugin-*/` | First-party plugins built against the SDK |
| `sdlc/` | Framework templates that get synced into consumer projects |
| `scripts/` | Helper scripts: `upload-evidence.sh` (synced into consumers; bundled into the CLI) + `validate-adapter.cjs`. Onboarding/sync live in the `devaudit` CLI (`cli/`). |
| `docs/` | Operator docs + design docs (including `devaudit-cli/` build plan + ADR) |
| `docs/ADR/` | Architectural Decision Records — immutable history |

## Licensing of contributions

By submitting a contribution, you agree it is licensed under the project's [Apache License 2.0](./LICENSE), per the License's contribution clause (§ 5).

## Cross-repo payload contracts (#571)

This repo and the Portal (`metasession-dev/devaudit`) communicate via `repository_dispatch` events. When changing a dispatch payload (adding/removing/renaming a field), **both sides must be updated in the same PR cycle** — the sender (Portal) and the consumer (DevAudit-Installer CI templates).

### Contract file

Dispatch payload schemas are defined in [`contracts/dispatch-payloads.json`](./contracts/dispatch-payloads.json). Both repos hold a copy and must stay in sync. The `sync-evidence-contract.yml` workflow notifies this repo when the Portal updates its copy.

### Rules

1. **Never remove a field from a dispatch payload without updating the consumer workflow.** The consumer reads `github.event.client_payload.<field>` — a missing field silently produces empty strings, not errors.
2. **When adding a field, make it nullable or optional in the consumer.** The consumer workflow must handle the field being absent (e.g. `${{ github.event.client_payload.approved_sha || '' }}`).
3. **When renaming a field, add the new name first, keep the old name as an alias for one release cycle, then remove it.** This gives the consumer time to migrate.
4. **Test both sides.** The Portal has unit tests for dispatch payloads (`tests/unit/services/approval-service.test.ts`); the DevAudit-Installer has shell tests for the consumer workflows. Run both before merging.
