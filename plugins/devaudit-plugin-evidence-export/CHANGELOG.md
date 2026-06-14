# Changelog

All notable changes to `@metasession.co/devaudit-plugin-evidence-export` are documented here. The plugin follows semver.

## [Unreleased]

## [0.1.59] — 2026-06-13

Version bump in lockstep with `@metasession.co/devaudit-cli@0.1.59`. No source changes.

## [0.1.1] — 2026-05-19

Version bump in lockstep with `@metasession.co/devaudit-cli@0.1.1`. No source changes.

## [0.1.0] — 2026-05-19

First public release. Package renamed from unscoped `devaudit-plugin-evidence-export` to scoped `@metasession.co/devaudit-plugin-evidence-export`. Repo flipped public; Apache-2.0 licensed. Published to npmjs.org with SLSA provenance. No behaviour change from v0.0.1.

## [0.0.1] — 2026-05-19

First public commit. Slice 6 of [`DevAudit-Installer#6`](https://github.com/metasession-dev/DevAudit-Installer/issues/6). Closes out workstream D for now — slice 5 (`devaudit-plugin-supabase`) is deferred until a real Supabase-using consumer adopts DevAudit.

### Added

- `list` command — `GET /api/evidence?projectSlug=…`, pretty-prints requirements + evidence counts
- `bundle` command — downloads all evidence for a project into `<dir>/<requirementId>/<file>`; writes a top-level `manifest.json`; per-file download failures are isolated and recorded
- `onDoctor` hook — verifies `DEVAUDIT_USER_TOKEN` is set; warns operators who plan to use the plugin but haven't authenticated
- Self-contained `EvidenceApi` REST client (`src/api/client.ts`) — does not import from the CLI's `lib/devaudit-api.ts` to avoid coupling
- `.github/workflows/plugin-evidence-export.yml` — matrix CI (Linux/macOS/Windows, node 22)
- 9 vitest cases using msw for portal mocking; covers happy + error paths on every export surface
