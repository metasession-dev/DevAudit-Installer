import { promises as fs } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';

// Several suites spawn the built CLI (`node dist/index.js`: doctor, cli-smoke,
// ...). A `dist/` built before the latest source change makes them fail on
// behaviour the source no longer has, on a developer machine only (CI builds
// first). Rebuild when dist is missing or older than any file under src/, so a
// stale build can never produce a false failure.

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function newestMtime(dir: string): Promise<number> {
  let newest = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    const t = entry.isDirectory() ? await newestMtime(p) : (await fs.stat(p)).mtimeMs;
    if (t > newest) newest = t;
  }
  return newest;
}

export default async function setup(): Promise<void> {
  const dist = join(CLI_ROOT, 'dist', 'index.js');
  const built = await fs.stat(dist).then((s) => s.mtimeMs, () => 0);
  const source = Math.max(await newestMtime(join(CLI_ROOT, 'src')), (await fs.stat(join(CLI_ROOT, 'package.json'))).mtimeMs);
  if (built >= source) return;
  console.warn('[global-setup] dist/ is missing or older than src/: rebuilding with tsup');
  await execa('npx', ['tsup'], { cwd: CLI_ROOT, stdio: 'inherit' });
}
