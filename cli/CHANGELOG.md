# Changelog

All notable changes to `@metasession.co/devaudit-cli` are documented here. The CLI follows semver.

## [Unreleased]

## [0.1.53] — 2026-06-09

### Changed

- **Three-tier E2E gating model** — formalises smoke (every push, ~3–5 min) / critical (PR-to-release-branch, ~10–15 min) / regression (nightly + post-merge + dispatch, full audit trail). The third tier (critical) is new; it bridges between fast smoke and full regression so release-PRs no longer wait 30+ minutes on the full pack. MoSCoW priority drives tier choice via file location: `e2e/smoke/`, `e2e/critical/`, `e2e/<area>/`. Post-merge `push: branches: [release]` runs the full regression + auto-files a `bug, priority:high` issue if a spec slipped past the critical-tier PR gate — operator triages within working hours (hotfix forward, revert, or accept-with-rationale). No automated revert; false positives + flakes + UAT-data drift are real classes that need human judgement.

  Ships as a framework convention, not a synced workflow: the framework provides a copy-pasteable reference at `skills/e2e-test-engineer/references/e2e-regression-3-tier.yml` that operators apply to their consumer-owned `e2e-regression.yml`. The framework does NOT sync `e2e-regression.yml` (consumers customise it per project) — overwriting that file is held off until the sync-survival escape hatch (#84) ships.

  Touch points:
  - `Test_Strategy.md` § *System Testing (E2E)* — new sub-section names the 3 tiers + cost philosophy + post-merge safety net
  - `Test_Policy.md` § *Risk-Based Testing* — new sub-section pins gate enforcement language ("Must in smoke + critical: pre-merge blocking; Should/Could in regression: post-merge auto-issue or accepted-with-rationale")
  - `Test_Architecture.md` § *Speed over Exhaustiveness* — cross-refs the new model as the first concrete implementation of "Strategic test selection"
  - `skills/e2e-test-engineer/SKILL.md` Phase 3 — adds a tier classification decision tree authors apply per spec; recorded in the eventual `test-execution-summary.md` § *Test design* (devaudit#50)
  - `skills/e2e-test-engineer/references/e2e-regression-3-tier.yml` — NEW reference workflow consumers copy into their own `e2e-regression.yml`. Includes critical-with-smoke-fallback selector + post-merge auto-issue logic.

## [0.1.52] — 2026-06-09

### Changed

- **#50** — `test-execution-summary.md` now carries a `## Test design` section at the top that records the design-time decisions (layers planned vs covered, deferral rationale, skill-invocation attribution). Closes the loop with #47/#132/#133/#152: the SDLC now has a recorded trace that scope was *decided*, not implicit — schema-only changes can state `e2e N/A — schema-only, no UI yet` explicitly rather than silently shipping unit+manual. Three additive edits: `3-compile-evidence.md` Step 1a heredoc grows the new section; `e2e-test-engineer/SKILL.md` Final report directs the operator to populate it with the skill's decisions + a verifiable turn pointer. The existing Test Reports gate continues to feed on `test_report` evidence; this enriches what's *in* the file without changing the gate mechanics.

## [0.1.51] — 2026-06-09

### Changed

- **devaudit#127** — `e2e-test-engineer` skill now explicitly handles transport-layer specs (Node `fetch` against webhooks, `MongoClient` queries, `socket.io-client` assertions) that live in `e2e/` but cannot call `evidenceShot` because they have no Playwright `page` object. Skill scope clarified — transport-boundary integration tests are IN scope (the existing "API-only" exclusion means unit-level route-handler tests, not transport-boundary integration). New "Specs with no page object" sub-section names the evidence form for these specs: per-spec entry in `test-execution-summary.md` describing the asserted behaviour in operator terms, with `[REQ-XXX][ACn]` bracket convention in the test title. Release-detail "screenshots" panel showing zero entries for purely-transport REQs is correct; reviewers cross-reference the test-execution summary instead. `2-implement-and-test.md` Step 4 carries the same callout so the operator sees it at the right point in the workflow.

## [0.1.50] — 2026-06-09

### Changed

- **devaudit#152** — SDLC Stage 1 hardening: the implementation plan now structurally catches the failure mode where green gates ship a feature with no UI surface that a user can reach (the REQ-030 / WGB pattern). Three additive doc edits — `Implementation_Plan_TEMPLATE.md` Section 1 (Goal + ACs) now opens with a Given/When/Then writing guide that names the format directly; Section 2 (Scope) gains a **Surface inventory** sub-section listing every user-touchable surface as `In scope` / `Already works` / `Out of scope (waived)`; `1-plan-requirement.md` Step 6 WAIT CHECKPOINT gains two new gate bullets (surface-inventory completeness + AC form) and Step 7's three test-scope heredocs (LOW / MEDIUM / HIGH) carry tier-appropriate AC-writing guidance above each `## Acceptance Criteria` heading. The original REQ-030 failure mode — `AC1: schema accepts inventoryId field` passing review as a valid behavioural AC — is now structurally caught at the plan-review gate.

## [0.1.49] — 2026-06-09

> 0.1.48 was bumped on-disk but never tagged — its contents are folded into this release to minimise consumer-side bumps. Consumers update from 0.1.47 directly to 0.1.49 in a single `devaudit update`.

### Added

- **devaudit#131** — SDLC navigability: every long-running REQ issue now carries an always-current `LAST` / `NEXT` status sticky comment, updated by `sdlc-implementer` at every phase transition + every operator-action handoff. New `scripts/update-sdlc-status.sh` is the idempotent helper (find-or-create via marker-tagged comment; `--dry-run` for safe inspection). The skill body now invokes it at the start of Phase 1, the end of Phases 1/2/3/4, and at every Phase 5 terminal (released / change-request loop / incident). Skill body also documents the matching `LAST: / NEXT:` chat-output convention. Operators returning to a long thread can now find "what just happened + what's next" without re-scrolling. 12 new hermetic tests over the helper.

### Changed

- **devaudit#132** — `sdlc-implementer`'s e2e delegation contract is now backed by two structural gates inside Phase 2, not just MUST-prose. Step 3 requires a literal pre-test-work declaration (`Delegating e2e test work to e2e-test-engineer.`) before any `e2e/**/*.spec.ts` edit, immediately followed by a `Skill(name: "e2e-test-engineer", …)` invocation. New step 9 (before Phase 3) is a mandatory self-audit: every `*.spec.ts` in the diff must be placed in one of two categories ("authored via skill on turn N" / "mechanical edit only"), or the orchestrator STOPs and reverts. Both gates exist because the rule alone was bypassed by inertia in past runs (REQ-075 + REQ-076 receipts); the gates are scripts the agent follows, not prose it can rationalise around.

## [0.1.47] — 2026-06-08

### Fixed

- **devaudit#133** — Unedited governance starter stubs (incident-report.md, etc.) no longer flip framework-coverage clauses to COVERED off placeholder content. `scripts/upload-evidence.sh` now skips any file still carrying the `STARTER TEMPLATE — REPLACE BEFORE …` banner (matches both v0.1.36+ "BEFORE COMMITTING" and pre-v0.1.36 "BEFORE GOING TO PRODUCTION" phrasings). Central guard protects every upload path — governance helper, per-REQ loop, future callers. New `SKIPPED` counter in the summary; exit code unchanged (only `FAILED > 0` exits 1).
- **devaudit#133** — `compliance-evidence.yml.template` now globs `incident-report*.md` (under both top-level and `compliance/governance/`) so real per-incident files written by `incident-export.yml` upload as evidence. Previously the exact-name match missed `incident-report-<id>.md` entirely.
- Doc accuracy: `incident-report.md.template` reflects the new behaviour — unedited stub is held back; COVERED flips only when a non-stub matches the glob.

## [0.1.8] — 2026-05-24

### Fixed

- `derive-release-version.sh` now also resolves a bracketed `[REQ-XXX]` tag in the **commit body**, not just the subject + `Ref:` line. A "Merge pull request …" commit carries the PR title (with its `[REQ-XXX]` tag) in the body, so PR-merged requirements were falling through to the date fallback and fragmenting onto a phantom `v<date>` release at `ci.yml`'s register-release step. Bracketed-only, so unbracketed prose ("target close: REQ-002") still can't beat a real `Ref:`. Regression-tested (case 8).

## [0.1.7] — 2026-05-24

### Fixed

- Bundled `post-deploy-prod.yml` now uploads the release ticket to the **production** environment (`release_artifact`) alongside the smoke results. Submit-for-production-review requires a release ticket in the production env (`STATUS_ENVIRONMENT[prod_review] = 'production'`), but the dev/UAT pipeline only uploaded it to `uat` — so the prod-review submission was unsatisfiable. The promoted release's ticket is now carried forward to production.

## [0.1.6] — 2026-05-24

### Fixed

- Bundled `post-deploy-prod.yml` now resolves the **promoted REQ release** instead of a date-prefixed one. It derives the version from the commits merged into the push (`[REQ-XXX]` subject tags / `Ref:` lines, `fetch-depth: 0`), falling back to a bare date only for date-versioned consumers. Previously a REQ-versioned release never converged at the production stage — prod evidence and the `prod_review` advance landed on a phantom `v<date>` release while the real REQ release stayed `uat_approved`.

## [0.1.5] — 2026-05-24

### Fixed

- Bundled `derive-release-version.sh` now reads the release id from the `[REQ-XXX]` subject tag or the `Ref:` line only — not the first `REQ-\d+` anywhere in the commit body. A prose forward-reference (e.g. "target close: REQ-002" before "Ref: REQ-001") no longer misroutes a release's gate evidence onto a phantom release named after the wrong requirement. Regression-tested (case 7). Same greedy-prose class as the 0.1.4 validator fix.

## [0.1.4] — 2026-05-24

### Fixed

- Bundled compliance validator (`sdlc/files/_common/scripts/validate-compliance-artifacts.sh`) now scopes requirement extraction to the commit `[REQ-XXX]` subject tag and `Ref:` trailer, instead of scraping the entire commit body. Prose forward-references like "target close: REQ-002" no longer cause CI to demand evidence dirs for requirements that haven't started. New regression case in the validator test suite (17 pass). Consumers pick this up on the next `devaudit update`.

## [0.1.3] — 2026-05-24

> Supersedes a broken manual `0.1.2` publish whose tarball carried an unresolved
> `@metasession.co/devaudit-plugin-sdk: file:../plugin-sdk` dependency (the manual
> `npm publish` bypassed `release.yml`'s `file:`→`^version` rewrite, so `npm i -g`
> failed). `0.1.2` is deprecated; this is the same change set published correctly
> via the tagged CI release. Lockstep release across all four packages.

### Added

- **Templates are now bundled into the package.** `prepack` runs `tools/bundle-templates.mjs`, which copies `sdlc/` and `scripts/upload-evidence.sh` from the repo root into the package, and `package.json` `files` ships them. The published tarball is self-contained — `devaudit install` / `devaudit update` work from a global `npm i -g` install with no DevAudit-Installer checkout. Implements the bundling design in `docs/devaudit-cli/build-plan.md` / ADR-001.

### Changed

- `resolveInstallerRoot()` now locates templates by the presence of `sdlc/files` (priority: `DEVAUDIT_INSTALLER_ROOT` → bundled package snapshot → repo root), instead of probing for `scripts/sdlc-onboard.sh`. The CLI no longer depends on the bash installer existing.

### Removed

- The bash installer (`scripts/sdlc-onboard.sh`, `scripts/sync-sdlc.sh`) has been removed from the repo. `devaudit install` / `devaudit update` are the only supported onboarding/sync path. (`scripts/upload-evidence.sh` stays — it's synced into consumers and bundled here.)

## [0.1.1] — 2026-05-19

### Fixed

- `devaudit --version` now reports the actual package version instead of a stale hardcoded `0.0.1`. Version is read from `package.json` at build time via a typed JSON import; tsup inlines it into the bundle. The constant can no longer drift from the published version.

### Docs

- `cli/README.md` now leads with the `npm install -g @metasession.co/devaudit-cli` snippet so the npm-registry page guides users straight to install. Status section bumped to 0.1.1.

## [0.1.0] — 2026-05-19

First public release. Package renamed from `@metasession-dev/devaudit-cli` (GitHub org scope) to `@metasession.co/devaudit-cli` (npm org scope). Repo flipped public; Apache-2.0 licensed. Published to npmjs.org with SLSA provenance.

### Added

- `devaudit push --dry-run` now short-circuits before any portal mutation. The CLI enumerates which evidence files would be uploaded (via the same `collectFiles` logic the live upload uses) and prints them; no POST to `/api/evidence/upload` happens. Operators can safely preview a push before running it for real. Combined with `--json`, dry-run emits a single structured planned payload: `{ dryRun: true, projectSlug, requirementId, evidenceType, baseUrl, files, metadata, ... }`.
- `devaudit auth status --json` emits one parseable JSON object instead of a stream of pretty log lines. Shape: `{ ok: true, source: 'env' | 'file', baseUrl, projects: [...slugs] }` on success; `{ ok: false, reason: 'not_logged_in' | 'portal_rejected' | 'unexpected', ... }` on failure. Prose path unchanged.
- `devaudit status --json` emits one structured object: `{ ok, projectPath, project_slug, stack, host, node_version | python_version, devaudit_base_url, uat_enabled, approval_mode, files_present, files_missing }`. The `not_onboarded` failure path also emits structured JSON when `--json` is set. Useful for piping into other tools.
- `lib/logger.ts` exports `isJsonMode()` and `emitJsonResult(payload)` — small helpers so commands can branch on JSON mode and emit a single result line rather than rely on consola's per-log JSON records.

### Fixed

- `devaudit install --yes` on an existing consumer no longer wipes rich `sdlc-config.json` customizations. Previously the `--yes` path read only 4 fields (`project_slug`, runtime version, `source_dirs`, `working_directory`) and the write step then rebuilt the config from defaults — so re-running install on a customized consumer (e.g. WGB, which has `runner: self-hosted`, `sast_baseline: 6`, `database_service: mongodb`, custom `build_env`, custom `paths_ignore`, etc.) would erase all of those fields. Now `write-config.ts` reads the existing config and merges: wizard-owned fields (stack/host/slug/runtime/source_dirs/working_directory/production_url_secret/devaudit block) always come from the current plan; everything else is preserved if present, defaulted otherwise. `prompts.ts:planFromConfig` also now reads `production_url_secret` from the existing config so the wizard doesn't overwrite a custom-named secret. Caught during the WGB smoke against PR #8; new vitest case in `install.test.ts` seeds a richly customized config and asserts every non-wizard field survives a `--yes` re-install.

### Added

- `devaudit plugin install / list / remove / update` are now functional (slice 3 of workstream D), replacing the previous stubs. `install <git-url>` does `git clone --depth 1` into `~/.config/devaudit/plugins/<derived-name>/`, runs `npm install --legacy-peer-deps`, then validates the manifest via the SDK — on validation failure the directory is rm-rf'd and the operator gets a clear error. `list` discovers plugins under `~/.config/devaudit/plugins/`, prints each loaded plugin's name+version+hooks+commands, and surfaces failed-to-load plugins with their reason. `remove <name>` matches by package name or directory name and removes the dir. `update` runs `git pull --ff-only` + `npm install` in each git-backed plugin dir; non-git plugin dirs are skipped with a warning. Each command accepts an optional `root` override for testability. Portal-registry-backed name resolution (e.g. `devaudit plugin install devaudit-plugin-prisma`) remains pending — see #6.
- Plugin loader (slice 2 of workstream D). New `cli/src/lib/plugin/` module discovers plugins under `~/.config/devaudit/plugins/<name>/`, validates each manifest via `@metasession.co/devaudit-plugin-sdk`'s `validateManifest()`, dynamic-imports each main module, and registers plugin-contributed commands under `devaudit <plugin-name> <sub-cmd>`. `runHook(plugins, hookName, ctx)` is wired into `install` (`beforeInstall` / `afterInstall`), `update` (`beforeSync` / `afterSync`), `push` (`beforePush` / `afterPush`), and `doctor` (`onDoctor`) — per-plugin errors are isolated so a misbehaving plugin can't crash the CLI. CLI now depends on `@metasession.co/devaudit-plugin-sdk` via `file:../plugin-sdk` (CI builds the SDK first). 7 new vitest cases cover discovery, runtime apiVersion mismatch, error isolation, skip on missing hook, and commander command registration. Plugin install/list/remove/update CLI commands stay stubbed pending the portal plugin registry (slice 3+ of workstream D).
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
