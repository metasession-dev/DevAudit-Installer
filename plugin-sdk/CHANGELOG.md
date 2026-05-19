# Changelog

All notable changes to `@metasession.co/devaudit-plugin-sdk` are documented here. The SDK follows semver.

## [Unreleased]

## [0.1.0] — 2026-05-19

First public release. Package renamed from `@metasession-dev/devaudit-plugin-sdk` (GitHub org scope) to `@metasession.co/devaudit-plugin-sdk` (npm org scope). Repo flipped public; Apache-2.0 licensed. Published to npmjs.org with SLSA provenance.

The plugin contract from v0.0.1 (Plugin/PluginContext/PluginManifest types, 9 lifecycle hooks, validateManifest, CommandContribution shape) ships unchanged in v0.1.0 — only metadata and publishing surface changed.

### Planned for future minor versions

- Plugin signing / verification helpers (separate follow-up — v0 plugins ship unsigned)
- Sandboxed execution helpers
- Richer PluginContext (filesystem capability, portal client) — gated on real plugin needs

## [0.0.1] — 2026-05-19

First public commit of `@metasession.co/devaudit-plugin-sdk`. Slice 1 of [`DevAudit-Installer#6`](https://github.com/metasession-dev/DevAudit-Installer/issues/6) — defines the contract everything else compiles against, ahead of the loader and the first-party plugins.

### Added

- `Plugin` — what a plugin's main module default-exports (name, apiVersion, hooks, commands)
- `PluginContext` — what the CLI passes to hooks and commands at runtime (projectPath, sdlcConfig view, logger, emit)
- `PluginManifest` — the `devaudit` field shape inside a plugin's `package.json`
- `LifecycleHookName` — union of supported hook names: beforeInstall, afterInstall, beforeUpdate, afterUpdate, beforePush, afterPush, beforeSync, afterSync, onDoctor
- `CommandContribution` — manifest shape for plugin-contributed CLI commands
- `validateManifest(input)` — zero-dep manifest validator; returns either `{ valid: true, manifest, packageName, packageVersion, main }` or `{ valid: false, errors }`
- 12 vitest cases covering manifest validation happy + failure paths, lifecycle hook classification, and type-level plugin shape compilation
- GitHub Actions workflow at `.github/workflows/plugin-sdk.yml` — lint + typecheck + build + test on Linux/macOS/Windows (node 22)

### Out of scope (deferred to v0.1.0+)

- Sandboxed execution model for plugins — v0 trusts plugins fully; security model documented in README
- Plugin marketplace UI on the portal
- Third-party plugin certification process
