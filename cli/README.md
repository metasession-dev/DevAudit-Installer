# `devaudit` — the Metasession SDLC CLI

> Single-binary, cross-platform tool for installing, maintaining, and operating the Metasession SDLC across consumer projects. Bundled with the framework templates it ships ([`../sdlc/`](../sdlc/)).

This is the source of `@metasession-dev/devaudit-cli` (binary name: `devaudit`). It is under active development — see [tracking issue #1](https://github.com/metasession-dev/DevAudit-Installer/issues/1) and the full design in [`../docs/devaudit-cli/`](../docs/devaudit-cli/).

## Status — v0.0.1 (skeleton)

Working today:

- `devaudit --help` — the command surface is registered (commands listed below)
- `devaudit --version` — prints the CLI version
- `devaudit doctor` — checks `node` (>=22), `git`, `gh`, `jq`, `curl` are on PATH

Stubbed (exit code 1, helpful pointer to the build plan):

- `devaudit install / update / push` — ports of `sdlc-onboard.sh` / `sync-sdlc.sh` / `upload-evidence.sh` (the bash scripts still work in the meantime)
- `devaudit auth login / logout / status` — PAT paste first, then browser OAuth
- `devaudit org list / switch / policy list|apply / report` — org features (workstream B prereq on the portal)
- `devaudit plugin list / install / remove / update` — plugin registry (workstream B prereq + plugin SDK in workstream D)
- `devaudit config get / set / list` — CLI configuration
- `devaudit status` — show a consumer's framework state
- `devaudit upgrade` — self-update

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
├── package.json              # @metasession-dev/devaudit-cli, ESM-only, node >=22
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
