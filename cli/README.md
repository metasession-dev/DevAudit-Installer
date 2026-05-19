# `devaudit` — the Metasession SDLC CLI

> Single-binary, cross-platform tool for installing, maintaining, and operating the Metasession SDLC across consumer projects. Bundled with the framework templates it ships ([`../sdlc/`](../sdlc/)).

This is the source of `@metasession.co/devaudit-cli` (binary name: `devaudit`). It is under active development — see [tracking issue #1](https://github.com/metasession-dev/DevAudit-Installer/issues/1) and the full design in [`../docs/devaudit-cli/`](../docs/devaudit-cli/).

## Status — v0.0.1

### Working

- `devaudit --help` / `--version`
- `devaudit doctor` — checks `node` (>=22), `git`, `gh`, `jq`, `curl` are on PATH
- `devaudit status [path]` — reads `sdlc-config.json` from a consumer project, prints stack/host/slug/source-dirs, and reports which framework files are present
- `devaudit auth login` — interactive PAT paste flow; validates against the portal; stores at `~/.config/devaudit/auth.json` (mode 0600)
- `devaudit auth logout` — wipes the cached token
- `devaudit auth status` — verifies the cached token (or `DEVAUDIT_USER_TOKEN` env var) by calling `GET /api/projects`
- `devaudit push <slug> <req-id> <type> <file>` — uploads evidence to the portal (port of `upload-evidence.sh`; file or directory; retries on 429/5xx with backoff)
- `devaudit install [path]` — **v0 wrapper** that shells out to `scripts/sdlc-onboard.sh`. Native TS port is workstream A milestone 3.
- `devaudit update <version> <paths...>` — **v0 wrapper** that shells out to `scripts/sync-sdlc.sh`. Native TS port is workstream A milestone 4.

7 vitest tests; all green.

### Stubbed (exit code 1 + helpful pointer)

These need workstream B (portal-side) prereqs or workstream D (plugin SDK) before they can do anything real:

- `devaudit org list / switch / policy list|apply / report`
- `devaudit plugin list / install / remove / update`
- `devaudit config get / set / list`
- `devaudit upgrade` (self-update — needs distribution channel established first)

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

Future structure (per [build-plan.md](../docs/devaudit-cli/build-plan.md)): `src/commands/{install,update,push,auth/*,org/*,plugin/*,config/*,status,upgrade}.ts` and `src/lib/{adapter,devaudit-api,sdlc-config,auth,git-provider,policy,plugin,report,prompts,paths,stack-detect}.ts`.

## Why a CLI when the bash scripts exist?

- Cross-platform native (Linux/macOS/Windows; no WSL requirement)
- JSON output mode on every command for CI
- Interactive UX comparable to Vercel/Supabase/Firebase/GH/Railway CLIs
- Single-binary distribution via Node SEA (no Node runtime required on the user's machine)
- Plugin extensibility
- Organisation-level features: policy-as-code, RBAC, centralised reporting

The full motivation lives in [`../docs/devaudit-cli/README.md`](../docs/devaudit-cli/README.md).
