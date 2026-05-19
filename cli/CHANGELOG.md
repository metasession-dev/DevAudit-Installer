# Changelog

All notable changes to `@metasession-dev/devaudit-cli` are documented here. The CLI follows semver.

## [Unreleased]

### Added

- `devaudit push --dry-run` now short-circuits before any portal mutation. The CLI enumerates which evidence files would be uploaded (via the same `collectFiles` logic the live upload uses) and prints them; no POST to `/api/evidence/upload` happens. Operators can safely preview a push before running it for real. Combined with `--json`, dry-run emits a single structured planned payload: `{ dryRun: true, projectSlug, requirementId, evidenceType, baseUrl, files, metadata, ... }`.
- `devaudit auth status --json` emits one parseable JSON object instead of a stream of pretty log lines. Shape: `{ ok: true, source: 'env' | 'file', baseUrl, projects: [...slugs] }` on success; `{ ok: false, reason: 'not_logged_in' | 'portal_rejected' | 'unexpected', ... }` on failure. Prose path unchanged.
- `devaudit status --json` emits one structured object: `{ ok, projectPath, project_slug, stack, host, node_version | python_version, devaudit_base_url, uat_enabled, approval_mode, files_present, files_missing }`. The `not_onboarded` failure path also emits structured JSON when `--json` is set. Useful for piping into other tools.
- `lib/logger.ts` exports `isJsonMode()` and `emitJsonResult(payload)` — small helpers so commands can branch on JSON mode and emit a single result line rather than rely on consola's per-log JSON records.

### Fixed

- `devaudit install --yes` on an existing consumer no longer wipes rich `sdlc-config.json` customizations. Previously the `--yes` path read only 4 fields (`project_slug`, runtime version, `source_dirs`, `working_directory`) and the write step then rebuilt the config from defaults — so re-running install on a customized consumer (e.g. WGB, which has `runner: self-hosted`, `sast_baseline: 6`, `database_service: mongodb`, custom `build_env`, custom `paths_ignore`, etc.) would erase all of those fields. Now `write-config.ts` reads the existing config and merges: wizard-owned fields (stack/host/slug/runtime/source_dirs/working_directory/production_url_secret/devaudit block) always come from the current plan; everything else is preserved if present, defaulted otherwise. `prompts.ts:planFromConfig` also now reads `production_url_secret` from the existing config so the wizard doesn't overwrite a custom-named secret. Caught during the WGB smoke against PR #8; new vitest case in `install.test.ts` seeds a richly customized config and asserts every non-wizard field survives a `--yes` re-install.

### Added

- `devaudit plugin install / list / remove / update` are now functional (slice 3 of workstream D), replacing the previous stubs. `install <git-url>` does `git clone --depth 1` into `~/.config/devaudit/plugins/<derived-name>/`, runs `npm install --legacy-peer-deps`, then validates the manifest via the SDK — on validation failure the directory is rm-rf'd and the operator gets a clear error. `list` discovers plugins under `~/.config/devaudit/plugins/`, prints each loaded plugin's name+version+hooks+commands, and surfaces failed-to-load plugins with their reason. `remove <name>` matches by package name or directory name and removes the dir. `update` runs `git pull --ff-only` + `npm install` in each git-backed plugin dir; non-git plugin dirs are skipped with a warning. Each command accepts an optional `root` override for testability. Portal-registry-backed name resolution (e.g. `devaudit plugin install devaudit-plugin-prisma`) remains pending — see #6.
- Plugin loader (slice 2 of workstream D). New `cli/src/lib/plugin/` module discovers plugins under `~/.config/devaudit/plugins/<name>/`, validates each manifest via `@metasession-dev/devaudit-plugin-sdk`'s `validateManifest()`, dynamic-imports each main module, and registers plugin-contributed commands under `devaudit <plugin-name> <sub-cmd>`. `runHook(plugins, hookName, ctx)` is wired into `install` (`beforeInstall` / `afterInstall`), `update` (`beforeSync` / `afterSync`), `push` (`beforePush` / `afterPush`), and `doctor` (`onDoctor`) — per-plugin errors are isolated so a misbehaving plugin can't crash the CLI. CLI now depends on `@metasession-dev/devaudit-plugin-sdk` via `file:../plugin-sdk` (CI builds the SDK first). 7 new vitest cases cover discovery, runtime apiVersion mismatch, error isolation, skip on missing hook, and commander command registration. Plugin install/list/remove/update CLI commands stay stubbed pending the portal plugin registry (slice 3+ of workstream D).
- `GitProvider` abstraction (workstream C). New `cli/src/lib/git-provider/` module exports a `GitProvider` interface plus a shipping `GitHubProvider` implementation. The provider prefers the `gh` CLI when on PATH and falls back to direct REST against `api.github.com` (with `GH_TOKEN`/`GITHUB_TOKEN`) for everything except secret-set (sodium encryption required — `gh` CLI must be present for that one op). `detectProvider()` parses `git remote get-url origin` and returns `github` / `gitlab` / `bitbucket` / `self-hosted`; only GitHub is wired up — other hosts throw a clear "not yet supported" error. Install steps 7 (secrets/variables) and 9 (branch protection) refactored to consume `GitProvider`, dropping their direct `execa('gh', …)` calls. 7 new vitest cases plus updated `install.test.ts` (uses a fake provider for injection-style mocking).
- Native TS port of `sdlc-onboard.sh` (workstream A milestone 3). `devaudit install` no longer shells out to bash; each of the 11 onboarding steps lives in its own module under `cli/src/install/`: auth-probe, detect-stack, prompts, write-config, project, api-key, github, hooks-bootstrap, branch-protection, sync-templates, done-report. Orchestrator threads `--dry-run` (planned actions, no mutations) and `--yes` (non-interactive — reads `sdlc-config.json` for defaults). Step 10 reuses the native `syncProject()` so the sync no longer shells out to `sync-sdlc.sh` either. `DevAuditClient.listApiKeys(projectId)` was added so step 6 stays idempotent against a portal-tracked `Onboarding-issued` key. 5 new vitest cases cover dry-run, full-run with mocked HTTP+gh, missing stack, PAT rejection, and the existing-key warn path.

### Planned for v0.1.0

- Native TS port of `sync-sdlc.sh` (workstream A milestone 4) — landed in #7
- `--json` output mode tightened on every command, with a versioned event schema
- `--yes` / `--dry-run` honoured by every mutating command — `install` honors both; other commands TBD
- npm publish (private scope first)

## [0.0.1] — 2026-05-18

First public commit on `metasession-dev/DevAudit-Installer`. Skeleton + working commands per workstream A milestones 1, 2, 5, 6 of [`docs/devaudit-cli/build-plan.md`](../docs/devaudit-cli/build-plan.md).

### Added

- Bootstrap (commit `48916b8`): Node/TS ESM sub-package under `cli/`, commander-based CLI, full command surface registered, common flags (`--json` / `--yes` / `--dry-run` / `--verbose` / `--no-color` / `--org`), consola logger
- `devaudit --help` and `--version` (commander default behaviour)
- `devaudit doctor` — verifies `node>=22`, `git`, `gh`, `jq`, `curl` are on PATH
- `devaudit status [path]` (commit `a133b8b`) — reads `sdlc-config.json` from a consumer project, prints stack/host/slug/source-dirs/devaudit-url/uat-state/approval-mode, and probes 10 framework files for presence
- `devaudit auth login` — interactive PAT paste flow via `@clack/prompts`, validates against `GET /api/projects`, stores at `~/.config/devaudit/auth.json` (mode 0600)
- `devaudit auth logout` — wipes the cached token
- `devaudit auth status` — verifies the cached token (or `DEVAUDIT_USER_TOKEN` env var) via portal
- `devaudit push <slug> <req> <type> <file>` — port of `scripts/upload-evidence.sh`. POST to `/api/evidence/upload` with `Authorization: Bearer DEVAUDIT_API_KEY`, multipart/form-data body. Single file or directory. Retries on 429/5xx with exponential backoff, honours `Retry-After`. All upload-evidence.sh flags preserved.
- `devaudit install [path]` — **v0 wrapper** that shells out to `scripts/sdlc-onboard.sh` with stdio inheritance. Native port pending.
- `devaudit update <version> <paths...>` — **v0 wrapper** that shells out to `scripts/sync-sdlc.sh`. Native port pending.
- 7 vitest tests
- GitHub Actions workflow at `.github/workflows/cli.yml` — lint + typecheck + build + test on Linux/macOS/Windows (node 22)

### Stubbed (not implemented; exit code 1 + pointer to build plan)

- `devaudit org list / switch / policy list|apply / report` — needs portal RBAC + policy engine + reporting endpoints (workstream B)
- `devaudit plugin list / install / remove / update` — needs portal plugin registry + plugin SDK (workstream D)
- `devaudit config get / set / list`
- `devaudit upgrade`
