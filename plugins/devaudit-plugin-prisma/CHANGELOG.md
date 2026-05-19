# Changelog

All notable changes to `devaudit-plugin-prisma` are documented here. The plugin follows semver.

## [Unreleased]

## [0.0.1] — 2026-05-19

First public commit. Slice 4 of [`DevAudit-Installer#6`](https://github.com/metasession-dev/DevAudit-Installer/issues/6). Dogfoods the SDK contract (slice 1) and the plugin loader (slice 2).

### Added

- `migrate-status` command — wraps `npx prisma migrate status`, warns if no schema present
- `pending` command — lists migration directories from `prisma/migrations/`, emits a `prisma-migrations` event with the count
- `afterUpdate` hook — when a Prisma schema exists, reminds the operator to run `npx prisma migrate deploy` after deploy
- `onDoctor` hook — verifies `prisma/schema.prisma` and `prisma/migrations/` are both present; warns on partial setup
- `.github/workflows/plugin-prisma.yml` — matrix CI (Linux/macOS/Windows, node 22)
- 9 vitest cases covering empty, schema-only, and schema+migrations project fixtures
