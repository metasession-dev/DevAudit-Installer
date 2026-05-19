# @metasession/devaudit-plugin-sdk

Contract types, manifest schema, and lifecycle hooks that DevAudit CLI plugins compile against.

> **Status:** v0 contract. The shape will stabilise at v1; until then expect breaking changes between minor versions.

## Install

```sh
npm install --save-dev @metasession/devaudit-plugin-sdk
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
    "hooks": ["afterUpdate"]
  }
}
```

### `src/plugin.ts`

```ts
import type { Plugin } from '@metasession/devaudit-plugin-sdk';

const plugin: Plugin = {
  name: 'devaudit-plugin-prisma',
  apiVersion: '1',
  hooks: {
    afterUpdate: async (ctx) => {
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
