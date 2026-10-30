# @metasession.co/devaudit-core

The pure shared core of DevAudit. The `devaudit` CLI and the DevAudit portal both consume it, so a repository gets the same answer from either.

> **Status:** new in the guided-onboarding work (DevAudit-Installer#1116). It holds the repository detection so far; the gap model, presets, the question registry and the local scan arrive in later work packages.

## Entry points

| Import | What it holds |
| --- | --- |
| `@metasession.co/devaudit-core` | Pure logic. No `node:` imports and no terminal, so it runs in a browser or a server. |
| `@metasession.co/devaudit-core/node` | The Node-only helpers (for example a file-system `RepoReader`). The only place that may import `node:` modules. |

## Detecting a repository

```ts
import { detectFacts } from '@metasession.co/devaudit-core';
import { fsRepoReader } from '@metasession.co/devaudit-core/node';

const facts = await detectFacts(fsRepoReader(process.cwd()));
// { stack, workingDirectory, host, testRunner, testGroups, branches, runner, governanceFiles, testData }
```

Detection reads files only, through a `RepoReader`. It never runs anything from the repository and never reads outside it: a path that is absolute or has a `..` segment is refused with `RepoPathError`, and `fsRepoReader` treats a symlink that leaves the root as absent. A directory entry from `list` ends with `/`. The portal supplies its own `RepoReader` over the GitHub API.

## Gaps

`Gap` is the shape for "this is not as it should be, here is why, and here is what you can do": `{ id, source, check, subject, title, why, controls, options[] }`, each option `{ id, label, tier, consequence, remediation? }` with a fix tier of `A` (local and reversible), `B` (portal state, interactive only) or `C` (guidance that is printed, never run). `findingToGap(check, finding, explanation?)` builds one from a check's finding and never returns a gap without a reason or an option. A gap describes; whoever shows it decides what to offer and always lets the person leave it as it is.

## Develop

```sh
cd core
npm install --legacy-peer-deps
npm run build
npm test
```

## Licence

Apache-2.0, like the rest of this repository.
