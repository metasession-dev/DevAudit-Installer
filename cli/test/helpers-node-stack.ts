import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The node stack adapter's required devDependencies, read from the adapter itself so a fixture
// never drifts from it. A sync fixture whose package.json already lists them makes
// `syncStackDeps` report "all present" instead of running `npm install --save-dev ...`
// (a network call that, on a loaded Windows runner, ran to the 300 s test limit; #1089).
const adapterPath = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), 'sdlc', 'files', 'stacks', 'node', 'adapter.json');

export function nodeStackDevDependencies(): Record<string, string> {
  const adapter = JSON.parse(readFileSync(adapterPath, 'utf-8')) as { required_dev_dependencies?: string[] };
  return Object.fromEntries((adapter.required_dev_dependencies ?? []).map((name) => [name, '*']));
}

/** A `package.json` body for a node-stack sync fixture that triggers no `npm install`. */
export function nodeStackPackageJson(name = 'fixture'): string {
  return JSON.stringify({ name, private: true, version: '0.0.0', devDependencies: nodeStackDevDependencies() });
}
