# ADR-001 — `devaudit` CLI: language, runtime, and distribution

- **Status**: Proposed
- **Date**: 2026-05-18
- **Context**: [README.md](./README.md) — design brief; [build-plan.md](./build-plan.md) — engineering plan

## Decision

The `devaudit` CLI is built in **Node.js / TypeScript** and distributed **simultaneously through five channels** from a single source tree:

- **Homebrew tap** (`brew install metasession-dev/tap/devaudit`)
- **Scoop manifest** (`scoop install devaudit`)
- **`curl -fsSL https://devaudit.metasession.co/install.sh | sh`** (auto-detect OS/arch)
- **npm** (`npm i -g @metasession.co/devaudit-cli`) — for Node-native users
- **GitHub Releases** on `metasession-dev/DevAudit-Installer` — raw binaries for direct download or system-package integration

Single-binary builds are produced via **Node SEA (Single Executable Application)** — bundled into Node 22+, no new toolchain needed. The same TypeScript source produces both the npm package and the standalone binaries.

## Context

The CLI replaces three bash scripts (`sdlc-onboard.sh`, `sync-sdlc.sh`, `upload-evidence.sh`) with an enterprise-grade tool that organisations across stacks (Node, Python, Go, Rust, Java, .NET, PHP) and across Git providers (GitHub, GitLab, Bitbucket, self-hosted) will rely on. The choice of language and distribution affects:

- **Engineering velocity** — team's existing skills, code reuse from the portal
- **Cross-platform support** — Linux, macOS, Windows native (not just WSL)
- **Install ergonomics** — Python/Go/Rust shops shouldn't need to install Node just to use the CLI
- **Cold-start performance** — a CLI invoked dozens of times a week should feel instant
- **Maintenance footprint** — one codebase, multiple distribution channels

The README's enterprise scope (multi-stack, multi-provider, plugin marketplace, single binary) rules out the npm-only-then-add-binaries-later path that an MVP might take. We commit to single-binary distribution from day one.

## Options considered

### Option A — Node.js / TypeScript, single source, multi-channel distribution (chosen)

Pros:

- Ecosystem fit with the existing portal codebase. `lib/services/*` patterns port directly.
- Team's existing TypeScript skills apply — no new language ramp.
- Largest pool of relevant libraries: `commander`, `@clack/prompts`, `consola`, `execa`, `msw`, `vitest`, `tsup`, `ajv`.
- Node SEA (Node 22+) produces real single binaries with no Node-runtime dependency on the user's machine — same source serves both npm and standalone distribution.
- npm distribution remains for users who prefer it (mostly Node consumers who already have Node).
- Plugin system maps cleanly: plugins are npm packages compiled against the SDK.

Cons:

- Binary size (~80 MB) — Node SEA bundles the full Node runtime. Acceptable for this distribution pattern (ripgrep, fd, gh-CLI are similar order of magnitude).
- Cold start on npm path is ~150 ms; on single-binary path ~50 ms (no Node startup cost). Both acceptable.
- Node SEA tooling is younger than Go's binary story; expect some build-pipeline gotchas.

### Option B — Go

Pros:

- Smallest binaries (~20 MB), fastest cold-start (<20 ms).
- Distribution story has been solid for years.

Cons:

- New language for the team — multi-week ramp.
- Parallel codebase from the portal; no `lib/services/*` reuse.
- Plugin system requires a separate solution (Go plugins are immature; most Go CLIs accept this).
- CLI library ecosystem (cobra/urfave) is good but doesn't match `@clack/prompts` UX.
- Throws away the working JS adapter loaders, schema validators, and template-substitution logic that already exists in the portal codebase.

### Option C — Rust

Pros:

- Smallest binaries, strongest type guarantees, fastest cold-start.

Cons:

- Highest engineering bar — team doesn't currently have Rust expertise.
- Compile times slow iteration.
- Overkill for a CLI that mostly shells out to `git` / `gh` / `glab` / package managers.
- Plugin model would require WASM or dynamic-linking — both add complexity.

### Option D — Bash (current state)

Pros:

- Zero dependency. Already shipping.

Cons:

- Cross-platform broken (no Windows native).
- Poor interactive UX. Hard to JSON-ify cleanly. Hard to test.
- Errors silent by default (recent example: [#313](https://github.com/metasession-dev/devaudit/issues/313)).
- No single-binary path. No plugin model.
- Doesn't scale to the enterprise feature set the README describes.

## Why Node/TS with multi-channel distribution from day one

Three reasons:

1. **Source reuse across portal and CLI.** The portal codebase has working TypeScript implementations of: adapter loaders, JSON-Schema validators, template-substitution logic, the DevAudit REST API surface, RBAC checks, and the policy schema (in progress). Building the CLI in the same language means those pieces port directly instead of being rewritten in Go or Rust.
2. **Plugin system fits naturally.** Plugins are npm packages with TypeScript types from `@metasession.co/devaudit-plugin-sdk`. A plugin author who already writes TypeScript for their app gets immediate productivity. Same model for org-private plugins via private npm registries or Git URLs.
3. **Node SEA closes the historic Node-runtime-dependency gap.** Before Node 22, "build a CLI in Node" meant "users must install Node." Node SEA changed that. The reason teams have historically chosen Go for CLIs (single binary, no runtime) no longer applies cleanly — we get the same outcome from the same TypeScript source.

Trade-off accepted: binary size (~80 MB vs. Go's ~20 MB). Acceptable given the comparables (ripgrep ~5 MB but written in Rust; gh-CLI ~30 MB; AWS CLI v2 ~70 MB).

## Consequences

### Build pipeline

- `tsup` produces an ESM bundle from `src/` into `dist/index.js`.
- `npm pack` ships the ESM bundle for npm distribution.
- Node SEA pipeline takes the same bundle and produces standalone binaries for `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64`. Each binary embeds Node 22 + `dist/index.js`.
- GitHub Actions release workflow uploads all binaries on tag-push, updates the Homebrew tap, refreshes the Scoop manifest, and publishes to npm.

### Distribution

- `install.sh` (served at `https://devaudit.metasession.co/install.sh`) detects OS/arch, downloads the right binary from GitHub Releases, extracts to `/usr/local/bin/devaudit` (or `~/.local/bin/devaudit` if not root).
- Homebrew tap (`metasession-dev/homebrew-tap`) gets auto-updated via the release workflow.
- Scoop manifest similar via `metasession-dev/scoop-bucket`.
- npm publishes both unscoped `devaudit` (binary path: `node_modules/devaudit/bin/devaudit.js`) and scoped `@metasession.co/devaudit-cli` (alias) — npm convention.

### Plugin distribution

- First-party plugins (`devaudit-plugin-prisma`, etc.) ship as separate npm packages from the same monorepo.
- Plugin SDK (`@metasession.co/devaudit-plugin-sdk`) ships as a standalone npm package — third parties depend on it.
- Plugin registry on the portal (`/plugins`) lists available plugins with metadata (description, install command, author, source); `devaudit plugin install <name>` resolves against it.

### Versioning

- CLI semver decoupled from framework template version.
- CLI bundles a template snapshot at release time (embedded in the binary).
- `devaudit update --templates-from-channel stable|beta|main` allows refreshing the template bundle from a release channel separately from the binary version.

### Long-term option

If usage shifts heavily toward stacks where users actively resist a Node-based CLI (Go shops who want a Go-native tool, etc.) and the binary's perceived weight outweighs the source-reuse win, Go remains a viable rewrite target. The README + build plan would not change; only the implementation language. The TypeScript source becomes the spec; a Go port follows it.

## Alternatives explicitly rejected

- **Pure-bash**: doesn't solve cross-platform; doesn't compose into a single binary; can't carry the enterprise feature set.
- **Python**: same Node-runtime friction problem but for non-Python shops; ecosystem fit for terminal UIs is weaker than Node's.
- **`pkg`** for binary distribution: deprecated as of 2024. Node SEA is the supported replacement.
- **Hybrid Node + native modules** (e.g. via `napi-rs` for hot paths): unnecessary complexity; the CLI is I/O-bound, not CPU-bound.
- **Single distribution channel (npm-only or single-binary-only)**: misses constituencies on both sides. Multi-channel costs ~1 week of release-pipeline engineering and serves both Node-native users (npm) and stack-agnostic users (brew/scoop/curl).

## References

- Node SEA documentation: <https://nodejs.org/api/single-executable-applications.html>
- Bun compile (kept as a fallback option): <https://bun.sh/docs/bundler/executables>
- The current bash scripts being replaced:
  - `DevAudit-Installer/scripts/sdlc-onboard.sh`
  - `DevAudit-Installer/scripts/sync-sdlc.sh`
  - `DevAudit-Installer/scripts/upload-evidence.sh`
- gh-CLI distribution model (multi-channel from Go): <https://github.com/cli/cli>
- Vercel CLI distribution (Node-based, multi-channel): <https://github.com/vercel/vercel>
