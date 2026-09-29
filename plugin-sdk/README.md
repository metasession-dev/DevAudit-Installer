# @metasession.co/devaudit-plugin-sdk

Contract types, manifest schema, and lifecycle hooks that DevAudit CLI plugins compile against.

> **Status:** v0 contract. The shape will stabilise at v1; until then expect breaking changes between minor versions.

## Install

```sh
npm install --save-dev @metasession.co/devaudit-plugin-sdk
```

## Author a plugin

A plugin is an npm package whose `package.json` declares a `devaudit` field, and whose `main` module default-exports a `Plugin` object.

### `package.json`

```jsonc
{
  "name": "devaudit-plugin-prisma",
  "version": "1.0.0",
  "main": "./dist/plugin.js",
  "devaudit": {
    "apiVersion": "1",
    "displayName": "Prisma migration helper",
    "description": "Prisma migration deploy hooks for Node consumers",
    "commands": [
      { "name": "migrate-status", "description": "Show pending Prisma migrations" }
    ],
    "hooks": ["afterSync"]
  }
}
```

### `src/plugin.ts`

```ts
import type { Plugin } from '@metasession.co/devaudit-plugin-sdk';

const plugin: Plugin = {
  name: 'devaudit-plugin-prisma',
  apiVersion: '1',
  hooks: {
    afterSync: async (ctx) => {
      ctx.logger.info(`Sync done. Now run \`npx prisma migrate deploy\` in ${ctx.projectPath}.`);
    },
  },
  commands: {
    'migrate-status': async (ctx) => {
      ctx.logger.info('Running Prisma migration status check…');
    },
  },
};

export default plugin;
```

## Lifecycle hooks

`LifecycleHookName` (the type export below) currently includes these values:

| Hook | Fires | Status |
| --- | --- | --- |
| `beforeSync` / `afterSync` | Around the template-copy step of `devaudit update` | **Wired up and working** — the one hook pair every shipped plugin actually uses (e.g. the Prisma plugin's `afterSync`, above). |
| `onDoctor` | At the end of `devaudit doctor`, after the built-in checks | **Wired up and working** — see [`docs/doctor.md`](../docs/doctor.md#plugin-extension-point-ondoctor). |
| `beforeInstall` / `afterInstall` | Around `devaudit install` | **Wired up and working** (`cli/src/install/index.ts`). |
| `beforePush` / `afterPush` | Around `devaudit push` | **Wired up and working** (`cli/src/commands/push.ts`). |
| `beforeUpdate` / `afterUpdate` | Intended to wrap the whole `devaudit update` invocation (broader than just the template-sync step `beforeSync`/`afterSync` cover) | **Reserved, not implemented** — declared in the type, but no code path calls them. If you need a post-sync hook today, use `afterSync`; it covers the same practical use case (act on the freshly-synced tree). |

## What's exported

| Export | Purpose |
|---|---|
| `Plugin` | The object a plugin's main module default-exports |
| `PluginContext` | What the CLI passes to hooks and commands at runtime |
| `PluginManifest` | The `devaudit` field shape inside a plugin's `package.json` |
| `LifecycleHookName` | Union of supported hook names |
| `CommandContribution` | Shape of an entry in `manifest.devaudit.commands` |
| `validateManifest(input)` | Zero-dep shape check; returns either `{ valid: true, manifest }` or `{ valid: false, errors }` |

## Semantic versioning

Plugins declare `devaudit.apiVersion` in their manifest. The CLI's plugin loader rejects plugins whose `apiVersion` is incompatible with the loader's supported range. v0 starts at `apiVersion: "1"`; bumps follow semver of this package.
