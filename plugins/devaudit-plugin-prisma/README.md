# devaudit-plugin-prisma

First-party DevAudit plugin: Prisma migration deploy hooks and status helpers for Node consumers.

## What it adds

When loaded, this plugin contributes:

### Commands

- `devaudit prisma migrate-status` — shells out to `npx prisma migrate status` in the consumer project; warns if there is no `prisma/schema.prisma`.
- `devaudit prisma pending` — lists migration directories under `prisma/migrations/`. Emits a `prisma-migrations` plugin event with the count.

### Lifecycle hooks

- `afterUpdate` — when the consumer has a `prisma/schema.prisma`, prints a friendly reminder to run `npx prisma migrate deploy` after deploy.
- `onDoctor` — checks that both `prisma/schema.prisma` and `prisma/migrations/` are present; warns if one is missing.

## Install

```sh
devaudit plugin install @metasession.co/devaudit-plugin-prisma
```

The plugin is published on npm; the CLI installs it from there. The source also lives in-tree under `plugins/devaudit-plugin-prisma/` for first-party development.

Pre-release / from-source install (against a Git tag or commit) remains available:

```sh
devaudit plugin install https://github.com/metasession-dev/DevAudit-Installer.git#plugins/devaudit-plugin-prisma
```

## Compatibility

| | |
|---|---|
| SDK apiVersion | `1` |
| Node | `>=22` |
| Targets | Any Node consumer with `prisma/` artefacts. Skips silently in projects without them. |

## Tests

```sh
npm install --legacy-peer-deps   # plugin-sdk must be built first
npm run build
npm test
```

9 vitest cases cover both commands and both hooks against empty, schema-only, and schema+migrations fixtures.
