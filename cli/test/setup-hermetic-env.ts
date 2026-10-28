import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

// devaudit-installer#1089 — no test may wait on a real `gh`, the network or a real `npm install`.
//
// The Windows runner flaked with timeouts in tests that run `doctor` or a full `syncProject`: both
// start `gh` (which calls the GitHub API when authenticated) and a fixture with no devDependencies
// makes the sync run a real `npm install --save-dev ...` against the registry. Every vitest worker
// therefore gets, first on PATH:
//   - a `gh` that answers `--version` and fails everything else at once (like "not authenticated");
//   - an `npm` that fails at once with a message, so a fixture that would install packages fails
//     loudly instead of hanging (give it its devDependencies: see `nodeStackDevDependencies`);
// and loses the credentials a developer machine may carry. Tests that need their own `gh` put a
// stub earlier on PATH, as before. Spawned children inherit all of this.
const stubs = mkdtempSync(join(tmpdir(), 'devaudit-test-bin-'));

writeFileSync(
  join(stubs, 'gh'),
  '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "gh version 0.0.0 (devaudit test stub)"; exit 0; fi\nexit 1\n',
  { mode: 0o755 },
);
writeFileSync(
  join(stubs, 'gh.cmd'),
  '@echo off\r\nif "%~1"=="--version" (\r\n  echo gh version 0.0.0 devaudit test stub\r\n  exit /b 0\r\n)\r\nexit /b 1\r\n',
);
writeFileSync(
  join(stubs, 'npm'),
  '#!/bin/sh\necho "npm is disabled in the CLI tests: a sync fixture must declare the stack devDependencies (test/helpers-node-stack.ts)" >&2\nexit 1\n',
  { mode: 0o755 },
);
writeFileSync(
  join(stubs, 'npm.cmd'),
  '@echo off\r\necho npm is disabled in the CLI tests: a sync fixture must declare the stack devDependencies 1>&2\r\nexit /b 1\r\n',
);

// Windows spells the variable `Path`; keep whichever key the environment uses.
const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
process.env[pathKey] = process.env[pathKey] ? `${stubs}${delimiter}${process.env[pathKey]}` : stubs;

for (const name of [
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
  'DEVAUDIT_USER_TOKEN',
  'DEVAUDIT_API_KEY',
  'DEVAUDIT_VIEWER_API_KEY',
]) {
  delete process.env[name];
}
