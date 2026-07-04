# `devaudit` — the Metasession SDLC CLI

> Single-binary, cross-platform tool for installing, maintaining, and operating the Metasession SDLC across consumer projects. Bundled with the framework templates it ships ([`../sdlc/`](../sdlc/)).

This is the source of `@metasession.co/devaudit-cli` (binary name: `devaudit`). It is under active development — see [tracking issue #1](https://github.com/metasession-dev/DevAudit-Installer/issues/1) and the full design in [`../docs/devaudit-cli/`](../docs/devaudit-cli/).

## Install

`npx` is the canonical zero-install invocation — pulls the latest version on first run:

```bash
npx @metasession.co/devaudit-cli@latest --help
npx @metasession.co/devaudit-cli@latest install ../path/to/your-project
npx @metasession.co/devaudit-cli@latest update
```

Prefer a permanent install? Run once, then the short forms work everywhere:

```bash
npm install -g @metasession.co/devaudit-cli
devaudit --help
devaudit install ../path/to/your-project
devaudit update
```

Requires Node ≥ 22. Native binaries (no Node runtime needed) are on the roadmap.

### Checking for updates

The CLI is distributed via **npm** — not GitHub releases. Check your version against the latest:

```bash
devaudit --version                              # your installed version
npm view @metasession.co/devaudit-cli version   # latest on npm
npm install -g @metasession.co/devaudit-cli@latest   # upgrade
```

## Status — v0.1.1

### Working

- `devaudit --help` / `--version`
- `devaudit doctor` — checks `node` (>=22), `git`, `gh`, `jq`, `curl` are on PATH
- `devaudit status [path]` — reads `sdlc-config.json` from a consumer project, prints stack/host/slug/source-dirs, and reports which framework files are present
- `devaudit install [path]` — **native TS, 11-step interactive onboarding** under `src/install/` (auth-probe → detect-stack → prompts → write-config → project → api-key → github → hooks-bootstrap → branch-protection → sync-templates → done-report). Replaces the former `scripts/sdlc-onboard.sh` (removed); no shell-out.
- `devaudit update <version> <paths...>` — **native TS, multi-project template sync** under `src/update/`. Reads each consumer's `sdlc-config.json`, copies framework files, fires `beforeSync` / `afterSync` plugin hooks. Replaces the former `scripts/sync-sdlc.sh` (removed); no shell-out.
- `devaudit push <slug> <req-id> <type> <file>` — uploads evidence to the portal (port of `upload-evidence.sh`; file or directory; retries on 429/5xx with backoff). Files >=25MB use a presigned R2 upload flow (3-step: request URL → PUT to R2 → notify portal); large-file uploads require the Portal to be configured with R2 evidence storage (`R2_EVIDENCE_BUCKET`). If R2 is not configured, the Portal returns a clear error which is surfaced to the operator.
- `devaudit auth login` — interactive PAT paste flow; validates against the portal; stores at `~/.config/devaudit/auth.json` (mode 0600)
- `devaudit auth logout` — wipes the cached token
- `devaudit auth status` — verifies the cached token (or `DEVAUDIT_USER_TOKEN` env var) by calling `GET /api/projects`
- `devaudit plugin list` — discovers plugins in `~/.config/devaudit/plugins/`, validates manifests, reports load state
- `devaudit plugin install <source>` — npm-name or Git URL; clones / installs / validates / registers
- `devaudit plugin remove <name>` — deregisters and rm-rfs the plugin directory
- `devaudit plugin update` — git-pulls each plugin directory

40 vitest tests across 8 test files; all green on Linux + macOS + Windows.

### Stubbed (exit code 1 + helpful pointer)

These need workstream B (portal-side) prereqs before they can do anything real:

- `devaudit org list / switch / policy list|apply / report` — needs portal RBAC + org endpoints
- `devaudit config get / set / list` — config file already exists, just no CLI surface yet
- `devaudit upgrade` — self-update; needs distribution channel established first (Step 2 of trajectory — native binaries via brew/scoop/curl)

## Develop locally

```bash
cd cli
npm install --legacy-peer-deps   # the framework's polyglot adapter set doesn't peer-clean cleanly with strict node>=22
npm run build                     # tsup → dist/index.js (ESM, bundled)
./bin/devaudit.js --help          # try the CLI
./bin/devaudit.js doctor          # check your local environment
```

## Project structure

```
cli/
├── package.json              # @metasession.co/devaudit-cli, ESM-only, node >=22
├── tsconfig.json             # strict TS
├── tsup.config.ts            # ESM bundle config
├── vitest.config.ts          # test runner
├── bin/
│   └── devaudit.js           # shebang + dynamic import of dist/index.js
└── src/
    ├── index.ts              # commander entry — registers all commands
    ├── commands/
    │   ├── doctor.ts         # real implementation
    │   └── stub.ts           # helper for not-yet-implemented commands
    └── lib/
        ├── logger.ts         # consola wrapper, --json + --verbose aware
        └── version.ts        # CLI version constant
```

## Why a CLI (it replaced the original bash scripts)

- Cross-platform native (Linux/macOS/Windows; no WSL requirement)
- JSON output mode on every command for CI
- Interactive UX comparable to Vercel/Supabase/Firebase/GH/Railway CLIs
- Plugin extensibility (`@metasession.co/devaudit-plugin-sdk` defines the contract; `@metasession.co/devaudit-plugin-prisma` + `@metasession.co/devaudit-plugin-evidence-export` are first-party reference implementations)
- Organisation-level features: policy-as-code, RBAC, centralised reporting
- Single-binary distribution via Node SEA (no Node runtime required on the user's machine) — on the roadmap
