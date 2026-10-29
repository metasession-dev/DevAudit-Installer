# @metasession.co/devaudit-core

The pure shared core of DevAudit. The `devaudit` CLI and the DevAudit portal both consume it, so a repository gets the same answer from either.

> **Status:** new in the guided-onboarding work (DevAudit-Installer#1116). The package currently exports only its contract version; detection, the gap model, presets, the question registry and the local scan arrive in later work packages.

## Entry points

| Import | What it holds |
| --- | --- |
| `@metasession.co/devaudit-core` | Pure logic. No `node:` imports and no terminal, so it runs in a browser or a server. |
| `@metasession.co/devaudit-core/node` | The Node-only helpers (for example a file-system `RepoReader`). The only place that may import `node:` modules. |

## Develop

```sh
cd core
npm install --legacy-peer-deps
npm run build
npm test
```

## Licence

Apache-2.0, like the rest of this repository.
