# Changelog

All notable changes to `@metasession-dev/devaudit-plugin-sdk` are documented here. The SDK follows semver.

## [Unreleased]

### Planned for v0.1.0

- Plugin loader inside the CLI (`cli/src/lib/plugin.ts`) consumes this SDK
- First-party plugin: `devaudit-plugin-prisma` (Prisma migration deploy hooks)
- First-party plugin: `devaudit-plugin-supabase` (RLS policy linting + project metadata sync)
- First-party plugin: `devaudit-plugin-evidence-export` (bulk evidence bundle export)
- Plugin signing / verification (separate follow-up — v1 ships unsigned)

## [0.0.1] — 2026-05-19

First public commit of `@metasession-dev/devaudit-plugin-sdk`. Slice 1 of [`DevAudit-Installer#6`](https://github.com/metasession-dev/DevAudit-Installer/issues/6) — defines the contract everything else compiles against, ahead of the loader and the first-party plugins.

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
